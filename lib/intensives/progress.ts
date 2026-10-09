/**
 * Прогресс и представление плана — всегда на сервере, по ВСЕМ связанным сообщениям (не по странице списка).
 *
 * Приватность: состояние пункта видно всем, кто видит пункт; текст, автор, ошибка и канал отправки —
 * только если вызывающий видит само сообщение (lib/intensives/access.ts → canSeeMessage).
 */
import prisma from '@/lib/prisma';
import { canSeeMessage, canSeePlanItem, itemInViewScope, planItemScope, userRef, USER_REF_SELECT, type IntensiveViewer } from './access';
import {
  dayDate,
  intensiveDayInfo,
  intensiveLengthDays,
  intensivePhase,
  isoWeekday,
  todayInTimeZone,
  ymdFromDbDate,
  zonedDateTimeToUtc,
} from './dates';
import { addToProgress, aggregateMessages, deriveItemState, emptyProgress, type SendAggregateRow } from './status';
import { itemsEverLinked, loadOfficialTemplates } from './plan';
import type {
  IntensiveStatus,
  IntensiveSummary,
  MessageStatus,
  PlanDayGroup,
  PlanItemAudience,
  PlanItemDto,
  PlanItemSend,
  PlanItemSetupReason,
  PlanProgress,
  PlanViewScope,
  RecommendedSchedule,
} from './types';

export interface IntensiveRowForView {
  id: string;
  orgSpaceId: string;
  orgSpace: { id: string; name: string };
  name: string;
  description: string | null;
  startDate: Date;
  endDate: Date;
  timezone: string;
  status: IntensiveStatus;
  publishedAt: Date | null;
  cancelledAt: Date | null;
  archivedAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Видимые пункты: сначала права роли (partial — роль видит не всё), затем выбор Lead_SUP (viewScope).
 * Для не-Lead_SUP viewScope совпадает с ролью (resolveViewScope), так что второй фильтр ничего не меняет.
 */
function splitVisible<T extends { sourceScope: string | null; audience: string }>(
  viewer: IntensiveViewer,
  items: T[],
  viewScope: PlanViewScope
): { visible: T[]; partial: boolean } {
  const byRole = items.filter((i) => canSeePlanItem(viewer.user.role, i));
  return { visible: byRole.filter((i) => itemInViewScope(viewScope, i)), partial: byRole.length < items.length };
}

/**
 * Прогресс по нескольким интенсивам одним набором агрегирующих запросов (groupBy).
 * viewScope — набор пунктов (Lead_SUP: ALL|SUP|ADM; остальным передавайте resolveViewScope → по роли).
 */
export async function computeProgressForIntensives(
  viewer: IntensiveViewer,
  intensiveIds: string[],
  now: Date = new Date(),
  viewScope: PlanViewScope = 'ALL'
): Promise<Map<string, { progress: PlanProgress; partial: boolean }>> {
  const out = new Map<string, { progress: PlanProgress; partial: boolean }>();
  if (intensiveIds.length === 0) return out;

  const [items, groups] = await Promise.all([
    prisma.intensivePlanItem.findMany({
      where: { intensiveId: { in: intensiveIds } },
      select: { id: true, intensiveId: true, audience: true, sourceScope: true, skipped: true },
    }),
    prisma.scheduledMessage.groupBy({
      by: ['planItemId', 'status', 'isPlanRepeat'],
      where: { intensiveId: { in: intensiveIds }, planItemId: { not: null } },
      _count: { _all: true },
      _max: { createdAt: true, sentAt: true },
      _min: { scheduledFor: true },
    }),
  ]);

  const rowsByItem = new Map<string, SendAggregateRow[]>();
  for (const g of groups) {
    if (!g.planItemId) continue;
    const list = rowsByItem.get(g.planItemId) ?? [];
    list.push({
      status: g.status as MessageStatus,
      isPlanRepeat: g.isPlanRepeat,
      count: g._count._all,
      maxCreatedAt: g._max.createdAt,
      minScheduledFor: g._min.scheduledFor,
      maxSentAt: g.status === 'SENT' ? g._max.sentAt : null,
    });
    rowsByItem.set(g.planItemId, list);
  }

  for (const id of intensiveIds) out.set(id, { progress: emptyProgress(), partial: false });
  for (const item of items) {
    const entry = out.get(item.intensiveId)!;
    if (!canSeePlanItem(viewer.user.role, item)) {
      entry.partial = true;
      continue;
    }
    if (!itemInViewScope(viewScope, item)) continue;
    const { state, details } = deriveItemState({ skipped: item.skipped, rows: rowsByItem.get(item.id) ?? [], now });
    addToProgress(entry.progress, state, details);
  }
  return out;
}

export function toIntensiveSummary(
  row: IntensiveRowForView,
  extra: { progress: PlanProgress | null; partial: boolean; overlaps?: IntensiveSummary['overlaps']; viewScope?: PlanViewScope },
  now: Date = new Date()
): IntensiveSummary {
  const start = ymdFromDbDate(row.startDate);
  const end = ymdFromDbDate(row.endDate);
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    orgSpace: { id: row.orgSpace.id, name: row.orgSpace.name },
    startDate: start,
    endDate: end,
    timezone: row.timezone,
    status: row.status,
    phase: row.status === 'PUBLISHED' ? intensivePhase(start, end, row.timezone, now) : null,
    day: intensiveDayInfo(start, end, row.timezone, now),
    publishedAt: row.publishedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    archivedAt: row.archivedAt?.toISOString() ?? null,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    progress: extra.progress,
    partial: extra.partial,
    ...(extra.viewScope ? { viewScope: extra.viewScope } : {}),
    ...(extra.overlaps ? { overlaps: extra.overlaps } : {}),
  };
}

