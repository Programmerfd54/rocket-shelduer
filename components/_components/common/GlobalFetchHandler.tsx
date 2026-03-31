"use client"

import { useEffect } from 'react'
import { toast } from 'sonner'

function isRelativeApiUrl(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url
  const path = typeof url === 'string' ? url : new URL(url).pathname
  return path.startsWith('/api/') && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')
}

/** Эндпоинты, где 403 ожидаем — тост «Нет доступа» не показываем */
function isOptional403Path(path: string): boolean {
  const p = path.split('?')[0]
  if (p === '/api/admin/settings' || p === '/api/admin/audit') return true
  // Сессия приложения есть, но нет входа в Rocket.Chat (или неверный пароль админа RC) — не путать с правами
  if (p.startsWith('/api/workspace/')) {
    if (/(channels|emojis|test)$/.test(p)) return true
    if (p.includes('/space-settings/')) return true
    if (p.endsWith('/emoji-import')) return true
    if (p.includes('/admin/user-access-rc')) return true
    if (p.includes('/users/add') || p.includes('/users/retry-failed') || p.includes('/users/refresh-login')) return true
  }
  if (p.startsWith('/api/messages/') && p.split('/').length >= 4) return true
  return false
}

export default function GlobalFetchHandler() {
  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return originalFetch.call(this, input, init).then((res) => {
        if (typeof window === 'undefined' || !isRelativeApiUrl(input)) return res
        if (res.status === 401) {
          window.location.href = '/login'
          return res
        }
        if (res.status === 403) {
          const path = typeof input === 'string' ? input : (input as Request).url
          const pathname = typeof path === 'string' ? path : new URL(path).pathname
          if (!isOptional403Path(pathname)) {
            toast.error('Нет доступа', { description: 'Недостаточно прав для этого действия' })
          }
          return res
        }
        if (res.status >= 500) {
          toast.error('Ошибка сервера', { description: 'Попробуйте позже или обновите страницу' })
          return res
        }
        return res
      })
    }
    return () => {
      window.fetch = originalFetch
    }
  }, [])
  return null
}
