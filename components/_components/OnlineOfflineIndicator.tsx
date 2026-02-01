"use client"

import { useState, useEffect } from 'react'
import { toast } from 'sonner'
import { Wifi, WifiOff } from 'lucide-react'
import { cn } from '@/lib/utils'

interface OnlineOfflineIndicatorProps {
  /** Показывать только иконку (без текста) */
  compact?: boolean
  /** Класс контейнера */
  className?: string
  /** Показывать тост при переходе в офлайн */
  toastOnOffline?: boolean
}

export function OnlineOfflineIndicator({
  compact = true,
  className,
  toastOnOffline = true,
}: OnlineOfflineIndicatorProps) {
  const [online, setOnline] = useState(
    typeof navigator !== 'undefined' ? navigator.onLine : true
  )

  useEffect(() => {
    if (typeof window === 'undefined') return
    const handleOnline = () => setOnline(true)
    const handleOffline = () => {
      setOnline(false)
      if (toastOnOffline) {
        toast.warning('Нет подключения к интернету', {
          description: 'Некоторые действия могут быть недоступны. Проверьте соединение.',
        })
      }
    }
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
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
      aria-label={online ? 'Подключение есть' : 'Нет подключения'}
    >
      {online ? (
        <Wifi className="h-4 w-4 text-green-600 dark:text-green-500" aria-hidden />
      ) : (
        <WifiOff className="h-4 w-4" aria-hidden />
      )}
      {!compact && (
        <span className="text-xs">
          {online ? 'Онлайн' : 'Офлайн'}
        </span>
      )}
    </div>
  )
}
