/**
 * История интенсива (IntensiveEvent) с постраничной выборкой и защитой приватности:
 * события сообщений, недоступных вызывающему, отдаются без канала/ошибки/автора; события пунктов,
 * скрытых по аудитории, не отдаются вовсе. Текст сообщений в историю не попадает никогда.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { canSeeAudience, canSeeMessage, userRef, USER_REF_SELECT, type IntensiveViewer } from './access';
import type { HistoryResponse, IntensiveEventDto, IntensiveEventType } from './types';

const REDACTED_KEEP = new Set(['fromStatus', 'toStatus', 'status', 'scheduledFor', 'sentAt', 'isPlanRepeat', 'source', 'reason']);

export async function getIntensiveHistory(
  viewer: IntensiveViewer,
  intensiveId: string,
  opts: { cursor?: string | null; limit?: number; planItemId?: string | null }
): Promise<HistoryResponse> {
  const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
  const where: Prisma.IntensiveEventWhereInput = { intensiveId };
  if (opts.planItemId) where.planItemId = opts.planItemId;

  const rows = await prisma.intensiveEvent.findMany({
    where,
    include: { actor: { select: USER_REF_SELECT } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: limit + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;

  // Аудитории существующих пунктов (для фильтрации)
  const itemIds = Array.from(new Set(page.map((e) => e.planItemId).filter((v): v is string => !!v)));
  const items = itemIds.length
    ? await prisma.intensivePlanItem.findMany({ where: { id: { in: itemIds } }, select: { id: true, audience: true } })
    : [];
  const audienceById = new Map(items.map((i) => [i.id, i.audience]));
  const fullAccess = viewer.user.role === 'LEAD_SUP' || viewer.user.role === 'SUP';

  const events: IntensiveEventDto[] = [];
  for (const e of page) {
    if (e.planItemId && !fullAccess) {
      const audience = audienceById.get(e.planItemId);
      // Пункт удалён (аудитория неизвестна) или скрыт по аудитории — событие не показываем
      if (!audience || !canSeeAudience(viewer.user.role, audience)) continue;
    }
    let details = (e.details ?? null) as Record<string, unknown> | null;
    let redacted = false;
    if (e.messageId && details) {
      const visible = canSeeMessage(viewer, {
        userId: typeof details.authorId === 'string' ? details.authorId : null,
        scheduledById: typeof details.scheduledById === 'string' ? details.scheduledById : null,
        workspaceId: typeof details.workspaceId === 'string' ? details.workspaceId : null,
      });
      if (!visible) {
        details = Object.fromEntries(Object.entries(details).filter(([k]) => REDACTED_KEEP.has(k)));
        redacted = true;
      }
    }
    events.push({
      id: e.id,
      type: e.type as IntensiveEventType,
      planItemId: e.planItemId,
      messageId: e.messageId,
      actor: redacted ? null : userRef(e.actor),
      details,
      redacted,
      createdAt: e.createdAt.toISOString(),
    });
  }
  return { events, nextCursor: hasMore ? page[page.length - 1].id : null };
}
