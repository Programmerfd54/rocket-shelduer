"use client"

import { useEffect } from 'react'
import { toast } from 'sonner'

function isRelativeApiUrl(input: RequestInfo | URL): boolean {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.pathname : (input as Request).url
  const path = typeof url === 'string' ? url : new URL(url).pathname
  return path.startsWith('/api/') && !path.startsWith('/api/auth/login') && !path.startsWith('/api/auth/register')
}

/** Эндпоинты, где 403 ожидаем (опциональный доступ по роли) — тост не показываем */
function isOptional403Path(path: string): boolean {
  const p = path.split('?')[0]
  return p === '/api/admin/settings' || p === '/api/admin/audit'
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
