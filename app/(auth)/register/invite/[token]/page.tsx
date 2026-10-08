"use client"

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Field } from "@/components/ui/field"
import { PasswordInput } from "@/components/ui/password-input"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Alert, AlertDescription } from "@/components/ui/alert"
import { AuthShell } from '@/components/common/AuthShell'
import { PasswordStrength } from '@/components/common/PasswordStrength'
import { toast } from 'sonner'
import { Loader2, CircleAlert } from 'lucide-react'
import { validateNewPassword, validatePasswordConfirm } from '@/lib/validate-password'

const ROLE_LABELS: Record<string, string> = {
  LEAD_SUP: 'Lead_SUP',
  SUP: 'SUP',
  ADM: 'ADM',
  MEMBER: 'Волонтёр',
}

export default function RegisterInvitePage() {
  const router = useRouter()
  const params = useParams()
  const token = params?.token as string

  const [invite, setInvite] = useState<{
    valid: boolean
    role: string
    email?: string
  } | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(true)

  const [formData, setFormData] = useState({
    login: '',
    name: '',
    password: '',
    confirmPassword: '',
  })
  const [touched, setTouched] = useState({ login: false, name: false, password: false, confirmPassword: false })
  const [isLoading, setIsLoading] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  useEffect(() => {
    if (!token) {
      setInviteError('Ссылка приглашения не указана')
      setLoadingInvite(false)
      return
    }
    fetch(`/api/auth/invite/${encodeURIComponent(token)}`)
      .then((res) => res.json())
      .then((data) => {
        if (data.valid) {
          setInvite({
            valid: true,
            role: data.role,
            email: data.email,
          })
          if (data.email) setFormData((f) => ({ ...f, login: data.email }))
        } else {
          setInviteError(data.error || 'Приглашение недействительно')
        }
      })
      .catch(() => setInviteError('Не удалось проверить приглашение. Проверьте соединение и обновите страницу.'))
      .finally(() => setLoadingInvite(false))
  }, [token])

  const loginTrim = formData.login.trim()
  const loginError = !loginTrim ? 'Введите логин' : /\s/.test(loginTrim) ? 'Логин без пробелов' : undefined
  const nameError = !formData.name.trim() ? 'Введите имя' : undefined
  const passwordError = validateNewPassword(formData.password)
  const confirmError = validatePasswordConfirm(formData.password, formData.confirmPassword)
  const valid = !loginError && !nameError && !passwordError && !confirmError

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite?.valid || !token) return
    setTouched({ login: true, name: true, password: true, confirmPassword: true })
    if (!valid) return

    setFormError(null)
    setIsLoading(true)
    try {
      const res = await fetch('/api/auth/register-invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          token,
          login: formData.login.trim(),
          password: formData.password,
          confirmPassword: formData.confirmPassword,
          name: formData.name.trim(),
        }),
      })
      const data = await res.json()

      if (!res.ok) {
        throw new Error(data.error || 'Ошибка регистрации')
      }

      toast.success('Аккаунт создан', { description: 'Добро пожаловать в систему' })
      router.push('/dashboard')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Попробуйте снова'
      setFormError(message)
      toast.error('Не удалось зарегистрироваться', { description: message })
    } finally {
      setIsLoading(false)
    }
  }

  if (loadingInvite) {
    return (
      <AuthShell title="Проверяем приглашение…">
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
          <Skeleton className="h-9 w-full" />
        </div>
      </AuthShell>
    )
  }

  if (inviteError || !invite?.valid) {
    return (
      <AuthShell
        title="Приглашение недействительно"
        description={inviteError || 'Срок действия ссылки истёк или она уже использована.'}
      >
        <div className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Попросите Lead_SUP отправить вам новое приглашение.
          </p>
          <Button asChild variant="outline" className="w-full">
            <Link href="/login">Перейти ко входу</Link>
          </Button>
        </div>
      </AuthShell>
    )
  }

  return (
    <AuthShell
      title="Создание аккаунта"
      description={
        <span className="flex flex-wrap items-center gap-2">
          Вас пригласили в систему с ролью
          <Badge variant="muted">{ROLE_LABELS[invite.role] ?? invite.role}</Badge>
        </span>
      }
      footer={
        <>
          Уже есть аккаунт?{' '}
          <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
            Войти
          </Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {formError && (
          <Alert variant="destructive">
            <CircleAlert aria-hidden />
            <AlertDescription>{formError}</AlertDescription>
          </Alert>
        )}

        <Field
          label="Логин"
          htmlFor="login"
          required
          error={touched.login ? loginError : undefined}
          hint={
            invite?.email
              ? 'Логин задан приглашением и не меняется. По нему вы будете входить в систему.'
              : 'По нему вы будете входить в систему.'
          }
        >
          <Input
            id="login"
            type="text"
            autoComplete="username"
            autoFocus
            value={formData.login}
            onChange={(e) => setFormData({ ...formData, login: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, login: true }))}
            aria-invalid={touched.login && !!loginError}
            className="font-mono"
            placeholder="d.solyanov"
            readOnly={!!invite?.email}
            disabled={isLoading}
          />
        </Field>

        <Field label="Имя" htmlFor="name" required error={touched.name ? nameError : undefined}>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            value={formData.name}
            onChange={(e) => setFormData({ ...formData, name: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, name: true }))}
            aria-invalid={touched.name && !!nameError}
            placeholder="Иван Иванов"
            disabled={isLoading}
          />
        </Field>

        <Field
          label="Пароль"
          htmlFor="password"
          required
          hint="Минимум 8 символов: заглавные и строчные буквы, цифры, спецсимволы."
          error={touched.password && formData.password ? passwordError : touched.password ? 'Введите пароль' : undefined}
        >
          <PasswordInput
            id="password"
            autoComplete="new-password"
            value={formData.password}
            onChange={(e) => setFormData({ ...formData, password: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, password: true }))}
            aria-invalid={touched.password && !!passwordError}
            placeholder="••••••••"
            disabled={isLoading}
          />
          <PasswordStrength password={formData.password} className="pt-1" />
        </Field>

        <Field
          label="Повторите пароль"
          htmlFor="confirmPassword"
          required
          error={touched.confirmPassword ? confirmError : undefined}
        >
          <PasswordInput
            id="confirmPassword"
            autoComplete="new-password"
            value={formData.confirmPassword}
            onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
            onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
            aria-invalid={touched.confirmPassword && !!confirmError}
            placeholder="••••••••"
            disabled={isLoading}
          />
        </Field>

        <Button type="submit" className="w-full" disabled={isLoading}>
          {isLoading && <Loader2 className="animate-spin" aria-hidden />}
          {isLoading ? 'Создаём аккаунт…' : 'Создать аккаунт'}
        </Button>
      </form>
    </AuthShell>
  )
}
