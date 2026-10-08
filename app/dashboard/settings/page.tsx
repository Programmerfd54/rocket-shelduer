"use client"

import { useState, useEffect, useRef, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { toast } from 'sonner'
import {
  Loader2,
  User,
  Shield,
  Camera,
  Trash2,
  Monitor,
  LogOut,
  Download,
  Palette,
  Database,
  Sun,
  Moon,
  Laptop,
  Check,
  Smartphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { PasswordInput } from '@/components/ui/password-input'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { Section } from '@/components/common/Section'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { PasswordStrength } from '@/components/common/PasswordStrength'
import { getInitials, generateAvatarColor, formatRelativeTime, cn } from '@/lib/utils'
import { validateNewPassword, validatePasswordConfirm } from '@/lib/validate-password'
import { ROLE_LABELS, isAppRole } from '@/lib/roles'

type SectionId = 'profile' | 'security' | 'sessions' | 'appearance' | 'data'

const SECTIONS: { id: SectionId; label: string; icon: React.ElementType }[] = [
  { id: 'profile', label: 'Профиль', icon: User },
  { id: 'security', label: 'Безопасность', icon: Shield },
  { id: 'sessions', label: 'Сессии', icon: Monitor },
  { id: 'appearance', label: 'Оформление', icon: Palette },
  { id: 'data', label: 'Данные', icon: Database },
]

const SESSION_DURATION_OPTIONS = [
  { value: 'default', label: 'По умолчанию (7 дней)', minutes: null },
  { value: '15', label: '15 минут', minutes: 15 },
  { value: '60', label: '1 час', minutes: 60 },
  { value: '1440', label: '1 день', minutes: 1440 },
  { value: '10080', label: '7 дней', minutes: 10080 },
  { value: '43200', label: '30 дней', minutes: 43200 },
]

const MAX_AVATAR_SIZE = 5 * 1024 * 1024
const AVATAR_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']

type UserData = {
  id?: string
  email?: string
  name?: string | null
  username?: string | null
  role?: string
  avatarUrl?: string | null
  sessionDurationMinutes?: number | null
}

type SessionItem = {
  id: string
  userAgent: string | null
  createdAt: string
  expiresAt: string
  isCurrent: boolean
}

/** Короткое описание устройства из User-Agent: «Chrome · macOS». */
function describeUserAgent(ua: string | null): string {
  if (!ua) return 'Неизвестное устройство'
  const browser = /Edg\//.test(ua)
    ? 'Edge'
    : /OPR\/|Opera/.test(ua)
      ? 'Opera'
      : /Firefox\//.test(ua)
        ? 'Firefox'
        : /Chrome\//.test(ua)
          ? 'Chrome'
          : /Safari\//.test(ua)
            ? 'Safari'
            : null
  const os = /Windows/.test(ua)
    ? 'Windows'
    : /iPhone|iPad/.test(ua)
      ? 'iOS'
      : /Android/.test(ua)
        ? 'Android'
        : /Mac OS X/.test(ua)
          ? 'macOS'
          : /Linux/.test(ua)
            ? 'Linux'
            : null
  if (!browser && !os) return ua
  return [browser, os].filter(Boolean).join(' · ')
}

function isMobileUserAgent(ua: string | null): boolean {
  return !!ua && /iPhone|iPad|Android|Mobile/.test(ua)
}

function PageSkeleton() {
  return (
    <PageContainer>
      <div className="space-y-3 pb-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-72" />
      </div>
      <div className="grid gap-6 lg:grid-cols-[200px_1fr] lg:gap-10">
        <div className="flex gap-2 lg:flex-col">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-28 lg:w-full" />
          ))}
        </div>
        <div className="space-y-6">
          <div className="space-y-3 rounded-lg border bg-card p-5">
            <Skeleton className="h-4 w-32" />
            <div className="flex items-center gap-4">
              <Skeleton className="h-16 w-16 rounded-full" />
              <Skeleton className="h-8 w-36" />
            </div>
          </div>
          <div className="space-y-4 rounded-lg border bg-card p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full max-w-sm" />
            <Skeleton className="h-9 w-full max-w-sm" />
            <Skeleton className="h-9 w-40" />
          </div>
        </div>
      </div>
    </PageContainer>
  )
}

