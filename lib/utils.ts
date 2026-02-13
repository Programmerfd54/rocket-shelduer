import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Единая цветовая кодировка статусов сообщений: ожидает / отправлено / ошибка */
export const messageStatusBadgeClasses: Record<string, string> = {
  PENDING: 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300 text-xs border-0',
  SENT: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300 text-xs border-0',
  FAILED: 'bg-destructive/10 text-destructive dark:bg-destructive/20 text-xs border-0',
}


export function formatDate(
    date: Date | string,
    options: Intl.DateTimeFormatOptions = {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }
  ): string {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.toLocaleString('ru-RU', options)
  }
  
/** Локальная дата в формате YYYY-MM-DD (для расчёта дня интенсива по календарю пользователя) */
export function formatLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

  export function formatRelativeTime(date: Date | string): string {
    const d = typeof date === 'string' ? new Date(date) : date
    const now = new Date()
    const diffInMs = now.getTime() - d.getTime()
    const diffInMinutes = Math.floor(diffInMs / (1000 * 60))
    const diffInHours = Math.floor(diffInMs / (1000 * 60 * 60))
    const diffInDays = Math.floor(diffInMs / (1000 * 60 * 60 * 24))
  
    if (diffInMinutes < 1) return 'только что'
    if (diffInMinutes < 60) return `${diffInMinutes} мин. назад`
    if (diffInHours < 24) return `${diffInHours} ч. назад`
    if (diffInDays < 7) return `${diffInDays} дн. назад`
    
    return formatDate(d)
  }
  
  export function checkPasswordStrength(password: string): {
    valid: boolean
    strength: 'weak' | 'medium' | 'strong'
    message: string
  } {
    if (password.length < 8) {
      return {
        valid: false,
        strength: 'weak',
        message: 'Пароль должен содержать минимум 8 символов',
      }
    }
  
    const hasUpperCase = /[A-Z]/.test(password)
    const hasLowerCase = /[a-z]/.test(password)
    const hasNumbers = /\d/.test(password)
    const hasSpecialChar = /[!@#$%^&*(),.?":{}|<>]/.test(password)
  
    const strengthScore = [hasUpperCase, hasLowerCase, hasNumbers, hasSpecialChar].filter(
      Boolean
    ).length
  
    if (strengthScore < 2) {
      return { valid: true, strength: 'weak', message: 'Слабый пароль' }
    }
  
    if (strengthScore < 4) {
      return { valid: true, strength: 'medium', message: 'Средний пароль' }
    }
  
    return { valid: true, strength: 'strong', message: 'Сильный пароль' }
  }
  
  export function getInitials(name: string | null | undefined): string {
    if (!name) return '??'
    
    const parts = name.trim().split(' ')
    if (parts.length === 1) {
      return parts[0].substring(0, 2).toUpperCase()
    }
    
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
  }
  
  export function generateAvatarColor(text: string): string {
    const colors = [
      'bg-red-500',
      'bg-blue-500',
      'bg-green-500',
      'bg-yellow-500',
      'bg-purple-500',
      'bg-pink-500',
      'bg-indigo-500',
      'bg-teal-500',
    ]
  
    let hash = 0
    for (let i = 0; i < text.length; i++) {
      hash = text.charCodeAt(i) + ((hash << 5) - hash)
    }
  
    return colors[Math.abs(hash) % colors.length]
  }

/** Цвета для тега/карточки канала по имени — 4 приятных цвета (синий, фиолетовый, бирюзовый, янтарный) */
export function getChannelTagColors(name: string): { bar: string; bg: string; text: string } {
  const palettes = [
    { bar: 'border-blue-500', bg: 'bg-blue-50 dark:bg-blue-950/40', text: 'text-blue-700 dark:text-blue-300' },
    { bar: 'border-violet-500', bg: 'bg-violet-50 dark:bg-violet-950/40', text: 'text-violet-700 dark:text-violet-300' },
    { bar: 'border-teal-500', bg: 'bg-teal-50 dark:bg-teal-950/40', text: 'text-teal-700 dark:text-teal-300' },
    { bar: 'border-amber-500', bg: 'bg-amber-50 dark:bg-amber-950/40', text: 'text-amber-700 dark:text-amber-300' },
  ]
  let hash = 0
  const str = (name || '').toString()
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash)
  }
  return palettes[Math.abs(hash) % palettes.length]
  }
  
  export function isFutureDate(date: Date | string): boolean {
    const d = typeof date === 'string' ? new Date(date) : date
    return d.getTime() > Date.now()
  }

/** Человекочитаемая подпись для типа действия в логе активности */
export function getActivityLabel(action: string): string {
  const labels: Record<string, string> = {
    USER_LOGIN: 'Вход в систему',
    USER_LOGOUT: 'Выход',
    USER_REGISTER: 'Регистрация',
    USER_BLOCKED: 'Пользователь заблокирован',
    USER_UNBLOCKED: 'Пользователь разблокирован',
    USER_ROLE_CHANGED: 'Роль изменена',
    USER_CREATED_BY_ADMIN: 'Создан администратором',
    WORKSPACE_CREATED: 'Пространство создано',
    WORKSPACE_UPDATED: 'Пространство обновлено',
    WORKSPACE_DELETED: 'Пространство удалено',
    WORKSPACE_ARCHIVED: 'Пространство заархивировано',
    WORKSPACE_UNARCHIVED: 'Пространство восстановлено из архива',
    WORKSPACE_CONNECTED: 'Подключение к пространству',
    MESSAGE_CREATED: 'Сообщение создано',
    MESSAGE_UPDATED: 'Сообщение обновлено',
    MESSAGE_DELETED: 'Сообщение удалено',
    MESSAGE_SENT: 'Сообщение отправлено',
    MESSAGE_FAILED: 'Ошибка отправки сообщения',
    SETTINGS_UPDATED: 'Настройки обновлены',
    PASSWORD_CHANGED: 'Пароль изменён',
    ADMIN_ACTION: 'Действие администратора',
  }
  return labels[action] || action
}

/** Краткое описание details из лога (JSON или строка) */
export function formatActivityDetails(details: string | null | undefined): string {
  if (!details) return ''
  try {
    const parsed = typeof details === 'string' ? JSON.parse(details) : details
    if (typeof parsed === 'object') {
      const parts: string[] = []
      if (parsed.reason) parts.push(`Причина: ${parsed.reason}`)
      if (parsed.targetUserId) parts.push(`ID пользователя: ${parsed.targetUserId}`)
      if (parsed.addDays) parts.push(`Продление на ${parsed.addDays} дн.`)
      if (parsed.action) parts.push(String(parsed.action))
      if (parsed.workspaceName) parts.push(parsed.workspaceName)
      if (parsed.email) parts.push(parsed.email)
      if (parsed.role) parts.push(`Роль: ${parsed.role}`)
      if (parts.length > 0) return parts.join(' · ')
      return JSON.stringify(parsed)
    }
    return String(parsed)
  } catch {
    return typeof details === 'string' ? details : ''
  }
}