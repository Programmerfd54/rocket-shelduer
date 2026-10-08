/**
 * Рейтинг реакций: чистая логика без БД и сети (покрыта тестами).
 *
 * Правило подсчёта: 1 балл = уникальная пара (username, messageId).
 * Несколько emoji одного пользователя на одном сообщении — всё равно 1 балл.
 * Период определяется по дате сообщения: у реакций в Rocket.Chat нет времени постановки.
 */
import { addDays, format } from 'date-fns';
import { formatInTimeZone, fromZonedTime } from 'date-fns-tz';
import { ru } from 'date-fns/locale';

export const DEFAULT_TIMEZONE = 'Europe/Moscow';

export type RatingChannel = { id: string; name: string; type: 'c' | 'p' };

export type RcReactionMessage = {
  _id: string;
  rid: string;
  ts: string | { $date: number | string };
  u?: { username?: string };
  t?: string;
  tmid?: string;
  _hidden?: boolean;
  reactions?: Record<string, { usernames?: string[] }>;
};

export type ExtractOptions = {
  excludeOwnMessages: boolean;
  includeThreads: boolean;
  /** Логины, которые не участвуют (служебные, боты). Сравнение без учёта регистра. */
  excludedUsernames: Set<string>;
};

export type ReactionPair = {
  messageId: string;
  roomId: string;
  username: string;
  messageTs: Date;
};

export type ScoreEntry = { username: string; score: number };
export type RankedEntry = ScoreEntry & { place: number };

export function parseRcDate(ts: RcReactionMessage['ts']): Date | null {
  const raw = typeof ts === 'object' && ts !== null ? ts.$date : ts;
  const d = new Date(raw as string | number);
  return Number.isFinite(d.getTime()) ? d : null;
}

/** Пары (пользователь, сообщение) из сообщений Rocket.Chat с учётом правил исключения. */
export function extractReactionPairs(messages: RcReactionMessage[], opts: ExtractOptions): ReactionPair[] {
  const out: ReactionPair[] = [];
  const seen = new Set<string>();
  for (const msg of messages) {
    if (!msg?._id || !msg.reactions) continue;
    // Системные сообщения (вход в канал, удалённые и т.п.) и скрытые не считаются
    if (msg.t || msg._hidden) continue;
    if (msg.tmid && !opts.includeThreads) continue;
    const messageTs = parseRcDate(msg.ts);
    if (!messageTs) continue;
    const author = msg.u?.username?.toLowerCase();

    for (const reaction of Object.values(msg.reactions)) {
      for (const rawName of reaction?.usernames ?? []) {
        const username = (rawName || '').trim();
        if (!username) continue;
        const lower = username.toLowerCase();
        if (opts.excludedUsernames.has(lower)) continue;
        if (opts.excludeOwnMessages && author && lower === author) continue;
        const key = `${msg._id}\u0000${lower}`;
        if (seen.has(key)) continue;
        seen.add(key);
        out.push({ messageId: msg._id, roomId: msg.rid, username, messageTs });
      }
    }
  }
  return out;
}

/** Похоже на бота по логину (дополнение к роли bot из Rocket.Chat). */
export function looksLikeBotUsername(username: string): boolean {
  const u = username.toLowerCase();
  return u === 'rocket.cat' || /(^|[._-])bot$/.test(u);
}

/** Места с учётом ничьих: 87, 87, 74 → 1, 1, 3. Внутри места — по алфавиту. */
export function rankEntries(entries: ScoreEntry[]): RankedEntry[] {
  const sorted = [...entries]
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score || a.username.localeCompare(b.username));
  let place = 0;
  let prevScore = -1;
  return sorted.map((e, i) => {
    if (e.score !== prevScore) {
      place = i + 1;
      prevScore = e.score;
    }
    return { ...e, place };
  });
}

// ── Периоды ──

export function periodOf(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, 'yyyy-MM');
}

export function isValidPeriod(p: unknown): p is string {
  return typeof p === 'string' && /^\d{4}-(0[1-9]|1[0-2])$/.test(p);
}

