/**
 * Календарная математика интенсивов. Чистые функции без серверных зависимостей (можно использовать на клиенте).
 *
 *  - Даты интенсива — календарные 'YYYY-MM-DD' (в БД — DATE; Prisma отдаёт их как UTC-полночь).
 *  - День N = дата начала + N − 1 календарных дней (без пропуска выходных).
 *  - Моменты отправки — UTC через IANA-пояс интенсива. Несуществующее / неоднозначное локальное время
 *    (переход на летнее/зимнее время) не угадывается: возвращается явный результат «нужно решение».
 */
import { formatInTimeZone, getTimezoneOffset } from 'date-fns-tz';
import type { IntensiveDayInfo, IntensivePhase } from './types';

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
const HM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
const DAY_MS = 86_400_000;

/** Максимальная длительность интенсива (дней, включительно). */
export const MAX_INTENSIVE_DAYS = 366;

export function isValidYmd(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = YMD_RE.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y < 2000 || y > 2100) return false;
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

export function isValidHm(s: unknown): s is string {
  return typeof s === 'string' && HM_RE.test(s);
}

/** IANA-пояс, известный среде выполнения (Intl). */
export function isValidTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

function ymdToUtcMs(ymd: string): number {
  const m = YMD_RE.exec(ymd);
  if (!m) throw new Error(`Invalid date: ${ymd}`);
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

function utcMsToYmd(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getUTCFullYear()).padStart(4, '0')}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(
    d.getUTCDate()
  ).padStart(2, '0')}`;
}

/** DATE из БД (UTC-полночь) → 'YYYY-MM-DD'. */
export function ymdFromDbDate(d: Date | string): string {
  const date = typeof d === 'string' ? new Date(d) : d;
  return utcMsToYmd(date.getTime());
}

/** 'YYYY-MM-DD' → Date (UTC-полночь) для записи в колонку DATE. */
export function dbDateFromYmd(ymd: string): Date {
  return new Date(ymdToUtcMs(ymd));
}

export function addDays(ymd: string, days: number): string {
  return utcMsToYmd(ymdToUtcMs(ymd) + days * DAY_MS);
}

/** b − a в календарных днях. */
export function diffDays(a: string, b: string): number {
  return Math.round((ymdToUtcMs(b) - ymdToUtcMs(a)) / DAY_MS);
}

/** Длительность интенсива в днях (окончание включается). */
export function intensiveLengthDays(startYmd: string, endYmd: string): number {
  return diffDays(startYmd, endYmd) + 1;
}

/** Дата дня N: start + N − 1. */
export function dayDate(startYmd: string, dayNumber: number): string {
  return addDays(startYmd, dayNumber - 1);
}

/** Номер дня интенсива для календарной даты или null, если дата вне периода. */
export function dayNumberOfDate(startYmd: string, endYmd: string, ymd: string): number | null {
  if (ymd < startYmd || ymd > endYmd) return null;
  return diffDays(startYmd, ymd) + 1;
}

/** ISO день недели (1 = пн … 7 = вс) для 'YYYY-MM-DD'. */
export function isoWeekday(ymd: string): number {
  const wd = new Date(ymdToUtcMs(ymd)).getUTCDay();
  return wd === 0 ? 7 : wd;
}

/** Календарная дата момента в заданном поясе. */
export function localYmdOfInstant(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'yyyy-MM-dd');
}

/** Локальное 'HH:mm' момента в заданном поясе. */
export function localHmOfInstant(instant: Date, timeZone: string): string {
  return formatInTimeZone(instant, timeZone, 'HH:mm');
}

/** «Сегодня» в поясе интенсива. */
export function todayInTimeZone(timeZone: string, now: Date = new Date()): string {
  return localYmdOfInstant(now, timeZone);
}

/** Текущий день интенсива в его поясе. */
export function intensiveDayInfo(
  startYmd: string,
  endYmd: string,
  timeZone: string,
  now: Date = new Date()
): IntensiveDayInfo {
  const today = todayInTimeZone(timeZone, now);
  return {
    today,
    dayNumber: dayNumberOfDate(startYmd, endYmd, today),
    totalDays: intensiveLengthDays(startYmd, endYmd),
  };
}

/** Фаза по датам в поясе интенсива: предстоящий / идёт / завершён. */
export function intensivePhase(
  startYmd: string,
  endYmd: string,
  timeZone: string,
  now: Date = new Date()
): IntensivePhase {
  const today = todayInTimeZone(timeZone, now);
  if (today < startYmd) return 'UPCOMING';
  if (today > endYmd) return 'FINISHED';
  return 'RUNNING';
}

/** Момент попадает в период интенсива (по календарной дате в его поясе). */
export function isInstantWithinIntensive(
  instant: Date,
  startYmd: string,
  endYmd: string,
  timeZone: string
): boolean {
  const ymd = localYmdOfInstant(instant, timeZone);
  return ymd >= startYmd && ymd <= endYmd;
}

/** Периоды [aStart, aEnd] и [bStart, bEnd] (включительно) пересекаются. */
export function periodsOverlap(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return aStart <= bEnd && bStart <= aEnd;
}

export type ZonedToUtcResult =
  | { kind: 'ok'; utc: Date }
  /** Локального времени не существует (переход вперёд). suggestedUtc — первый момент после разрыва. */
  | { kind: 'nonexistent'; suggestedUtc: Date }
  /** Локальное время встречается дважды (переход назад): нужно выбрать earlier / later. */
  | { kind: 'ambiguous'; earlierUtc: Date; laterUtc: Date };

/**
 * Локальные дата+время в IANA-поясе → UTC с обнаружением DST-разрыва и неоднозначности.
 * dstChoice разрешает неоднозначность явно ('earlier' | 'later'); несуществующее время всегда требует решения.
 */
export function zonedDateTimeToUtc(
  ymd: string,
  hm: string,
  timeZone: string,
  dstChoice?: 'earlier' | 'later'
): ZonedToUtcResult {
  const m = YMD_RE.exec(ymd);
  const t = HM_RE.exec(hm);
  if (!m || !t) throw new Error('Invalid date/time');
  const naive = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(t[1]), Number(t[2]));
  const wanted = `${ymd}T${hm}`;

  // Возможные смещения пояса вокруг нужного момента (DST меняется не чаще пары раз в год)
  const offsets = new Set<number>();
  for (const probe of [naive - 2 * DAY_MS, naive - DAY_MS / 2, naive, naive + DAY_MS / 2, naive + 2 * DAY_MS]) {
    const off = getTimezoneOffset(timeZone, new Date(probe));
    if (Number.isFinite(off)) offsets.add(off);
  }
  const candidates = Array.from(offsets)
    .map((off) => naive - off)
    .filter((ms) => formatInTimeZone(new Date(ms), timeZone, "yyyy-MM-dd'T'HH:mm") === wanted)
    .sort((a, b) => a - b);
  const unique = Array.from(new Set(candidates));

  if (unique.length === 1) return { kind: 'ok', utc: new Date(unique[0]) };
  if (unique.length >= 2) {
    const earlierUtc = new Date(unique[0]);
    const laterUtc = new Date(unique[unique.length - 1]);
    if (dstChoice === 'earlier') return { kind: 'ok', utc: earlierUtc };
    if (dstChoice === 'later') return { kind: 'ok', utc: laterUtc };
    return { kind: 'ambiguous', earlierUtc, laterUtc };
  }
  // Разрыв: берём меньшее смещение (до перехода) → время сдвигается вперёд на длину разрыва (02:30 → 03:30)
  const offs = Array.from(offsets).sort((a, b) => a - b);
  const before = offs[0];
  const suggested = naive - before;
  return { kind: 'nonexistent', suggestedUtc: new Date(suggested) };
}
