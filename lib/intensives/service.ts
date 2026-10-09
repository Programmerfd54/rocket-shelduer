/**
 * Операции с интенсивами: список, карточка, создание, изменение (с анализом последствий),
 * публикация (advisory lock + проверка пересечений), отмена, архивирование.
 * Создание/публикация не запускают отправки; завершение периода ничего не отменяет и не архивирует.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { canViewOrgSpace, loadIntensiveForViewer, userRef, USER_REF_SELECT, type IntensiveViewer } from './access';
import {
  dayDate,
  dbDateFromYmd,
  intensiveLengthDays,
  intensivePhase,
  localYmdOfInstant,
  periodsOverlap,
  ymdFromDbDate,
} from './dates';
import { appendEvent, appendEvents, setHistoryActor } from './events';
import { ApiError, isDbConstraintError } from './http';
import { findOverlaps, lockOrgSpaceSchedule, OVERLAP_CONSTRAINT } from './overlap';
import { generatePlanFromOfficial } from './plan';
import { computeProgressForIntensives, toIntensiveSummary, type IntensiveRowForView } from './progress';
import type {
  DateChangeImpact,
  IntensiveDetail,
  IntensiveOverlapRef,
  IntensivePhase,
  IntensiveStatus,
  IntensiveSummary,
  MessageStatus,
  OutOfRangeResolution,
  PlanViewScope,
} from './types';
import { INTENSIVE_PHASES, INTENSIVE_STATUSES } from './types';

const INTENSIVE_INCLUDE = { orgSpace: { select: { id: true, name: true } } } as const;
const MAX_LIST = 500;

function overlapConflict(conflicts: IntensiveOverlapRef[]): ApiError {
  return new ApiError(409, 'INTENSIVE_OVERLAP', 'Период пересекается с опубликованным интенсивом этого пространства', {
    conflicts,
  });
}

function versionConflict(): ApiError {
  return new ApiError(409, 'VERSION_CONFLICT', 'Интенсив уже изменён другим пользователем. Обновите страницу.');
}

/** Проверка оптимистической версии (если передана). */
function assertVersion(current: number, expected: number | undefined): void {
  if (expected !== undefined && expected !== current) throw versionConflict();
}

/* ───────────── Список ───────────── */

export interface ListFilters {
  year?: number;
  orgSpaceId?: string;
  workspaceId?: string;
  phase?: IntensivePhase;
  statuses?: IntensiveStatus[];
  includeProgress?: boolean;
  /** Набор пунктов для прогресса (resolveViewScope: Lead_SUP — query scope, остальные — по роли) */
  viewScope?: PlanViewScope;
}

export function parseListFilters(searchParams: URLSearchParams): ListFilters {
  const f: ListFilters = {};
  const year = searchParams.get('year');
  if (year != null) {
    const n = Number(year);
    if (!Number.isInteger(n) || n < 2000 || n > 2100) throw new ApiError(400, 'BAD_REQUEST', 'Некорректный год');
    f.year = n;
  }
  const phase = searchParams.get('phase');
  if (phase != null) {
    const p = phase.toUpperCase();
    if (!(INTENSIVE_PHASES as readonly string[]).includes(p)) throw new ApiError(400, 'BAD_REQUEST', 'Некорректная фаза');
    f.phase = p as IntensivePhase;
  }
  const status = searchParams.get('status');
  if (status != null) {
    const list = status
      .split(',')
      .map((s) => s.trim().toUpperCase())
      .filter(Boolean);
    if (list.some((s) => !(INTENSIVE_STATUSES as readonly string[]).includes(s))) {
      throw new ApiError(400, 'BAD_REQUEST', 'Некорректный статус');
    }
    f.statuses = list as IntensiveStatus[];
  }
  for (const key of ['orgSpaceId', 'workspaceId'] as const) {
    const v = searchParams.get(key);
    if (v != null) {
      if (!/^[A-Za-z0-9_-]{1,100}$/.test(v)) throw new ApiError(400, 'BAD_REQUEST', 'Некорректный идентификатор');
      f[key] = v;
    }
  }
  f.includeProgress = searchParams.get('progress') !== 'false';
  return f;
}

