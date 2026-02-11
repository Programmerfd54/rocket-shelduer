"use client"

import { useState, useEffect, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Separator } from "@/components/ui/separator"
import { toast } from 'sonner'
import { Loader2, ArrowLeft, User, Lock, CheckCircle2, Shield, Camera, Trash2, Monitor, LogOut, Download } from 'lucide-react'
import Link from 'next/link'
import { checkPasswordStrength, getInitials, generateAvatarColor } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

export default function SettingsPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [user, setUser] = useState<any>(null)

  const [profileForm, setProfileForm] = useState({
    name: '',
    username: ''
  })

  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
    confirmPassword: ''
  })

  const [avatarUploading, setAvatarUploading] = useState(false)
  const avatarInputRef = useRef<HTMLInputElement>(null)
  const [sessions, setSessions] = useState<{ id: string; userAgent: string | null; createdAt: string; expiresAt: string; isCurrent: boolean }[]>([])
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null)
  const [sessionDuration, setSessionDuration] = useState<string>('')
  const [sessionsLoading, setSessionsLoading] = useState(false)
  const [sessionsSaving, setSessionsSaving] = useState(false)
  const [logoutAllLoading, setLogoutAllLoading] = useState(false)
  const [exportLoading, setExportLoading] = useState(false)

  useEffect(() => {
    loadUser()
  }, [])

  const loadUser = async () => {
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
        username: data.user.username || ''
      })
      const dur = data.user.sessionDurationMinutes
      setSessionDuration(dur == null ? 'default' : String(dur))
    } catch (error) {
      console.error('Failed to load user:', error)
      toast.error('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }

  const handleProfileUpdate = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)

    try {
      const response = await fetch('/api/user/profile', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profileForm)
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to update profile')
      }

      await loadUser()
      toast.success('Профиль обновлён', {
        description: 'Изменения успешно сохранены'
      })
    } catch (error: any) {
      toast.error('Ошибка обновления', {
        description: error.message || 'Попробуйте снова'
      })
    } finally {
      setSaving(false)
    }
  }

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault()

    if (passwordForm.newPassword !== passwordForm.confirmPassword) {
      toast.error('Пароли не совпадают', {
        description: 'Проверьте правильность ввода'
      })
      return
    }

    const strength = checkPasswordStrength(passwordForm.newPassword)
    if (!strength.valid) {
      toast.error('Слабый пароль', {
        description: strength.message
      })
      return
    }

    setSaving(true)

    try {
      const response = await fetch('/api/user/password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          currentPassword: passwordForm.currentPassword,
          newPassword: passwordForm.newPassword
        })
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to change password')
      }

      setPasswordForm({ currentPassword: '', newPassword: '', confirmPassword: '' })
      toast.success('Пароль изменён', {
        description: 'Используйте новый пароль для входа'
      })
    } catch (error: any) {
      toast.error('Ошибка смены пароля', {
        description: error.message || 'Проверьте текущий пароль'
      })
    } finally {
      setSaving(false)
    }
  }

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setAvatarUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)
      const response = await fetch('/api/user/avatar', { method: 'POST', body: formData })
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || 'Ошибка загрузки')
      await loadUser()
      toast.success('Фото обновлено')
    } catch (err: any) {
      toast.error('Ошибка загрузки фото', { description: err.message })
    } finally {
      setAvatarUploading(false)
      e.target.value = ''
    }
  }

  const loadSessions = async () => {
    setSessionsLoading(true)
    try {
      const res = await fetch('/api/user/sessions')
      if (!res.ok) throw new Error('Failed to load sessions')
      const data = await res.json()
      setSessions(data.sessions || [])
      setCurrentSessionId(data.currentSessionId || null)
    } catch {
      toast.error('Ошибка загрузки сессий')
    } finally {
      setSessionsLoading(false)
    }
  }

  const SESSION_DURATION_OPTIONS = [
    { value: 'default', label: 'По умолчанию (7 дней)', minutes: null },
    { value: '15', label: '15 минут', minutes: 15 },
    { value: '60', label: '1 час', minutes: 60 },
    { value: '1440', label: '1 день', minutes: 1440 },
    { value: '10080', label: '7 дней', minutes: 10080 },
    { value: '43200', label: '30 дней', minutes: 43200 },
  ]

  const handleSessionDurationChange = async (value: string) => {
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
        const data = await res.json()
        throw new Error(data.error || 'Ошибка сохранения')
      }
      toast.success('Длительность сессии сохранена. Применится при следующем входе.')
    } catch (err: any) {
      toast.error(err.message || 'Ошибка сохранения')
      setSessionDuration(user?.sessionDurationMinutes == null ? 'default' : String(user?.sessionDurationMinutes))
    } finally {
      setSessionsSaving(false)
    }
  }

  const handleLogoutOtherSessions = async () => {
    if (!confirm('Завершить все сессии кроме текущей? На других устройствах потребуется войти снова.')) return
    setLogoutAllLoading(true)
    try {
      const res = await fetch('/api/user/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) })
      if (!res.ok) throw new Error('Ошибка')
      toast.success('Остальные сессии завершены')
      await loadSessions()
    } catch {
      toast.error('Ошибка завершения сессий')
    } finally {
      setLogoutAllLoading(false)
    }
  }

  const handleExportBackup = async () => {
    setExportLoading(true)
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
      toast.success('Резервная копия скачана', { description: 'Файл сохранён в папку загрузок' })
    } catch {
      toast.error('Ошибка экспорта данных')
    } finally {
      setExportLoading(false)
    }
  }

  const handleEndSession = async (sessionId: string) => {
    if (!confirm('Завершить эту сессию?')) return
    try {
      const res = await fetch('/api/user/sessions', { method: 'DELETE', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sessionId }) })
      if (!res.ok) throw new Error('Ошибка')
      toast.success('Сессия завершена')
      await loadSessions()
    } catch {
      toast.error('Ошибка завершения сессии')
    }
  }

  const handleAvatarDelete = async () => {
    setAvatarUploading(true)
    try {
      const response = await fetch('/api/user/avatar', { method: 'DELETE' })
      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Ошибка удаления')
      }
      await loadUser()
      toast.success('Фото удалено')
    } catch (err: any) {
      toast.error('Ошибка удаления фото', { description: err.message })
    } finally {
      setAvatarUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-muted/10">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    )
  }

  const passwordStrength = checkPasswordStrength(passwordForm.newPassword)

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted/10 w-full max-w-full overflow-x-hidden">
      <div className="container max-w-4xl w-full py-8 px-4 sm:px-6 mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Дашборд', href: '/dashboard' },
            { label: 'Настройки', current: true },
          ]}
          className="mb-6"
        />
        <div className="space-y-6">
          <div>
            <h1 className="text-3xl font-bold">Настройки</h1>
            <p className="text-muted-foreground mt-2">
              Управление профилем и безопасностью
            </p>
          </div>

          <Separator />

          <Tabs defaultValue="profile" className="space-y-6">
            <TabsList className="bg-muted/50">
              <TabsTrigger value="profile" className="data-[state=active]:bg-background">
                <User className="w-4 h-4 mr-2" />
                Профиль
              </TabsTrigger>
              <TabsTrigger value="password" className="data-[state=active]:bg-background">
                <Shield className="w-4 h-4 mr-2" />
                Безопасность
              </TabsTrigger>
              <TabsTrigger value="sessions" className="data-[state=active]:bg-background" onClick={loadSessions}>
                <Monitor className="w-4 h-4 mr-2" />
                Активная сессия
              </TabsTrigger>
            </TabsList>

            <TabsContent value="profile" className="space-y-4">
              <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <User className="w-5 h-5 text-primary" />
                    Информация профиля
                  </CardTitle>
                  <CardDescription>
                    Обновите данные вашего профиля
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <div className="flex flex-wrap items-center gap-4 pb-5 border-b border-border">
                    <Avatar className="h-20 w-20">
                      {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                      <AvatarFallback className={`${generateAvatarColor(user?.email)} text-white text-xl font-semibold`}>
                        {getInitials(user?.name || user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="flex flex-col gap-2">
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
                        {avatarUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Camera className="mr-2 h-4 w-4" />}
                        {avatarUploading ? 'Загрузка...' : 'Загрузить фото'}
                      </Button>
                      {user?.avatarUrl && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="text-destructive hover:text-destructive"
                          disabled={avatarUploading}
                          onClick={handleAvatarDelete}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Удалить фото
                        </Button>
                      )}
                    </div>
                  </div>
                  <form onSubmit={handleProfileUpdate} className="space-y-5 mt-5">
                    <div className="space-y-2">
                      <Label>Логин</Label>
                      <p className="text-sm text-muted-foreground font-mono h-11 flex items-center">{user?.email ?? '—'}</p>
                      <p className="text-xs text-muted-foreground">Логин изменить нельзя</p>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="name">Имя</Label>
                      <Input
                        id="name"
                        value={profileForm.name}
                        onChange={(e) => setProfileForm({ ...profileForm, name: e.target.value })}
                        placeholder="Ваше имя"
                        className="h-11"
                        disabled={saving}
                      />
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="username">Username (опционально)</Label>
                      <Input
                        id="username"
                        value={profileForm.username}
                        onChange={(e) => setProfileForm({ ...profileForm, username: e.target.value })}
                        placeholder="username"
                        className="h-11"
                        disabled={saving}
                      />
                      <p className="text-xs text-muted-foreground">
                        Используется для отображения в интерфейсе
                      </p>
                    </div>

                    <Button 
                      type="submit" 
                      disabled={saving}
                      className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Сохранение...
                        </>
                      ) : (
                        <>
                          <CheckCircle2 className="mr-2 h-4 w-4" />
                          Сохранить изменения
                        </>
                      )}
                    </Button>
                  </form>
                </CardContent>
              </Card>

              <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Download className="w-5 h-5 text-primary" />
                    Резервная копия
                  </CardTitle>
                  <CardDescription>
                    Скачайте ваши данные (профиль, пространства, сообщения, шаблоны) в виде JSON-файла. Пароли и секреты не включаются.
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <Button variant="outline" onClick={handleExportBackup} disabled={exportLoading}>
                    {exportLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
                    Скачать резервную копию
                  </Button>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="password" className="space-y-4">
              <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Shield className="w-5 h-5 text-primary" />
                    Смена пароля
                  </CardTitle>
                  <CardDescription>
                    Обновите ваш пароль для безопасности аккаунта
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <form onSubmit={handlePasswordChange} className="space-y-5">
                    <div className="space-y-2">
                      <Label htmlFor="currentPassword">Текущий пароль</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="currentPassword"
                          type="password"
                          value={passwordForm.currentPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, currentPassword: e.target.value })}
                          placeholder="••••••••"
                          className="h-11 pl-10"
                          disabled={saving}
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="newPassword">Новый пароль</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="newPassword"
                          type="password"
                          value={passwordForm.newPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, newPassword: e.target.value })}
                          placeholder="••••••••"
                          className="h-11 pl-10"
                          disabled={saving}
                        />
                      </div>
                      {passwordForm.newPassword && (
                        <div className="space-y-2 pt-1">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground font-medium">Надёжность</span>
                            <span className={`font-semibold ${
                              passwordStrength.strength === 'weak' ? 'text-red-500' :
                              passwordStrength.strength === 'medium' ? 'text-yellow-500' : 
                              'text-green-500'
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
                      <Label htmlFor="confirmPassword">Подтвердите новый пароль</Label>
                      <div className="relative">
                        <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                        <Input
                          id="confirmPassword"
                          type="password"
                          value={passwordForm.confirmPassword}
                          onChange={(e) => setPasswordForm({ ...passwordForm, confirmPassword: e.target.value })}
                          placeholder="••••••••"
                          className="h-11 pl-10"
                          disabled={saving}
                        />
                        {passwordForm.confirmPassword && passwordForm.newPassword === passwordForm.confirmPassword && (
                          <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-green-500" />
                        )}
                      </div>
                    </div>

                    <Button 
                      type="submit" 
                      disabled={saving}
                      className="bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
                    >
                      {saving ? (
                        <>
                          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                          Изменение...
                        </>
                      ) : (
                        <>
                          <Lock className="mr-2 h-4 w-4" />
                          Изменить пароль
                        </>
                      )}
                    </Button>
                    <p className="text-xs text-muted-foreground mt-3">
                      После смены пароля все сессии будут завершены — потребуется войти снова на всех устройствах.
                    </p>
                  </form>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="sessions" className="space-y-4">
              <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
                <CardHeader className="pb-4">
                  <CardTitle className="flex items-center gap-2">
                    <Monitor className="w-5 h-5 text-primary" />
                    Активная сессия
                  </CardTitle>
                  <CardDescription>
                    Длительность сессии и список устройств. После истечения срока сессии потребуется повторный вход в систему.
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Длительность сессии</Label>
                    <Select value={sessionDuration} onValueChange={handleSessionDurationChange} disabled={sessionsSaving}>
                      <SelectTrigger className="w-full max-w-xs">
                        <SelectValue placeholder="Выберите длительность" />
                      </SelectTrigger>
                      <SelectContent>
                        {SESSION_DURATION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      После истечения срока сессии потребуется повторная авторизация. Новое значение применится при следующем входе.
                    </p>
                  </div>

                  <Separator />

                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <Label>Активные сессии</Label>
                      {sessions.filter((s) => !s.isCurrent).length > 0 && (
                        <Button
                          type="button"
                          variant="outline"
                          size="sm"
                          disabled={logoutAllLoading}
                          onClick={handleLogoutOtherSessions}
                        >
                          {logoutAllLoading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <LogOut className="h-4 w-4 mr-1" />}
                          Выйти на всех устройствах кроме текущего
                        </Button>
                      )}
                    </div>
                    {sessionsLoading ? (
                      <div className="flex items-center gap-2 py-4 text-muted-foreground">
                        <Loader2 className="h-5 w-5 animate-spin" />
                        Загрузка сессий...
                      </div>
                    ) : sessions.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-4">Нет активных сессий</p>
                    ) : (
                      <ul className="space-y-3">
                        {sessions.map((s) => (
                          <li
                            key={s.id}
                            className="flex items-center justify-between rounded-lg border border-border/70 bg-muted/10 px-4 py-3"
                          >
                            <div className="min-w-0">
                              <p className="font-medium text-sm truncate">
                                {s.userAgent || 'Неизвестное устройство'}
                              </p>
                              <p className="text-xs text-muted-foreground">
                                Вход: {new Date(s.createdAt).toLocaleString('ru')}
                                {s.isCurrent && (
                                  <span className="ml-2 text-primary font-medium">• Текущая сессия</span>
                                )}
                              </p>
                            </div>
                            {!s.isCurrent && (
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="text-destructive hover:text-destructive"
                                onClick={() => handleEndSession(s.id)}
                              >
                                Завершить
                              </Button>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  )
}