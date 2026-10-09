/**
 * График интенсивов пространства (подключения) без ручных «организационных пространств».
 *
 *  - ensureOrgSpaceForWorkspace — OrgSpace создаётся и привязывается автоматически при первом интенсиве
 *    пространства (идемпотентно, под advisory lock; гонка по имени — повтор).
 *  - getWorkspaceArchiveInfo — поля archiveSuggested / nextIntensive / upcomingIntensiveCount для списка
 *    пространств одним пакетным запросом (без N+1).
 *  - applySuppressArchivePromptPatch — разбор поля suppressArchivePrompt в PATCH /api/workspace/[id] (только Lead_SUP).
 */
import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { addDays, dbDateFromYmd, todayInTimeZone, ymdFromDbDate } from './dates';
import { isIntensivesEnabled } from './feature';
import { ApiError, prismaErrorCode } from './http';
import {
  isIntensiveUpcomingOrRunning,
  shouldSuggestArchive,
  type WorkspaceArchiveInfo,
  type WorkspaceNextIntensive,
} from './archive-prompt';
import type { IntensiveStatus } from './types';

export * from './archive-prompt';

const ORG_SPACE_NAME_MAX = 120;
const MAX_ENSURE_ATTEMPTS = 4;

const normName = (v: string) => v.trim().toLocaleLowerCase('ru-RU');

/** Свободное имя OrgSpace: название пространства, при совпадении — с коротким суффиксом. */
function pickFreeName(base: string, workspaceId: string, taken: Set<string>): string {
  const clean = base.trim().replace(/\s+/g, ' ').slice(0, ORG_SPACE_NAME_MAX - 12) || 'Пространство';
  if (!taken.has(normName(clean))) return clean;
  const short = workspaceId.slice(-5);
  const withId = `${clean} · ${short}`;
  if (!taken.has(normName(withId))) return withId;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${clean} · ${short}-${n}`;
    if (!taken.has(normName(candidate))) return candidate;
  }
  return `${clean} · ${Date.now().toString(36)}`;
}

/**
 * OrgSpace пространства: существующий или созданный автоматически (название = название пространства).
 * Идемпотентно и безопасно при одновременных вызовах: pg_advisory_xact_lock по пространству + повтор при
 * конфликте уникального имени (ручное создание OrgSpace идёт без этой блокировки).
 */
export async function ensureOrgSpaceForWorkspace(
  workspaceId: string,
  actorId: string | null
): Promise<{ orgSpaceId: string; created: boolean }> {
  const conn = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, orgSpaceId: true },
  });
  if (!conn) throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено', { fieldErrors: { workspaceId: 'Не найдено' } });
  if (conn.orgSpaceId) return { orgSpaceId: conn.orgSpaceId, created: false };

  let lastError: unknown = null;
  for (let attempt = 0; attempt < MAX_ENSURE_ATTEMPTS; attempt++) {
    try {
      const res = await prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`workspace-org-space:${workspaceId}`}))`;
        const fresh = await tx.workspaceConnection.findUnique({
          where: { id: workspaceId },
          select: { id: true, orgSpaceId: true, workspaceName: true },
        });
        if (!fresh) throw new ApiError(404, 'NOT_FOUND', 'Пространство не найдено');
        if (fresh.orgSpaceId) return { orgSpaceId: fresh.orgSpaceId, created: false, name: null as string | null };
        // Имена OrgSpace — небольшая таблица; сравнение без учёта регистра, как в ручном создании
        const all = await tx.orgSpace.findMany({ select: { name: true } });
        const name = pickFreeName(fresh.workspaceName, workspaceId, new Set(all.map((s) => normName(s.name))));
        const space = await tx.orgSpace.create({
          data: { name, createdById: actorId, description: 'Создано автоматически для графика интенсивов пространства' },
          select: { id: true },
        });
        const upd = await tx.workspaceConnection.updateMany({
          where: { id: workspaceId, orgSpaceId: null },
          data: { orgSpaceId: space.id },
        });
        if (upd.count !== 1) throw new ApiError(409, 'VERSION_CONFLICT', 'Пространство изменилось. Повторите попытку.');
        return { orgSpaceId: space.id, created: true, name };
      });
      if (res.created && actorId) {
        try {
          await prisma.activityLog.create({
            data: {
              userId: actorId,
              action: 'ADMIN_ACTION',
              entityType: 'org_space',
              entityId: res.orgSpaceId,
              details: JSON.stringify({ op: 'org_space_auto_create', orgSpaceId: res.orgSpaceId, workspaceId, name: res.name }),
            },
          });
        } catch (e) {
          console.error('[intensives] activity log failed:', e);
        }
      }
      return { orgSpaceId: res.orgSpaceId, created: res.created };
    } catch (e) {
      // Имя заняли параллельно (ручное создание OrgSpace) — пробуем снова с новым списком имён
      if (prismaErrorCode(e) === 'P2002') {
        lastError = e;
        continue;
      }
      throw e;
    }
  }
  console.error('[intensives] ensureOrgSpaceForWorkspace: name conflicts', lastError);
  throw new ApiError(409, 'ORG_SPACE_NAME_TAKEN', 'Не удалось подготовить график пространства. Повторите попытку.');
}

