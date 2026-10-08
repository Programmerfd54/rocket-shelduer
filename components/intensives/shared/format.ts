/**
 * Форматирование и производные значения для интерфейса плана анонсов.
 * Все даты/время показываются в часовом поясе ИНТЕНСИВА (не браузера).
 * Клиент-безопасный код: без серверных импортов.
 */
import { formatInTimeZone } from 'date-fns-tz'
import { ru } from 'date-fns/locale'

import { dayDate } from '@/lib/intensives/dates'
import type { IntensiveSummary, PlanItemDto, PlanItemSend } from '@/lib/intensives/types'
import { formatDayHeading, formatRange, formatTimezone, formatYmd, pluralize } from '@/lib/intensives/ui'

/** Момент (ISO) → «13 октября, 10:00» в поясе интенсива (год — если не совпадает с текущим). */
export function formatInstantInTz(iso: string | Date | null | undefined, timeZone: string): string {
  if (!iso) return '—'
  const d = typeof iso === 'string' ? new Date(iso) : iso
  if (Number.isNaN(d.getTime())) return '—'
  try {
    const sameYear = formatInTimeZone(d, timeZone, 'yyyy') === formatInTimeZone(new Date(), timeZone, 'yyyy')
    return formatInTimeZone(d, timeZone, sameYear ? 'd MMMM, HH:mm' : 'd MMMM yyyy, HH:mm', { locale: ru })
  } catch {
    return d.toLocaleString('ru-RU')
  }
}

/** «12–25 октября · День 3 из 14 · Москва» — строка-подпись выбранного интенсива. */
export function intensiveMetaLine(intensive: IntensiveSummary): string {
  const parts = [formatRange(intensive.startDate, intensive.endDate)]
  const day = intensiveDayText(intensive)
  if (day) parts.push(day)
  parts.push(formatTimezone(intensive.timezone))
  return parts.join(' · ')
}

/** «День 3 из 14» / «Начнётся 12 октября» / «Завершён» — по данным сервера (поле day). */
export function intensiveDayText(intensive: IntensiveSummary): string | null {
  const { dayNumber, totalDays, today } = intensive.day
  if (dayNumber != null) return `День ${dayNumber} из ${totalDays}`
  if (today < intensive.startDate) return `Начнётся ${formatYmd(intensive.startDate, false)} · ${totalDays} ${pluralize(totalDays, 'день', 'дня', 'дней')}`
  if (today > intensive.endDate) return 'Завершён'
  return null
}

/** «День 2 · 13 октября, 10:00 · Москва» для даты/времени в поясе интенсива. */
export function planScheduleLine(
  intensive: Pick<IntensiveSummary, 'startDate' | 'endDate' | 'timezone'>,
  date: string | null | undefined,
  time: string | null | undefined,
): string | null {
  if (!date) return null
  const inPeriod = date >= intensive.startDate && date <= intensive.endDate
  const dayN = inPeriod ? diffDaysSafe(intensive.startDate, date) + 1 : null
  const head = dayN != null ? `День ${dayN} · ` : ''
  return `${head}${formatYmd(date, date.slice(0, 4) !== intensive.startDate.slice(0, 4))}${time ? `, ${time}` : ''} · ${formatTimezone(intensive.timezone)}`
}

function diffDaysSafe(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number)
  const [by, bm, bd] = b.split('-').map(Number)
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000)
}

/** Заголовок группы дня: «День 1 · Понедельник, 12 октября». */
export function dayGroupHeading(dayNumber: number, date: string): string {
  return `День ${dayNumber} · ${formatDayHeading(date)}`
}

/** «День 2 · 13 октября» по номеру дня пункта (без времени). */
export function itemDayShort(intensive: Pick<IntensiveSummary, 'startDate'>, dayNumber: number | null): string | null {
  if (dayNumber == null) return null
  return `День ${dayNumber} · ${formatYmd(dayDate(intensive.startDate, dayNumber), false)}`
}

export function sendCountText(n: number): string {
  return `${n} ${pluralize(n, 'отправка', 'отправки', 'отправок')}`
}

export function announcementsText(n: number): string {
  return `${n} ${pluralize(n, 'анонс', 'анонса', 'анонсов')}`
}

const SETUP_REASON_TEXT: Record<string, string> = {
  DAY_OUTSIDE_PERIOD: 'день вне периода интенсива',
  NO_DAY: 'не указан день',
  NO_TIME: 'не указано время',
}

/** «Требует настройки: не указано время» */
export function setupReasonsText(item: Pick<PlanItemDto, 'setupReasons'>): string {
  const list = item.setupReasons.map((r) => SETUP_REASON_TEXT[r] ?? r)
  return list.length ? `Требует настройки: ${list.join(', ')}` : 'Требует настройки'
}

/** Пункт требует внимания (ошибка, ожидание после назначенного времени, ошибка повтора). */
export function itemNeedsAttention(item: Pick<PlanItemDto, 'state' | 'details'>): boolean {
  return item.state === 'FAILED' || item.state === 'AWAITING_OVERDUE' || (item.state === 'SENT' && item.details.hasFailedRepeat)
}

const ts = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0)

/**
 * Отправка, к которой относится текущее состояние пункта: ожидающая основная / последняя успешная /
 * последняя ошибка / последняя отмена. Нужна для «Открыть сообщение», «Посмотреть отправку», «Открыть ошибку».
 */
export function primarySend(item: Pick<PlanItemDto, 'state' | 'sends'>): PlanItemSend | null {
  const sends = item.sends
  if (sends.length === 0) return null
  const pick = (pred: (s: PlanItemSend) => boolean, order: (a: PlanItemSend, b: PlanItemSend) => number) =>
    sends.filter(pred).sort(order)[0] ?? null
  switch (item.state) {
    case 'SCHEDULED':
    case 'AWAITING_OVERDUE':
      return (
        pick((s) => s.status === 'PENDING' && !s.isPlanRepeat, (a, b) => ts(a.scheduledFor) - ts(b.scheduledFor)) ??
        pick((s) => s.status === 'PENDING', (a, b) => ts(a.scheduledFor) - ts(b.scheduledFor))
      )
    case 'SENT':
      return pick((s) => s.status === 'SENT', (a, b) => ts(b.sentAt ?? b.scheduledFor) - ts(a.sentAt ?? a.scheduledFor))
    case 'FAILED':
      return (
        pick((s) => s.status === 'FAILED' && !s.isPlanRepeat, (a, b) => ts(b.createdAt) - ts(a.createdAt)) ??
        pick((s) => s.status === 'FAILED', (a, b) => ts(b.createdAt) - ts(a.createdAt))
      )
    case 'CANCELLED':
      return pick((s) => s.status === 'CANCELLED', (a, b) => ts(b.createdAt) - ts(a.createdAt))
    default:
      return null
  }
}

/** Последняя повторная отправка с ошибкой (для «Отправлено · Повтор завершился ошибкой»). */
export function lastFailedRepeat(item: Pick<PlanItemDto, 'sends'>): PlanItemSend | null {
  return item.sends.filter((s) => s.isPlanRepeat && s.status === 'FAILED').sort((a, b) => ts(b.createdAt) - ts(a.createdAt))[0] ?? null
}

/** Имя пользователя или null */
export function userName(u: { name: string | null } | null | undefined): string | null {
  const n = u?.name?.trim()
  return n ? n : null
}
