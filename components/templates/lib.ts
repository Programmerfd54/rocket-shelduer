/**
 * Общие типы и хелперы страницы «Шаблоны анонсов» (components/templates/**). Только клиентский код.
 */
import { ApiError } from '@/lib/intensives/ui'
import type { OfficialTemplateDto, TemplateAudience, TemplateScope } from '@/lib/templates/types'

export type { OfficialTemplateDto, TemplateAudience, TemplateScope }

/** Свой шаблон пользователя (GET /api/templates/mine). */
export type UserTemplate = {
  id: string
  channel: string
  intensiveDay: number | null
  time: string
  title: string | null
  body: string
  tags?: string[]
  createdAt: string
  updatedAt: string
  lastSentAt?: string | null
}

export type TemplateVersion = {
  id: string
  body: string
  title: string | null
  channel: string
  time: string
  intensiveDay: number | null
  createdAt: string
}

/** Что передаём в диалог «Запланировать сообщение по шаблону». */
export type ScheduleSource = {
  body: string
  channel: string
  time: string
  userTemplateId?: string
}

export type LoadStatus = 'loading' | 'ready' | 'error' | 'forbidden'

export const SCOPE_TAB_LABELS: Record<TemplateScope, string> = {
  SUP: 'Шаблоны SUP',
  ADM: 'Шаблоны ADM',
}

export const AUDIENCE_OPTIONS: { value: TemplateAudience; label: string }[] = [
  { value: 'all', label: 'Все кампусы' },
  { value: 'mk', label: 'Только кампусы с МК' },
]

export const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

export function otherScope(scope: TemplateScope): TemplateScope {
  return scope === 'SUP' ? 'ADM' : 'SUP'
}

export function dayTitle(day: number): string {
  return day === 0 ? 'Без дня' : `День ${day}`
}

export function announcementsCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} анонс`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} анонса`
  return `${n} анонсов`
}

export function templatesCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} шаблон`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} шаблона`
  return `${n} шаблонов`
}

export function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

export const NETWORK_ERROR = 'Нет связи с сервером. Проверьте соединение и повторите.'

/** Текст ошибки для тоста/формы: ответ API ({ error }) или сетевая ошибка. */
export function errText(e: unknown, fallback = NETWORK_ERROR): string {
  if (e instanceof ApiError) return e.message
  if (e instanceof Error && e.message && !(e instanceof TypeError)) return e.message
  return fallback
}

export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (e instanceof ApiError && e.body.fieldErrors && typeof e.body.fieldErrors === 'object') {
    return e.body.fieldErrors as Record<string, string>
  }
  return {}
}

/** Копирование в буфер с запасным способом для старых браузеров / http. */
export async function copyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard) {
    try {
      await navigator.clipboard.writeText(text)
      return true
    } catch {
      /* пробуем запасной способ */
    }
  }
  try {
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    textarea.style.pointerEvents = 'none'
    document.body.appendChild(textarea)
    textarea.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(textarea)
    return ok
  } catch {
    return false
  }
}

export function matchesSearch(q: string, ...fields: (string | null | undefined)[]): boolean {
  if (!q) return true
  const s = q.toLowerCase()
  return fields.some((f) => !!f && f.toLowerCase().includes(s))
}
