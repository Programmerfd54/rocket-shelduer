/**
 * Инструмент Lead_SUP: привязка старых сообщений к пунктам плана.
 *  - Кандидаты: сообщения без интенсива в подключениях OrgSpace, в периоде интенсива (по его поясу),
 *    созданные из того же шаблона, что и пункт (sourceOfficialTemplateId / sourceUserTemplateId). Только подсказка.
 *  - Привязка идемпотентна и меняет ТОЛЬКО intensiveId/planItemId (текст, время, автор, отправитель, статус — нет;
 *    updatedAt обновляется автоматически). Соблюдается правило одной активной отправки на пункт.
 */
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { userRef, USER_REF_SELECT } from './access';
import { addDays, dbDateFromYmd, localYmdOfInstant, ymdFromDbDate } from './dates';
import { appendEvent } from './events';
import { ApiError, prismaErrorCode } from './http';
import { lockPlanItem } from './plan-service';
import { isActiveSend } from './status';
import type { LinkCandidate, LinkResult, MessageStatus } from './types';

const MAX_CANDIDATES = 2000;

type IntensiveForLink = { id: string; orgSpaceId: string; status: string; startDate: Date; endDate: Date; timezone: string };

function assertLinkable(intensive: IntensiveForLink): void {
  if (intensive.status === 'CANCELLED') {
    throw new ApiError(409, 'INTENSIVE_READ_ONLY', 'К отменённому интенсиву сообщения не привязываются');
  }
}

/** Момент, по которому сообщение относится к периоду: факт отправки для SENT, иначе назначенное время. */
function messageInstant(m: { status: string; sentAt: Date | null; scheduledFor: Date }): Date {
  return m.status === 'SENT' && m.sentAt ? m.sentAt : m.scheduledFor;
}

export async function getLinkCandidates(intensive: IntensiveForLink): Promise<{ candidates: LinkCandidate[]; truncated: boolean }> {
  assertLinkable(intensive);
  const startYmd = ymdFromDbDate(intensive.startDate);
  const endYmd = ymdFromDbDate(intensive.endDate);

  const [connections, items] = await Promise.all([
    prisma.workspaceConnection.findMany({
      where: { orgSpaceId: intensive.orgSpaceId },
      select: { id: true, workspaceName: true },
    }),
    prisma.intensivePlanItem.findMany({
      where: { intensiveId: intensive.id, skipped: false, sourceTemplateId: { not: null }, sourceType: { in: ['OFFICIAL', 'USER_TEMPLATE'] } },
      select: { id: true, title: true, sourceType: true, sourceTemplateId: true },
    }),
  ]);
  if (connections.length === 0 || items.length === 0) return { candidates: [], truncated: false };

  const officialMap = new Map(items.filter((i) => i.sourceType === 'OFFICIAL').map((i) => [i.sourceTemplateId!, i]));
  const userMap = new Map(items.filter((i) => i.sourceType === 'USER_TEMPLATE').map((i) => [i.sourceTemplateId!, i]));
  const wsName = new Map(connections.map((c) => [c.id, c.workspaceName]));

  // Грубый UTC-диапазон с запасом в сутки; точная проверка — по дате в поясе интенсива
  const from = dbDateFromYmd(addDays(startYmd, -1));
  const to = dbDateFromYmd(addDays(endYmd, 2));
  const messages = await prisma.scheduledMessage.findMany({
    where: {
      workspaceId: { in: connections.map((c) => c.id) },
      intensiveId: null,
      OR: [
        ...(officialMap.size ? [{ sourceOfficialTemplateId: { in: Array.from(officialMap.keys()) } }] : []),
        ...(userMap.size ? [{ sourceUserTemplateId: { in: Array.from(userMap.keys()) } }] : []),
      ],
      AND: [{ OR: [{ scheduledFor: { gte: from, lt: to } }, { sentAt: { gte: from, lt: to } }] }],
    },
    select: {
      id: true,
      status: true,
      scheduledFor: true,
      sentAt: true,
      workspaceId: true,
      channelName: true,
      message: true,
      isPlanRepeat: true,
      sourceOfficialTemplateId: true,
      sourceUserTemplateId: true,
      user: { select: USER_REF_SELECT },
    },
    orderBy: { scheduledFor: 'asc' },
    take: MAX_CANDIDATES + 1,
  });
  const truncated = messages.length > MAX_CANDIDATES;

  const activeLinked = await prisma.scheduledMessage.findMany({
    where: { planItemId: { in: items.map((i) => i.id) }, isPlanRepeat: false, status: { in: ['PENDING', 'SENT'] } },
    select: { planItemId: true },
  });
  const itemsWithActive = new Set(activeLinked.map((m) => m.planItemId));

  const candidates: LinkCandidate[] = [];
  for (const m of messages.slice(0, MAX_CANDIDATES)) {
    const item =
      (m.sourceOfficialTemplateId && officialMap.get(m.sourceOfficialTemplateId)) ||
      (m.sourceUserTemplateId && userMap.get(m.sourceUserTemplateId)) ||
      null;
    if (!item) continue;
    const localDate = localYmdOfInstant(messageInstant(m), intensive.timezone);
    if (localDate < startYmd || localDate > endYmd) continue;
    candidates.push({
      messageId: m.id,
      planItemId: item.id,
      planItemTitle: item.title,
      status: m.status as MessageStatus,
      scheduledFor: m.scheduledFor.toISOString(),
      sentAt: m.sentAt?.toISOString() ?? null,
      localDate,
      workspaceId: m.workspaceId,
      workspaceName: wsName.get(m.workspaceId) ?? '',
      channelName: m.channelName,
      author: userRef(m.user),
      preview: m.message.slice(0, 200),
      wouldConflict: isActiveSend({ status: m.status, isPlanRepeat: false }) && itemsWithActive.has(item.id),
    });
  }
  return { candidates, truncated };
}

