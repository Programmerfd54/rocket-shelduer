"use client"

import { useEffect } from 'react'
import { toast } from 'sonner'

/** Путь запроса (без query) или null, если это не относительный /api/* запрос к нашему origin. */
function getApiPath(input: RequestInfo | URL): string | null {
  try {
    const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : (input as Request).url
    const url = new URL(raw, window.location.href)
    if (url.origin !== window.location.origin) return null
    return url.pathname.startsWith('/api/') ? url.pathname : null
  } catch {
    return null
  }
}

/**
 * Эндпоинты, где 401 — это ответ формы (неверный пароль, истёкшая ссылка и т.п.),
 * а не «сессия истекла»: редирект на /login не делаем, ошибку показывает сама форма.
 */
function isAuthFormPath(path: string): boolean {
  return (
    path === '/api/auth/login' ||
    path.startsWith('/api/auth/register') || // register, register-invite
    path === '/api/auth/logout' ||
    path === '/api/auth/reset-password' ||
    path === '/api/auth/forgot-password' ||
    path.startsWith('/api/auth/invite/') ||
    path === '/api/user/password' // 401 = неверный текущий пароль
  )
}

/** Эндпоинты, где 403 ожидаем — тост «Нет доступа» не показываем */
function isOptional403Path(path: string): boolean {
  const p = path.split('?')[0]
  if (p === '/api/admin/settings' || p === '/api/admin/audit') return true
  // Сессия приложения есть, но нет входа в Rocket.Chat (или неверный пароль админа RC) — не путать с правами
  if (p.startsWith('/api/workspace/')) {
    if (/(channels|emojis|test)$/.test(p)) return true
    if (p.includes('/space-settings/')) return true
    if (p.endsWith('/emoji-import') || p.endsWith('/emoji-import/manage')) return true
    if (p.includes('/admin/user-access-rc')) return true
    if (p.includes('/users/add') || p.includes('/users/retry-failed') || p.includes('/users/refresh-login')) return true
  }
  if (p.startsWith('/api/messages/') && p.split('/').length >= 4) return true
  return false
}

function isLocalErrorHandling(input: RequestInfo | URL, init?: RequestInit): boolean {
  try {
    const fromInit = init?.headers ? new Headers(init.headers).get('X-Error-Handling') : null
    if (fromInit) return fromInit === 'local'
    if (typeof Request !== 'undefined' && input instanceof Request) {
      return input.headers.get('X-Error-Handling') === 'local'
    }
  } catch {
    /* ignore malformed headers */
  }
  return false
}

export default function GlobalFetchHandler() {
  useEffect(() => {
    const originalFetch = window.fetch
    window.fetch = function (input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      return originalFetch.call(this, input, init).then((res) => {
        if (typeof window === 'undefined') return res
        const path = getApiPath(input)
        if (!path) return res

        // Запросы с X-Error-Handling: local сами показывают ошибку у формы (в т.ч. «Сессия истекла»
        // с сохранением введённого текста) — глобальный редирект/тост для них не выполняется.
        if (isLocalErrorHandling(input, init)) return res

        if (res.status === 401) {
          if (!isAuthFormPath(path)) window.location.href = '/login'
          return res
        }
        if (res.status === 403) {
          // Временный пароль: сервер пускает только на страницу смены пароля
          if (res.headers.get('X-Password-Change-Required') === '1') {
            if (window.location.pathname !== '/dashboard/change-password') {
              window.location.href = '/dashboard/change-password'
            }
            return res
          }
          if (!isOptional403Path(path)) {
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
