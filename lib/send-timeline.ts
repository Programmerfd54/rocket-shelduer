/**
 * История отправки сообщения («таймлайн») — только из данных, которые реально есть в записи:
 * createdAt, scheduledFor, sentAt (только для SENT: у PENDING это отметка «взято в работу»),
 * error (для FAILED), updatedAt (время ошибки/отмены) и ссылка на сообщение в Rocket.Chat.
 *
 * Попытки отправки и «началась отправка» не выдумываем: сервер хранит только итог.
 * Чистая функция, без React — тестируется vitest.
 */
import { sanitizeErrorReason, toTimestamp } from '@/lib/message-status'

export type TimelineEventKey = 'created' | 'scheduled' | 'sent' | 'failed' | 'cancelled'
export type TimelineTone = 'neutral' | 'success' | 'danger' | 'muted'

export interface TimelineEvent {
  key: TimelineEventKey
  /** Что произошло (текст, не зависит от цвета) */
  label: string
  /** Уточнение: кто запланировал / причина ошибки; null — нечего добавить */
  detail: string | null
  /** Время события (ISO) или null, если в данных его нет */
  at: string | null
  /** 'upcoming' — событие ещё впереди (назначенное время не наступило) */
  state: 'done' | 'upcoming'
  tone: TimelineTone
  /** Ссылка на сообщение в Rocket.Chat (только у «Отправлено», если сервер её определил) */
  link: string | null
}

export interface TimelineActor {
  name?: string | null
  username?: string | null
  email?: string | null
}

export interface TimelineSource {
  status?: string | null
  createdAt?: string | null
  scheduledFor?: string | null
  sentAt?: string | null
  error?: string | null
  updatedAt?: string | null
  user?: TimelineActor | null
  scheduledBy?: TimelineActor | null
  rcPermalink?: string | null
}

export const TIMELINE_STORAGE_NOTE = 'Сервер хранит только итог отправки'

function actorLabel(a: TimelineActor | null | undefined): string {
  return (a?.name || a?.username || a?.email || '').trim()
}

function iso(value: string | null | undefined): string | null {
  return toTimestamp(value) === null ? null : (value as string)
}

export function buildSendTimeline(
  message: TimelineSource,
  now: Date | number = new Date(),
): { events: TimelineEvent[]; note: string | null } {
  const nowMs = typeof now === 'number' ? now : now.getTime()
  const events: TimelineEvent[] = []

  const who = actorLabel(message.scheduledBy) || actorLabel(message.user)
  const createdAt = iso(message.createdAt)
  if (createdAt) {
    events.push({
      key: 'created',
      label: 'Запланировано',
      detail: who ? `Запланировал(а): ${who}` : null,
      at: createdAt,
      state: 'done',
      tone: 'neutral',
      link: null,
    })
  }

  const scheduledFor = iso(message.scheduledFor)
  if (scheduledFor) {
    const future = (toTimestamp(scheduledFor) as number) > nowMs
    events.push({
      key: 'scheduled',
      label: 'Назначено на',
      detail: null,
      at: scheduledFor,
      state: message.status === 'PENDING' && future ? 'upcoming' : 'done',
      tone: 'neutral',
      link: null,
    })
  }

  switch (message.status) {
    case 'SENT':
      events.push({
        key: 'sent',
        label: 'Отправлено',
        detail: null,
        at: iso(message.sentAt),
        state: 'done',
        tone: 'success',
        link: message.rcPermalink || null,
      })
      break
    case 'FAILED':
      events.push({
        key: 'failed',
        label: 'Ошибка',
        detail: sanitizeErrorReason(message.error) ?? 'Причина в данных не указана.',
        at: iso(message.updatedAt),
        state: 'done',
        tone: 'danger',
        link: null,
      })
      break
    case 'CANCELLED':
      events.push({
        key: 'cancelled',
        label: 'Отменено',
        detail: null,
        at: iso(message.updatedAt),
        state: 'done',
        tone: 'muted',
        link: null,
      })
      break
    default:
      break
  }

  const note = message.status === 'SENT' || message.status === 'FAILED' ? TIMELINE_STORAGE_NOTE : null
  return { events, note }
}