export default function SettingsPage() {
  const router = useRouter()
  const { theme, setTheme } = useTheme()
  const [themeMounted, setThemeMounted] = useState(false)

  const [section, setSection] = useState<SectionId>('profile')
  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<UserData | null>(null)

  // Профиль
  const [profileForm, setProfileForm] = useState({ name: '', username: '' })
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileTouched, setProfileTouched] = useState({ name: false, username: false })
  const [usernameServerError, setUsernameServerError] = useState<string | null>(null)
  const [avatarUploading, setAvatarUploading] = useState(false)
  const [avatarDeleteOpen, setAvatarDeleteOpen] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)

  // Пароль
  const [passwordForm, setPasswordForm] = useState({ currentPassword: '', newPassword: '', confirmPassword: '' })
  const [passwordTouched, setPasswordTouched] = useState({ currentPassword: false, newPassword: false, confirmPassword: false })
  const [passwordSaving, setPasswordSaving] = useState(false)
  const [currentPasswordServerError, setCurrentPasswordServerError] = useState<string | null>(null)

  // Сессии
  const [sessions, setSessions] = useState<SessionItem[]>([])
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsLoaded, setSessionsLoaded] = useState(false)
  const [sessionDuration, setSessionDuration] = useState<string>('default')
  const [sessionsSaving, setSessionsSaving] = useState(false)
  const [logoutAllOpen, setLogoutAllOpen] = useState(false)
  const [logoutAllLoading, setLogoutAllLoading] = useState(false)
  const [sessionToEnd, setSessionToEnd] = useState<SessionItem | null>(null)
  const [endSessionLoading, setEndSessionLoading] = useState(false)

  // Данные
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => setThemeMounted(true), [])

  // Раздел из адреса (#security и т.п.)
  useEffect(() => {
    const hash = window.location.hash.replace('#', '')
    if (SECTIONS.some((s) => s.id === hash)) setSection(hash as SectionId)
  }, [])

  const selectSection = (id: SectionId) => {
    setSection(id)
    try {
      window.history.replaceState(null, '', `#${id}`)
    } catch {
      /* ignore */
    }
  }

  const loadUser = useCallback(async () => {
    try {
      const response = await fetch('/api/auth/me')
      if (!response.ok) {
        router.push('/login')
        return
      }
      const data = await response.json()
      setUser(data.user)
      setProfileForm({
        name: data.user.name || '',
        username: data.user.username || '',
      })
      const dur = data.user.sessionDurationMinutes
      setSessionDuration(dur == null ? 'default' : String(dur))
    } catch (error) {
      console.error('Failed to load user:', error)
      toast.error('Не удалось загрузить данные профиля', { description: 'Обновите страницу или проверьте соединение.' })
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    loadUser()
  }, [loadUser])

  const loadSessions = useCallback(async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch('/api/user/sessions')
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = await res.json()
      setSessions(data.sessions || [])
      setSessionsLoaded(true)
    } catch {
      toast.error('Не удалось загрузить сессии', { description: 'Попробуйте обновить список.' })
    } finally {
      setSessionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (section === 'sessions' && !sessionsLoaded && !sessionsLoading) loadSessions()
  }, [section, sessionsLoaded, sessionsLoading, loadSessions])

  // ── Валидация профиля ──
  const savedName = (user?.name || '').trim()
  const savedUsername = (user?.username || '').trim()
  const nameTrim = profileForm.name.trim()
  const usernameTrim = profileForm.username.trim()
  const profileDirty = !!user && (nameTrim !== savedName || usernameTrim !== savedUsername)

  const nameError = nameTrim.length > 100 ? 'Не длиннее 100 символов' : undefined
  const usernameError =
    usernameTrim !== savedUsername
      ? /\s/.test(usernameTrim)
        ? 'Без пробелов'
        : usernameTrim.length > 50
          ? 'Не длиннее 50 символов'
          : undefined
      : undefined
  const shownNameError = profileTouched.name ? nameError : undefined
  const shownUsernameError = usernameServerError ?? (profileTouched.username ? usernameError : undefined)

  // ── Валидация пароля ──
  const currentPasswordError = !passwordForm.currentPassword ? 'Введите текущий пароль' : undefined
  const newPasswordError =
    validateNewPassword(passwordForm.newPassword) ??
    (passwordForm.newPassword && passwordForm.newPassword === passwordForm.currentPassword
      ? 'Новый пароль должен отличаться от текущего'
      : undefined)
  const confirmPasswordError = validatePasswordConfirm(passwordForm.newPassword, passwordForm.confirmPassword)
  const passwordValid = !currentPasswordError && !newPasswordError && !confirmPasswordError
  const passwordFilled = !!(passwordForm.currentPassword || passwordForm.newPassword || passwordForm.confirmPassword)

  // Предупреждение при закрытии вкладки с несохранёнными данными
  useEffect(() => {
    if (!profileDirty && !passwordFilled) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [profileDirty, passwordFilled])

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setProfileTouched({ name: true, username: true })
    if (nameError || usernameError || !profileDirty) return
    setUsernameServerError(null)
    setProfileSaving(true)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 409) setUsernameServerError(data.error || 'Имя пользователя уже занято')
        throw new Error(data.error || 'Не удалось сохранить профиль')
      }

      await loadUser()
      setProfileTouched({ name: false, username: false })
      toast.success('Профиль сохранён')
    } catch (error) {
      toast.error('Не удалось сохранить профиль', {
        description: (error instanceof Error && error.message) || 'Попробуйте снова',
      })
    } finally {
      setProfileSaving(false)
    }
  }

  const resetProfileForm = () => {
    setProfileForm({ name: user?.name || '', username: user?.username || '' })
    setProfileTouched({ name: false, username: false })
    setUsernameServerError(null)
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()
    setPasswordTouched({ currentPassword: true, newPassword: true, confirmPassword: true })
    if (!passwordValid) return
    setCurrentPasswordServerError(null)
    setPasswordSaving(true)

    try {
      const response = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        if (response.status === 401) setCurrentPasswordServerError(data.error || 'Неверный текущий пароль')
        throw new Error(data.error || 'Не удалось изменить пароль')
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      setPasswordTouched({ currentPassword: false, newPassword: false, confirmPassword: false })
      toast.success('Пароль изменён', {
        description: 'Используйте новый пароль при следующем входе.',
      })
    } catch (error) {
      toast.error('Не удалось изменить пароль', {
        description: (error instanceof Error && error.message) || 'Проверьте текущий пароль и попробуйте снова',
      })
    } finally {
      setPasswordSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target
    const file = input.files?.[0]
    if (!file) return
    if (!AVATAR_TYPES.includes(file.type)) {
      toast.error('Неподходящий формат файла', { description: 'Загрузите JPG, PNG, WebP или GIF.' })
      input.value = ''
      return
    }
    if (file.size > MAX_AVATAR_SIZE) {
      toast.error('Файл слишком большой', { description: 'Максимальный размер фото — 5 МБ.' })
      input.value = ''
      return
    }
    setAvatarUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/user/avatar', { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Ошибка загрузки')
      await loadUser()
      toast.success('Фото обновлено')
    } catch (err) {
      toast.error('Не удалось загрузить фото', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setAvatarUploading(false)
      input.value = ''
    }
  }

  const handleAvatarDelete = async () => {
    setAvatarUploading(true)
    try {
      const response = await fetch('/api/user/avatar', { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Ошибка удаления')
      }
      await loadUser()
      setAvatarDeleteOpen(false)
      toast.success('Фото удалено')
    } catch (err) {
      toast.error('Не удалось удалить фото', { description: err instanceof Error ? err.message : undefined })
    } finally {
      setAvatarUploading(false)
    }
  }

  const handleSessionDurationChange = async (value: string) => {
    const prev = sessionDuration
    setSessionDuration(value)
    const opt = SESSION_DURATION_OPTIONS.find((o) => o.value === value)
    const minutes = opt?.minutes ?? null
    setSessionsSaving(true)
    try {
      const res = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionDurationMinutes: minutes }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || 'Ошибка сохранения')
      }
      toast.success('Срок сессии сохранён', { description: 'Применится при следующем входе.' })
      setUser((u) => (u ? { ...u, sessionDurationMinutes: minutes } : u))
    } catch (err) {
      toast.error('Не удалось сохранить срок сессии', { description: err instanceof Error ? err.message : undefined })
      setSessionDuration(prev)
    } finally {
      setSessionsSaving(false)
    }
  }

  const handleLogoutOtherSessions = async () => {
    setLogoutAllLoading(true)
    try {
      const res = await fetch('/api/user/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      if (!res.ok) throw new Error('Ошибка')
      toast.success('Остальные сессии завершены')
      setLogoutAllOpen(false)
      await loadSessions()
    } catch {
      toast.error('Не удалось завершить сессии', { description: 'Попробуйте ещё раз.' })
    } finally {
      setLogoutAllLoading(false)
    }
  }

  const handleEndSession = async () => {
    if (!sessionToEnd) return
    setEndSessionLoading(true)
    try {
      const res = await fetch('/api/user/sessions', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId: sessionToEnd.id }),
      })
      if (!res.ok) throw new Error('Ошибка')
      toast.success('Сессия завершена')
      setSessionToEnd(null)
      await loadSessions()
    } catch {
      toast.error('Не удалось завершить сессию', { description: 'Попробуйте ещё раз.' })
    } finally {
      setEndSessionLoading(false)
    }
  }

  const handleExportBackup = async () => {
    setExportLoading(true)
    const toastId = toast.loading('Готовим резервную копию…')
    try {
      const res = await fetch('/api/user/export')
      if (!res.ok) throw new Error('Ошибка экспорта')
      const blob = await res.blob()
      const disposition = res.headers.get('Content-Disposition')
      const match = disposition?.match(/filename="?([^";]+)"?/)
      const filename = match?.[1] || `rc-scheduler-backup-${new Date().toISOString().slice(0, 10)}.json`
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = filename
      a.click()
      URL.revokeObjectURL(a.href)
      toast.success('Резервная копия скачана', { id: toastId, description: 'Файл сохранён в папку загрузок.' })
    } catch {
      toast.error('Не удалось скачать резервную копию', { id: toastId, description: 'Попробуйте ещё раз позже.' })
    } finally {
      setExportLoading(false)
    }
  }

  if (loading) return <PageSkeleton />

  const otherSessions = sessions.filter((s) => !s.isCurrent)
  const roleLabel = user?.role && isAppRole(user.role) ? (user.role === 'MEMBER' ? 'Волонтёр' : ROLE_LABELS[user.role]) : null

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Настройки', current: true },
            ]}
          />
        }
        title="Настройки"
        description="Профиль, безопасность аккаунта, сессии и оформление."
      />

      <div className="grid gap-6 lg:grid-cols-[200px_1fr] lg:gap-10">
        {/* Навигация по разделам */}
        <nav
          aria-label="Разделы настроек"
          className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1 lg:sticky lg:top-6 lg:mx-0 lg:flex-col lg:self-start lg:overflow-visible lg:px-0 lg:pb-0"
        >
          {SECTIONS.map(({ id, label, icon: Icon }) => {
            const active = section === id
            return (
              <button
                key={id}
                type="button"
                onClick={() => selectSection(id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'flex h-9 shrink-0 items-center gap-2 rounded-md px-3 text-sm font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 lg:w-full',
                  active
                    ? 'bg-accent text-foreground'
                    : 'text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                )}
              >
                <Icon className="size-4" aria-hidden />
                {label}
                {id === 'profile' && profileDirty && (
                  <span className="ml-auto size-1.5 rounded-full bg-amber-500" aria-label="Есть несохранённые изменения" />
                )}
                {id === 'security' && passwordFilled && (
                  <span className="ml-auto size-1.5 rounded-full bg-amber-500" aria-label="Форма не отправлена" />
                )}
              </button>
            )
          })}
        </nav>

        <div className="min-w-0 max-w-2xl space-y-6">
          {/* ───────── Профиль ───────── */}
          {section === 'profile' && (
            <>
              <Section title="Фото" description="Показывается в меню и в списках пользователей. JPG, PNG, WebP или GIF до 5 МБ.">
                <div className="flex flex-wrap items-center gap-4">
                  <Avatar className="h-16 w-16">
                    {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                    <AvatarFallback className={`${generateAvatarColor(user?.email ?? '')} text-lg font-semibold text-white`}>
                      {getInitials(user?.name || user?.email || '')}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      ref={avatarInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      className="hidden"
                      onChange={handleAvatarUpload}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      disabled={avatarUploading}
                      onClick={() => avatarInputRef.current?.click()}
                    >
                      {avatarUploading ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
                      {avatarUploading ? 'Загрузка…' : user?.avatarUrl ? 'Заменить фото' : 'Загрузить фото'}
                    </Button>
                    {user?.avatarUrl && (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="text-destructive hover:text-destructive"
                        disabled={avatarUploading}
                        onClick={() => setAvatarDeleteOpen(true)}
                      >
                        <Trash2 aria-hidden />
                        Удалить
                      </Button>
                    )}
                  </div>
                </div>
              </Section>

              <Section title="Данные профиля" description="Имя видно коллегам и администраторам.">
                <form onSubmit={handleProfileUpdate} className="space-y-4" noValidate>
                  <Field label="Логин" htmlFor="login-readonly" hint="Логин изменить нельзя — его назначает администратор.">
                    <div className="flex items-center gap-2">
                      <Input
                        id="login-readonly"
                        value={user?.email ?? '—'}
                        readOnly
                        disabled
                        className="max-w-sm font-mono"
                      />
                      {roleLabel && <Badge variant="muted">{roleLabel}</Badge>}
                    </div>
                  </Field>

                  <Field label="Имя" htmlFor="name" error={shownNameError}>
                    <Input
                      id="name"
                      value={profileForm.name}
                      onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                      onBlur={() => setProfileTouched((t) => ({ ...t, name: true }))}
                      aria-invalid={!!shownNameError}
                      placeholder="Иван Иванов"
                      autoComplete="name"
                      className="max-w-sm"
                      disabled={profileSaving}
                    />
                  </Field>

                  <Field
                    label="Username"
                    htmlFor="username"
                    error={shownUsernameError}
                    hint="Необязательно. Должен быть уникальным, без пробелов."
                  >
                    <Input
                      id="username"
                      value={profileForm.username}
                      onChange={(e) => {
                        setUsernameServerError(null)
                        setProfileForm({ ...profileForm, username: e.target.value })
                      }}
                      onBlur={() => setProfileTouched((t) => ({ ...t, username: true }))}
                      aria-invalid={!!shownUsernameError}
                      placeholder="username"
                      autoComplete="off"
                      className="max-w-sm"
                      disabled={profileSaving}
                    />
                  </Field>

                  <div className="flex flex-wrap items-center gap-3 pt-1">
                    <Button type="submit" disabled={profileSaving || !profileDirty}>
                      {profileSaving && <Loader2 className="animate-spin" aria-hidden />}
                      {profileSaving ? 'Сохраняем…' : 'Сохранить'}
                    </Button>
                    {profileDirty && !profileSaving && (
                      <>
                        <Button type="button" variant="ghost" onClick={resetProfileForm}>
                          Отменить
                        </Button>
                        <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>
                      </>
                    )}
                  </div>
                </form>
              </Section>
            </>
          )}

          {/* ───────── Безопасность ───────── */}
          {section === 'security' && (
            <Section
              title="Смена пароля"
              description="После смены пароля все сессии будут завершены — потребуется войти заново на всех устройствах."
            >
              <form onSubmit={handlePasswordChange} className="space-y-4" noValidate>
                {/* Скрытое поле логина — для менеджеров паролей */}
                <input type="text" name="username" value={user?.email ?? ''} autoComplete="username" readOnly hidden />

                <Field
                  label="Текущий пароль"
                  htmlFor="currentPassword"
                  error={currentPasswordServerError ?? (passwordTouched.currentPassword ? currentPasswordError : undefined)}
                >
                  <PasswordInput
                    id="currentPassword"
                    autoComplete="current-password"
                    value={passwordForm.currentPassword}
                    onChange={(e) => {
                      setCurrentPasswordServerError(null)
                      setPasswordForm({ ...passwordForm, currentPassword: e.target.value })
                    }}
                    onBlur={() => setPasswordTouched((t) => ({ ...t, currentPassword: true }))}
                    aria-invalid={!!(currentPasswordServerError ?? (passwordTouched.currentPassword && currentPasswordError))}
                    className="max-w-sm"
                    disabled={passwordSaving}
                  />
                </Field>

                <Field
                  label="Новый пароль"
                  htmlFor="newPassword"
                  hint="Минимум 8 символов: заглавные и строчные буквы, цифры, спецсимволы."
                  error={passwordTouched.newPassword && passwordForm.newPassword ? newPasswordError : undefined}
                >
                  <PasswordInput
                    id="newPassword"
                    autoComplete="new-password"
                    value={passwordForm.newPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                    onBlur={() => setPasswordTouched((t) => ({ ...t, newPassword: true }))}
                    aria-invalid={!!(passwordTouched.newPassword && passwordForm.newPassword && newPasswordError)}
                    className="max-w-sm"
                    disabled={passwordSaving}
                  />
                  <PasswordStrength password={passwordForm.newPassword} className="max-w-sm pt-1" />
                </Field>

                <Field
                  label="Повторите новый пароль"
                  htmlFor="confirmPassword"
                  error={passwordTouched.confirmPassword && passwordForm.confirmPassword ? confirmPasswordError : undefined}
                >
                  <PasswordInput
                    id="confirmPassword"
                    autoComplete="new-password"
                    value={passwordForm.confirmPassword}
                    onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                    onBlur={() => setPasswordTouched((t) => ({ ...t, confirmPassword: true }))}
                    aria-invalid={!!(passwordTouched.confirmPassword && passwordForm.confirmPassword && confirmPasswordError)}
                    className="max-w-sm"
                    disabled={passwordSaving}
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-3 pt-1">
                  <Button type="submit" disabled={passwordSaving || !passwordValid}>
                    {passwordSaving && <Loader2 className="animate-spin" aria-hidden />}
                    {passwordSaving ? 'Меняем…' : 'Изменить пароль'}
                  </Button>
                  {passwordFilled && !passwordSaving && (
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => {
                        setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
                        setPasswordTouched({ currentPassword: false, newPassword: false, confirmPassword: false })
                        setCurrentPasswordServerError(null)
                      }}
                    >
                      Очистить
                    </Button>
                  )}
                </div>
              </form>
            </Section>
          )}

          {/* ───────── Сессии ───────── */}
          {section === 'sessions' && (
            <>
              <Section
                title="Срок сессии"
                description="Как долго вы остаётесь в системе без повторного входа. Новое значение применится при следующем входе."
              >
                <Field label="Автоматический выход через" htmlFor="session-duration">
                  <div className="flex items-center gap-2">
                    <Select value={sessionDuration} onValueChange={handleSessionDurationChange} disabled={sessionsSaving}>
                      <SelectTrigger id="session-duration" className="w-full max-w-xs">
                        <SelectValue placeholder="Выберите срок" />
                      </SelectTrigger>
                      <SelectContent>
                        {SESSION_DURATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {sessionsSaving && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Сохраняем" />}
                  </div>
                </Field>
              </Section>

              <Section
                title="Активные сессии"
                description="Устройства, на которых выполнен вход в ваш аккаунт."
                bare
                actions={
                  otherSessions.length > 0 ? (
                    <Button type="button" variant="outline" size="sm" onClick={() => setLogoutAllOpen(true)}>
                      <LogOut aria-hidden />
                      Выйти на других устройствах
                    </Button>
                  ) : undefined
                }
              >
                {sessionsLoading && sessions.length === 0 ? (
                  <div className="divide-y rounded-lg border bg-card">
                    {Array.from({ length: 3 }).map((_, i) => (
                      <div key={i} className="flex items-center gap-3 p-3">
                        <Skeleton className="size-5" />
                        <div className="flex-1 space-y-1.5">
                          <Skeleton className="h-4 w-40" />
                          <Skeleton className="h-3 w-56" />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : sessions.length === 0 ? (
                  <EmptyState
                    icon={<Monitor />}
                    title="Нет активных сессий"
                    description="Список появится после следующего входа."
                  />
                ) : (
                  <ul className="divide-y rounded-lg border bg-card">
                    {sessions.map((s) => {
                      const DeviceIcon = isMobileUserAgent(s.userAgent) ? Smartphone : Monitor
                      return (
                        <li key={s.id} className="flex items-center gap-3 px-3 py-2.5">
                          <DeviceIcon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                          <div className="min-w-0 flex-1">
                            <p className="flex items-center gap-2 truncate text-sm font-medium" title={s.userAgent ?? undefined}>
                              <span className="truncate">{describeUserAgent(s.userAgent)}</span>
                              {s.isCurrent && <Badge variant="success">Это устройство</Badge>}
                            </p>
                            <p className="text-xs text-muted-foreground" title={new Date(s.createdAt).toLocaleString('ru')}>
                              Вход {formatRelativeTime(s.createdAt)} · действует до{' '}
                              {new Date(s.expiresAt).toLocaleDateString('ru-RU')}
                            </p>
                          </div>
                          {!s.isCurrent && (
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              className="text-destructive hover:text-destructive"
                              onClick={() => setSessionToEnd(s)}
                            >
                              Завершить
                            </Button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </Section>
            </>
          )}

          {/* ───────── Оформление ───────── */}
          {section === 'appearance' && (
            <Section title="Тема" description="«Как в системе» подстраивается под настройки вашей ОС.">
              <div role="radiogroup" aria-label="Тема оформления" className="grid max-w-md grid-cols-3 gap-2">
                {[
                  { value: 'light', label: 'Светлая', icon: Sun },
                  { value: 'dark', label: 'Тёмная', icon: Moon },
                  { value: 'system', label: 'Как в системе', icon: Laptop },
                ].map(({ value, label, icon: Icon }) => {
                  const active = themeMounted && theme === value
                  return (
                    <button
                      key={value}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => setTheme(value)}
                      className={cn(
                        'flex h-16 flex-col items-center justify-center gap-1.5 rounded-md border text-[13px] font-medium transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                        active
                          ? 'border-primary bg-accent text-foreground'
                          : 'text-muted-foreground hover:border-foreground/25 hover:text-foreground',
                      )}
                    >
                      <span className="flex items-center gap-1">
                        <Icon className="size-4" aria-hidden />
                        {active && <Check className="size-3 text-primary" aria-hidden />}
                      </span>
                      {label}
                    </button>
                  )
                })}
              </div>
            </Section>
          )}

          {/* ───────── Данные ───────── */}
          {section === 'data' && (
            <Section
              title="Резервная копия"
              description="Скачайте свои данные — профиль, пространства, сообщения и шаблоны — одним JSON-файлом. Пароли и секретные ключи в файл не попадают."
            >
              <Button type="button" variant="outline" onClick={handleExportBackup} disabled={exportLoading}>
                {exportLoading ? <Loader2 className="animate-spin" aria-hidden /> : <Download aria-hidden />}
                {exportLoading ? 'Готовим файл…' : 'Скачать резервную копию'}
              </Button>
            </Section>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={avatarDeleteOpen}
        onOpenChange={setAvatarDeleteOpen}
        title="Удалить фото профиля?"
        description="Вместо фото будут показаны ваши инициалы. Позже можно загрузить новое."
        confirmLabel="Удалить"
        destructive
        loading={avatarUploading}
        onConfirm={handleAvatarDelete}
      />

      <ConfirmDialog
        open={logoutAllOpen}
        onOpenChange={setLogoutAllOpen}
        title="Выйти на других устройствах?"
        description={`Будет завершено сессий: ${otherSessions.length}. Текущая сессия останется активной, на остальных устройствах потребуется войти снова.`}
        confirmLabel="Завершить сессии"
        destructive
        loading={logoutAllLoading}
        onConfirm={handleLogoutOtherSessions}
      />

      <ConfirmDialog
        open={!!sessionToEnd}
        onOpenChange={(v) => !v && setSessionToEnd(null)}
        title="Завершить сессию?"
        description={
          sessionToEnd
            ? `Устройство «${describeUserAgent(sessionToEnd.userAgent)}» будет разлогинено, на нём потребуется войти снова.`
            : undefined
        }
        confirmLabel="Завершить"
        destructive
        loading={endSessionLoading}
        onConfirm={handleEndSession}
      />
    </PageContainer>
  )
}
