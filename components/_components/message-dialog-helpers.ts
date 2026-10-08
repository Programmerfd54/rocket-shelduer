/**
 * Чистые хелперы диалога сообщения: понятные тексты ошибок сохранения.
 * Не меняют контракты API — только переводят ответ сервера в сообщение пользователю.
 */

export type SaveErrorKind = 'auth' | 'network' | 'time' | 'other'

export interface SaveErrorInfo {
  kind: SaveErrorKind
  /** Текст для баннера у кнопки сохранения */
  message: string
  /** Если ошибка относится к полю времени — текст у поля */
  timeError?: string
}

const KNOWN_ERRORS: Record<string, string> = {
  'All fields are required': 'Заполните все обязательные поля.',
  'Workspace not found': 'Пространство не найдено — возможно, оно удалено.',
  'No access to this workspace': 'Нет доступа к этому пространству.',
  'Message not found': 'Сообщение не найдено — возможно, оно уже удалено.',
  Unauthorized: 'Нет прав на это действие.',
  'Can only edit pending or sent messages': 'Это сообщение уже нельзя изменить.',
  'Failed to schedule message': 'Не удалось запланировать сообщение. Попробуйте ещё раз.',
  'Failed to update message': 'Не удалось сохранить изменения. Попробуйте ещё раз.',
}

const HAS_CYRILLIC = /[а-яё]/i

/** Ответ сервера → понятное сообщение. `status` 0 — запрос не дошёл до сервера. */
export function describeSaveError(status: number, data: { error?: unknown; code?: unknown } | null | undefined): SaveErrorInfo {
  const raw = typeof data?.error === 'string' ? data.error : ''

  if (status === 0) {
    return {
      kind: 'network',
      message: 'Нет соединения с сервером. Проверьте интернет — введённые данные сохранены, попробуйте ещё раз.',
    }
  }
  if (status === 401) {
    return {
      kind: 'auth',
      message: 'Сессия истекла. Войдите снова — текст сохранён в черновике на этом устройстве.',
    }
  }
  if (raw === 'Scheduled time must be in the future') {
    const t = 'Время отправки должно быть в будущем'
    return { kind: 'time', message: `${t}. Выберите другое время.`, timeError: t }
  }
  if (data?.code === 'RC_NOT_CONNECTED') {
    return {
      kind: 'other',
      message: 'Пространство не подключено к Rocket.Chat. Обновите подключение в настройках пространства и повторите.',
    }
  }
  if (KNOWN_ERRORS[raw]) return { kind: 'other', message: KNOWN_ERRORS[raw] }
  if (raw && HAS_CYRILLIC.test(raw)) return { kind: 'other', message: raw }
  if (status >= 500) {
    return { kind: 'other', message: 'Ошибка сервера. Введённые данные сохранены в форме — попробуйте ещё раз чуть позже.' }
  }
  if (status === 403) return { kind: 'other', message: 'Нет прав на это действие.' }
  return { kind: 'other', message: `Не удалось сохранить сообщение (код ${status}). Данные в форме сохранены.` }
}