export async function listIntensives(
  viewer: IntensiveViewer,
  filters: ListFilters,
  now: Date = new Date()
): Promise<{ intensives: IntensiveSummary[]; resolvedOrgSpaceId: string | null }> {
  let statuses = filters.statuses ?? (viewer.isLead ? (['DRAFT', 'PUBLISHED'] as IntensiveStatus[]) : (['PUBLISHED'] as IntensiveStatus[]));
  if (!viewer.isLead) statuses = statuses.filter((s) => s !== 'DRAFT');
  if (statuses.length === 0) return { intensives: [], resolvedOrgSpaceId: null };

  let orgSpaceId = filters.orgSpaceId ?? null;
  if (filters.workspaceId) {
    if (!viewer.isLead && !viewer.accessibleWorkspaceIds.has(filters.workspaceId)) {
      throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено');
    }
    const ws = await prisma.workspaceConnection.findUnique({
      where: { id: filters.workspaceId },
      select: { orgSpaceId: true },
    });
    if (!ws) throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено');
    if (!ws.orgSpaceId) return { intensives: [], resolvedOrgSpaceId: null };
    if (orgSpaceId && orgSpaceId !== ws.orgSpaceId) return { intensives: [], resolvedOrgSpaceId: ws.orgSpaceId };
    orgSpaceId = ws.orgSpaceId;
  }
  if (orgSpaceId && !canViewOrgSpace(viewer, orgSpaceId)) return { intensives: [], resolvedOrgSpaceId: orgSpaceId };

  const where: Prisma.IntensiveWhereInput = { status: { in: statuses } };
  if (orgSpaceId) where.orgSpaceId = orgSpaceId;
  else if (viewer.orgSpaceIds !== null) where.orgSpaceId = { in: Array.from(viewer.orgSpaceIds) };
  if (filters.year) {
    where.startDate = { lte: dbDateFromYmd(`${filters.year}-12-31`) };
    where.endDate = { gte: dbDateFromYmd(`${filters.year}-01-01`) };
  }

  let rows = await prisma.intensive.findMany({
    where,
    include: INTENSIVE_INCLUDE,
    orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
    take: MAX_LIST,
  });
  if (filters.phase) {
    rows = rows.filter(
      (r) =>
        r.status === 'PUBLISHED' &&
        intensivePhase(ymdFromDbDate(r.startDate), ymdFromDbDate(r.endDate), r.timezone, now) === filters.phase
    );
  }

  const progressMap =
    filters.includeProgress !== false
      ? await computeProgressForIntensives(viewer, rows.map((r) => r.id), now, filters.viewScope ?? 'ALL')
      : null;

  // Lead_SUP: предупреждения о пересечениях (черновики/опубликованные одного OrgSpace)
  let overlapsById: Map<string, IntensiveOverlapRef[]> | null = null;
  if (viewer.isLead && rows.length > 0) {
    const orgIds = Array.from(new Set(rows.map((r) => r.orgSpaceId)));
    const peers = await prisma.intensive.findMany({
      where: { orgSpaceId: { in: orgIds }, status: { in: ['DRAFT', 'PUBLISHED'] } },
      select: { id: true, orgSpaceId: true, name: true, status: true, startDate: true, endDate: true },
    });
    overlapsById = new Map();
    for (const r of rows) {
      if (r.status !== 'DRAFT' && r.status !== 'PUBLISHED') continue;
      const s = ymdFromDbDate(r.startDate);
      const e = ymdFromDbDate(r.endDate);
      const list = peers
        .filter((p) => p.id !== r.id && p.orgSpaceId === r.orgSpaceId)
        .map((p) => ({ id: p.id, name: p.name, status: p.status, startDate: ymdFromDbDate(p.startDate), endDate: ymdFromDbDate(p.endDate) }))
        .filter((p) => periodsOverlap(s, e, p.startDate, p.endDate));
      overlapsById.set(r.id, list);
    }
  }

  const intensives = rows.map((r) => {
    const pr = progressMap?.get(r.id);
    return toIntensiveSummary(
      r,
      {
        progress: pr?.progress ?? null,
        partial: pr?.partial ?? false,
        ...(pr && filters.viewScope ? { viewScope: filters.viewScope } : {}),
        ...(overlapsById ? { overlaps: overlapsById.get(r.id) ?? [] } : {}),
      },
      now
    );
  });
  return { intensives, resolvedOrgSpaceId: orgSpaceId };
}

