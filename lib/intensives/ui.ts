/**
 * Общие хелперы интерфейса интенсивов: подписи, форматирование, клиент API.
 * Только клиент-безопасный код (никаких серверных импортов).
 */
import type {
  ApiErrorBody,
  IntensivePhase,
  IntensiveStatus,
  PlanItemAudience,
  PlanItemState,
} from '@/lib/intensives/types'

export const STATE_LABELS: Record<PlanItemState, string> = {
  NOT_SCHEDULED: 'Не запланировано',
  SCHEDULED: 'Запланировано',
  AWAITING_OVERDUE: 'Ожидает отправки · время прошло',
  SENT: 'Отправлено',
  FAILED: 'Ошибка',
  CANCELLED: 'Отменено',
  SKIPPED: 'Пропущено',
}

/** Основное действие строки зависит от состояния (ТЗ §7). */
export const STATE_PRIMARY_ACTION: Record<PlanItemState, string> = {
  NOT_SCHEDULED: 'Запланировать',
  SCHEDULED: 'Открыть сообщение',
  AWAITING_OVERDUE: 'Открыть сообщение',
  SENT: 'Посмотреть отправку',
  FAILED: 'Открыть ошибку',
  CANCELLED: 'Запланировать заново',
  SKIPPED: 'Посмотреть причину',
}

export const INTENSIVE_STATUS_LABELS: Record<IntensiveStatus, string> = {
  DRAFT: 'Черновик',
  PUBLISHED: 'Опубликован',
  CANCELLED: 'Отменён',
  ARCHIVED: 'В архиве',
}

export const PHASE_LABELS: Record<IntensivePhase, string> = {
  UPCOMING: 'Предстоящий',
  RUNNING: 'Идёт',
  FINISHED: 'Завершён',
}

export const AUDIENCE_LABELS: Record<PlanItemAudience, string> = {
  ALL: 'Для всех',
  ADM: 'Для ADM',
  SUP: 'Для SUP',
}

export const WEEKDAYS_FULL = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']
const MONTHS_GEN = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря']
export const MONTHS_NOM = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

function parseYmd(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number)
  return { y, m, d }
}

/** '2026-10-12' → '12 октября 2026' (год можно скрыть). */
export function formatYmd(ymd: string, withYear = true): string {
  const { y, m, d } = parseYmd(ymd)
  return `${d} ${MONTHS_GEN[m - 1]}${withYear ? ` ${y}` : ''}`
}

/** '2026-10-12','2026-10-25' → '12–25 октября' / '28 октября – 3 ноября' / с годом при смене года. */
export function formatRange(start: string, end: string): string {
  const a = parseYmd(start)
  const b = parseYmd(end)
  if (a.y !== b.y) return `${formatYmd(start)} – ${formatYmd(end)}`
  if (a.m === b.m) return `${a.d}–${b.d} ${MONTHS_GEN[a.m - 1]}${''}`
  return `${formatYmd(start, false)} – ${formatYmd(end, false)}`
}

/** Номер дня недели ISO (1 = пн … 7 = вс) для календарной даты YYYY-MM-DD (без часовых поясов). */
export function isoWeekday(ymd: string): number {
  const { y, m, d } = parseYmd(ymd)
  const js = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  return js === 0 ? 7 : js
}

/** 'Понедельник, 12 октября' */
export function formatDayHeading(ymd: string): string {
  return `${WEEKDAYS_FULL[isoWeekday(ymd) - 1]}, ${formatYmd(ymd, false)}`
}

/** Короткое название часового пояса: Europe/Moscow → Москва, иначе — идентификатор. */
export function formatTimezone(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('ru-RU', { timeZone: tz, timeZoneName: 'shortGeneric' }).formatToParts(new Date())
    const name = parts.find((p) => p.type === 'timeZoneName')?.value
    return name && !/^GMT/.test(name) ? name : tz
  } catch {
    return tz
  }
}

export function pluralize(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

export const IANA_TIMEZONES_COMMON = [
  'Europe/Moscow', 'Europe/Kaliningrad', 'Europe/Samara', 'Asia/Yekaterinburg', 'Asia/Omsk', 'Asia/Novosibirsk',
  'Asia/Krasnoyarsk', 'Asia/Irkutsk', 'Asia/Yakutsk', 'Asia/Vladivostok', 'Asia/Magadan', 'Asia/Kamchatka',
  'Europe/Minsk', 'Europe/Kyiv', 'Asia/Almaty', 'Asia/Tashkent', 'Asia/Tbilisi', 'Asia/Yerevan', 'Asia/Baku',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'UTC',
]

/* ───────────── Клиент API ───────────── */

export class ApiError extends Error {
  status: number
  code: string
  body: ApiErrorBody
  constructor(status: number, body: ApiErrorBody) {
    super(body.error || `Ошибка запроса (${status})`)
    this.status = status
    this.code = String(body.code ?? '')
    this.body = body
  }
}

/** fetch + JSON с типизированной ошибкой. Всегда `X-Error-Handling: local` — форма сама покажет ошибку. */
export async function apiFetch<T>(url: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  const { json, headers, ...rest } = init ?? {}
  const res = await fetch(url, {
    ...rest,
    headers: {
      'X-Error-Handling': 'local',
      ...(json !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(headers as Record<string, string> | undefined),
    },
    body: json !== undefined ? JSON.stringify(json) : rest.body,
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new ApiError(res.status, data as ApiErrorBody)
  return data as T
}
