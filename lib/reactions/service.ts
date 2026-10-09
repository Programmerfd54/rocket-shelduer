/**
 * Рейтинг реакций: синхронизация с Rocket.Chat, подсчёт, итоги месяца, публикации.
 *
 * Источник истины — сами сообщения RC (поле reactions). При каждой синхронизации
 * сообщения периода перечитываются, и записи ReactionRecord приводятся к ним:
 * добавление/удаление emoji, снятие всех реакций, удаление сообщения обрабатываются одинаково.
 */
import type { ReactionRatingSettings } from '@prisma/client';
import prisma from '@/lib/prisma';
import { connectionAad, decryptAuthToken } from '@/lib/encryption';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { isStudentRcHostStrict } from '@/lib/workspace-url-flags';
import {
  DEFAULT_TIMEZONE,
  extractReactionPairs,
  formatMonthlyPost,
  formatWeeklyPost,
  localClock,
  localDateKey,
  localDayStart,
  looksLikeBotUsername,
  monthRange,
  parseRcDate,
  periodLabel,
  periodOf,
  rankEntries,
  shiftPeriod,
  weekStart,
  type RankedEntry,
  type RatingChannel,
  type RcReactionMessage,
  type ReactionPair,
} from './core';

const HISTORY_PAGE_SIZE = 100;
const HISTORY_MAX_PAGES = 300;
const SYNC_INTERVAL_MS = 15 * 60_000;

export class ReactionRatingError extends Error {
  constructor(message: string, public status = 400) {
    super(message);
  }
}

export function parseChannels(raw: unknown): RatingChannel[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => !!c && typeof c === 'object')
    .map((c) => ({
      id: String(c.id ?? ''),
      name: String(c.name ?? ''),
      type: c.type === 'p' ? ('p' as const) : ('c' as const),
    }))
    .filter((c) => c.id);
}

function tzOf(s: Pick<ReactionRatingSettings, 'timezone'> | null) {
  return s?.timezone || DEFAULT_TIMEZONE;
}

// ── Доступ к Rocket.Chat ──

type RcAuth = { rc: RocketChatClient; authToken: string; userIdRc: string };

/** Подключение пользователя к этому RC, иначе — подключение владельца пространства (для cron). */
async function resolveRcAuth(workspaceId: string, actingUserId?: string): Promise<RcAuth | null> {
  if (actingUserId) {
    const eff = await getEffectiveConnectionForRc(actingUserId, workspaceId);
    if (eff?.authToken && eff.userId_RC) {
      return { rc: new RocketChatClient(eff.workspaceUrl), authToken: eff.authToken, userIdRc: eff.userId_RC };
    }
  }
  const ws = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { workspaceUrl: true, authToken: true, userId_RC: true, isActive: true, userId: true },
  });
  const token = ws?.authToken ? decryptAuthToken(ws.authToken, connectionAad(ws.userId)) : null;
  if (!ws || !ws.isActive || !token || !ws.userId_RC) return null;
  return { rc: new RocketChatClient(ws.workspaceUrl), authToken: token, userIdRc: ws.userId_RC };
}

async function fetchRoomMessages(auth: RcAuth, room: RatingChannel, oldest: Date, latest: Date) {
  const byId = new Map<string, RcReactionMessage>();
  let cursor = latest;
  for (let page = 0; page < HISTORY_MAX_PAGES; page++) {
    const batch = (await auth.rc.getRoomHistoryPage(auth.authToken, auth.userIdRc, room, {
      oldest,
      latest: cursor,
      count: HISTORY_PAGE_SIZE,
    })) as unknown as RcReactionMessage[];
    let added = 0;
    let minTs = cursor.getTime();
    for (const m of batch) {
      if (!m?._id) continue;
      const t = parseRcDate(m.ts)?.getTime();
      if (t !== undefined) minTs = Math.min(minTs, t);
      if (!byId.has(m._id)) {
        byId.set(m._id, { ...m, rid: m.rid || room.id });
        added++;
      }
    }
    // inclusive=true: сообщения на границе могут повториться — останавливаемся, когда новых нет
    if (batch.length < HISTORY_PAGE_SIZE || added === 0) break;
    cursor = new Date(minTs);
  }
  return [...byId.values()];
}

