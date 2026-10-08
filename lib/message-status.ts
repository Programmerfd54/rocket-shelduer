/**
 * Единые формулировки статусов запланированных сообщений (только отображение).
 * Статусы в базе (PENDING / SENT / FAILED / CANCELLED) не меняются: здесь они лишь
 * превращаются в понятный текст с учётом времени. Чистые функции, без React — тестируются vitest.
 *
 * Правила:
 * - PENDING и время в будущем      → «Запланировано»
 * - PENDING и время уже прошло     → «Ожидает отправки · назначенное время прошло»
 *   (не утверждаем, что сломался планировщик — мы этого не знаем)
 * - SENT → «Отправлено», FAILED → «Не отправлено», CANCELLED → «Отменено»
 * - Никогда не показываем «Отправляется», «Доставлено», «Прочитано»: таких данных у нас нет.
 */

export type DisplayStatusKey = 'scheduled' | 'overdue' | 'sent' | 'failed' | 'cancelled' | 'unknown'

/** Тон = семантический вариант Badge */
export type StatusTone = 'info' | 'warning' | 'success' | 'danger' | 'muted'

/** Ключ иконки (сами иконки подключает компонент MessageStatusBadge) */
export type StatusIconKey = 'scheduled' | 'overdue' | 'sent' | 'failed' | 'cancelled' | 'unknown'

export interface MessageStatusView {
  key: DisplayStatusKey
  /** Полная формулировка */
  label: string
  /** Короткая формулировка для тесных мест (строки списка) */
  shortLabel: string
  /** Пояснение (для подсказки/скринридера); пусто, если label и так всё говорит */
  description: string
  tone: StatusTone
  icon: StatusIconKey
  /** Требует внимания пользователя (не отправлено / ожидает с прошедшим временем) */
  needsAttention: boolean
}

type TimeInput = string | number | Date | null | undefined

/** Время в мс или null, если значение не задано / некорректно */
export function toTimestamp(value: TimeInput): number | null {
  if (value == null || value === '') return null
  const t = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : new Date(value).getTime()
  return Number.isFinite(t) ? t : null
}

/** PENDING, а назначенное время уже наступило/прошло */
export function isPendingOverdue(
  status: string | null | undefined,
  scheduledFor: TimeInput,
  now: Date | number = new Date(),
): boolean {
  if (status !== 'PENDING') return false
  const at = toTimestamp(scheduledFor)
  if (at === null) return false
  const nowMs = typeof now === 'number' ? now : now.getTime()
  return at <= nowMs
}

export function getMessageStatusView(
  status: string | null | undefined,
  scheduledFor: TimeInput,
  now: Date | number = new Date(),
): MessageStatusView {
  switch (status) {
    case 'PENDING':
      if (isPendingOverdue(status, scheduledFor, now)) {
        return {
          key: 'overdue',
          label: 'Ожидает отправки · назначенное время прошло',
          shortLabel: 'Ожидает отправки',
          description: 'Назначенное время уже прошло, а сообщение ещё не отправлено.',
          tone: 'warning',
          icon: 'overdue',
          needsAttention: true,
        }
      }
      return {
        key: 'scheduled',
        label: 'Запланировано',
        shortLabel: 'Запланировано',
        description: '',
        tone: 'info',
        icon: 'scheduled',
        needsAttention: false,
      }
    case 'SENT':
      return {
        key: 'sent',
        label: 'Отправлено',
        shortLabel: 'Отправлено',
        description: '',
        tone: 'success',
        icon: 'sent',
        needsAttention: false,
      }
    case 'FAILED':
      return {
        key: 'failed',
        label: 'Не отправлено',
        shortLabel: 'Не отправлено',
        description: 'Отправить сообщение не удалось.',
        tone: 'danger',
        icon: 'failed',
        needsAttention: true,
      }
    case 'CANCELLED':
      return {
        key: 'cancelled',
        label: 'Отменено',
        shortLabel: 'Отменено',
        description: '',
        tone: 'muted',
        icon: 'cancelled',
        needsAttention: false,
      }
    default:
      return {
        key: 'unknown',
        label: status ? String(status) : 'Статус неизвестен',
        shortLabel: status ? String(status) : 'Неизвестно',
        description: '',
        tone: 'muted',
        icon: 'unknown',
        needsAttention: false,
      }
  }
}

const MAX_ERROR_LENGTH = 400
const REDACTED = '[скрыто]'

/**
 * Причина ошибки из существующих данных (`message.error`) для показа пользователю:
 * вырезает токены/пароли/ключи, схлопывает пробелы, ограничивает длину.
 * Нет текста → null (не придумываем причину).
 */
export function sanitizeErrorReason(error: string | null | undefined): string | null {
  if (typeof error !== 'string') return null
  let text = error.replace(/\s+/g, ' ').trim()
  if (!text) return null

  // Bearer-токены и заголовки авторизации
  text = text.replace(/\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi, `$1 ${REDACTED}`)
  // key=value / key: value / "key":"value" для чувствительных ключей
  text = text.replace(
    /((?:x-)?(?:auth[-_ ]?token|user[-_ ]?id|access[-_ ]?token|refresh[-_ ]?token|token|password|passwd|pwd|secret|api[-_ ]?key|authorization)["']?\s*[:=]\s*)["']?[^\s"',;&]+["']?/gi,
    `$1${REDACTED}`,
  )
  // Длинные токеноподобные строки (JWT-сегменты, base64/hex-ключи)
  text = text.replace(/[A-Za-z0-9_-]{32,}/g, REDACTED)

  if (text.length > MAX_ERROR_LENGTH) text = `${text.slice(0, MAX_ERROR_LENGTH - 1).trimEnd()}…`
  return text
}
