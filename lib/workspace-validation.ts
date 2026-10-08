/** Клиентская проверка полей подключения пространства Rocket.Chat (до запроса к API). */

export interface UrlCheck {
  error?: string
  /** Не блокирует отправку, но стоит показать пользователю */
  warning?: string
}

export function checkWorkspaceUrl(raw: string): UrlCheck {
  const value = raw.trim()
  if (!value) return { error: 'Укажите адрес пространства' }
  if (!/^https?:\/\//i.test(value)) {
    return { error: 'Адрес должен начинаться с https://, например https://rocketchat.example.com' }
  }
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    return { error: 'Некорректный адрес. Пример: https://rocketchat.example.com' }
  }
  if (!parsed.hostname || (!parsed.hostname.includes('.') && parsed.hostname !== 'localhost')) {
    return { error: 'Укажите полный адрес сервера, например https://rocketchat.example.com' }
  }
  if (parsed.protocol === 'http:') {
    return { warning: 'Адрес без шифрования (http://). По возможности используйте https://' }
  }
  return {}
}

/** Дата окончания не может быть раньше даты начала (значения в формате yyyy-MM-dd). */
export function checkDateRange(start: string, end: string): string | undefined {
  if (start && end && end < start) return 'Дата окончания раньше даты начала'
  return undefined
}
