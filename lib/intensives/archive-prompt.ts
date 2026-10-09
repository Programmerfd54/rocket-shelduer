/**
 * Когда предлагать архивировать пространство (подключение). Чистые функции — используются сервером
 * (GET /api/workspace, /api/workspace/[id]) и клиентом (подписи «Скоро завершится» и т.п.).
 *
 * Правило:
 *  - уже в архиве → не предлагать;
 *  - Lead_SUP включил «Не предлагать архивировать это пространство» → не предлагать;
 *  - в графике пространства есть интенсив DRAFT/PUBLISHED, который ещё не закончился
 *    (дата окончания ≥ «сегодня» в его часовом поясе: предстоящий или идущий) → не предлагать;
 *  - иначе — старое правило: прошёл последний день периода подключения (WorkspaceConnection.endDate).
 * Ручная архивация доступна всегда — здесь решается только, показывать ли подсказку.
 */
import { todayInTimeZone, ymdFromDbDate } from './dates';
import type { IntensiveStatus } from './types';

/** Пояс для «старых» дат подключения (WorkspaceConnection.startDate/endDate), у которых пояса нет. */
export const LEGACY_WORKSPACE_TIMEZONE = 'Europe/Moscow';

export interface ArchivePromptIntensive {
  status: IntensiveStatus | string;
  /** 'YYYY-MM-DD' или DATE из БД */
  startDate: string | Date;
  endDate: string | Date;
  timezone: string;
}

export interface ArchivePromptInput {
  isArchived: boolean;
  /** Старая дата окончания подключения (WorkspaceConnection.endDate) */
  endDate: string | Date | null | undefined;
  suppressArchivePrompt: boolean;
  /** Интенсивы организационного пространства, к которому привязано подключение */
  intensives: ArchivePromptIntensive[];
}

function toYmd(v: string | Date): string {
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return v;
  return ymdFromDbDate(v);
}

function safeToday(timeZone: string, now: Date): string {
  try {
    return todayInTimeZone(timeZone, now);
  } catch {
    return todayInTimeZone(LEGACY_WORKSPACE_TIMEZONE, now);
  }
}

/** Интенсив ещё не закончился (предстоящий или идущий) и не отменён/не в архиве. */
export function isIntensiveUpcomingOrRunning(i: ArchivePromptIntensive, now: Date = new Date()): boolean {
  if (i.status !== 'DRAFT' && i.status !== 'PUBLISHED') return false;
  return toYmd(i.endDate) >= safeToday(i.timezone, now);
}

/** Прошёл ли последний день старого периода подключения. */
export function isLegacyPeriodEnded(endDate: string | Date | null | undefined, now: Date = new Date()): boolean {
  if (!endDate) return false;
  const d = typeof endDate === 'string' ? new Date(endDate) : endDate;
  if (Number.isNaN(d.getTime())) return false;
  return ymdFromDbDate(d) < safeToday(LEGACY_WORKSPACE_TIMEZONE, now);
}

export function shouldSuggestArchive(input: ArchivePromptInput, now: Date = new Date()): boolean {
  if (input.isArchived) return false;
  if (input.suppressArchivePrompt) return false;
  if (input.intensives.some((i) => isIntensiveUpcomingOrRunning(i, now))) return false;
  return isLegacyPeriodEnded(input.endDate, now);
}

/* ───────────── Поля ответа GET /api/workspace (общие для клиента) ───────────── */

export interface WorkspaceNextIntensive {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  timezone: string;
  status: IntensiveStatus;
}

export interface WorkspaceArchiveInfo {
  /** Предлагать ли архивировать (единственный источник для баннеров, тостов и фильтров) */
  archiveSuggested: boolean;
  suppressArchivePrompt: boolean;
  /** Ближайший предстоящий или идущий интенсив, видимый вызывающему */
  nextIntensive: WorkspaceNextIntensive | null;
  /** Сколько предстоящих/идущих интенсивов видит вызывающий */
  upcomingIntensiveCount: number;
}

/** Минимум полей пространства, нужный клиенту для подсказок об окончании. */
export interface ArchivePromptWorkspaceLike {
  isArchived?: boolean;
  endDate?: string | Date | null;
  archiveSuggested?: boolean;
  suppressArchivePrompt?: boolean;
  upcomingIntensiveCount?: number;
}

/**
 * «Период подключения скоро закончится» (≤ days дней): только если подсказка об архиве в принципе
 * уместна — не отключена Lead_SUP и в графике нет предстоящих/идущих интенсивов.
 */
export function isLegacyPeriodEndingSoon(ws: ArchivePromptWorkspaceLike, days = 7, now: Date = new Date()): boolean {
  if (ws.isArchived || ws.suppressArchivePrompt || (ws.upcomingIntensiveCount ?? 0) > 0) return false;
  if (!ws.endDate || isLegacyPeriodEnded(ws.endDate, now)) return false;
  const end = ymdFromDbDate(typeof ws.endDate === 'string' ? new Date(ws.endDate) : ws.endDate);
  const today = safeToday(LEGACY_WORKSPACE_TIMEZONE, now);
  const diff = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  return diff >= 0 && diff <= days;
}

/** Дней до конца старого периода (0 — сегодня последний день); null — дат нет. */
export function legacyDaysLeft(endDate: string | Date | null | undefined, now: Date = new Date()): number | null {
  if (!endDate) return null;
  const d = typeof endDate === 'string' ? new Date(endDate) : endDate;
  if (Number.isNaN(d.getTime())) return null;
  const end = ymdFromDbDate(d);
  const today = safeToday(LEGACY_WORKSPACE_TIMEZONE, now);
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
}
