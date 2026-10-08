"use client"

import { useEffect, useSyncExternalStore } from 'react'
import { toast } from 'sonner'
import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnlineOfflineIndicatorProps {
  /** Показывать только иконку (без текста) */
  compact?: boolean
  /** Класс контейнера */
  className?: string
  /**
   * Показывать тост при переходе в офлайн.
   * По умолчанию выключено: глобальное уведомление уже показывает OfflineDetector в корневом layout.
   */
  toastOnOffline?: boolean
}

function subscribeOnline(callback: () => void) {
  window.addEventListener('online', callback)
  window.addEventListener('offline', callback)
  return () => {
    window.removeEventListener('online', callback)
    window.removeEventListener('offline', callback)
  }
}

function getOnline() {
  return navigator.onLine
}

/** Тихий индикатор соединения: в норме приглушённый, при обрыве — янтарный с подписью. */
export function OnlineOfflineIndicator({
  compact = true,
  className,
  toastOnOffline = false,
}: OnlineOfflineIndicatorProps) {
  const online = useSyncExternalStore(subscribeOnline, getOnline, () => true)

  useEffect(() => {
    if (!toastOnOffline) return
    const handleOffline = () => {
      toast.warning('Нет подключения к интернету', {
        description: 'Часть действий недоступна. Проверьте соединение.',
      })
    }
    window.addEventListener('offline', handleOffline)
    return () => window.removeEventListener('offline', handleOffline)
  }, [toastOnOffline])

  return (
    <div
      className={cn(
        'flex items-center gap-1.5 text-muted-foreground',
        !online && 'text-amber-600 dark:text-amber-400',
        compact && 'justify-center',
        className
      )}
      role="status"
      aria-label={online ? 'Соединение есть' : 'Нет соединения'}
      title={online ? 'Соединение есть' : 'Нет соединения с интернетом'}
    >
      {online ? (
        <Wifi className="h-4 w-4" aria-hidden />
      ) : (
        <WifiOff className="h-4 w-4" aria-hidden />
      )}
      {!compact && (
        <span className="text-xs">{online ? 'Онлайн' : 'Офлайн'}</span>
      )}
    </div>
  )
}