/** Рекомендуемые дата/время пункта в поясе интенсива + причины «требует настройки». */
export function computeRecommended(
  item: { dayNumber: number | null; time: string | null },
  intensive: { startYmd: string; endYmd: string; timezone: string },
  now: Date = new Date()
): { recommended: RecommendedSchedule; setupReasons: PlanItemSetupReason[] } {
  const reasons: PlanItemSetupReason[] = [];
  const total = intensiveLengthDays(intensive.startYmd, intensive.endYmd);
  let date: string | null = null;
  if (item.dayNumber == null) reasons.push('NO_DAY');
  else if (item.dayNumber > total || item.dayNumber < 1) reasons.push('DAY_OUTSIDE_PERIOD');
  else date = dayDate(intensive.startYmd, item.dayNumber);
  if (!item.time) reasons.push('NO_TIME');

  let utc: Date | null = null;
  let dstIssue: RecommendedSchedule['dstIssue'] = null;
  if (date && item.time) {
    const r = zonedDateTimeToUtc(date, item.time, intensive.timezone);
    if (r.kind === 'ok') utc = r.utc;
    else dstIssue = r.kind === 'nonexistent' ? 'NONEXISTENT' : 'AMBIGUOUS';
  }
  const today = todayInTimeZone(intensive.timezone, now);
  const isPast = utc ? utc.getTime() <= now.getTime() : date ? date < today : false;
  return {
    recommended: { date, time: item.time, utc: utc ? utc.toISOString() : null, dstIssue, isPast },
    setupReasons: reasons,
  };
}

const SEND_SELECT = {
  id: true,
  planItemId: true,
  status: true,
  isPlanRepeat: true,
  scheduledFor: true,
  sentAt: true,
  createdAt: true,
  workspaceId: true,
  userId: true,
  scheduledById: true,
  channelName: true,
  error: true,
  planEditedFromSnapshot: true,
  user: { select: USER_REF_SELECT },
  scheduledBy: { select: USER_REF_SELECT },
} as const;

