/**
 * Постоянная ссылка на отправленное сообщение в Rocket.Chat. Чистая функция, без сети.
 *
 * Тип комнаты определяет вызывающий код (rooms.info): 'c' — публичный канал → /channel/<имя>,
 * 'p' — приватная группа → /group/<имя>, 'd' — личные сообщения → /direct/<id комнаты>.
 * Тип неизвестен или не хватает данных → null (тип никогда не угадываем).
 */

export type RcRoomType = 'c' | 'p' | 'd'

export interface RcPermalinkInput {
  /** Адрес сервера Rocket.Chat (из подключения к пространству), только http(s) */
  workspaceUrl: string | null | undefined
  /** Поле `t` из rooms.info */
  roomType: string | null | undefined
  /** Поле `name` комнаты (для 'c' и 'p') */
  roomName?: string | null
  /** Идентификатор комнаты (для 'd') */
  roomId?: string | null
  /** Идентификатор сообщения в Rocket.Chat (messageId_RC) */
  messageId: string | null | undefined
}

/** Адрес сервера без query/hash и хвостовых «/». Не http(s) или некорректный → null. */
export function normalizeWorkspaceBase(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null
  const v = raw.trim()
  if (!v) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    return `${u.origin}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return null
  }
}

function nonEmpty(v: string | null | undefined): string | null {
  if (typeof v !== 'string') return null
  const t = v.trim()
  return t ? t : null
}

export function buildRcPermalink(input: RcPermalinkInput): string | null {
  const base = normalizeWorkspaceBase(input.workspaceUrl)
  const messageId = nonEmpty(input.messageId)
  if (!base || !messageId) return null

  let path: string
  switch (input.roomType) {
    case 'c': {
      const name = nonEmpty(input.roomName)
      if (!name) return null
      path = `/channel/${encodeURIComponent(name)}`
      break
    }
    case 'p': {
      const name = nonEmpty(input.roomName)
      if (!name) return null
      path = `/group/${encodeURIComponent(name)}`
      break
    }
    case 'd': {
      const rid = nonEmpty(input.roomId)
      if (!rid) return null
      path = `/direct/${encodeURIComponent(rid)}`
      break
    }
    default:
      return null
  }
  return `${base}${path}?msg=${encodeURIComponent(messageId)}`
}