export async function linkMessages(
  user: CurrentUser,
  intensive: IntensiveForLink,
  links: { messageId: string; planItemId: string }[]
): Promise<LinkResult[]> {
  assertLinkable(intensive);
  const startYmd = ymdFromDbDate(intensive.startDate);
  const endYmd = ymdFromDbDate(intensive.endDate);
  const orgWorkspaceIds = new Set(
    (await prisma.workspaceConnection.findMany({ where: { orgSpaceId: intensive.orgSpaceId }, select: { id: true } })).map((w) => w.id)
  );

  const results: LinkResult[] = [];
  for (const link of links) {
    const r = (result: LinkResult['result']) => results.push({ ...link, result });
    const msg = await prisma.scheduledMessage.findUnique({
      where: { id: link.messageId },
      select: { id: true, workspaceId: true, intensiveId: true, planItemId: true, status: true, scheduledFor: true, sentAt: true },
    });
    if (!msg) { r('message_not_found'); continue; }
    if (msg.intensiveId === intensive.id && msg.planItemId === link.planItemId) { r('already_linked'); continue; }
    if (msg.intensiveId || msg.planItemId) { r('linked_elsewhere'); continue; }
    if (!orgWorkspaceIds.has(msg.workspaceId)) { r('not_in_org_space'); continue; }
    const item = await prisma.intensivePlanItem.findFirst({
      where: { id: link.planItemId, intensiveId: intensive.id },
      select: { id: true, skipped: true },
    });
    if (!item) { r('item_not_found'); continue; }
    if (item.skipped) { r('item_skipped'); continue; }
    const localDate = localYmdOfInstant(messageInstant(msg), intensive.timezone);
    if (localDate < startYmd || localDate > endYmd) { r('outside_period'); continue; }

    try {
      const outcome = await prisma.$transaction(async (tx) => {
        await lockPlanItem(tx, item.id, 'SHARE');
        if (isActiveSend({ status: msg.status, isPlanRepeat: false })) {
          const active = await tx.scheduledMessage.findFirst({
            where: { planItemId: item.id, isPlanRepeat: false, status: { in: ['PENDING', 'SENT'] }, id: { not: msg.id } },
            select: { id: true },
          });
          if (active) return 'conflict_active_send' as const;
        }
        // Условное обновление: только если сообщение всё ещё без привязки (идемпотентность при гонке)
        const upd = await tx.scheduledMessage.updateMany({
          where: { id: msg.id, intensiveId: null, planItemId: null },
          data: { intensiveId: intensive.id, planItemId: item.id, isPlanRepeat: false },
        });
        if (upd.count !== 1) return 'linked_elsewhere' as const;
        await appendEvent(tx, {
          intensiveId: intensive.id,
          type: 'MESSAGE_LINKED',
          actorId: user.id,
          planItemId: item.id,
          messageId: msg.id,
          details: {
            source: 'migration_tool',
            status: msg.status,
            scheduledFor: msg.scheduledFor.toISOString(),
            sentAt: msg.sentAt?.toISOString() ?? null,
            workspaceId: msg.workspaceId,
          },
        });
        return 'linked' as const;
      });
      r(outcome);
    } catch (e) {
      if (prismaErrorCode(e) === 'P2002') r('conflict_active_send');
      else throw e;
    }
  }
  return results;
}