/* ───────────── Карточка ───────────── */

export async function getIntensiveDetail(
  viewer: IntensiveViewer,
  id: string,
  now: Date = new Date(),
  viewScope: PlanViewScope = 'ALL'
): Promise<IntensiveDetail> {
  const intensive = await loadIntensiveForViewer(viewer, id);
  const [full, progressMap, connections, planItemCount, linkedMessageCount, overlaps] = await Promise.all([
    prisma.intensive.findUnique({
      where: { id },
      select: { createdBy: { select: USER_REF_SELECT }, updatedBy: { select: USER_REF_SELECT }, cancelReason: true },
    }),
    computeProgressForIntensives(viewer, [id], now, viewScope),
    prisma.workspaceConnection.findMany({
      where: {
        orgSpaceId: intensive.orgSpaceId,
        ...(viewer.isLead ? {} : { id: { in: Array.from(viewer.accessibleWorkspaceIds) } }),
      },
      select: { id: true, workspaceName: true, workspaceUrl: true, isArchived: true },
      orderBy: { workspaceName: 'asc' },
    }),
    prisma.intensivePlanItem.count({ where: { intensiveId: id } }),
    prisma.scheduledMessage.count({ where: { intensiveId: id } }),
    viewer.isLead && (intensive.status === 'DRAFT' || intensive.status === 'PUBLISHED')
      ? findOverlaps(prisma, {
          orgSpaceId: intensive.orgSpaceId,
          startYmd: ymdFromDbDate(intensive.startDate),
          endYmd: ymdFromDbDate(intensive.endDate),
          excludeId: id,
        })
      : Promise.resolve(undefined),
  ]);
  const pr = progressMap.get(id);
  return {
    ...toIntensiveSummary(intensive, { progress: pr?.progress ?? null, partial: pr?.partial ?? false, overlaps, viewScope }, now),
    createdBy: userRef(full?.createdBy),
    updatedBy: userRef(full?.updatedBy),
    cancelReason: full?.cancelReason ?? null,
    workspaces: connections,
    planItemCount,
    linkedMessageCount,
  };
}

/* ───────────── Создание ───────────── */

export async function createIntensive(
  user: CurrentUser,
  input: {
    orgSpaceId: string;
    name: string;
    description?: string | null;
    startDate: string;
    endDate: string;
    timezone: string;
    templateIds?: string[];
  }
): Promise<{ intensive: IntensiveRowForView; overlaps: IntensiveOverlapRef[]; plan: { created: string[]; alreadyInPlan: string[] } | null }> {
  const org = await prisma.orgSpace.findUnique({ where: { id: input.orgSpaceId }, select: { id: true } });
  if (!org) throw new ApiError(404, 'NOT_FOUND', 'Пространство (OrgSpace) не найдено', { fieldErrors: { orgSpaceId: 'Не найдено' } });

  const result = await prisma.$transaction(async (tx) => {
    const intensive = await tx.intensive.create({
      data: {
        orgSpaceId: input.orgSpaceId,
        name: input.name,
        description: input.description ?? null,
        startDate: dbDateFromYmd(input.startDate),
        endDate: dbDateFromYmd(input.endDate),
        timezone: input.timezone,
        status: 'DRAFT',
        createdById: user.id,
        updatedById: user.id,
      },
      include: INTENSIVE_INCLUDE,
    });
    await appendEvent(tx, {
      intensiveId: intensive.id,
      type: 'INTENSIVE_CREATED',
      actorId: user.id,
      details: { name: input.name, startDate: input.startDate, endDate: input.endDate, timezone: input.timezone },
    });
    const plan =
      input.templateIds && input.templateIds.length > 0
        ? await generatePlanFromOfficial(tx, { intensiveId: intensive.id, templateIds: input.templateIds, actorId: user.id })
        : null;
    return { intensive, plan };
  });
  const overlaps = await findOverlaps(prisma, {
    orgSpaceId: input.orgSpaceId,
    startYmd: input.startDate,
    endYmd: input.endDate,
    excludeId: result.intensive.id,
  });
  return { intensive: result.intensive, overlaps, plan: result.plan };
}