/* ───────────── Подсказка «архивировать» для списка пространств ───────────── */

export interface ArchiveInfoWorkspaceRow {
  id: string;
  orgSpaceId: string | null;
  isArchived: boolean;
  endDate: Date | string | null;
  suppressArchivePrompt: boolean;
}

/**
 * Поля archiveSuggested / suppressArchivePrompt / nextIntensive / upcomingIntensiveCount для набора пространств.
 * Один запрос к Intensive на все OrgSpace. archiveSuggested учитывает и черновики (данные защищаются от
 * архивации независимо от того, кто смотрит и включена ли функция); nextIntensive и счётчик — только видимые
 * вызывающему (черновики — только Lead_SUP) и только при включённой функции «Интенсивы».
 */
export async function getWorkspaceArchiveInfo(
  rows: ArchiveInfoWorkspaceRow[],
  opts: { includeDrafts: boolean },
  now: Date = new Date()
): Promise<Map<string, WorkspaceArchiveInfo>> {
  const orgIds = Array.from(new Set(rows.map((r) => r.orgSpaceId).filter((v): v is string => !!v)));
  // Пояса отличаются от UTC не больше чем на ±14 ч — интенсивы, закончившиеся раньше «вчера по UTC», не нужны
  const minEnd = dbDateFromYmd(addDays(todayInTimeZone('UTC', now), -1));
  const [featureOn, intensives] = await Promise.all([
    isIntensivesEnabled(),
    orgIds.length
      ? prisma.intensive.findMany({
          where: { orgSpaceId: { in: orgIds }, status: { in: ['DRAFT', 'PUBLISHED'] }, endDate: { gte: minEnd } },
          select: { id: true, orgSpaceId: true, name: true, status: true, startDate: true, endDate: true, timezone: true },
          orderBy: [{ startDate: 'asc' }, { name: 'asc' }],
        })
      : Promise.resolve([]),
  ]);
  const byOrg = new Map<string, typeof intensives>();
  for (const i of intensives) {
    const list = byOrg.get(i.orgSpaceId) ?? [];
    list.push(i);
    byOrg.set(i.orgSpaceId, list);
  }

  const out = new Map<string, WorkspaceArchiveInfo>();
  for (const r of rows) {
    const list = r.orgSpaceId ? (byOrg.get(r.orgSpaceId) ?? []) : [];
    const active = list.filter((i) => isIntensiveUpcomingOrRunning(i, now));
    const visible = featureOn ? active.filter((i) => opts.includeDrafts || i.status === 'PUBLISHED') : [];
    const next = visible[0];
    const nextIntensive: WorkspaceNextIntensive | null = next
      ? {
          id: next.id,
          name: next.name,
          startDate: ymdFromDbDate(next.startDate),
          endDate: ymdFromDbDate(next.endDate),
          timezone: next.timezone,
          status: next.status as IntensiveStatus,
        }
      : null;
    out.set(r.id, {
      archiveSuggested: shouldSuggestArchive(
        { isArchived: r.isArchived, endDate: r.endDate, suppressArchivePrompt: r.suppressArchivePrompt, intensives: active },
        now
      ),
      suppressArchivePrompt: r.suppressArchivePrompt,
      nextIntensive,
      upcomingIntensiveCount: visible.length,
    });
  }
  return out;
}

