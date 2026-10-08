"use client"

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/** Публичная регистрация отключена — редирект на логин. Регистрация только по приглашению. */
export default function RegisterPage() {
  const router = useRouter()

  useEffect(() => {
    router.replace('/login')
  }, [router])

  return (
    <div className="auth-canvas flex min-h-screen items-center justify-center p-4">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Переходим на страницу входа…
      </div>
    </div>
  )
}