// ── Синхронизация ──

async function reconcileRoom(workspaceId: string, roomId: string, periods: string[], pairs: ReactionPair[], tz: string) {
  const keyOf = (messageId: string, username: string) => `${messageId}\u0000${username.toLowerCase()}`;
  const desired = new Map<string, ReactionPair>();
  for (const p of pairs) {
    if (periods.includes(periodOf(p.messageTs, tz))) desired.set(keyOf(p.messageId, p.username), p);
  }
  const existing = await prisma.reactionRecord.findMany({
    where: { workspaceId, roomId, period: { in: periods } },
    select: { id: true, messageId: true, username: true },
  });
  const existingKeys = new Set<string>();
  const toDelete: string[] = [];
  for (const r of existing) {
    const k = keyOf(r.messageId, r.username);
    existingKeys.add(k);
    if (!desired.has(k)) toDelete.push(r.id);
  }
  const toCreate = [...desired.entries()]
    .filter(([k]) => !existingKeys.has(k))
    .map(([, p]) => ({
      workspaceId,
      roomId,
      messageId: p.messageId,
      username: p.username,
      messageTs: p.messageTs,
      period: periodOf(p.messageTs, tz),
    }));
  await prisma.$transaction([
    prisma.reactionRecord.deleteMany({ where: { id: { in: toDelete } } }),
    prisma.reactionRecord.createMany({ data: toCreate, skipDuplicates: true }),
  ]);
  return { added: toCreate.length, removed: toDelete.length };
}

/** Периоды для обычной синхронизации: текущий месяц + прошлый, пока его итоги не зафиксированы. */
async function defaultSyncPeriods(workspaceId: string, tz: string, now = new Date()) {
  const current = periodOf(now, tz);
  const prev = shiftPeriod(current, -1);
  const prevFinal = await prisma.reactionMonthlyResult.findUnique({
    where: { workspaceId_period: { workspaceId, period: prev } },
    select: { id: true },
  });
  return prevFinal ? [current] : [prev, current];
}

export type SyncResult = { channels: number; messages: number; added: number; removed: number; errors: string[] };

export async function syncWorkspace(
  workspaceId: string,
  opts: { periods?: string[]; actingUserId?: string } = {},
): Promise<SyncResult> {
  const settings = await prisma.reactionRatingSettings.findUnique({
    where: { workspaceId },
    include: { workspace: { select: { workspaceUrl: true } } },
  });
  if (!settings) throw new ReactionRatingError('Сначала сохраните настройки рейтинга');
  if (!isStudentRcHostStrict(settings.workspace.workspaceUrl)) {
    throw new ReactionRatingError('Рейтинг реакций доступен только для rocketchat-student.21-school.ru', 403);
  }
  const tz = tzOf(settings);
  const channels = parseChannels(settings.channels);
  const periods = [...new Set(opts.periods ?? (await defaultSyncPeriods(workspaceId, tz)))].sort();
  const result: SyncResult = { channels: channels.length, messages: 0, added: 0, removed: 0, errors: [] };
  if (channels.length === 0 || periods.length === 0) return result;

  const auth = await resolveRcAuth(workspaceId, opts.actingUserId);
  if (!auth) {
    const error = 'Нет активного подключения к Rocket.Chat — переподключите пространство.';
    await prisma.reactionRatingSettings.update({ where: { workspaceId }, data: { lastSyncError: error } });
    throw new ReactionRatingError(error, 403);
  }

  const excluded = new Set(settings.excludedUsernames.map((u) => u.trim().toLowerCase()).filter(Boolean));
  if (settings.excludeBots) {
    const bots = await auth.rc.getUsernamesInRole(auth.authToken, auth.userIdRc, 'bot');
    for (const b of bots ?? []) excluded.add(b.toLowerCase());
  }

  const oldest = monthRange(periods[0], tz).start;
  const latest = new Date(Math.min(monthRange(periods[periods.length - 1], tz).end.getTime(), Date.now() + 60_000));

  for (const channel of channels) {
    try {
      const messages = await fetchRoomMessages(auth, channel, oldest, latest);
      result.messages += messages.length;
      const pairs = extractReactionPairs(messages, {
        excludeOwnMessages: settings.excludeOwnMessages,
        includeThreads: settings.includeThreads,
        excludedUsernames: excluded,
      }).filter((p) => !settings.excludeBots || !looksLikeBotUsername(p.username));
      const r = await reconcileRoom(workspaceId, channel.id, periods, pairs, tz);
      result.added += r.added;
      result.removed += r.removed;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.errors.push(`#${channel.name}: ${msg}`);
    }
  }

  await prisma.reactionRatingSettings.update({
    where: { workspaceId },
    data: { lastSyncAt: new Date(), lastSyncError: result.errors.length ? result.errors.join('\n').slice(0, 4000) : null },
  });
  return result;
}