/* ───────────── Изменение (даты/пояс — с анализом последствий) ───────────── */

export async function computeDateChangeImpact(
  intensive: { id: string; startDate: Date; endDate: Date; timezone: string },
  next: { startYmd: string; endYmd: string; timezone: string }
): Promise<DateChangeImpact> {
  const oldStart = ymdFromDbDate(intensive.startDate);
  const oldEnd = ymdFromDbDate(intensive.endDate);
  const [items, messages] = await Promise.all([
    prisma.intensivePlanItem.findMany({
      where: { intensiveId: intensive.id },
      select: { id: true, title: true, dayNumber: true },
      orderBy: { position: 'asc' },
    }),
    prisma.scheduledMessage.findMany({
      where: { intensiveId: intensive.id },
      select: { id: true, planItemId: true, status: true, scheduledFor: true, sentAt: true },
    }),
  ]);
  const sendCount = new Map<string, number>();
  for (const m of messages) if (m.planItemId) sendCount.set(m.planItemId, (sendCount.get(m.planItemId) ?? 0) + 1);

  const recDate = (start: string, end: string, day: number | null) =>
    day != null && day >= 1 && day <= intensiveLengthDays(start, end) ? dayDate(start, day) : null;

  const affectedItems: DateChangeImpact['affectedItems'] = [];
  const itemsWithSends: DateChangeImpact['itemsWithSends'] = [];
  for (const it of items) {
    const c = sendCount.get(it.id) ?? 0;
    if (c > 0) {
      itemsWithSends.push({ planItemId: it.id, title: it.title, sendCount: c });
      continue;
    }
    const fromDate = recDate(oldStart, oldEnd, it.dayNumber);
    const toDate = recDate(next.startYmd, next.endYmd, it.dayNumber);
    if (fromDate !== toDate) affectedItems.push({ planItemId: it.id, title: it.title, dayNumber: it.dayNumber, fromDate, toDate });
  }

  const messagesOutsideNewRange: DateChangeImpact['messagesOutsideNewRange'] = [];
  for (const m of messages) {
    if (m.status === 'CANCELLED') continue;
    const at = m.status === 'SENT' && m.sentAt ? m.sentAt : m.scheduledFor;
    const localDate = localYmdOfInstant(at, next.timezone);
    if (localDate < next.startYmd || localDate > next.endYmd) {
      messagesOutsideNewRange.push({
        messageId: m.id,
        planItemId: m.planItemId,
        status: m.status as MessageStatus,
        scheduledFor: m.scheduledFor.toISOString(),
        localDate,
      });
    }
  }
  return { affectedItems, itemsWithSends, messagesOutsideNewRange, linkedMessageCount: messages.length };
}