/** Полное представление плана для вызывающего (viewScope — см. computeProgressForIntensives). */
export async function buildPlanView(
  viewer: IntensiveViewer,
  intensive: IntensiveRowForView,
  now: Date = new Date(),
  viewScope: PlanViewScope = 'ALL'
): Promise<{
  items: PlanItemDto[];
  days: PlanDayGroup[];
  unscheduledDayItemIds: string[];
  progress: PlanProgress;
  partial: boolean;
  viewScope: PlanViewScope;
  scopeFiltered: boolean;
}> {
  const startYmd = ymdFromDbDate(intensive.startDate);
  const endYmd = ymdFromDbDate(intensive.endDate);

  const allItems = await prisma.intensivePlanItem.findMany({
    where: { intensiveId: intensive.id },
    include: { skippedBy: { select: USER_REF_SELECT } },
  });
  const { visible: items, partial } = splitVisible(viewer, allItems, viewScope);
  const itemIds = items.map((i) => i.id);

  const [messages, everLinked, officials] = await Promise.all([
    itemIds.length > 0
      ? prisma.scheduledMessage.findMany({
          where: { planItemId: { in: itemIds } },
          select: SEND_SELECT,
          orderBy: { createdAt: 'asc' },
        })
      : Promise.resolve([]),
    itemsEverLinked(prisma, itemIds),
    viewer.isLead ? loadOfficialTemplates() : Promise.resolve([]),
  ]);
  const officialById = new Map(officials.map((t) => [t.id, t]));
  const msgsByItem = new Map<string, typeof messages>();
  for (const m of messages) {
    if (!m.planItemId) continue;
    const list = msgsByItem.get(m.planItemId) ?? [];
    list.push(m);
    msgsByItem.set(m.planItemId, list);
  }

  const progress = emptyProgress();
  const dtos: PlanItemDto[] = items.map((item) => {
    const msgs = msgsByItem.get(item.id) ?? [];
    const { state, details } = deriveItemState({
      skipped: item.skipped,
      rows: aggregateMessages(msgs.map((m) => ({ ...m, status: m.status as MessageStatus }))),
      now,
    });
    addToProgress(progress, state, details);
    const { recommended, setupReasons } = computeRecommended(item, { startYmd, endYmd, timezone: intensive.timezone }, now);
    const sends: PlanItemSend[] = msgs.map((m) => {
      const canView = canSeeMessage(viewer, m);
      return {
        messageId: m.id,
        status: m.status as MessageStatus,
        isPlanRepeat: m.isPlanRepeat,
        scheduledFor: m.scheduledFor.toISOString(),
        sentAt: m.status === 'SENT' ? (m.sentAt?.toISOString() ?? null) : null,
        createdAt: m.createdAt.toISOString(),
        workspaceId: m.workspaceId,
        canView,
        plannedBy: canView ? userRef(m.scheduledBy ?? m.user) : null,
        author: canView ? userRef(m.user) : null,
        channelName: canView ? m.channelName : null,
        error: canView ? m.error : null,
        planEditedFromSnapshot: m.planEditedFromSnapshot,
      };
    });
    const official = item.sourceType === 'OFFICIAL' && item.sourceTemplateId ? officialById.get(item.sourceTemplateId) : undefined;
    return {
      id: item.id,
      intensiveId: item.intensiveId,
      position: item.position,
      sourceType: item.sourceType,
      sourceTemplateId: item.sourceTemplateId,
      sourceScope: (item.sourceScope as 'ADM' | 'SUP' | null) ?? null,
      scope: planItemScope(item),
      sourceVersion: item.sourceVersion,
      title: item.title,
      body: item.body,
      channel: item.channel,
      dayNumber: item.dayNumber,
      time: item.time,
      audience: item.audience as PlanItemAudience,
      categories: item.categories,
      skipped: item.skipped,
      skipReason: item.skipReason,
      skippedBy: userRef(item.skippedBy),
      skippedAt: item.skippedAt?.toISOString() ?? null,
      state,
      details,
      sends,
      recommended,
      needsSetup: setupReasons.length > 0,
      setupReasons,
      hasEverLinkedMessages: everLinked.has(item.id),
      updateAvailable: !!official && official.version !== item.sourceVersion,
      createdAt: item.createdAt.toISOString(),
      updatedAt: item.updatedAt.toISOString(),
    };
  });

  dtos.sort(
    (a, b) =>
      (a.dayNumber ?? Number.MAX_SAFE_INTEGER) - (b.dayNumber ?? Number.MAX_SAFE_INTEGER) ||
      (a.time ?? '99:99').localeCompare(b.time ?? '99:99') ||
      a.position - b.position
  );

  const total = intensiveLengthDays(startYmd, endYmd);
  const dayMap = new Map<number, PlanDayGroup>();
  const unscheduledDayItemIds: string[] = [];
  for (const d of dtos) {
    if (d.dayNumber == null || d.dayNumber > total) {
      unscheduledDayItemIds.push(d.id);
      continue;
    }
    const date = dayDate(startYmd, d.dayNumber);
    const g = dayMap.get(d.dayNumber) ?? { dayNumber: d.dayNumber, date, isoWeekday: isoWeekday(date), itemCount: 0, completed: 0 };
    g.itemCount += 1;
    if (d.state === 'SENT') g.completed += 1;
    dayMap.set(d.dayNumber, g);
  }
  const days = Array.from(dayMap.values()).sort((a, b) => a.dayNumber - b.dayNumber);
  return { items: dtos, days, unscheduledDayItemIds, progress, partial, viewScope, scopeFiltered: viewer.isLead && viewScope !== 'ALL' };
}