// ── Подсчёт ──

async function computeScores(
  workspaceId: string,
  settings: Pick<ReactionRatingSettings, 'channels' | 'excludedUsernames'>,
  where: { period?: string; from?: Date; to?: Date },
) {
  const roomIds = parseChannels(settings.channels).map((c) => c.id);
  const excluded = new Set(settings.excludedUsernames.map((u) => u.toLowerCase()));
  const filter = {
    workspaceId,
    roomId: { in: roomIds },
    ...(where.period ? { period: where.period } : {}),
    ...(where.from || where.to ? { messageTs: { ...(where.from ? { gte: where.from } : {}), ...(where.to ? { lt: where.to } : {}) } } : {}),
  };
  const [groups, distinctMessages] = await Promise.all([
    prisma.reactionRecord.groupBy({ by: ['username'], where: filter, _count: { _all: true } }),
    prisma.reactionRecord.findMany({ where: filter, distinct: ['messageId'], select: { messageId: true } }),
  ]);
  const entries = rankEntries(
    groups
      .filter((g) => !excluded.has(g.username.toLowerCase()))
      .map((g) => ({ username: g.username, score: g._count._all })),
  );
  return { entries, totalMessages: distinctMessages.length };
}

export type LeaderboardEntry = RankedEntry & { week: number | null };

export async function getLeaderboard(workspaceId: string, settings: ReactionRatingSettings, period: string) {
  const tz = tzOf(settings);
  const now = new Date();
  const isCurrent = period === periodOf(now, tz);
  const final = await prisma.reactionMonthlyResult.findUnique({
    where: { workspaceId_period: { workspaceId, period } },
  });

  if (final) {
    const entries = (Array.isArray(final.entries) ? final.entries : []) as RankedEntry[];
    return {
      period,
      label: periodLabel(period),
      isCurrent,
      finalized: true,
      announcedAt: final.announcedAt,
      entries: entries.map((e) => ({ ...e, week: null })) as LeaderboardEntry[],
      totals: { participants: final.participants, messages: final.messages, points: entries.reduce((s, e) => s + e.score, 0) },
    };
  }

  const { entries, totalMessages } = await computeScores(workspaceId, settings, { period });
  let weekly = new Map<string, number>();
  if (isCurrent) {
    const from = new Date(Math.max(weekStart(now, tz).getTime(), monthRange(period, tz).start.getTime()));
    const w = await computeScores(workspaceId, settings, { period, from });
    weekly = new Map(w.entries.map((e) => [e.username, e.score]));
  }
  return {
    period,
    label: periodLabel(period),
    isCurrent,
    finalized: false,
    announcedAt: null as Date | null,
    entries: entries.map((e) => ({ ...e, week: isCurrent ? (weekly.get(e.username) ?? 0) : null })),
    totals: { participants: entries.length, messages: totalMessages, points: entries.reduce((s, e) => s + e.score, 0) },
  };
}

export async function listPeriods(workspaceId: string, tz: string) {
  const [recs, finals] = await Promise.all([
    prisma.reactionRecord.groupBy({ by: ['period'], where: { workspaceId } }),
    prisma.reactionMonthlyResult.findMany({ where: { workspaceId }, select: { period: true } }),
  ]);
  const set = new Set([periodOf(new Date(), tz), ...recs.map((r) => r.period), ...finals.map((f) => f.period)]);
  return [...set].sort().reverse().map((p) => ({ period: p, label: periodLabel(p) }));
}