export function shiftPeriod(period: string, delta: number): string {
  const [y, m] = period.split('-').map(Number);
  const idx = y * 12 + (m - 1) + delta;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, '0')}`;
}

/** Границы месяца [start, end) в UTC для часового пояса tz. */
export function monthRange(period: string, tz: string): { start: Date; end: Date } {
  return {
    start: fromZonedTime(`${period}-01T00:00:00`, tz),
    end: fromZonedTime(`${shiftPeriod(period, 1)}-01T00:00:00`, tz),
  };
}

/** Начало ISO-недели (понедельник 00:00) в часовом поясе tz, содержащей date. */
export function weekStart(date: Date, tz: string): Date {
  const isoDay = Number(formatInTimeZone(date, tz, 'i')); // 1..7
  return localDayStart(date, tz, -(isoDay - 1));
}

/** Полночь (00:00) дня date в часовом поясе tz, сдвинутая на deltaDays дней. */
export function localDayStart(date: Date, tz: string, deltaDays = 0): Date {
  const localDay = formatInTimeZone(date, tz, 'yyyy-MM-dd');
  const shifted = addDays(new Date(`${localDay}T00:00:00Z`), deltaDays);
  return fromZonedTime(`${shifted.toISOString().slice(0, 10)}T00:00:00`, tz);
}

/** Час (0–23), ISO день недели (1 = пн) и число месяца в часовом поясе tz. */
export function localClock(date: Date, tz: string) {
  return {
    hour: Number(formatInTimeZone(date, tz, 'H')),
    isoDay: Number(formatInTimeZone(date, tz, 'i')),
    dayOfMonth: Number(formatInTimeZone(date, tz, 'd')),
  };
}

export function localDateKey(date: Date, tz: string): string {
  return formatInTimeZone(date, tz, 'yyyy-MM-dd');
}

export function periodLabel(period: string): string {
  const [y, m] = period.split('-').map(Number);
  return format(new Date(y, m - 1, 1), 'LLLL yyyy', { locale: ru });
}

// ── Тексты публикаций (Markdown Rocket.Chat) ──

const MEDALS = ['🥇', '🥈', '🥉'];

function who(username: string, mention: boolean) {
  return mention ? `@${username}` : `*${username}*`;
}

function formatTop(entries: RankedEntry[], topN: number, mention: boolean): string {
  const top = entries.filter((e) => e.place <= topN);
  return top
    .map((e) => `${e.place <= 3 ? MEDALS[e.place - 1] : `${e.place}.`} ${who(e.username, mention)} — ${e.score}`)
    .join('\n');
}

function messagesWord(n: number): string {
  const n10 = n % 10;
  const n100 = n % 100;
  if (n10 === 1 && n100 !== 11) return 'сообщение';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'сообщения';
  return 'сообщений';
}

export function formatWeeklyPost(args: {
  entries: RankedEntry[];
  totalMessages: number;
  from: Date;
  to: Date; // включительно (последний день недели)
  tz: string;
  topN: number;
  mention: boolean;
}): string {
  const range = `${formatInTimeZone(args.from, args.tz, 'd MMMM', { locale: ru })} — ${formatInTimeZone(args.to, args.tz, 'd MMMM', { locale: ru })}`;
  const lines = [`🏆 *Рейтинг реакций за неделю* (${range})`, ''];
  if (args.entries.length === 0) {
    lines.push('На этой неделе реакций пока не было — самое время начать! 🙂');
  } else {
    lines.push(formatTop(args.entries, args.topN, args.mention));
    lines.push('');
    lines.push(`Всего за неделю участники поставили реакции на *${args.totalMessages}* ${messagesWord(args.totalMessages)}.`);
  }
  lines.push('_Напоминаем: одна или несколько реакций на один пост = максимум 1 балл_ ❤️');
  return lines.join('\n');
}

export function formatMonthlyPost(args: {
  period: string;
  entries: RankedEntry[];
  topN: number;
  mention: boolean;
  /** Месяц ещё идёт — промежуточный рейтинг вместо объявления победителя */
  interim?: boolean;
  totalMessages?: number;
}): string {
  const label = periodLabel(args.period);
  if (args.interim) {
    const lines = [`📊 *Рейтинг реакций: ${label}* (промежуточные итоги)`, ''];
    if (args.entries.length === 0) {
      lines.push('Реакций в этом месяце пока нет — самое время начать! 🙂');
    } else {
      lines.push(formatTop(args.entries, args.topN, args.mention));
      if (args.totalMessages != null) {
        lines.push('');
        lines.push(`С начала месяца участники поставили реакции на *${args.totalMessages}* ${messagesWord(args.totalMessages)}.`);
      }
    }
    lines.push('_Одна или несколько реакций на один пост = максимум 1 балл_ ❤️');
    return lines.join('\n');
  }
  const lines = [`🎉 *Итоги месяца: ${label}*`, ''];
  const winners = args.entries.filter((e) => e.place === 1);
  if (winners.length === 0) {
    lines.push('В этом месяце реакций не было.');
    return lines.join('\n');
  }
  const names = winners.map((w) => who(w.username, true));
  const score = winners[0].score;
  lines.push(
    winners.length === 1
      ? `Победитель месяца — ${names[0]}! 🏆`
      : `Победители месяца — ${names.slice(0, -1).join(', ')} и ${names[names.length - 1]}! 🏆`,
  );
  lines.push(`*${score}* ${messagesWord(score)} с реакцией.`);
  lines.push('');
  lines.push(formatTop(args.entries, Math.max(args.topN, 3), args.mention));
  lines.push('');
  lines.push('Спасибо всем, кто регулярно взаимодействует с контентом ❤️');
  return lines.join('\n');
}
