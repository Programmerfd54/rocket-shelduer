"use client"

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { AlertTriangle, Ban, CalendarPlus, Loader2, Pencil, ShieldOff, Trash2, UserX, Wifi } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { DatePicker } from '@/components/ui/date-picker'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer } from '@/components/common/PageHeader'
import { Section } from '@/components/common/Section'
import { getInitials, generateAvatarColor, formatRelativeTime, formatDate, getActivityLabel, formatActivityDetails } from '@/lib/utils'
import { APP_ROLES, ROLE_LABELS, canManageUserWithRole, isVolunteerMember, roleChangeAssignableRoles, type AppRole } from '@/lib/roles'

const ROLES = APP_ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))

function roleBadgeVariant(role: string): 'default' | 'info' | 'secondary' | 'muted' {
  if (role === 'LEAD_SUP') return 'default'
  if (role === 'SUP') return 'info'
  if (role === 'ADM') return 'secondary'
  return 'muted'
}

function messageStatusBadge(status: string) {
  switch (status) {
    case 'PENDING': return <Badge variant="muted">Ожидает</Badge>
    case 'SENT': return <Badge variant="success">Отправлено</Badge>
    case 'FAILED': return <Badge variant="danger">Ошибка</Badge>
    case 'CANCELLED': return <Badge variant="muted">Отменено</Badge>
    default: return <Badge variant="muted">{status}</Badge>
  }
}

type ProfileUser = {
  id: string
  email: string
  name: string | null
  username: string | null
  avatarUrl: string | null
  role: string
  isBlocked: boolean
  blockedReason: string | null
  volunteerExpiresAt: string | null
  volunteerIntensive: string | null
  lastLoginAt: string | null
  createdAt: string
}
type CurrentUser = { id: string; role: string; restrictedFeatures?: string[] }
type ProfileWorkspace = { id: string; workspaceName: string; workspaceUrl: string; username: string; isActive: boolean; lastConnected: string | null }
type ProfileMessage = {
  id: string
  status: string
  message: string
  channelName: string
  scheduledFor: string
  sentAt: string | null
  error?: string | null
  workspace?: { workspaceName: string } | null
}
type ActivityLogItem = { id: string; action: string; details: string | null; createdAt: string }
type ProfileNote = { id: string; text: string; important: boolean; createdAt: string; author?: { name: string | null; email: string } | null }

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback
}

const USERNAME_RE = /^[a-zA-Z0-9._-]+$/

