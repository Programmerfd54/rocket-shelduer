/**
 * Чистые хелперы очереди сообщений на дашборде: представления (вкладки), сортировка,
 * сводка и подписи времени. Работают с уже загруженными данными — без запросов.
 *
 * Важно про честность данных: «Сегодня» и «Очередь» считаются по ПОЛНОМУ списку PENDING
 * (API /api/messages без limit отдаёт все ожидающие сообщения пользователя),
 * «Требуют внимания» — по PENDING с прошедшим временем + FAILED (FAILED может быть ограничен limit).
 */
import { isPendingOverdue, toTimestamp } from '@/lib/message-status'

export type QueueView = 'today' | 'queue' | 'attention'

export const QUEUE_VIEWS: readonly QueueView[] = ['today', 'queue', 'attention']
export const DEFAULT_QUEUE_VIEW: QueueView = 'queue'
export const QUEUE_VIEW_STORAGE_KEY = 'dashboard:queue-view'

export interface QueueMessageLike {
  id: string
  status: string
  scheduledFor: string
}

/** Значение из localStorage → корректное представление (иначе по умолчанию) */
export function parseStoredView(raw: string | null | undefined): QueueView {
  return QUEUE_VIEWS.includes(raw as QueueView) ? (raw as QueueView) : DEFAULT_QUEUE_VIEW
}

/** Один и тот же календарный день в часовом поясе браузера */
export function isSameLocalDay(a: Date | number | string, b: Date | number | string): boolean {
  const da = new Date(a)
  const db = new Date(b)
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return false
  return (
    da.getFullYear() === db.getFullYear() && da.getMonth() === db.getMonth() && da.getDate() === db.getDate()
  )
}

/** Хронологически: по времени отправки, при равенстве — по id (стабильный порядок) */
export function sortChronological<T extends QueueMessageLike>(list: readonly T[]): T[] {
  return [...list].sort((x, y) => {
    const tx = toTimestamp(x.scheduledFor) ?? 0
    const ty = toTimestamp(y.scheduledFor) ?? 0
    if (tx !== ty) return tx - ty
    return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
  })
}

export function needsAttention(m: QueueMessageLike, now: Date | number = new Date()): boolean {
  return m.status === 'FAILED' || isPendingOverdue(m.status, m.scheduledFor, now)
}

/**
 * Что показывает представление:
 *  - today: PENDING, назначенные на сегодняшний день (локальный пояс), включая просроченные сегодня;
 *  - queue: все PENDING (запланированные и ожидающие), хронологически;
 *  - attention: FAILED + PENDING с прошедшим временем, хронологически.
 */
export function filterByView<T extends QueueMessageLike>(
  list: readonly T[],
  view: QueueView,
  now: Date = new Date(),
): T[] {
  let out: T[]
  switch (view) {
    case 'today':
      out = list.filter((m) => m.status === 'PENDING' && isSameLocalDay(m.scheduledFor, now))
      break
    case 'attention':
      out = list.filter((m) => needsAttention(m, now))
      break
    case 'queue':
    default:
      out = list.filter((m) => m.status === 'PENDING')
  }
  return sortChronological(out)
}

export interface QueueSummary {
  /** Все PENDING */
  pendingTotal: number
  /** PENDING на сегодня */
  todayCount: number
  /** PENDING с прошедшим временем */
  overdueCount: number
  /** FAILED среди загруженных */
  failedCount: number
  /** Ближайшее PENDING в будущем */
  next: QueueMessageLike | null
}

export function summarizeQueue<T extends QueueMessageLike>(
  list: readonly T[],
  now: Date = new Date(),
): Omit<QueueSummary, 'next'> & { next: T | null } {
  let pendingTotal = 0
  let todayCount = 0
  let overdueCount = 0
  let failedCount = 0
  let next: T | null = null
  let nextAt = Infinity
  const nowMs = now.getTime()
  for (const m of list) {
    if (m.status === 'FAILED') {
      failedCount += 1
      continue
    }
    if (m.status !== 'PENDING') continue
    pendingTotal += 1
    if (isSameLocalDay(m.scheduledFor, now)) todayCount += 1
    const at = toTimestamp(m.scheduledFor)
    if (at === null) continue
    if (at <= nowMs) overdueCount += 1
    else if (at < nextAt) {
      nextAt = at
      next = m
    }
  }
  return { pendingTotal, todayCount, overdueCount, failedCount, next }
}

/** «через 25 мин», «через 2 ч 10 мин», «через 3 дн.»; прошлое → «время прошло» */
export function formatUntil(target: string | number | Date, now: Date | number = new Date()): string {
  const at = toTimestamp(target)
  if (at === null) return ''
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const diffMin = Math.ceil((at - nowMs) / 60000)
  if (diffMin <= 0) return 'время прошло'
  if (diffMin < 60) return `через ${diffMin} мин`
  const hours = Math.floor(diffMin / 60)
  const minutes = diffMin % 60
  if (hours < 24) return minutes ? `через ${hours} ч ${minutes} мин` : `через ${hours} ч`
  return `через ${Math.floor(hours / 24)} дн.`
}

/** Подпись дня для колонки времени: «Сегодня» / «Завтра» / «Вчера» / «8 окт.» (+год, если не текущий) */
export function formatDayLabel(target: string | number | Date, now: Date = new Date()): string {
  const d = new Date(target)
  if (Number.isNaN(d.getTime())) return ''
  if (isSameLocalDay(d, now)) return 'Сегодня'
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  if (isSameLocalDay(d, tomorrow)) return 'Завтра'
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (isSameLocalDay(d, yesterday)) return 'Вчера'
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'short',
    ...(d.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  })
}

/** «14:30» */
export function formatClock(target: string | number | Date): string {
  const d = new Date(target)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

/** «среда, 7 октября» */
export function formatWeekdayDate(now: Date = new Date()): string {
  return now.toLocaleDateString('ru-RU', { weekday: 'long', day: 'numeric', month: 'long' })
}

/** Русское склонение: pluralRu(5, ['сообщение','сообщения','сообщений']) */
export function pluralRu(n: number, forms: readonly [string, string, string]): string {
  const m10 = Math.abs(n) % 10
  const m100 = Math.abs(n) % 100
  if (m10 === 1 && m100 !== 11) return forms[0]
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return forms[1]
  return forms[2]
}