export async function updateIntensive(
  user: CurrentUser,
  viewer: IntensiveViewer,
  id: string,
  input: {
    version: number;
    name?: string;
    description?: string | null;
    startDate?: string;
    endDate?: string;
    timezone?: string;
    confirmImpact?: boolean;
    outOfRangeResolution?: OutOfRangeResolution;
  }
): Promise<{ intensive: IntensiveRowForView; impact: DateChangeImpact | null }> {
  const current = await loadIntensiveForViewer(viewer, id);
  assertVersion(current.version, input.version);

  const oldStart = ymdFromDbDate(current.startDate);
  const oldEnd = ymdFromDbDate(current.endDate);
  const nextStart = input.startDate ?? oldStart;
  const nextEnd = input.endDate ?? oldEnd;
  const nextTz = input.timezone ?? current.timezone;
  const datesChanged = nextStart !== oldStart || nextEnd !== oldEnd || nextTz !== current.timezone;

  if (datesChanged && current.status !== 'DRAFT' && current.status !== 'PUBLISHED') {
    throw new ApiError(409, 'INTENSIVE_READ_ONLY', 'Даты отменённого или архивного интенсива не меняются');
  }
  if (nextEnd < nextStart) {
    throw new ApiError(400, 'VALIDATION_ERROR', 'Дата окончания раньше даты начала', {
      fieldErrors: { endDate: 'Дата окончания раньше даты начала' },
    });
  }

  let impact: DateChangeImpact | null = null;
  let pendingOutside: string[] = [];
  if (datesChanged) {
    impact = await computeDateChangeImpact(current, { startYmd: nextStart, endYmd: nextEnd, timezone: nextTz });
    if (impact.linkedMessageCount > 0 && !input.confirmImpact) {
      throw new ApiError(409, 'IMPACT_CONFIRMATION_REQUIRED', 'Есть связанные сообщения: подтвердите изменение дат', { impact });
    }
    pendingOutside = impact.messagesOutsideNewRange.filter((m) => m.status === 'PENDING').map((m) => m.messageId);
    if (pendingOutside.length > 0 && !input.outOfRangeResolution) {
      throw new ApiError(
        409,
        'OUT_OF_RANGE_DECISION_REQUIRED',
        'Запланированные сообщения окажутся вне новых дат: выберите, что с ними сделать',
        { impact }
      );
    }
  }

  const changes: Record<string, { from: unknown; to: unknown }> = {};
  if (input.name !== undefined && input.name !== current.name) changes.name = { from: current.name, to: input.name };
  if (input.description !== undefined && input.description !== current.description) {
    changes.description = { from: current.description, to: input.description };
  }
  if (nextStart !== oldStart) changes.startDate = { from: oldStart, to: nextStart };
  if (nextEnd !== oldEnd) changes.endDate = { from: oldEnd, to: nextEnd };
  if (nextTz !== current.timezone) changes.timezone = { from: current.timezone, to: nextTz };

  try {
    const updated = await prisma.$transaction(async (tx) => {
      if (datesChanged && current.status === 'PUBLISHED') {
        await lockOrgSpaceSchedule(tx, current.orgSpaceId);
        const conflicts = await findOverlaps(tx, {
          orgSpaceId: current.orgSpaceId,
          startYmd: nextStart,
          endYmd: nextEnd,
          excludeId: id,
          statuses: ['PUBLISHED'],
        });
        if (conflicts.length > 0) throw overlapConflict(conflicts);
      }
      const res = await tx.intensive.updateMany({
        where: { id, version: input.version },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(datesChanged
            ? { startDate: dbDateFromYmd(nextStart), endDate: dbDateFromYmd(nextEnd), timezone: nextTz }
            : {}),
          updatedById: user.id,
          version: { increment: 1 },
        },
      });
      if (res.count !== 1) throw versionConflict();

      if (pendingOutside.length > 0) {
        await setHistoryActor(tx, user.id);
        if (input.outOfRangeResolution === 'cancel') {
          await tx.scheduledMessage.updateMany({
            where: { id: { in: pendingOutside }, intensiveId: id, status: 'PENDING' },
            data: { status: 'CANCELLED' },
          });
        } else if (input.outOfRangeResolution === 'detach') {
          const rows = await tx.scheduledMessage.findMany({
            where: { id: { in: pendingOutside }, intensiveId: id },
            select: { id: true, planItemId: true },
          });
          await tx.scheduledMessage.updateMany({
            where: { id: { in: rows.map((r) => r.id) } },
            data: { intensiveId: null, planItemId: null, isPlanRepeat: false },
          });
          await appendEvents(
            tx,
            rows.map((r) => ({
              intensiveId: id,
              type: 'MESSAGE_DETACHED' as const,
              actorId: user.id,
              planItemId: r.planItemId,
              messageId: r.id,
              details: { reason: 'date_change' },
            }))
          );
        }
      }
      if (Object.keys(changes).length > 0) {
        await appendEvent(tx, {
          intensiveId: id,
          type: 'INTENSIVE_UPDATED',
          actorId: user.id,
          details: {
            changes,
            ...(pendingOutside.length > 0
              ? { outOfRangeResolution: input.outOfRangeResolution, outOfRangeMessageIds: pendingOutside }
              : {}),
          },
        });
      }
      return tx.intensive.findUniqueOrThrow({ where: { id }, include: INTENSIVE_INCLUDE });
    });
    return { intensive: updated, impact };
  } catch (e) {
    if (isDbConstraintError(e, OVERLAP_CONSTRAINT)) throw overlapConflict([]);
    throw e;
  }
}

