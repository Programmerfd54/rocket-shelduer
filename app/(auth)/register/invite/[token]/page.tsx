"use client"

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { toast } from 'sonner'
import { Send, Mail, Lock, Loader2, ArrowRight, CheckCircle, User } from 'lucide-react'
import { checkPasswordStrength } from '@/lib/utils'

const ROLE_LABELS: Record<string, string> = {
  USER: 'Пользователь',
  ADM: 'Администратор',
  VOL: 'Волонтёр',
  SUPPORT: 'Support',
  ADMIN: 'Admin',
}

export default function RegisterInvitePage() {
  const router = useRouter()
  const params = useParams()
  const token = params?.token as string

  const [invite, setInvite] = useState<{ valid: boolean; role: string; email?: string } | null>(null)
  const [inviteError, setInviteError] = useState<string | null>(null)
  const [loadingInvite, setLoadingInvite] = useState(true)

  const [formData, setFormData] = useState({
    login: '',
    name: '',
    password: '',
    confirmPassword: '',
  })
  const [isLoading, setIsLoading] = useState(false)

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
          setInvite({ valid: true, role: data.role, email: data.email })
          if (data.email) setFormData((f) => ({ ...f, login: data.email }))
        } else {
          setInviteError(data.error || 'Приглашение недействительно')
        }
      })
      .catch(() => setInviteError('Ошибка загрузки приглашения'))
      .finally(() => setLoadingInvite(false))
  }, [token])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!invite?.valid || !token) return

    if (formData.password !== formData.confirmPassword) {
      toast.error('Пароли не совпадают')
      return
    }

    const passwordCheck = checkPasswordStrength(formData.password)
    if (!passwordCheck.valid) {
      toast.error('Слабый пароль', { description: passwordCheck.message })
      return
    }

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

      toast.success('Регистрация успешна!', { description: 'Добро пожаловать в систему' })
      router.push('/dashboard')
    } catch (err: unknown) {
      toast.error('Ошибка регистрации', {
        description: err instanceof Error ? err.message : 'Попробуйте снова',
      })
    } finally {
      setIsLoading(false)
    }
  }

  const passwordStrength = checkPasswordStrength(formData.password)

  if (loadingInvite) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/20">
        <div className="text-center space-y-4">
          <Loader2 className="w-10 h-10 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Проверка приглашения...</p>
        </div>
      </div>
    )
  }

  if (inviteError || !invite?.valid) {
    return (
      <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/20">
        <Card className="w-full max-w-md border-destructive/50">
          <CardHeader>
            <CardTitle>Приглашение недействительно</CardTitle>
            <CardDescription>{inviteError || 'Срок действия ссылки истёк или ссылка уже использована.'}</CardDescription>
          </CardHeader>
          <CardContent>
            <Link href="/login">
              <Button variant="outline" className="w-full">Перейти ко входу</Button>
            </Link>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background to-muted/20">
      <div className="w-full max-w-md space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
        <div className="text-center space-y-4">
          <div className="flex justify-center">
            <div className="relative">
              <div className="w-16 h-16 bg-gradient-to-br from-red-600 to-red-700 rounded-2xl flex items-center justify-center shadow-2xl">
                <Send className="w-8 h-8 text-white" />
              </div>
              <div className="absolute -bottom-1 -right-1 w-5 h-5 bg-green-500 rounded-full border-4 border-background" />
            </div>
          </div>
          <div>
            <h1 className="text-3xl font-bold bg-gradient-to-r from-foreground to-foreground/70 bg-clip-text text-transparent">
              Регистрация по приглашению
            </h1>
            <p className="text-muted-foreground mt-2">
              Роль: <span className="font-medium text-foreground">{ROLE_LABELS[invite.role] ?? invite.role}</span>
            </p>
          </div>
        </div>

        <Card className="border-muted shadow-xl">
          <CardHeader className="space-y-1 pb-4">
            <CardTitle className="text-2xl">Создать аккаунт</CardTitle>
            <CardDescription>
              Укажите логин (как в корпоративной почте), пароль и имя.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="login">Логин *</Label>
                <div className="relative">
                  <Mail className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="login"
                    type="text"
                    autoComplete="username"
                    required
                    value={formData.login}
                    onChange={(e) => setFormData({ ...formData, login: e.target.value })}
                    className="pl-10 h-11"
                    placeholder="d.solyanov"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="password">Пароль *</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="password"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={formData.password}
                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                    className="pl-10 h-11"
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                </div>
                {formData.password && (
                  <div className="space-y-2 pt-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground font-medium">Надёжность</span>
                      <span className={`font-semibold ${
                        passwordStrength.strength === 'weak' ? 'text-red-500' :
                        passwordStrength.strength === 'medium' ? 'text-yellow-500' : 'text-green-500'
                      }`}>
                        {passwordStrength.message}
                      </span>
                    </div>
                    <div className="h-2 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full transition-all duration-300 ${
                          passwordStrength.strength === 'weak' ? 'bg-red-500 w-1/3' :
                          passwordStrength.strength === 'medium' ? 'bg-yellow-500 w-2/3' :
                          'bg-green-500 w-full'
                        }`}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="confirmPassword">Повторите пароль *</Label>
                <div className="relative">
                  <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="confirmPassword"
                    type="password"
                    autoComplete="new-password"
                    required
                    value={formData.confirmPassword}
                    onChange={(e) => setFormData({ ...formData, confirmPassword: e.target.value })}
                    className="pl-10 h-11 pr-10"
                    placeholder="••••••••"
                    disabled={isLoading}
                  />
                  {formData.confirmPassword && formData.password === formData.confirmPassword && (
                    <CheckCircle className="absolute right-3 top-3 h-5 w-5 text-green-500" />
                  )}
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="name">Имя *</Label>
                <div className="relative">
                  <User className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="name"
                    type="text"
                    autoComplete="name"
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="pl-10 h-11"
                    placeholder="Иван Иванов"
                    disabled={isLoading}
                  />
                </div>
              </div>

              <p className="text-xs text-muted-foreground">
                Пароль можно сбросить через администратора либо в настройках.
              </p>

              <Button
                type="submit"
                className="w-full h-11 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                disabled={isLoading}
              >
                {isLoading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Регистрация...
                  </>
                ) : (
                  <>
                    Создать аккаунт
                    <ArrowRight className="ml-2 h-4 w-4" />
                  </>
                )}
              </Button>

              <div className="relative my-6">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-card px-2 text-muted-foreground">Уже есть аккаунт?</span>
                </div>
              </div>

              <Link href="/login" className="block">
                <Button variant="outline" className="w-full h-11" type="button" disabled={isLoading}>
                  Войти
                </Button>
              </Link>
            </form>
          </CardContent>
        </Card>

        <p className="text-center text-sm text-muted-foreground">
          Планирование отложенных сообщений для Rocket.Chat
        </p>
      </div>
    </div>
  )
}