export default function UserActivityPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<ProfileUser | null>(null)
  const [workspaces, setWorkspaces] = useState<ProfileWorkspace[]>([])
  const [messages, setMessages] = useState<ProfileMessage[]>([])
  const [activityLogs, setActivityLogs] = useState<ActivityLogItem[]>([])
  const [notes, setNotes] = useState<ProfileNote[]>([])
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteImportant, setNoteImportant] = useState(false)
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [noteToDelete, setNoteToDelete] = useState<ProfileNote | null>(null)
  const [noteDeleting, setNoteDeleting] = useState(false)
  const [extendLoading, setExtendLoading] = useState<number | null>(null)
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [editRoleOpen, setEditRoleOpen] = useState(false)
  const [editRoleForm, setEditRoleForm] = useState({ role: 'MEMBER', volunteerExpiresAt: '', volunteerIntensive: '' })
  const [editRoleLoading, setEditRoleLoading] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [blockLoading, setBlockLoading] = useState(false)
  const [unblockOpen, setUnblockOpen] = useState(false)
  const [unblockLoading, setUnblockLoading] = useState(false)
  const [checkingWorkspaceId, setCheckingWorkspaceId] = useState<string | null>(null)
  const [deleteUserOpen, setDeleteUserOpen] = useState(false)
  const [deleteUserLoading, setDeleteUserLoading] = useState(false)
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [editProfileForm, setEditProfileForm] = useState({ name: '', email: '', username: '', newPassword: '' })
  const [editProfileErrors, setEditProfileErrors] = useState<Partial<Record<'email' | 'username' | 'newPassword', string>>>({})
  const [editProfileLoading, setEditProfileLoading] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('')

  useEffect(() => {
    loadUserActivity()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId])

  const loadUserActivity = async () => {
    try {
      setAccessDenied(false)
      setAccessDeniedMessage('')
      const meRes = await fetch('/api/auth/me')
      if (meRes.ok) {
        const meData = await meRes.json()
        setCurrentUser(meData.user)
      }
      const response = await fetch(`/api/admin/users/${userId}/activity`)
      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        const msg = data.error || 'Нет доступа'
        setAccessDenied(true)
        setAccessDeniedMessage(msg)
        toast.error(msg, {
          description: 'Недостаточно прав для просмотра этого пользователя',
          action: { label: 'К пользователям', onClick: () => router.push('/dashboard/admin') },
        })
        setLoading(false)
        return
      }

      const data = await response.json()
      setUser(data.user)
      setWorkspaces(data.workspaces)
      setMessages(data.messages)
      setActivityLogs(data.activityLogs || [])
      const notesRes = await fetch(`/api/admin/users/${userId}/notes`)
      if (notesRes.ok) {
        const notesData = await notesRes.json()
        setNotes(notesData.notes || [])
      } else {
        setNotes([])
      }
    } catch (error) {
      console.error('Load activity error:', error)
      toast.error(errorMessage(error, 'Ошибка загрузки данных'), {
        description: 'Проверьте подключение и повторите.',
        action: { label: 'К пользователям', onClick: () => router.push('/dashboard/admin') },
      })
      setAccessDenied(true)
      setAccessDeniedMessage(errorMessage(error, 'Ошибка загрузки'))
    } finally {
      setLoading(false)
    }
  }

  const loadNotes = async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/notes`)
      if (res.ok) {
        const data = await res.json()
        setNotes(data.notes || [])
      }
    } catch {
      setNotes([])
    }
  }

  const handleAddNote = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!noteText.trim()) return
    setNoteSubmitting(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/notes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: noteText.trim(), important: noteImportant }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Заметка добавлена')
      setNoteOpen(false)
      setNoteText('')
      setNoteImportant(false)
      await loadNotes()
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось добавить заметку'), { description: 'Повторите попытку.' })
    } finally {
      setNoteSubmitting(false)
    }
  }

  const handleDeleteNote = async () => {
    if (!noteToDelete) return
    setNoteDeleting(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/notes/${noteToDelete.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast.success('Заметка удалена')
      setNoteToDelete(null)
      await loadNotes()
    } catch {
      toast.error('Не удалось удалить заметку', { description: 'Повторите попытку.' })
    } finally {
      setNoteDeleting(false)
    }
  }

  const handleExtendVol = async (addDays: number) => {
    setExtendLoading(addDays)
    try {
      const res = await fetch(`/api/admin/users/${userId}/extend-vol`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addDays }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Доступ продлён на ${addDays} дн.`)
      await loadUserActivity()
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось продлить доступ'), { description: 'Повторите попытку.' })
    } finally {
      setExtendLoading(null)
    }
  }

  const openEditRole = () => {
    if (!user) return
    setEditRoleForm({
      role: user.role,
      volunteerExpiresAt: user.volunteerExpiresAt ? user.volunteerExpiresAt.slice(0, 10) : '',
      volunteerIntensive: user.volunteerIntensive || '',
    })
    setEditRoleOpen(true)
  }

  const intensiveTooLong = editRoleForm.volunteerIntensive.trim().length > 50

  const handleEditRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (intensiveTooLong) return
    setEditRoleLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/role`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: editRoleForm.role,
          volunteerExpiresAt: editRoleForm.volunteerExpiresAt || undefined,
          volunteerIntensive: editRoleForm.volunteerIntensive.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Роль обновлена')
      setEditRoleOpen(false)
      await loadUserActivity()
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось изменить роль'), { description: 'Повторите попытку.' })
    } finally {
      setEditRoleLoading(false)
    }
  }

  const handleBlock = async () => {
    setBlockLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/block`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: blockReason.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Пользователь заблокирован')
      setBlockOpen(false)
      setBlockReason('')
      await loadUserActivity()
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось заблокировать'), { description: 'Повторите попытку.' })
    } finally {
      setBlockLoading(false)
    }
  }

  const validateProfile = () => {
    const errors: typeof editProfileErrors = {}
    const email = editProfileForm.email.trim()
    if (!email) errors.email = 'Укажите логин'
    else if (/\s/.test(email)) errors.email = 'Логин не должен содержать пробелов'
    const username = editProfileForm.username.trim()
    if (username && !USERNAME_RE.test(username)) errors.username = 'Только латиница, цифры, точка, дефис и подчёркивание'
    const pwd = editProfileForm.newPassword
    if (pwd.trim() && pwd.length < 8) errors.newPassword = 'Пароль — не короче 8 символов'
    return errors
  }

  const handleEditProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    const errors = validateProfile()
    setEditProfileErrors(errors)
    if (Object.keys(errors).length > 0) return
    setEditProfileLoading(true)
    try {
      const body: { name?: string; email?: string; username?: string; newPassword?: string } = {}
      if (editProfileForm.name !== (user?.name ?? '')) body.name = editProfileForm.name
      if (editProfileForm.email !== (user?.email ?? '')) body.email = editProfileForm.email
      if (editProfileForm.username !== (user?.username ?? '')) body.username = editProfileForm.username || undefined
      if (editProfileForm.newPassword.trim()) body.newPassword = editProfileForm.newPassword
      if (Object.keys(body).length === 0) {
        toast.info('Нет изменений')
        setEditProfileOpen(false)
        return
      }
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка обновления')
      toast.success('Профиль обновлён')
      setEditProfileOpen(false)
      await loadUserActivity()
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось обновить профиль'), { description: 'Проверьте данные и повторите.' })
    } finally {
      setEditProfileLoading(false)
    }
  }

  const handleUnblock = async () => {
    setUnblockLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}/unblock`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Пользователь разблокирован')
      setUnblockOpen(false)
      await loadUserActivity()
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось разблокировать'), { description: 'Повторите попытку.' })
    } finally {
      setUnblockLoading(false)
    }
  }

  const handleCheckConnection = async (workspaceId: string) => {
    setCheckingWorkspaceId(workspaceId)
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/check`, { method: 'POST' })
      const data = await res.json()
      if (data.ok) {
        toast.success('Подключение успешно')
        await loadUserActivity()
      } else {
        toast.error(data.error || 'Подключение не удалось', { description: 'Проверьте URL и данные входа пространства.' })
        await loadUserActivity()
      }
    } catch {
      toast.error('Ошибка проверки подключения', { description: 'Повторите попытку.' })
    } finally {
      setCheckingWorkspaceId(null)
    }
  }

  const handleDeleteUser = async () => {
    setDeleteUserLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${userId}`, { method: 'DELETE' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Пользователь удалён')
      router.push('/dashboard/admin')
    } catch (err) {
      toast.error(errorMessage(err, 'Не удалось удалить пользователя'), { description: 'Повторите попытку.' })
    } finally {
      setDeleteUserLoading(false)
      setDeleteUserOpen(false)
    }
  }

  // Группировка сообщений по дате для таймлайна (дата запланирована или отправлена)
  const messagesByDate = (() => {
    const map = new Map<string, ProfileMessage[]>()
    for (const m of messages) {
      const dateKey = (m.sentAt ? new Date(m.sentAt) : new Date(m.scheduledFor)).toISOString().slice(0, 10)
      if (!map.has(dateKey)) map.set(dateKey, [])
      map.get(dateKey)!.push(m)
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 31)
  })()

  const failedMessages = messages.filter((m) => m.status === 'FAILED')
  const sentCount = messages.filter((m) => m.status === 'SENT').length
  const canManage = !!currentUser && !!user && user.id !== currentUser.id && canManageUserWithRole(currentUser.role, user.role)
  const canEditNotes = !!currentUser && !!user && canManageUserWithRole(currentUser.role, user.role)

  if (loading) {
    return (
      <PageContainer size="wide" className="px-4 sm:px-6">
        <div role="status" aria-busy="true" aria-label="Загрузка" className="space-y-5">
          <Skeleton className="h-4 w-56" />
          <div className="flex items-center gap-4">
            <Skeleton className="size-14 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 max-w-full" />
            </div>
          </div>
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-64 w-full" />
        </div>
      </PageContainer>
    )
  }

  if (accessDenied || !user) {
    return (
      <PageContainer size="wide" className="px-4 sm:px-6">
        <Breadcrumbs
          items={[
            { label: 'Админ панель', href: '/dashboard/admin' },
            { label: 'Пользователи', href: '/dashboard/admin' },
            { label: 'Нет доступа', current: true },
          ]}
          className="mb-6"
        />
        <EmptyState
          icon={<AlertTriangle />}
          title="Нет доступа к карточке пользователя"
          description={`${accessDeniedMessage || 'Карточка недоступна.'} SUP может открывать только пользователей с ролями ADM и MEMBER.`}
          action={{ label: 'К пользователям', href: '/dashboard/admin' }}
        />
      </PageContainer>
    )
  }

  const stats = [
    { label: 'Пространства', value: workspaces.length },
    { label: 'Сообщения', value: messages.length },
    { label: 'Отправлено', value: sentCount },
    { label: 'С ошибкой', value: failedMessages.length },
  ]

  return (
    <PageContainer size="wide" className="px-4 sm:px-6">
      <Breadcrumbs
        items={[
          { label: 'Админ панель', href: '/dashboard/admin' },
          { label: 'Пользователи', href: '/dashboard/admin' },
          { label: user.name || user.email || 'Пользователь', current: true },
        ]}
        className="mb-5"
      />

      {/* Шапка профиля */}
      <header className="flex flex-col gap-4 pb-5 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-4">
          <Avatar className="size-14 shrink-0">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className={`${generateAvatarColor(user.email)} text-base font-semibold text-white`}>
              {getInitials(user.name || user.email)}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0 space-y-1.5">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="truncate text-xl font-semibold tracking-tight">{user.name || 'Без имени'}</h1>
              <Badge variant={roleBadgeVariant(user.role)}>{ROLE_LABELS[user.role as AppRole] ?? user.role}</Badge>
              {user.isBlocked ? <Badge variant="danger">Заблокирован</Badge> : <Badge variant="success">Активен</Badge>}
              {isVolunteerMember(user) && (
                <Badge variant="info">
                  Волонтёр до {formatDate(user.volunteerExpiresAt as string, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              <span className="font-mono">{user.email}</span>
              {user.username && <span className="ml-2">@{user.username}</span>}
            </p>
            <p className="text-xs text-muted-foreground">
              Зарегистрирован {formatRelativeTime(user.createdAt)}
              {user.lastLoginAt && <> · последний вход {formatRelativeTime(user.lastLoginAt)}</>}
              {isVolunteerMember(user) && user.volunteerIntensive && <> · интенсив: {user.volunteerIntensive}</>}
            </p>
            {user.isBlocked && user.blockedReason && (
              <p className="flex items-center gap-1.5 text-sm text-destructive">
                <AlertTriangle className="size-4 shrink-0" aria-hidden />
                Причина блокировки: {user.blockedReason}
              </p>
            )}
          </div>
        </div>
        {canManage && (
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setEditProfileForm({ name: user.name || '', email: user.email || '', username: user.username || '', newPassword: '' })
                setEditProfileErrors({})
                setEditProfileOpen(true)
              }}
            >
              <Pencil className="size-4" aria-hidden />
              Профиль
            </Button>
            <Button size="sm" variant="outline" onClick={openEditRole}>
              <Pencil className="size-4" aria-hidden />
              Роль и доступ
            </Button>
            {user.isBlocked ? (
              <Button size="sm" variant="outline" onClick={() => setUnblockOpen(true)}>
                <ShieldOff className="size-4" aria-hidden />
                Разблокировать
              </Button>
            ) : (
              <Button
                size="sm"
                variant="outline"
                className="text-destructive hover:text-destructive"
                onClick={() => {
                  setBlockReason('')
                  setBlockOpen(true)
                }}
              >
                <Ban className="size-4" aria-hidden />
                Заблокировать
              </Button>
            )}
          </div>
        )}
      </header>

      <div className="space-y-8">
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4">
          {stats.map((s) => (
            <div key={s.label} className="bg-card px-4 py-3">
              <dt className="text-xs text-muted-foreground">{s.label}</dt>
              <dd className="mt-0.5 text-xl font-semibold tabular-nums">{s.value}</dd>
            </div>
          ))}
        </dl>

        {isVolunteerMember(user) && (
          <Section
            title="Доступ волонтёра"
            description={`Действует до ${formatDate(user.volunteerExpiresAt as string, { day: '2-digit', month: '2-digit', year: 'numeric' })}. Продление отсчитывается от текущего срока или от сегодняшнего дня, если срок истёк.`}
            actions={
              <>
                <Button size="sm" variant="outline" onClick={() => handleExtendVol(7)} disabled={extendLoading !== null}>
                  {extendLoading === 7 ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarPlus className="size-4" aria-hidden />}
                  +7 дн.
                </Button>
                <Button size="sm" variant="outline" onClick={() => handleExtendVol(30)} disabled={extendLoading !== null}>
                  {extendLoading === 30 ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <CalendarPlus className="size-4" aria-hidden />}
                  +30 дн.
                </Button>
              </>
            }
          >
            <></>
          </Section>
        )}

        <Section
          title="Подключённые пространства"
          description="Rocket.Chat-пространства пользователя."
          bare
        >
          {workspaces.length > 0 ? (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead>Название</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Подключение</TableHead>
                    {canEditNotes && (
                      <TableHead className="w-12 text-right">
                        <span className="sr-only">Действия</span>
                      </TableHead>
                    )}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspaces.map((workspace) => (
                    <TableRow key={workspace.id} className="hover:bg-muted/40">
                      <TableCell className="font-medium">
                        <Link href={`/dashboard/workspaces/${workspace.id}`} className="hover:underline">
                          {workspace.workspaceName}
                        </Link>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate font-mono text-xs text-muted-foreground" title={workspace.workspaceUrl}>
                        {workspace.workspaceUrl}
                      </TableCell>
                      <TableCell className="text-sm">{workspace.username}</TableCell>
                      <TableCell>
                        <Badge variant={workspace.isActive ? 'success' : 'muted'}>{workspace.isActive ? 'Активно' : 'Неактивно'}</Badge>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-sm text-muted-foreground">
                        {workspace.lastConnected ? formatRelativeTime(workspace.lastConnected) : 'Никогда'}
                      </TableCell>
                      {canEditNotes && (
                        <TableCell className="text-right">
                          <Button
                            size="icon"
                            variant="ghost"
                            className="size-8"
                            aria-label={`Проверить подключение: ${workspace.workspaceName}`}
                            title="Проверить подключение"
                            onClick={() => handleCheckConnection(workspace.id)}
                            disabled={checkingWorkspaceId === workspace.id}
                          >
                            {checkingWorkspaceId === workspace.id ? <Loader2 className="size-4 animate-spin" /> : <Wifi className="size-4" />}
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
              Пользователь не подключил ни одного пространства
            </p>
          )}
        </Section>

        {failedMessages.length > 0 && (
          <Section title={`Ошибки отправки (${failedMessages.length})`} description="Сообщения со статусом «Ошибка» и текст ошибки." bare>
            <ul className="divide-y rounded-lg border bg-card">
              {failedMessages.map((m) => (
                <li key={m.id} className="space-y-1 px-4 py-3 text-sm">
                  <div className="text-xs text-muted-foreground">
                    {m.workspace?.workspaceName} · #{m.channelName} · {formatDate(m.scheduledFor)}
                  </div>
                  <p className="line-clamp-2">{m.message}</p>
                  {m.error && <p className="text-xs text-destructive">{m.error}</p>}
                </li>
              ))}
            </ul>
          </Section>
        )}

        <Tabs defaultValue="messages" className="gap-4">
          <TabsList variant="line" className="h-auto w-full justify-start overflow-x-auto border-b p-0 pb-1.5">
            <TabsTrigger value="messages" className="flex-none">Сообщения</TabsTrigger>
            <TabsTrigger value="activity" className="flex-none">Активность</TabsTrigger>
            <TabsTrigger value="notes" className="flex-none">
              Заметки{notes.length > 0 && <span className="text-xs tabular-nums text-muted-foreground">{notes.length}</span>}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="messages">
            {messagesByDate.length > 0 ? (
              <div className="space-y-5">
                <p className="text-[13px] text-muted-foreground">Запланированные и отправленные сообщения по дням (последние 31 день с сообщениями).</p>
                {messagesByDate.map(([dateKey, dayMessages]) => (
                  <div key={dateKey}>
                    <h3 className="mb-1 text-xs font-medium text-muted-foreground">
                      {formatDate(dateKey, { day: 'numeric', month: 'long', year: 'numeric' })}
                    </h3>
                    <ul className="divide-y rounded-lg border bg-card">
                      {dayMessages.map((m) => (
                        <li key={m.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2 text-sm hover:bg-muted/40">
                          <span className="w-12 shrink-0 tabular-nums text-muted-foreground">
                            {formatDate((m.sentAt || m.scheduledFor) as string, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {messageStatusBadge(m.status)}
                          <span className="text-muted-foreground">
                            {m.workspace?.workspaceName} · #{m.channelName}
                          </span>
                          <span className="min-w-0 flex-1 basis-full truncate sm:basis-0">{m.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            ) : (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Нет запланированных сообщений</p>
            )}
          </TabsContent>

          <TabsContent value="activity">
            {activityLogs.length > 0 ? (
              <ul className="divide-y rounded-lg border bg-card">
                {activityLogs.map((log) => (
                  <li key={log.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-4 py-2.5 text-sm hover:bg-muted/40">
                    <span className="w-36 shrink-0 text-xs text-muted-foreground">{formatRelativeTime(log.createdAt)}</span>
                    <Badge variant="muted" className="whitespace-nowrap">{getActivityLabel(log.action)}</Badge>
                    {log.details && <span className="min-w-0 flex-1 basis-full truncate text-muted-foreground sm:basis-0">{formatActivityDetails(log.details)}</span>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">Нет записей активности</p>
            )}
          </TabsContent>

          <TabsContent value="notes" className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-[13px] text-muted-foreground">Заметки о пользователе видны только администраторам.</p>
              {canEditNotes && (
                <Button
                  size="sm"
                  onClick={() => {
                    setNoteOpen(true)
                    setNoteText('')
                    setNoteImportant(false)
                  }}
                >
                  Добавить заметку
                </Button>
              )}
            </div>
            {notes.length > 0 ? (
              <ul className="divide-y rounded-lg border bg-card">
                {notes.map((note) => (
                  <li key={note.id} className="flex items-start justify-between gap-3 px-4 py-3 text-sm">
                    <div className="min-w-0 flex-1 space-y-1">
                      <p className="whitespace-pre-wrap break-words">{note.text}</p>
                      <p className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                        {note.important && <Badge variant="warning">Важная</Badge>}
                        {note.author?.name || note.author?.email} · {formatRelativeTime(note.createdAt)}
                      </p>
                    </div>
                    {canEditNotes && (
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-8 shrink-0 text-muted-foreground hover:text-destructive"
                        aria-label="Удалить заметку"
                        onClick={() => setNoteToDelete(note)}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">
                Заметок пока нет{canEditNotes ? ' — нажмите «Добавить заметку».' : '.'}
              </p>
            )}
          </TabsContent>
        </Tabs>

        {canManage && (
          <Section title="Удаление" bare>
            <div className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-sm text-muted-foreground">
                Пользователь и все его данные (пространства, сообщения, заметки) будут удалены безвозвратно.
              </p>
              <Button size="sm" variant="destructive" className="shrink-0" onClick={() => setDeleteUserOpen(true)}>
                <UserX className="size-4" aria-hidden />
                Удалить пользователя
              </Button>
            </div>
          </Section>
        )}
      </div>

      {/* Роль и доступ */}
      <Dialog open={editRoleOpen} onOpenChange={(o) => !editRoleLoading && setEditRoleOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Роль и доступ</DialogTitle>
            <DialogDescription>
              Логин: <span className="font-mono">{user.email}</span>
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditRole} className="space-y-4">
            <Field label="Роль" htmlFor="edit-role">
              <Select value={editRoleForm.role} onValueChange={(v) => setEditRoleForm((f) => ({ ...f, role: v }))}>
                <SelectTrigger id="edit-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.filter((r) => roleChangeAssignableRoles(currentUser?.role ?? '').includes(r.value)).map((r) => (
                    <SelectItem key={r.value} value={r.value}>
                      {r.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            {editRoleForm.role === 'MEMBER' && (
              <>
                <Field
                  label="Дата окончания доступа"
                  htmlFor="edit-vol-expires"
                  hint="Оставьте пустым — участник без ограничения срока (не волонтёр)."
                >
                  <DatePicker
                    id="edit-vol-expires"
                    value={editRoleForm.volunteerExpiresAt}
                    onChange={(v) => setEditRoleForm((f) => ({ ...f, volunteerExpiresAt: v }))}
                    shortcuts={false}
                  />
                </Field>
                <Field
                  label="Интенсив"
                  htmlFor="edit-vol-intensive"
                  hint="Например, feb-26. Необязательно."
                  error={intensiveTooLong ? 'Не длиннее 50 символов' : undefined}
                >
                  <Input
                    id="edit-vol-intensive"
                    value={editRoleForm.volunteerIntensive}
                    onChange={(e) => setEditRoleForm((f) => ({ ...f, volunteerIntensive: e.target.value }))}
                    placeholder="feb-26"
                    aria-invalid={intensiveTooLong}
                  />
                </Field>
              </>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditRoleOpen(false)} disabled={editRoleLoading}>
                Отмена
              </Button>
              <Button type="submit" disabled={editRoleLoading || intensiveTooLong}>
                {editRoleLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Блокировка */}
      <ConfirmDialog
        open={blockOpen}
        onOpenChange={setBlockOpen}
        title="Заблокировать пользователя?"
        description={
          <>
            <span className="font-mono">{user.email}</span> не сможет войти в систему до разблокировки. Запланированные им сообщения останутся.
          </>
        }
        confirmLabel="Заблокировать"
        destructive
        loading={blockLoading}
        onConfirm={handleBlock}
      >
        <Field label="Причина" htmlFor="block-reason" hint="Необязательно — увидит пользователь.">
          <Textarea id="block-reason" value={blockReason} maxLength={500} onChange={(e) => setBlockReason(e.target.value)} className="min-h-[80px]" />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={unblockOpen}
        onOpenChange={setUnblockOpen}
        title="Разблокировать пользователя?"
        description={
          <>
            <span className="font-mono">{user.email}</span> снова сможет входить в систему.
          </>
        }
        confirmLabel="Разблокировать"
        loading={unblockLoading}
        onConfirm={handleUnblock}
      />

      {/* Профиль */}
      <Dialog open={editProfileOpen} onOpenChange={(o) => !editProfileLoading && setEditProfileOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Редактировать профиль</DialogTitle>
            <DialogDescription>Имя, логин, username или пароль. Пароль оставьте пустым, чтобы не менять.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditProfile} className="space-y-4" noValidate>
            <Field label="Имя" htmlFor="edit-profile-name">
              <Input
                id="edit-profile-name"
                value={editProfileForm.name}
                onChange={(e) => setEditProfileForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Имя пользователя"
              />
            </Field>
            <Field label="Логин" htmlFor="edit-profile-email" required error={editProfileErrors.email}>
              <Input
                id="edit-profile-email"
                value={editProfileForm.email}
                onChange={(e) => {
                  setEditProfileForm((f) => ({ ...f, email: e.target.value }))
                  setEditProfileErrors((er) => ({ ...er, email: undefined }))
                }}
                placeholder="login или email"
                aria-invalid={!!editProfileErrors.email}
                aria-describedby={editProfileErrors.email ? 'edit-profile-email-error' : undefined}
                className="font-mono"
              />
            </Field>
            <Field label="Username" htmlFor="edit-profile-username" hint="Необязательно." error={editProfileErrors.username}>
              <Input
                id="edit-profile-username"
                value={editProfileForm.username}
                onChange={(e) => {
                  setEditProfileForm((f) => ({ ...f, username: e.target.value }))
                  setEditProfileErrors((er) => ({ ...er, username: undefined }))
                }}
                aria-invalid={!!editProfileErrors.username}
                aria-describedby={editProfileErrors.username ? 'edit-profile-username-error' : undefined}
                className="font-mono"
              />
            </Field>
            <Field label="Новый пароль" htmlFor="edit-profile-password" hint="Минимум 8 символов. Пусто — не менять." error={editProfileErrors.newPassword}>
              <PasswordInput
                id="edit-profile-password"
                value={editProfileForm.newPassword}
                onChange={(e) => {
                  setEditProfileForm((f) => ({ ...f, newPassword: e.target.value }))
                  setEditProfileErrors((er) => ({ ...er, newPassword: undefined }))
                }}
                autoComplete="new-password"
                aria-invalid={!!editProfileErrors.newPassword}
                aria-describedby={editProfileErrors.newPassword ? 'edit-profile-password-error' : undefined}
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setEditProfileOpen(false)} disabled={editProfileLoading}>
                Отмена
              </Button>
              <Button type="submit" disabled={editProfileLoading}>
                {editProfileLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Удаление пользователя */}
      <ConfirmDialog
        open={deleteUserOpen}
        onOpenChange={setDeleteUserOpen}
        title="Удалить пользователя?"
        description={
          <>
            <span className="font-mono">{user.email}</span> и все его данные (пространства, сообщения, заметки) будут удалены безвозвратно.
            Это действие нельзя отменить.
          </>
        }
        confirmLabel="Удалить"
        destructive
        loading={deleteUserLoading}
        onConfirm={handleDeleteUser}
      />

      {/* Удаление заметки */}
      <ConfirmDialog
        open={!!noteToDelete}
        onOpenChange={(o) => !o && setNoteToDelete(null)}
        title="Удалить заметку?"
        description={<span className="line-clamp-3 whitespace-pre-wrap">{noteToDelete?.text}</span>}
        confirmLabel="Удалить"
        destructive
        loading={noteDeleting}
        onConfirm={handleDeleteNote}
      />

      {/* Новая заметка */}
      <Dialog open={noteOpen} onOpenChange={(o) => !noteSubmitting && setNoteOpen(o)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить заметку</DialogTitle>
            <DialogDescription>Заметка привязана к пользователю и видна только администраторам.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleAddNote} className="space-y-4">
            <Field label="Текст" htmlFor="note-text" required>
              <Textarea
                id="note-text"
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="Например: договорились о продлении до конца интенсива"
                className="min-h-[100px]"
                maxLength={2000}
              />
            </Field>
            <div className="flex items-center gap-2">
              <Checkbox id="note-important" checked={noteImportant} onCheckedChange={(c) => setNoteImportant(c === true)} />
              <Label htmlFor="note-important" className="text-sm">
                Важная
              </Label>
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setNoteOpen(false)} disabled={noteSubmitting}>
                Отмена
              </Button>
              <Button type="submit" disabled={noteSubmitting || !noteText.trim()}>
                {noteSubmitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                Добавить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