/* ───────────── Публикация / отмена / архив ───────────── */

export async function publishIntensive(user: CurrentUser, viewer: IntensiveViewer, id: string, version?: number) {
  const current = await loadIntensiveForViewer(viewer, id);
  try {
    return await prisma.$transaction(async (tx) => {
      await lockOrgSpaceSchedule(tx, current.orgSpaceId);
      const fresh = await tx.intensive.findUniqueOrThrow({ where: { id } });
      if (fresh.status !== 'DRAFT') {
        throw new ApiError(409, 'INVALID_STATUS_TRANSITION', 'Опубликовать можно только черновик');
      }
      assertVersion(fresh.version, version);
      const conflicts = await findOverlaps(tx, {
        orgSpaceId: fresh.orgSpaceId,
        startYmd: ymdFromDbDate(fresh.startDate),
        endYmd: ymdFromDbDate(fresh.endDate),
        excludeId: id,
        statuses: ['PUBLISHED'],
      });
      if (conflicts.length > 0) throw overlapConflict(conflicts);
      const res = await tx.intensive.updateMany({
        where: { id, version: fresh.version, status: 'DRAFT' },
        data: { status: 'PUBLISHED', publishedAt: new Date(), updatedById: user.id, version: { increment: 1 } },
      });
      if (res.count !== 1) throw versionConflict();
      await appendEvent(tx, { intensiveId: id, type: 'INTENSIVE_PUBLISHED', actorId: user.id });
      return tx.intensive.findUniqueOrThrow({ where: { id }, include: INTENSIVE_INCLUDE });
    });
  } catch (e) {
    if (isDbConstraintError(e, OVERLAP_CONSTRAINT)) throw overlapConflict([]);
    throw e;
  }
}

async function pendingMessagesOf(db: Prisma.TransactionClient | typeof prisma, intensiveId: string) {
  return db.scheduledMessage.findMany({
    where: { intensiveId, status: 'PENDING' },
    select: { id: true, planItemId: true, scheduledFor: true, workspaceId: true, isPlanRepeat: true },
    orderBy: { scheduledFor: 'asc' },
  });
}

