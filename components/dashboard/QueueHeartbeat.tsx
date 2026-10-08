"use client"

import { useEffect, useState } from 'react'
import { AlertTriangle, CircleCheck } from 'lucide-react'
import { describeQueueStatus, type QueueStatus } from '@/lib/queue-status'
import { cn } from '@/lib/utils'

/**
 * Состояние очереди отправки для Lead_SUP / SUP: когда планировщик (cron) последний раз проверял очередь.
 * Это состояние сервера — не «онлайн» браузера. Запрос один при открытии и при возврате на вкладку, без опроса.
 * Для остальных ролей и при ошибке запроса ничего не показываем (не выдумываем состояние).
 */
export function QueueHeartbeat({ enabled, className }: { enabled: boolean; className?: string }) {
  const [status, setStatus] = useState<QueueStatus | null>(null)
  useEffect(() => {
    if (!enabled) return
    let cancelled = false
    let ctrl: AbortController | null = null

    const load = () => {
      ctrl?.abort()
      ctrl = new AbortController()
      fetch('/api/admin/queue-status', { signal: ctrl.signal, cache: 'no-store' })
        .then((res) => (res.ok ? res.json() : null))
        .then((data: Partial<QueueStatus> | null) => {
          if (cancelled || !data || typeof data.stale !== 'boolean') return
          setStatus({
            lastTickAt: typeof data.lastTickAt === 'string' ? data.lastTickAt : null,
            ageSeconds: typeof data.ageSeconds === 'number' ? data.ageSeconds : null,
            stale: data.stale,
          })
        })
        .catch(() => {
          /* индикатор второстепенен: при ошибке сети оставляем прежнее значение */
        })
    }
    const onVisible = () => {
      if (document.visibilityState === 'visible') load()
    }

    load()
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      cancelled = true
      ctrl?.abort()
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [enabled])

  if (!enabled || !status) return null
  const view = describeQueueStatus(status)
  const warning = view.tone === 'warning'
  const Icon = warning ? AlertTriangle : CircleCheck

  return (
    <span
      role={warning ? 'status' : undefined}
      className={cn(
        'inline-flex items-center gap-1.5 text-xs',
        warning ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground',
        className,
      )}
    >
      <Icon className="size-3.5 shrink-0" aria-hidden />
      {view.text}
    </span>
  )
}
