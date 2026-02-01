"use client"

import { useState, useEffect } from 'react'
import { useRouter, useParams } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import { Separator } from "@/components/ui/separator"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { toast } from 'sonner'
import { Loader2, ArrowLeft, Clock, MessageSquare, Server, Calendar, Ban, AlertTriangle, CalendarPlus, StickyNote, Trash2, ShieldOff, Pencil, Wifi, WifiOff, XCircle, UserX } from 'lucide-react'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { getInitials, generateAvatarColor, formatRelativeTime, formatDate, getActivityLabel, formatActivityDetails } from '@/lib/utils'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

const ROLES = [
  { value: 'USER', label: 'USER' },
  { value: 'SUPPORT', label: 'SUPPORT' },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'ADM', label: 'ADM' },
  { value: 'VOL', label: 'VOL' },
]

export default function UserActivityPage() {
  const router = useRouter()
  const params = useParams()
  const userId = params.id as string

  const [loading, setLoading] = useState(true)
  const [user, setUser] = useState<any>(null)
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [activityLogs, setActivityLogs] = useState<any[]>([])
  const [notes, setNotes] = useState<any[]>([])
  const [noteOpen, setNoteOpen] = useState(false)
  const [noteText, setNoteText] = useState('')
  const [noteImportant, setNoteImportant] = useState(false)
  const [noteSubmitting, setNoteSubmitting] = useState(false)
  const [extendLoading, setExtendLoading] = useState(false)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [editRoleOpen, setEditRoleOpen] = useState(false)
  const [editRoleForm, setEditRoleForm] = useState({ role: 'USER', volunteerExpiresAt: '', volunteerIntensive: '' })
  const [editRoleLoading, setEditRoleLoading] = useState(false)
  const [blockOpen, setBlockOpen] = useState(false)
  const [blockReason, setBlockReason] = useState('')
  const [blockLoading, setBlockLoading] = useState(false)
  const [checkingWorkspaceId, setCheckingWorkspaceId] = useState<string | null>(null)
  const [deleteUserOpen, setDeleteUserOpen] = useState(false)
  const [deleteUserLoading, setDeleteUserLoading] = useState(false)
  const [editProfileOpen, setEditProfileOpen] = useState(false)
  const [editProfileForm, setEditProfileForm] = useState({ name: '', email: '', username: '', newPassword: '' })
  const [editProfileLoading, setEditProfileLoading] = useState(false)
  const [accessDenied, setAccessDenied] = useState(false)
  const [accessDeniedMessage, setAccessDeniedMessage] = useState('')

  useEffect(() => {
    loadUserActivity()
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
          action: { label: 'В админку', onClick: () => router.push('/dashboard/admin') },
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
    } catch (error: any) {
      console.error('Load activity error:', error)
      toast.error(error.message || 'Ошибка загрузки данных', {
        action: { label: 'В админку', onClick: () => router.push('/dashboard/admin') },
      })
      setAccessDenied(true)
      setAccessDeniedMessage(error.message || 'Ошибка загрузки')
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
    } catch (err: any) {
      toast.error(err.message || 'Ошибка')
    } finally {
      setNoteSubmitting(false)
    }
  }

  const handleDeleteNote = async (noteId: string) => {
    if (!confirm('Удалить заметку?')) return
    try {
      const res = await fetch(`/api/admin/users/${userId}/notes/${noteId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      toast.success('Заметка удалена')
      await loadNotes()
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const handleExtendVol = async (addDays: number) => {
    setExtendLoading(true)
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
    } catch (err: any) {
      toast.error(err.message || 'Ошибка')
    } finally {
      setExtendLoading(false)
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

  const handleEditRole = async (e: React.FormEvent) => {
    e.preventDefault()
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
    } catch (err: any) {
      toast.error(err.message || 'Ошибка')
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
    } catch (err: any) {
      toast.error(err.message || 'Ошибка блокировки')
    } finally {
      setBlockLoading(false)
    }
  }

  const handleEditProfile = async (e: React.FormEvent) => {
    e.preventDefault()
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
    } catch (err: any) {
      toast.error(err.message || 'Ошибка обновления профиля')
    } finally {
      setEditProfileLoading(false)
    }
  }

  const handleUnblock = async () => {
    try {
      const res = await fetch(`/api/admin/users/${userId}/unblock`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Пользователь разблокирован')
      await loadUserActivity()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка разблокировки')
    }
  }

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING': return <Badge variant="secondary">Ожидает</Badge>
      case 'SENT': return <Badge variant="default" className="bg-green-600">Отправлено</Badge>
      case 'FAILED': return <Badge variant="destructive">Ошибка</Badge>
      case 'CANCELLED': return <Badge variant="outline">Отменено</Badge>
      default: return <Badge>{status}</Badge>
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
        toast.error(data.error || 'Подключение не удалось')
        await loadUserActivity()
      }
    } catch {
      toast.error('Ошибка проверки подключения')
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
    } catch (err: any) {
      toast.error(err.message || 'Ошибка удаления')
    } finally {
      setDeleteUserLoading(false)
      setDeleteUserOpen(false)
    }
  }

  // Группировка сообщений по дате для таймлайна (дата запланирована или отправлена)
  const messagesByDate = (() => {
    const map = new Map<string, any[]>()
    for (const m of messages) {
      const dateKey = (m.sentAt ? new Date(m.sentAt) : new Date(m.scheduledFor)).toISOString().slice(0, 10)
      if (!map.has(dateKey)) map.set(dateKey, [])
      map.get(dateKey)!.push(m)
    }
    const entries = Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0])).slice(0, 31)
    return entries
  })()

  const failedMessages = messages.filter((m: any) => m.status === 'FAILED')

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!user && !accessDenied) {
    return null
  }

  if (accessDenied) {
    return (
      <div className="w-full container max-w-6xl py-8 px-4 sm:px-6 mx-auto overflow-x-hidden">
        <Breadcrumbs
          items={[
            { label: 'Дашборд', href: '/dashboard' },
            { label: 'Админ панель', href: '/dashboard/admin' },
            { label: 'Пользователи', href: '/dashboard/admin' },
            { label: 'Нет доступа', current: true },
          ]}
          className="mb-6"
        />
        <Card className="border-destructive/50">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              Нет доступа
            </CardTitle>
            <CardDescription>
              {accessDeniedMessage}
            </CardDescription>
            <p className="text-sm text-muted-foreground mt-2">
              У вас нет прав для просмотра карточки этого пользователя. Администратор (ADM) может просматривать только пользователей с ролью VOL.
            </p>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={() => router.push('/dashboard/admin')}>
              Вернуться в админку
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (!user) {
    return null
  }

  return (
    <div className="w-full container max-w-6xl py-8 px-4 sm:px-6 mx-auto overflow-x-hidden">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Админ панель', href: '/dashboard/admin' },
          { label: 'Пользователи', href: '/dashboard/admin' },
          { label: user?.name || user?.email || 'Пользователь', current: true },
        ]}
        className="mb-6"
      />

      <div className="space-y-6">
        {/* Информация о пользователе */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-4">
              <Avatar className="h-16 w-16">
                {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className={`${generateAvatarColor(user.email)} text-white text-lg`}>
                  {getInitials(user.name || user.email)}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <CardTitle>{user.name || 'Без имени'}</CardTitle>
                  <Badge variant={user.role === 'SUPPORT' ? 'destructive' : user.role === 'ADM' ? 'default' : 'secondary'}>
                    {user.role}
                  </Badge>
                  {user.isBlocked ? (
                    <Badge variant="destructive" className="gap-1">
                      <Ban className="h-3 w-3" />
                      Заблокирован
                    </Badge>
                  ) : (
                    <Badge variant="default" className="bg-green-600">Активен</Badge>
                  )}
                  {user.role === 'VOL' && user.volunteerExpiresAt && (
                    <Badge variant="outline">
                      Доступ до {formatDate(user.volunteerExpiresAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                    </Badge>
                  )}
                </div>
                <CardDescription className="mt-1">
                  Логин: {user.email}
                  {user.username && <span className="ml-2">(@{user.username})</span>}
                </CardDescription>
                <p className="text-sm text-muted-foreground mt-1">
                  Зарегистрирован {formatRelativeTime(user.createdAt)}
                </p>
                {user.isBlocked && user.blockedReason && (
                  <p className="text-sm text-destructive mt-2 flex items-center gap-1">
                    <AlertTriangle className="h-4 w-4" />
                    Причина: {user.blockedReason}
                  </p>
                )}
                {user.role === 'VOL' && user.volunteerIntensive && (
                  <p className="text-sm text-muted-foreground">Интенсив: {user.volunteerIntensive}</p>
                )}
                {user.role === 'VOL' && (
                  <div className="flex gap-2 mt-3">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExtendVol(30)}
                      disabled={extendLoading}
                    >
                      {extendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4 mr-1" />}
                      Продлить на 30 дн.
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => handleExtendVol(7)}
                      disabled={extendLoading}
                    >
                      Продлить на 7 дн.
                    </Button>
                  </div>
                )}
                {currentUser && user && user.id !== currentUser.id && (user.role !== 'ADMIN' || currentUser.role === 'ADMIN') && (currentUser.role === 'SUPPORT' || currentUser.role === 'ADMIN') && (
                  <div className="flex flex-wrap gap-2 mt-3">
                    <Button size="sm" variant="outline" onClick={() => { setEditProfileForm({ name: user.name || '', email: user.email || '', username: user.username || '', newPassword: '' }); setEditProfileOpen(true); }}>
                      <Pencil className="h-4 w-4 mr-1" />
                      Редактировать профиль
                    </Button>
                    <Button size="sm" variant="outline" onClick={openEditRole}>
                      <Pencil className="h-4 w-4 mr-1" />
                      Изменить роль
                    </Button>
                    {user.isBlocked ? (
                      <Button size="sm" variant="outline" onClick={handleUnblock}>
                        <ShieldOff className="h-4 w-4 mr-1" />
                        Разблокировать
                      </Button>
                    ) : (
                      <Button size="sm" variant="destructive" onClick={() => { setBlockReason(''); setBlockOpen(true); }}>
                        <Ban className="h-4 w-4 mr-1" />
                        Заблокировать
                      </Button>
                    )}
                  </div>
                )}
                {user.lastLoginAt && (
                  <p className="text-sm text-muted-foreground mt-2">
                    Последний вход: {formatRelativeTime(user.lastLoginAt)}
                  </p>
                )}
                {currentUser && user && user.id !== currentUser.id && (user.role !== 'ADMIN' || currentUser.role === 'ADMIN') && (currentUser.role === 'SUPPORT' || currentUser.role === 'ADMIN') && (
                  <div className="mt-3 pt-3 border-t">
                    <Button size="sm" variant="destructive" onClick={() => setDeleteUserOpen(true)}>
                      <UserX className="h-4 w-4 mr-1" />
                      Удалить пользователя
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </CardHeader>
        </Card>

        {/* Статистика */}
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Пространства
              </CardTitle>
              <Server className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{workspaces.length}</div>
              <p className="text-xs text-muted-foreground">
                подключенных
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Сообщения
              </CardTitle>
              <MessageSquare className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{messages.length}</div>
              <p className="text-xs text-muted-foreground">
                всего запланировано
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">
                Отправлено
              </CardTitle>
              <Clock className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                {messages.filter(m => m.status === 'SENT').length}
              </div>
              <p className="text-xs text-muted-foreground">
                успешно
              </p>
            </CardContent>
          </Card>
        </div>

        {/* Подключенные пространства */}
        <Card>
          <CardHeader>
            <CardTitle>Подключенные пространства</CardTitle>
            <CardDescription>
              Список всех Rocket.Chat пространств пользователя
            </CardDescription>
          </CardHeader>
          <CardContent>
            {workspaces.length > 0 ? (
              <Table>
                <TableHeader>
                    <TableRow>
                    <TableHead>Название</TableHead>
                    <TableHead>URL</TableHead>
                    <TableHead>Username</TableHead>
                    <TableHead>Статус</TableHead>
                    <TableHead>Последнее подключение</TableHead>
                    {(currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADMIN') && user?.role !== 'ADMIN' && <TableHead className="text-right">Действия</TableHead>}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {workspaces.map((workspace) => (
                    <TableRow key={workspace.id}>
                      <TableCell className="font-medium">
                        <Link href={`/dashboard/workspaces/${workspace.id}`} className="text-primary hover:underline">
                          {workspace.workspaceName}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        <Link href={`/dashboard/workspaces/${workspace.id}`} className="text-primary hover:underline truncate block max-w-[200px]">
                          {workspace.workspaceUrl}
                        </Link>
                      </TableCell>
                      <TableCell className="text-sm">{workspace.username}</TableCell>
                      <TableCell>
                        <Badge variant={workspace.isActive ? 'default' : 'secondary'}>
                          {workspace.isActive ? 'Активно' : 'Неактивно'}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {workspace.lastConnected ? formatRelativeTime(workspace.lastConnected) : 'Никогда'}
                      </TableCell>
                      {(currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADMIN') && user?.role !== 'ADMIN' && (
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => handleCheckConnection(workspace.id)}
                            disabled={checkingWorkspaceId === workspace.id}
                          >
                            {checkingWorkspaceId === workspace.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Wifi className="h-4 w-4 mr-1" />
                            )}
                            Проверить подключение
                          </Button>
                        </TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Пользователь не подключил ни одного пространства
              </p>
            )}
          </CardContent>
        </Card>

        {/* Ошибки отправки */}
        {failedMessages.length > 0 && (
          <Card className="border-destructive/50">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-destructive">
                <XCircle className="h-5 w-5" />
                Ошибки отправки ({failedMessages.length})
              </CardTitle>
              <CardDescription>
                Сообщения со статусом «Ошибка» и текст ошибки
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-3">
                {failedMessages.map((m: any) => (
                  <li key={m.id} className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm">
                    <div className="font-medium text-muted-foreground">
                      {m.workspace?.workspaceName} · #{m.channelName} · {formatDate(m.scheduledFor)}
                    </div>
                    <p className="mt-1 line-clamp-2">{m.message}</p>
                    {m.error && (
                      <p className="mt-2 text-destructive text-xs">{m.error}</p>
                    )}
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        )}

        {/* Таймлайн сообщений по датам */}
        {messagesByDate.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5" />
                Сообщения по датам
              </CardTitle>
              <CardDescription>
                Запланированные и отправленные сообщения по дням
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {messagesByDate.map(([dateKey, dayMessages]) => (
                  <div key={dateKey} className="border-l-2 border-primary/30 pl-4">
                    <div className="text-sm font-medium text-muted-foreground mb-2">
                      {formatDate(dateKey, { day: 'numeric', month: 'long', year: 'numeric' })}
                    </div>
                    <ul className="space-y-2">
                      {dayMessages.map((m: any) => (
                        <li key={m.id} className="flex items-start gap-2 text-sm">
                          <span className="shrink-0 text-muted-foreground w-20">
                            {m.sentAt ? formatDate(m.sentAt, { hour: '2-digit', minute: '2-digit' }) : formatDate(m.scheduledFor, { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          {getStatusBadge(m.status)}
                          <span className="text-muted-foreground">{m.workspace?.workspaceName} · #{m.channelName}</span>
                          <span className="truncate max-w-[200px]">{m.message}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Запланированные сообщения (таблица) */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <MessageSquare className="h-5 w-5" />
              Все сообщения
            </CardTitle>
            <CardDescription>
              История всех запланированных сообщений пользователя
            </CardDescription>
          </CardHeader>
          <CardContent>
            {messages.length > 0 ? (
              <div className="overflow-x-auto -mx-1">
              <Table className="min-w-[500px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Пространство</TableHead>
                    <TableHead>Канал</TableHead>
                    <TableHead>Сообщение</TableHead>
                    <TableHead>Запланировано</TableHead>
                    <TableHead>Статус</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {messages.slice(0, 20).map((message) => (
                    <TableRow key={message.id}>
                      <TableCell className="font-medium text-sm">
                        {message.workspace.workspaceName}
                      </TableCell>
                      <TableCell className="text-sm">#{message.channelName}</TableCell>
                      <TableCell className="text-sm max-w-xs truncate">
                        {message.message}
                      </TableCell>
                      <TableCell className="text-sm text-muted-foreground">
                        {formatDate(message.scheduledFor)}
                      </TableCell>
                      <TableCell>
                        {getStatusBadge(message.status)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Нет запланированных сообщений
              </p>
            )}
          </CardContent>
        </Card>

        {/* Активность / аудит */}
        <Card>
          <CardHeader>
            <CardTitle>Активность</CardTitle>
            <CardDescription>
              Последние действия пользователя (вход, смена пароля, работа с пространствами и сообщениями)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {activityLogs.length > 0 ? (
              <ul className="space-y-2">
                {activityLogs.map((log: any) => (
                  <li
                    key={log.id}
                    className="flex items-center gap-3 py-2 border-b border-border/50 last:border-0 text-sm"
                  >
                    <span className="text-muted-foreground shrink-0 w-40">
                      {formatRelativeTime(log.createdAt)}
                    </span>
                    <Badge variant="outline" className="text-xs whitespace-nowrap">
                      {getActivityLabel(log.action)}
                    </Badge>
                    {log.details && (
                      <span className="text-muted-foreground truncate max-w-md">
                        {formatActivityDetails(log.details)}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center text-muted-foreground py-8">
                Нет записей активности
              </p>
            )}
          </CardContent>
        </Card>

        {/* Заметки администратора */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0">
            <div>
              <CardTitle className="flex items-center gap-2">
                <StickyNote className="h-5 w-5" />
                Заметки администратора
              </CardTitle>
              <CardDescription>
                Заметки о пользователе (видны только SUP)
              </CardDescription>
            </div>
            {(currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADMIN') && (user?.role !== 'ADMIN' || currentUser?.role === 'ADMIN') && (
              <Button size="sm" onClick={() => { setNoteOpen(true); setNoteText(''); setNoteImportant(false); }}>
                Добавить заметку
              </Button>
            )}
          </CardHeader>
          <CardContent>
            {notes.length > 0 ? (
              <ul className="space-y-3">
                {notes.map((note: any) => (
                  <li
                    key={note.id}
                    className={`rounded-lg border p-3 text-sm ${note.important ? 'border-amber-500/50 bg-amber-500/5' : 'border-border'}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="whitespace-pre-wrap flex-1">{note.text}</p>
                      <div className="flex items-center gap-2 shrink-0">
                        <span className="text-xs text-muted-foreground">
                          {note.author?.name || note.author?.email} · {formatRelativeTime(note.createdAt)}
                        </span>
                        {(currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADMIN') && (user?.role !== 'ADMIN' || currentUser?.role === 'ADMIN') && (
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                            onClick={() => handleDeleteNote(note.id)}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-center text-muted-foreground py-6">
                Нет заметок. Нажмите «Добавить заметку».
              </p>
            )}
          </CardContent>
        </Card>

        {/* Edit Role Dialog */}
        <Dialog open={editRoleOpen} onOpenChange={setEditRoleOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Изменить роль</DialogTitle>
              <DialogDescription>Логин: {user?.email}</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEditRole} className="space-y-4">
              <div className="space-y-2">
                <Label>Роль</Label>
                <Select value={editRoleForm.role} onValueChange={(v) => setEditRoleForm((f) => ({ ...f, role: v }))}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.filter((r) => r.value !== 'ADMIN' || currentUser?.role === 'ADMIN').map((r) => (
                      <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {editRoleForm.role === 'VOL' && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="edit-vol-expires">Дата окончания доступа</Label>
                    <Input
                      id="edit-vol-expires"
                      type="date"
                      value={editRoleForm.volunteerExpiresAt}
                      onChange={(e) => setEditRoleForm((f) => ({ ...f, volunteerExpiresAt: e.target.value }))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-vol-intensive">Интенсив</Label>
                    <Input
                      id="edit-vol-intensive"
                      value={editRoleForm.volunteerIntensive}
                      onChange={(e) => setEditRoleForm((f) => ({ ...f, volunteerIntensive: e.target.value }))}
                      placeholder="feb-26"
                    />
                  </div>
                </>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditRoleOpen(false)}>Отмена</Button>
                <Button type="submit" disabled={editRoleLoading}>
                  {editRoleLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Block User AlertDialog */}
        <AlertDialog open={blockOpen} onOpenChange={setBlockOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Заблокировать пользователя?</AlertDialogTitle>
              <AlertDialogDescription>
                Пользователь <strong>{user?.email}</strong> будет заблокирован и не сможет войти в систему до разблокировки. Причина (необязательно):
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="py-2">
              <Textarea
                placeholder="Причина блокировки"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleBlock(); }}
                disabled={blockLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {blockLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Заблокировать
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* Edit Profile Dialog */}
        <Dialog open={editProfileOpen} onOpenChange={setEditProfileOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Редактировать профиль</DialogTitle>
              <DialogDescription>
                Измените имя, логин (email), имя пользователя или пароль. Оставьте пароль пустым, чтобы не менять.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleEditProfile} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-profile-name">Имя</Label>
                <Input
                  id="edit-profile-name"
                  value={editProfileForm.name}
                  onChange={(e) => setEditProfileForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Имя пользователя"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-profile-email">Логин (email)</Label>
                <Input
                  id="edit-profile-email"
                  type="email"
                  value={editProfileForm.email}
                  onChange={(e) => setEditProfileForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="email@example.com"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-profile-username">Имя пользователя (username)</Label>
                <Input
                  id="edit-profile-username"
                  value={editProfileForm.username}
                  onChange={(e) => setEditProfileForm((f) => ({ ...f, username: e.target.value }))}
                  placeholder="username (необязательно)"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-profile-password">Новый пароль</Label>
                <Input
                  id="edit-profile-password"
                  type="password"
                  value={editProfileForm.newPassword}
                  onChange={(e) => setEditProfileForm((f) => ({ ...f, newPassword: e.target.value }))}
                  placeholder="Оставьте пустым, чтобы не менять"
                  autoComplete="new-password"
                />
                <p className="text-xs text-muted-foreground">Минимум 8 символов</p>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setEditProfileOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={editProfileLoading}>
                  {editProfileLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
                  Сохранить
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        {/* Delete User AlertDialog */}
        <AlertDialog open={deleteUserOpen} onOpenChange={setDeleteUserOpen}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Удалить пользователя?</AlertDialogTitle>
              <AlertDialogDescription>
                Логин: {user?.email} — пользователь и все его данные (пространства, сообщения, заметки) будут удалены безвозвратно. Это действие нельзя отменить.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Отмена</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); handleDeleteUser(); }}
                disabled={deleteUserLoading}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              >
                {deleteUserLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Удалить
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Dialog open={noteOpen} onOpenChange={setNoteOpen}>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Добавить заметку</DialogTitle>
              <DialogDescription>
                Заметка будет привязана к пользователю и видна только администраторам.
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleAddNote} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="note-text">Текст</Label>
                <Textarea
                  id="note-text"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value)}
                  placeholder="Заметка о пользователе..."
                  className="min-h-[100px]"
                  required
                />
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id="note-important"
                  checked={noteImportant}
                  onChange={(e) => setNoteImportant(e.target.checked)}
                  className="rounded border-input"
                />
                <Label htmlFor="note-important">Важная</Label>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setNoteOpen(false)}>
                  Отмена
                </Button>
                <Button type="submit" disabled={noteSubmitting}>
                  {noteSubmitting && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                  Добавить
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  )
}