export async function cancelIntensive(
  user: CurrentUser,
  viewer: IntensiveViewer,
  id: string,
  input: { version?: number; resolution?: 'cancel_messages' | 'detach_messages'; reason?: string | null }
) {
  const current = await loadIntensiveForViewer(viewer, id);
  if (current.status !== 'DRAFT' && current.status !== 'PUBLISHED') {
    throw new ApiError(409, 'INVALID_STATUS_TRANSITION', 'Отменить можно только черновик или опубликованный интенсив');
  }
  assertVersion(current.version, input.version);

  const toPendingDto = (rows: Awaited<ReturnType<typeof pendingMessagesOf>>) =>
    rows.map((m) => ({
      messageId: m.id,
      planItemId: m.planItemId,
      scheduledFor: m.scheduledFor.toISOString(),
      workspaceId: m.workspaceId,
      isPlanRepeat: m.isPlanRepeat,
    }));

  const pending = await pendingMessagesOf(prisma, id);
  if (pending.length > 0 && !input.resolution) {
    throw new ApiError(409, 'PENDING_MESSAGES_EXIST', 'Есть запланированные сообщения: выберите, что с ними сделать', {
      pendingMessages: toPendingDto(pending),
    });
  }

  return prisma.$transaction(async (tx) => {
    await setHistoryActor(tx, user.id);
    const pendingNow = await pendingMessagesOf(tx, id);
    if (pendingNow.length > 0 && !input.resolution) {
      throw new ApiError(409, 'PENDING_MESSAGES_EXIST', 'Есть запланированные сообщения: выберите, что с ними сделать', {
        pendingMessages: toPendingDto(pendingNow),
      });
    }
    let affected = 0;
    if (pendingNow.length > 0 && input.resolution === 'cancel_messages') {
      // Та же семантика, что при архивировании пространства: PENDING → CANCELLED.
      // Сообщение, уже взятое отправщиком в работу, может всё равно уйти (остановку не обещаем).
      const r = await tx.scheduledMessage.updateMany({
        where: { intensiveId: id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      affected = r.count;
    } else if (pendingNow.length > 0 && input.resolution === 'detach_messages') {
      const ids = pendingNow.map((m) => m.id);
      const r = await tx.scheduledMessage.updateMany({
        where: { id: { in: ids }, intensiveId: id },
        data: { intensiveId: null, planItemId: null, isPlanRepeat: false },
      });
      affected = r.count;
      await appendEvents(
        tx,
        pendingNow.map((m) => ({
          intensiveId: id,
          type: 'MESSAGE_DETACHED' as const,
          actorId: user.id,
          planItemId: m.planItemId,
          messageId: m.id,
          details: { reason: 'intensive_cancelled' },
        }))
      );
    }
    const res = await tx.intensive.updateMany({
      where: { id, status: { in: ['DRAFT', 'PUBLISHED'] }, ...(input.version !== undefined ? { version: input.version } : {}) },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelReason: input.reason ?? null,
        updatedById: user.id,
        version: { increment: 1 },
      },
    });
    if (res.count !== 1) throw versionConflict();
    await appendEvent(tx, {
      intensiveId: id,
      type: 'INTENSIVE_CANCELLED',
      actorId: user.id,
      details: { resolution: input.resolution ?? null, affectedMessages: affected, reason: input.reason ?? null },
    });
    const intensive = await tx.intensive.findUniqueOrThrow({ where: { id }, include: INTENSIVE_INCLUDE });
    return { intensive, affectedMessages: affected, resolution: input.resolution ?? null };
  });
}

export async function archiveIntensive(user: CurrentUser, viewer: IntensiveViewer, id: string, version?: number) {
  const current = await loadIntensiveForViewer(viewer, id);
  if (current.status === 'ARCHIVED') {
    throw new ApiError(409, 'INVALID_STATUS_TRANSITION', 'Интенсив уже в архиве');
  }
  if (current.status === 'PUBLISHED') {
    const phase = intensivePhase(ymdFromDbDate(current.startDate), ymdFromDbDate(current.endDate), current.timezone);
    if (phase !== 'FINISHED') {
      throw new ApiError(409, 'INTENSIVE_NOT_FINISHED', 'Архивировать опубликованный интенсив можно после его завершения');
    }
  }
  assertVersion(current.version, version);
  return prisma.$transaction(async (tx) => {
    const res = await tx.intensive.updateMany({
      where: { id, status: current.status, version: current.version },
      data: { status: 'ARCHIVED', archivedAt: new Date(), updatedById: user.id, version: { increment: 1 } },
    });
    if (res.count !== 1) throw versionConflict();
    // Архив интенсива не трогает сообщения и не архивирует пространство
    const pendingCount = await tx.scheduledMessage.count({ where: { intensiveId: id, status: 'PENDING' } });
    await appendEvent(tx, {
      intensiveId: id,
      type: 'INTENSIVE_ARCHIVED',
      actorId: user.id,
      details: { fromStatus: current.status, pendingMessages: pendingCount },
    });
    const intensive = await tx.intensive.findUniqueOrThrow({ where: { id }, include: INTENSIVE_INCLUDE });
    return { intensive, pendingMessages: pendingCount };
  });
}