export async function listMonthlyHistory(workspaceId: string) {
  const rows = await prisma.reactionMonthlyResult.findMany({
    where: { workspaceId },
    orderBy: { period: 'desc' },
    take: 12,
  });
  return rows.map((r) => {
    const entries = (Array.isArray(r.entries) ? r.entries : []) as RankedEntry[];
    return {
      period: r.period,
      label: periodLabel(r.period),
      winners: r.winnerUsernames,
      winnerScore: entries[0]?.score ?? 0,
      participants: r.participants,
      messages: r.messages,
      announcedAt: r.announcedAt,
      finalizedAt: r.finalizedAt,
    };
  });
}

// ── Тексты публикаций ──

/** Неделя, завершившаяся к началу сегодняшнего дня: [сегодня−7д, сегодня). */
function lastWeekWindow(now: Date, tz: string) {
  const to = localDayStart(now, tz);
  const from = localDayStart(now, tz, -7);
  return { from, to, key: localDateKey(to, tz) };
}

export async function buildWeeklyPost(workspaceId: string, settings: ReactionRatingSettings, now = new Date()) {
  const tz = tzOf(settings);
  const { from, to, key } = lastWeekWindow(now, tz);
  const { entries, totalMessages } = await computeScores(workspaceId, settings, { from, to });
  const text = formatWeeklyPost({
    entries,
    totalMessages,
    from,
    to: new Date(to.getTime() - 1),
    tz,
    topN: settings.topN,
    mention: settings.mentionUsers,
  });
  return { text, key };
}

export async function buildMonthlyPost(workspaceId: string, settings: ReactionRatingSettings, period: string) {
  const board = await getLeaderboard(workspaceId, settings, period);
  return formatMonthlyPost({
    period,
    entries: board.entries,
    topN: settings.topN,
    mention: settings.mentionUsers,
    interim: !board.finalized,
    totalMessages: board.totals.messages,
  });
}

/**
 * Проверка канала публикаций рейтинга в Rocket.Chat под учётной записью того, кто меняет настройки:
 * комната должна существовать, быть каналом/группой и быть видимой этой учётной записи.
 * Имя канала берётся из RC, а не от клиента.
 */
export async function verifyReportChannel(
  workspaceId: string,
  actingUserId: string,
  channelId: string,
): Promise<{ id: string; name: string }> {
  const eff = await getEffectiveConnectionForRc(actingUserId, workspaceId);
  if (!eff?.authToken || !eff.userId_RC) {
    throw new ReactionRatingError('Подключитесь к Rocket.Chat, чтобы выбрать канал для публикации рейтинга', 403);
  }
  let info: Awaited<ReturnType<RocketChatClient['getRoomInfo']>>;
  try {
    info = await new RocketChatClient(eff.workspaceUrl).getRoomInfo(eff.authToken, eff.userId_RC, channelId);
  } catch {
    throw new ReactionRatingError('Не удалось проверить канал рейтинга в Rocket.Chat. Повторите позже.', 502);
  }
  const room = info?.room;
  if (!room || room._id !== channelId || (room.t !== 'c' && room.t !== 'p')) {
    throw new ReactionRatingError('Канал для публикации рейтинга не найден или недоступен вашей учётной записи Rocket.Chat');
  }
  return { id: room._id, name: String(room.name || room.fname || room._id).slice(0, 200) };
}

/**
 * Публикация через очередь отложенных сообщений от имени владельца пространства (видна в «Сообщениях»).
 * Канал — только сохранённый reportChannelId настроек этого пространства; текст формирует сервер.
 */
export async function enqueuePost(workspaceId: string, settings: ReactionRatingSettings, text: string) {
  if (!settings.reportChannelId) throw new ReactionRatingError('Не выбран канал для публикации рейтинга');
  const ws = await prisma.workspaceConnection.findUnique({ where: { id: workspaceId }, select: { userId: true } });
  if (!ws) throw new ReactionRatingError('Пространство не найдено', 404);
  return prisma.scheduledMessage.create({
    data: {
      userId: ws.userId,
      workspaceId,
      channelId: settings.reportChannelId,
      channelName: settings.reportChannelName || settings.reportChannelId,
      message: text,
      scheduledFor: new Date(),
    },
    select: { id: true, scheduledFor: true },
  });
}

// ── Итоги месяца ──

