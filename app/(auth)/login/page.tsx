"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { PasswordInput } from "@/components/ui/password-input"
import { Field } from "@/components/ui/field"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthShell } from '@/components/common/AuthShell'
import { toast } from 'sonner'
import { Loader2, CircleAlert } from 'lucide-react'

export default function LoginPage() {
  const router = useRouter()
  const [formData, setFormData] = useState({
    login: '',
    password: '',
  })
  const [isLoading, setIsLoading] = useState(false)
  const [touched, setTouched] = useState({ login: false, password: false })
  const [formError, setFormError] = useState<string | null>(null)

  const loginError = touched.login && !formData.login.trim() ? 'Введите логин' : undefined
  const passwordError = touched.password && !formData.password ? 'Введите пароль' : undefined

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched({ login: true, password: true })
    if (!formData.login.trim() || !formData.password) return
    setFormError(null)
    setIsLoading(true)

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ login: formData.login.trim(), password: formData.password }),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Ошибка входа')
      }

      if (data.requirePasswordChange) {
        router.push('/dashboard/change-password')
        return
      }

      router.push('/dashboard')
    } catch (err: any) {
      const message = err.message || 'Проверьте логин и пароль и попробуйте снова'
      setFormError(message)
      toast.error('Не удалось войти', { description: message })
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <AuthShell
      title="Вход"
      description="Введите логин и пароль, которые выдал администратор."
      footer="Нет доступа? Попросите Lead_SUP прислать приглашение."
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <Field label="Логин" htmlFor="login" error={loginError}>
          <Input
            id="login"
            type="text"
            autoComplete="username"
            autoFocus
            value={formData.login}
            onChange={(e) => setFormData({ ...formData, login: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, login: true }))}
            aria-invalid={!!loginError}
            placeholder="d.solyanov"
            disabled={isLoading}
          />
        </Field>

        <Field
          label="Пароль"
          htmlFor="password"
          error={passwordError}
          hint="Забыли пароль? Его сбросит администратор."
        >
          <PasswordInput
            id="password"
            autoComplete="current-password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={!!passwordError}
            placeholder="••••••••"
            disabled={isLoading}
          />
        </Field>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="animate-spin" aria-hidden />}
          {isLoading ? 'Входим…' : 'Войти'}
        </Button>
      </form>
    </AuthShell>
  )
}
