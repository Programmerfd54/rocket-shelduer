"use client"

import { useEffect, useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { Ban, CalendarPlus, Key, Loader2, MoreHorizontal, Pencil, Search, ShieldOff, SlidersHorizontal, UserPlus, Users, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CopyButton } from '@/components/common/CopyButton'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { AddUserDialog } from '@/components/admin/AddUserDialog'
import { cn, getInitials, generateAvatarColor, formatRelativeTime, formatDate } from '@/lib/utils'
import { APP_ROLES, ROLE_LABELS, canManageUserWithRole, canSeeAdminPanel, inviteAssignableRoles, isVolunteerMember, type AppRole } from '@/lib/roles'

type AdminUser = {
  id: string
  email: string
  username: string | null
  name: string | null
  avatarUrl: string | null
  role: string
  restrictedFeatures: string[]
  isBlocked: boolean
  blockedReason: string | null
  volunteerExpiresAt: string | null
  volunteerIntensive: string | null
  requirePasswordChange?: boolean
  lastLoginAt: string | null
  createdAt: string
  _count?: { workspaces: number; scheduledMessages: number }
}

type CurrentUser = { id: string; role: string; restrictedFeatures?: string[] }

const PAGE_SIZE = 20

const RESTRICTIONS: { key: string; label: string; hint: string }[] = [
  { key: 'sendAs', label: 'Запретить «Отправить от имени»', hint: 'Не сможет планировать сообщения от имени других' },
  { key: 'activityView', label: 'Запретить просмотр чужой активности', hint: 'SUP не увидит активность волонтёров; ADM — чужую активность' },
  { key: 'adminPanel', label: 'Запретить доступ в админ панель', hint: 'Скрыть раздел «Пользователи»' },
]

const EXPIRING_DAYS = 7
const DAY_MS = 24 * 60 * 60 * 1000

/** Волонтёр, у которого доступ истёк или истекает в ближайшие 7 дней. */
function isExpiringVolunteer(u: { role: string; volunteerExpiresAt: string | null }): boolean {
  if (!isVolunteerMember(u) || !u.volunteerExpiresAt) return false
  return new Date(u.volunteerExpiresAt).getTime() <= Date.now() + EXPIRING_DAYS * DAY_MS
}

function roleBadgeVariant(role: string): 'default' | 'info' | 'secondary' | 'muted' {
  if (role === 'LEAD_SUP') return 'default'
  if (role === 'SUP') return 'info'
  if (role === 'ADM') return 'secondary'
  return 'muted'
}

export default function AdminUsersPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [users, setUsers] = useState<AdminUser[]>([])
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null)
  const [workspaceStats, setWorkspaceStats] = useState<{ active: number; archived: number } | null>(null)

  const [addOpen, setAddOpen] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('createdAt')
  const [page, setPage] = useState(1)

  const [blockUser, setBlockUser] = useState<AdminUser | null>(null)
  const [blockReason, setBlockReason] = useState('')
  const [unblockUser, setUnblockUser] = useState<AdminUser | null>(null)
  const [resetUser, setResetUser] = useState<AdminUser | null>(null)
  const [actionLoading, setActionLoading] = useState(false)
  const [resetPasswordResult, setResetPasswordResult] = useState<{ email: string; newPassword: string } | null>(null)

  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [extendUser, setExtendUser] = useState<AdminUser | null>(null)
  const [bulkExtendOpen, setBulkExtendOpen] = useState(false)

  const [restrictUser, setRestrictUser] = useState<AdminUser | null>(null)
  const [restrictForm, setRestrictForm] = useState<string[]>([])

  const loadData = async () => {
    try {
      setLoadError(false)
      const meRes = await fetch('/api/auth/me')
      if (!meRes.ok) {
        router.push('/login')
        return
      }
      const me = (await meRes.json()).user as CurrentUser | undefined
      if (!me || !canSeeAdminPanel(me.role, me.restrictedFeatures ?? [])) {
        router.push('/dashboard')
        return
      }
      setCurrentUser(me)

      const [usersRes, statsRes] = await Promise.all([fetch('/api/admin/users'), fetch('/api/admin/workspace-stats')])
      const usersData = await usersRes.json().catch(() => ({}))
      if (!usersRes.ok) throw new Error(usersData.error || 'Не удалось загрузить пользователей')
      setUsers(usersData.users || [])
      if (statsRes.ok) {
        const ws = await statsRes.json()
        setWorkspaceStats({ active: ws.active ?? 0, archived: ws.archived ?? 0 })
      }
    } catch (error) {
      console.error('Load admin users error:', error)
      setLoadError(true)
      toast.error('Не удалось загрузить пользователей', {
        description: 'Проверьте подключение и повторите.',
        action: { label: 'Повторить', onClick: () => void loadData() },
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const filteredUsers = useMemo(() => {
    let list = [...users]
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (u) => u.email?.toLowerCase().includes(q) || u.name?.toLowerCase().includes(q) || u.username?.toLowerCase().includes(q)
      )
    }
    if (roleFilter === 'VOLUNTEER') list = list.filter((u) => isVolunteerMember(u))
    else if (roleFilter === 'EXPIRING') list = list.filter((u) => isExpiringVolunteer(u))
    else if (roleFilter !== 'all') list = list.filter((u) => u.role === roleFilter)
    if (statusFilter === 'blocked') list = list.filter((u) => u.isBlocked)
    if (statusFilter === 'active') list = list.filter((u) => !u.isBlocked)
    list.sort((a, b) => {
      if (sortBy === 'email') return (a.email || '').localeCompare(b.email || '')
      const key = sortBy === 'lastLogin' ? 'lastLoginAt' : 'createdAt'
      const av = a[key] ? new Date(a[key] as string).getTime() : 0
      const bv = b[key] ? new Date(b[key] as string).getTime() : 0
      return bv - av
    })
    return list
  }, [users, searchQuery, roleFilter, statusFilter, sortBy])

  const totalPages = Math.max(1, Math.ceil(filteredUsers.length / PAGE_SIZE))
  const paginatedUsers = filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const canAddUsers = currentUser ? inviteAssignableRoles(currentUser.role).length > 0 : false
  const isLeadSup = currentUser?.role === 'LEAD_SUP'

  const resetFilters = () => {
    setSearchQuery('')
    setRoleFilter('all')
    setStatusFilter('all')
    setPage(1)
  }

  const isSelectable = (u: AdminUser) =>
    !!currentUser && u.id !== currentUser.id && canManageUserWithRole(currentUser.role, u.role) && isVolunteerMember(u)
  const selectablePageIds = paginatedUsers.filter(isSelectable).map((u) => u.id)
  const allPageSelected = selectablePageIds.length > 0 && selectablePageIds.every((id) => selectedIds.has(id))
  const somePageSelected = selectablePageIds.some((id) => selectedIds.has(id))

  const toggleSelect = (id: string, checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (checked) next.add(id)
      else next.delete(id)
      return next
    })

  const toggleSelectPage = (checked: boolean) =>
    setSelectedIds((prev) => {
      const next = new Set(prev)
      for (const id of selectablePageIds) {
        if (checked) next.add(id)
        else next.delete(id)
      }
      return next
    })

  const handleExtendOne = async () => {
    if (!extendUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${extendUser.id}/extend-vol`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addDays: 30 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось продлить доступ')
      toast.success('Доступ продлён на 30 дней', { description: extendUser.email })
      setExtendUser(null)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось продлить доступ', { description: 'Повторите попытку.' })
    } finally {
      setActionLoading(false)
    }
  }

  const handleBulkExtend = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) return
    setActionLoading(true)
    try {
      const res = await fetch('/api/admin/users/bulk-extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: ids, addDays: 30 }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось продлить доступ')
      toast.success(`Доступ продлён на 30 дней: ${data.extended ?? ids.length}`)
      setSelectedIds(new Set())
      setBulkExtendOpen(false)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось продлить доступ', { description: 'Повторите попытку.' })
    } finally {
      setActionLoading(false)
    }
  }

  const handleResetPassword = async () => {
    if (!resetUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${resetUser.id}/reset-password`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось сбросить пароль')
      setResetPasswordResult({ email: resetUser.email, newPassword: data.newPassword })
      setResetUser(null)
      toast.success('Пароль сброшен', { description: 'Скопируйте новый пароль и передайте пользователю.' })
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось сбросить пароль')
    } finally {
      setActionLoading(false)
    }
  }

  const handleBlock = async () => {
    if (!blockUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${blockUser.id}/block`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: blockReason.trim() || undefined }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось заблокировать')
      toast.success('Пользователь заблокирован', { description: blockUser.email })
      setBlockUser(null)
      setBlockReason('')
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось заблокировать')
    } finally {
      setActionLoading(false)
    }
  }

  const handleUnblock = async () => {
    if (!unblockUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${unblockUser.id}/unblock`, { method: 'PATCH' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось разблокировать')
      toast.success('Пользователь разблокирован', { description: unblockUser.email })
      setUnblockUser(null)
      await loadData()
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Не удалось разблокировать')
    } finally {
      setActionLoading(false)
    }
  }

  const handleSaveRestrictions = async () => {
    if (!restrictUser) return
    setActionLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${restrictUser.id}/restrictions`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ restrictedFeatures: restrictForm }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      setUsers((prev) => prev.map((u) => (u.id === restrictUser.id ? { ...u, restrictedFeatures: data.user.restrictedFeatures } : u)))
      toast.success('Ограничения сохранены')
      setRestrictUser(null)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setActionLoading(false)
    }
  }

  const header = (
    <PageHeader
      title="Пользователи"
      description={
        isLeadSup
          ? 'Все пользователи системы: приглашения, роли, блокировки и сброс паролей.'
          : 'Пользователи системы. Вы можете добавлять и управлять пользователями ADM и MEMBER.'
      }
      actions={
        canAddUsers ? (
          <Button onClick={() => setAddOpen(true)}>
            <UserPlus className="size-4" aria-hidden />
            Добавить пользователя
          </Button>
        ) : undefined
      }
    />
  )

  if (loading) {
    return (
      <PageContainer className="px-4 sm:px-6">
        <div className="space-y-3 pb-5">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
        <Skeleton className="mb-4 h-16 w-full" />
        <div className="space-y-1">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      </PageContainer>
    )
  }

  const totalUsers = users.length
  const blockedUsers = users.filter((u) => u.isBlocked).length
  const staffUsers = users.filter((u) => u.role === 'LEAD_SUP' || u.role === 'SUP').length
  const volunteers = users.filter((u) => isVolunteerMember(u)).length

  const stats: { label: string; value: number; hint?: string }[] = [
    { label: 'Всего', value: totalUsers },
    { label: 'Заблокировано', value: blockedUsers },
    { label: 'Lead_SUP и SUP', value: staffUsers },
    { label: 'Волонтёров', value: volunteers },
    ...(workspaceStats ? [{ label: 'Пространств', value: workspaceStats.active, hint: `в архиве: ${workspaceStats.archived}` }] : []),
  ]

  const expiringVolunteers = users.filter((u) => isExpiringVolunteer(u)).length
  const roleChips: { value: string; label: string; count: number }[] = [
    { value: 'all', label: 'Все', count: totalUsers },
    ...APP_ROLES.map((r) => ({ value: r as string, label: ROLE_LABELS[r], count: users.filter((u) => u.role === r).length })),
    { value: 'VOLUNTEER', label: 'Волонтёры', count: volunteers },
    ...(expiringVolunteers > 0 ? [{ value: 'EXPIRING', label: 'Доступ истекает', count: expiringVolunteers }] : []),
  ]

  return (
    <PageContainer className="px-4 sm:px-6">
      {header}

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3 lg:grid-cols-5">
        {stats.map((s) => (
          <div key={s.label} className="bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{s.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">{s.value}</dd>
            {s.hint && <dd className="text-xs text-muted-foreground">{s.hint}</dd>}
          </div>
        ))}
      </dl>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row">
        <div className="relative min-w-0 flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Поиск по логину, имени, username"
            aria-label="Поиск пользователей"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value)
              setPage(1)
            }}
            className="pl-9"
          />
        </div>
        <div className="grid grid-cols-2 gap-2 sm:flex">
          <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-[150px]" aria-label="Фильтр по статусу">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="active">Активен</SelectItem>
              <SelectItem value="blocked">Заблокирован</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1) }}>
            <SelectTrigger className="w-full sm:w-[180px]" aria-label="Сортировка">
              <SelectValue placeholder="Сортировка" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="createdAt">По дате создания</SelectItem>
              <SelectItem value="lastLogin">По последнему входу</SelectItem>
              <SelectItem value="email">По логину</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:none]" role="group" aria-label="Фильтр по роли">
        {roleChips.map((chip) => {
          const active = roleFilter === chip.value
          return (
            <button
              key={chip.value}
              type="button"
              aria-pressed={active}
              onClick={() => {
                setRoleFilter(chip.value)
                setPage(1)
              }}
              className={cn(
                'inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
                active ? 'border-foreground/20 bg-muted font-medium text-foreground' : 'border-transparent text-muted-foreground hover:bg-muted/60 hover:text-foreground',
              )}
            >
              {chip.label}
              <span className="tabular-nums text-xs text-muted-foreground">{chip.count}</span>
            </button>
          )
        })}
      </div>

      {selectedIds.size > 0 && (
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/50 px-3 py-2" role="status">
          <p className="text-sm">
            Выбрано: <span className="font-medium tabular-nums">{selectedIds.size}</span>
          </p>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={() => setBulkExtendOpen(true)}>
              <CalendarPlus className="size-4" aria-hidden />
              Продлить доступ на 30 дн.
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
              <X className="size-4" aria-hidden />
              Снять выбор
            </Button>
          </div>
        </div>
      )}

      {loadError && users.length === 0 ? (
        <EmptyState
          icon={<Users className="size-6 text-muted-foreground" />}
          title="Не удалось загрузить пользователей"
          description="Проверьте подключение и повторите."
          action={{ label: 'Повторить', onClick: () => void loadData() }}
        />
      ) : filteredUsers.length === 0 ? (
        users.length === 0 ? (
          <EmptyState
            icon={<Users className="size-6 text-muted-foreground" />}
            title="Пока нет пользователей"
            description="Пригласите коллег по ссылке или создайте учётную запись."
            action={canAddUsers ? { label: 'Добавить пользователя', onClick: () => setAddOpen(true) } : undefined}
          />
        ) : (
          <EmptyState
            icon={<Search className="size-6 text-muted-foreground" />}
            title="Никого не нашли"
            description="Измените запрос или сбросьте фильтры."
            action={{ label: 'Сбросить фильтры', onClick: resetFilters }}
          />
        )
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <Table className="min-w-[820px]">
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-10 pr-0">
                  {selectablePageIds.length > 0 && (
                    <Checkbox
                      aria-label="Выбрать всех волонтёров на странице"
                      checked={allPageSelected ? true : somePageSelected ? 'indeterminate' : false}
                      onCheckedChange={(c) => toggleSelectPage(c === true)}
                    />
                  )}
                </TableHead>
                <TableHead>Пользователь</TableHead>
                <TableHead>Логин</TableHead>
                <TableHead>Роль</TableHead>
                <TableHead>Статус</TableHead>
                <TableHead className="text-right">Пространства</TableHead>
                <TableHead>Последний вход</TableHead>
                <TableHead className="w-12">
                  <span className="sr-only">Действия</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedUsers.map((u) => {
                const manageable = !!currentUser && u.id !== currentUser.id && canManageUserWithRole(currentUser.role, u.role)
                return (
                  <TableRow key={u.id} className="hover:bg-muted/40" data-state={selectedIds.has(u.id) ? 'selected' : undefined}>
                    <TableCell className="w-10 py-2 pr-0">
                      {isSelectable(u) && (
                        <Checkbox
                          aria-label={`Выбрать ${u.email}`}
                          checked={selectedIds.has(u.id)}
                          onCheckedChange={(c) => toggleSelect(u.id, c === true)}
                        />
                      )}
                    </TableCell>
                    <TableCell className="py-2">
                      <Link href={`/dashboard/admin/users/${u.id}`} className="flex min-w-0 items-center gap-2.5 hover:underline">
                        <Avatar className="size-8 shrink-0">
                          {u.avatarUrl && <AvatarImage src={u.avatarUrl} alt="" />}
                          <AvatarFallback className={`${generateAvatarColor(u.email)} text-xs font-semibold text-white`}>
                            {getInitials(u.name || u.email)}
                          </AvatarFallback>
                        </Avatar>
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{u.name || 'Без имени'}</div>
                          {u.username && <div className="truncate text-xs text-muted-foreground">@{u.username}</div>}
                        </div>
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-[200px] truncate py-2 font-mono text-sm" title={u.email}>
                      {u.email}
                    </TableCell>
                    <TableCell className="py-2">
                      <Badge variant={roleBadgeVariant(u.role)}>{ROLE_LABELS[u.role as AppRole] ?? u.role}</Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex flex-col gap-0.5">
                        {u.isBlocked ? (
                          <Badge variant="danger">Заблокирован</Badge>
                        ) : u.requirePasswordChange ? (
                          <Badge variant="warning">Ждёт смены пароля</Badge>
                        ) : (
                          <Badge variant="success">Активен</Badge>
                        )}
                        {isVolunteerMember(u) && u.volunteerExpiresAt && (
                          <span className={cn('text-xs', isExpiringVolunteer(u) ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>
                            волонтёр до {formatDate(u.volunteerExpiresAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                          </span>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="py-2 text-right text-sm tabular-nums text-muted-foreground">
                      {u._count?.workspaces ?? 0}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2 text-sm text-muted-foreground">
                      {u.lastLoginAt ? formatRelativeTime(u.lastLoginAt) : '—'}
                    </TableCell>
                    <TableCell className="py-2 text-right">
                      {manageable && (
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="icon" className="size-8" aria-label={`Действия: ${u.email}`}>
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end" className="w-56">
                            <DropdownMenuItem onClick={() => router.push(`/dashboard/admin/users/${u.id}`)}>
                              <Pencil className="size-4" />
                              Профиль и роль
                            </DropdownMenuItem>
                            {isVolunteerMember(u) && (
                              <DropdownMenuItem onClick={() => setExtendUser(u)}>
                                <CalendarPlus className="size-4" />
                                Продлить доступ на 30 дн.
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuItem onClick={() => setResetUser(u)}>
                              <Key className="size-4" />
                              Сбросить пароль
                            </DropdownMenuItem>
                            {isLeadSup && (u.role === 'SUP' || u.role === 'ADM') && (
                              <DropdownMenuItem
                                onClick={() => {
                                  setRestrictUser(u)
                                  setRestrictForm(u.restrictedFeatures ?? [])
                                }}
                              >
                                <SlidersHorizontal className="size-4" />
                                Ограничения
                              </DropdownMenuItem>
                            )}
                            <DropdownMenuSeparator />
                            {u.isBlocked ? (
                              <DropdownMenuItem onClick={() => setUnblockUser(u)}>
                                <ShieldOff className="size-4" />
                                Разблокировать
                              </DropdownMenuItem>
                            ) : (
                              <DropdownMenuItem
                                variant="destructive"
                                onClick={() => {
                                  setBlockUser(u)
                                  setBlockReason('')
                                }}
                              >
                                <Ban className="size-4" />
                                Заблокировать
                              </DropdownMenuItem>
                            )}
                          </DropdownMenuContent>
                        </DropdownMenu>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex flex-col items-center justify-between gap-2 border-t px-4 py-3 sm:flex-row">
              <p className="text-sm text-muted-foreground">
                {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredUsers.length)} из {filteredUsers.length}
              </p>
              <div className="flex gap-2">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Назад
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Вперёд
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {currentUser && (
        <AddUserDialog open={addOpen} onOpenChange={setAddOpen} actorRole={currentUser.role} onCreated={() => void loadData()} />
      )}

      <ConfirmDialog
        open={!!resetUser}
        onOpenChange={(o) => !o && setResetUser(null)}
        title="Сбросить пароль?"
        description={
          <>
            Для <span className="font-mono">{resetUser?.email}</span> будет создан новый пароль, все активные сессии завершатся. Старый пароль
            перестанет работать.
          </>
        }
        confirmLabel="Сбросить пароль"
        loading={actionLoading}
        onConfirm={handleResetPassword}
      />

      <ConfirmDialog
        open={!!blockUser}
        onOpenChange={(o) => !o && setBlockUser(null)}
        title="Заблокировать пользователя?"
        description={
          <>
            <span className="font-mono">{blockUser?.email}</span> не сможет войти в систему до разблокировки. Запланированные им сообщения
            останутся.
          </>
        }
        confirmLabel="Заблокировать"
        destructive
        loading={actionLoading}
        onConfirm={handleBlock}
      >
        <Field label="Причина" htmlFor="block-reason" hint="Необязательно — увидит пользователь.">
          <Textarea
            id="block-reason"
            value={blockReason}
            maxLength={500}
            onChange={(e) => setBlockReason(e.target.value)}
            className="min-h-[80px]"
          />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!unblockUser}
        onOpenChange={(o) => !o && setUnblockUser(null)}
        title="Разблокировать пользователя?"
        description={
          <>
            <span className="font-mono">{unblockUser?.email}</span> снова сможет входить в систему.
          </>
        }
        confirmLabel="Разблокировать"
        loading={actionLoading}
        onConfirm={handleUnblock}
      />

      <ConfirmDialog
        open={!!extendUser}
        onOpenChange={(o) => !o && setExtendUser(null)}
        title="Продлить доступ волонтёра?"
        description={
          <>
            Срок доступа <span className="font-mono">{extendUser?.email}</span> увеличится на 30 дней. Если доступ был закрыт из-за окончания
            срока, пользователь будет разблокирован.
          </>
        }
        confirmLabel="Продлить на 30 дн."
        loading={actionLoading}
        onConfirm={handleExtendOne}
      />

      <ConfirmDialog
        open={bulkExtendOpen}
        onOpenChange={setBulkExtendOpen}
        title={`Продлить доступ: ${selectedIds.size}`}
        description="Срок доступа выбранных волонтёров увеличится на 30 дней. Заблокированные из-за окончания срока будут разблокированы."
        confirmLabel="Продлить на 30 дн."
        loading={actionLoading}
        onConfirm={handleBulkExtend}
      />

      {/* Новый пароль после сброса */}
      <Dialog open={!!resetPasswordResult} onOpenChange={(o) => !o && setResetPasswordResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Пароль сброшен</DialogTitle>
            <DialogDescription>
              Логин: <span className="font-mono">{resetPasswordResult?.email}</span>. Скопируйте пароль и передайте пользователю — после
              закрытия он больше не будет показан.
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center gap-2">
            <Input readOnly value={resetPasswordResult?.newPassword ?? ''} className="font-mono" aria-label="Новый пароль" />
            <CopyButton text={resetPasswordResult?.newPassword ?? ''} successMessage="Пароль скопирован" variant="outline" size="icon" aria-label="Копировать пароль" />
          </div>
          <DialogFooter>
            <Button onClick={() => setResetPasswordResult(null)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Ограничения — Lead_SUP */}
      <Dialog open={!!restrictUser} onOpenChange={(o) => !o && !actionLoading && setRestrictUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ограничения пользователя</DialogTitle>
            <DialogDescription>
              <span className="font-mono">{restrictUser?.email}</span> — запретить отдельные возможности.
            </DialogDescription>
          </DialogHeader>
          <ul className="divide-y rounded-md border">
            {RESTRICTIONS.map((r) => (
              <li key={r.key} className="flex items-start gap-3 px-3 py-2.5">
                <Checkbox
                  id={`restrict-${r.key}`}
                  className="mt-0.5"
                  checked={restrictForm.includes(r.key)}
                  onCheckedChange={(c) =>
                    setRestrictForm((prev) => (c === true ? [...prev, r.key] : prev.filter((k) => k !== r.key)))
                  }
                />
                <div>
                  <Label htmlFor={`restrict-${r.key}`} className="text-sm font-medium">
                    {r.label}
                  </Label>
                  <p className="text-xs text-muted-foreground">{r.hint}</p>
                </div>
              </li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestrictUser(null)} disabled={actionLoading}>
              Отмена
            </Button>
            <Button onClick={() => void handleSaveRestrictions()} disabled={actionLoading}>
              {actionLoading && <Loader2 className="size-4 animate-spin" aria-hidden />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