export async function finalizeMonth(
  workspaceId: string,
  period: string,
  opts: { announce: boolean; actingUserId?: string },
) {
  await syncWorkspace(workspaceId, { periods: [period], actingUserId: opts.actingUserId });
  const settings = await prisma.reactionRatingSettings.findUniqueOrThrow({ where: { workspaceId } });
  const { entries, totalMessages } = await computeScores(workspaceId, settings, { period });
  const winners = entries.filter((e) => e.place === 1).map((e) => e.username);
  const data = {
    entries: entries.map(({ place, username, score }) => ({ place, username, score })),
    participants: entries.length,
    messages: totalMessages,
    winnerUsernames: winners,
    finalizedAt: new Date(),
  };
  const result = await prisma.reactionMonthlyResult.upsert({
    where: { workspaceId_period: { workspaceId, period } },
    create: { workspaceId, period, ...data },
    update: data,
  });

  if (opts.announce && settings.monthlyEnabled && settings.reportChannelId && !result.announcedAt) {
    const text = formatMonthlyPost({ period, entries, topN: settings.topN, mention: settings.mentionUsers });
    await enqueuePost(workspaceId, settings, text);
    await prisma.$transaction([
      prisma.reactionMonthlyResult.update({ where: { id: result.id }, data: { announcedAt: new Date() } }),
      prisma.reactionRatingSettings.update({ where: { workspaceId }, data: { lastMonthlyPostPeriod: period } }),
    ]);
  }
  return result;
}

// ── Cron ──

async function tickWorkspace(s: ReactionRatingSettings, now: Date) {
  const tz = tzOf(s);
  const { hour, isoDay, dayOfMonth } = localClock(now, tz);
  const current = periodOf(now, tz);
  const prev = shiftPeriod(current, -1);

  // 1. Итоги прошлого месяца: 1-го числа после часа публикации (или позже, если сервер был недоступен)
  if (s.createdAt < monthRange(prev, tz).end && (dayOfMonth > 1 || hour >= s.reportHour)) {
    const done = await prisma.reactionMonthlyResult.findUnique({
      where: { workspaceId_period: { workspaceId: s.workspaceId, period: prev } },
      select: { id: true },
    });
    if (!done) {
      await finalizeMonth(s.workspaceId, prev, { announce: true });
      s = await prisma.reactionRatingSettings.findUniqueOrThrow({ where: { workspaceId: s.workspaceId } });
    }
  }

  // 2. Еженедельный рейтинг — в выбранный день после часа публикации
  const week = lastWeekWindow(now, tz);
  const weeklyDue = s.weeklyEnabled && s.reportChannelId && isoDay === s.weeklyDay && hour >= s.reportHour && s.lastWeeklyPostKey !== week.key;

  // 3. Синхронизация раз в 15 минут (и всегда перед еженедельной публикацией)
  if (weeklyDue || !s.lastSyncAt || now.getTime() - s.lastSyncAt.getTime() >= SYNC_INTERVAL_MS) {
    await syncWorkspace(s.workspaceId);
  }

  if (weeklyDue) {
    const { text, key } = await buildWeeklyPost(s.workspaceId, s, now);
    await enqueuePost(s.workspaceId, s, text);
    await prisma.reactionRatingSettings.update({ where: { workspaceId: s.workspaceId }, data: { lastWeeklyPostKey: key } });
  }
}

let tickRunning = false;
let lastTickAt = 0;

/** Вызывается из cron отправки сообщений (раз в минуту); сам ограничивает частоту. */
export async function runReactionRatingTick(now = new Date()) {
  if (tickRunning || Date.now() - lastTickAt < 60_000) return;
  tickRunning = true;
  lastTickAt = Date.now();
  try {
    const list = await prisma.reactionRatingSettings.findMany({
      where: { enabled: true, workspace: { isArchived: false } },
      include: { workspace: { select: { workspaceUrl: true } } },
    });
    for (const { workspace, ...s } of list) {
      if (!isStudentRcHostStrict(workspace.workspaceUrl)) continue;
      try {
        await tickWorkspace(s, now);
      } catch (e) {
        console.error(`[reactions] workspace ${s.workspaceId}:`, e instanceof Error ? e.message : e);
      }
    }
  } finally {
    tickRunning = false;
  }
}
