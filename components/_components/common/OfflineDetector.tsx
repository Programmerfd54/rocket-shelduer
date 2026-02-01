"use client"

import { useEffect, useState } from 'react'
import { WifiOff, Wifi } from 'lucide-react'
import { toast } from 'sonner'

export default function OfflineDetector() {
  const [isOnline, setIsOnline] = useState(true)
  const [wasOffline, setWasOffline] = useState(false)

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true)
      if (wasOffline) {
        toast.success('Подключение восстановлено', {
          description: 'Вы снова онлайн',
          icon: <Wifi className="w-5 h-5" />,
        })
        setWasOffline(false)
      }
    }

    const handleOffline = () => {
      setIsOnline(false)
      setWasOffline(true)
      toast.error('Нет подключения к интернету', {
        description: 'Проверьте подключение',
        icon: <WifiOff className="w-5 h-5" />,
        duration: Infinity, // Не закрывается автоматически
      })
    }

    // Проверка текущего состояния
    setIsOnline(navigator.onLine)

    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)

    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [wasOffline])

  if (isOnline) return null

  return (
    <div className="fixed bottom-0 left-0 right-0 bg-destructive text-destructive-foreground p-4 z-50">
      <div className="container mx-auto flex items-center justify-center gap-2">
        <WifiOff className="w-5 h-5" />
        <p className="font-medium">Нет подключения к интернету</p>
      </div>
    </div>
  )
}