/** Удобная обёртка: поля для ответа API (plus canEditArchivePrompt для UI). */
export function archiveFieldsFor(
  info: Map<string, WorkspaceArchiveInfo>,
  id: string,
  user: Pick<CurrentUser, 'role'>
): WorkspaceArchiveInfo & { canEditArchivePrompt: boolean } {
  const v = info.get(id) ?? { archiveSuggested: false, suppressArchivePrompt: false, nextIntensive: null, upcomingIntensiveCount: 0 };
  return { ...v, canEditArchivePrompt: user.role === 'LEAD_SUP' };
}

/* ───────────── PATCH suppressArchivePrompt ───────────── */

/**
 * Поле suppressArchivePrompt в PATCH /api/workspace/[id]:
 *  - нет поля → { response: null, data: {} } (обычный поток);
 *  - не boolean → 400; не Lead_SUP → 403;
 *  - только это поле (Lead_SUP с доступом: владелец или назначен) → сохраняется сразу, возвращается ответ;
 *  - вместе с другими полями → { data } для обычного обновления владельцем.
 */
export async function applySuppressArchivePromptPatch(
  user: CurrentUser,
  workspaceId: string,
  body: unknown
): Promise<{ response: NextResponse | null; data: { suppressArchivePrompt?: boolean } }> {
  if (!body || typeof body !== 'object' || !Object.prototype.hasOwnProperty.call(body, 'suppressArchivePrompt')) {
    return { response: null, data: {} };
  }
  const value = (body as Record<string, unknown>).suppressArchivePrompt;
  if (typeof value !== 'boolean') {
    return { response: NextResponse.json({ error: 'suppressArchivePrompt: ожидается true или false' }, { status: 400 }), data: {} };
  }
  if (user.role !== 'LEAD_SUP') {
    return {
      response: NextResponse.json({ error: 'Настройку «Не предлагать архивировать» меняет только Lead_SUP' }, { status: 403 }),
      data: {},
    };
  }
  const otherKeys = Object.keys(body as Record<string, unknown>).filter((k) => k !== 'suppressArchivePrompt');
  if (otherKeys.length > 0) return { response: null, data: { suppressArchivePrompt: value } };

  const ws = await prisma.workspaceConnection.findUnique({ where: { id: workspaceId }, select: { id: true, userId: true } });
  const allowed =
    !!ws &&
    (ws.userId === user.id ||
      !!(await prisma.workspaceAdminAssignment.findFirst({ where: { userId: user.id, workspaceId }, select: { id: true } })));
  if (!ws || !allowed) {
    return { response: NextResponse.json({ error: 'Workspace not found' }, { status: 404 }), data: {} };
  }
  await prisma.workspaceConnection.update({ where: { id: workspaceId }, data: { suppressArchivePrompt: value } });
  try {
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_UPDATED',
        entityType: 'workspace',
        entityId: workspaceId,
        details: JSON.stringify({ suppressArchivePrompt: value }),
      },
    });
  } catch (e) {
    console.error('[workspace] activity log failed:', e);
  }
  return { response: NextResponse.json({ success: true, workspace: { id: workspaceId, suppressArchivePrompt: value } }), data: {} };
}

/* ───────────── Защита данных при автоочистке архива ───────────── */

/** id подключений из списка, привязанных к OrgSpace, где есть хоть один интенсив (любой статус). */
export async function workspaceIdsWithIntensives(
  rows: { id: string; orgSpaceId: string | null }[],
  db: Prisma.TransactionClient | typeof prisma = prisma
): Promise<Set<string>> {
  const orgIds = Array.from(new Set(rows.map((r) => r.orgSpaceId).filter((v): v is string => !!v)));
  if (orgIds.length === 0) return new Set();
  const groups = await db.intensive.groupBy({ by: ['orgSpaceId'], where: { orgSpaceId: { in: orgIds } }, _count: { _all: true } });
  const withIntensives = new Set(groups.filter((g) => g._count._all > 0).map((g) => g.orgSpaceId));
  return new Set(rows.filter((r) => r.orgSpaceId && withIntensives.has(r.orgSpaceId)).map((r) => r.id));
}
