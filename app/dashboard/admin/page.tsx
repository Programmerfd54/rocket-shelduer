"use client"

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from "@/components/ui/button"
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { Badge } from "@/components/ui/badge"
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { toast } from 'sonner'
import { Loader2, ArrowLeft, MoreVertical, Shield, ShieldOff, Key, Ban, Users, Activity, UserPlus, Pencil, CalendarPlus, Search, ClipboardCopy, FileText, Server, Archive, ShieldCheck } from 'lucide-react'
import Link from 'next/link'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Checkbox } from '@/components/ui/checkbox'
import { getInitials, generateAvatarColor, formatRelativeTime, formatDate } from '@/lib/utils'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

const ROLES = [
  { value: 'USER', label: 'USER' },
  { value: 'SUPPORT', label: 'SUPPORT' },
  { value: 'ADMIN', label: 'ADMIN' },
  { value: 'ADM', label: 'ADM' },
  { value: 'VOL', label: 'VOL' },
]

export default function AdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [users, setUsers] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [createInviteLink, setCreateInviteLink] = useState<string | null>(null)
  const [createForm, setCreateForm] = useState({
    login: '',
    role: 'USER',
  })

  const [editRoleUser, setEditRoleUser] = useState<any>(null)
  const [editRoleLoading, setEditRoleLoading] = useState(false)
  const [editRoleForm, setEditRoleForm] = useState({ role: 'USER', volunteerExpiresAt: '', volunteerIntensive: '' })

  const [blockUser, setBlockUser] = useState<any>(null)
  const [blockReason, setBlockReason] = useState('')
  const [blockLoading, setBlockLoading] = useState(false)

  const [searchQuery, setSearchQuery] = useState('')
  const [roleFilter, setRoleFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [sortBy, setSortBy] = useState<string>('createdAt')
  const [page, setPage] = useState(1)
  const [activeTab, setActiveTab] = useState<'all' | 'expiring'>('all')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())
  const [bulkExtendLoading, setBulkExtendLoading] = useState(false)
  const [editRoleConfirmSup, setEditRoleConfirmSup] = useState(false)
  const [resetPasswordResult, setResetPasswordResult] = useState<{ email: string; newPassword: string } | null>(null)

  const [systemSettings, setSystemSettings] = useState<Record<string, string>>({})
  const [systemSettingsLoading, setSystemSettingsLoading] = useState(false)
  const [restrictUser, setRestrictUser] = useState<any>(null)
  const [restrictForm, setRestrictForm] = useState<string[]>([])
  const [restrictLoading, setRestrictLoading] = useState(false)
  const [workspaceStats, setWorkspaceStats] = useState<{ active: number; archived: number } | null>(null)
  const [loadError, setLoadError] = useState(false)

  const PAGE_SIZE = 20

  const filteredUsers = useMemo(() => {
    let list = [...users]
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (u) =>
          u.email?.toLowerCase().includes(q) ||
          u.name?.toLowerCase().includes(q) ||
          u.username?.toLowerCase().includes(q)
      )
    }
    if (roleFilter !== 'all') list = list.filter((u) => u.role === roleFilter)
    if (statusFilter === 'blocked') list = list.filter((u) => u.isBlocked)
    if (statusFilter === 'active') list = list.filter((u) => !u.isBlocked)
    if (activeTab === 'expiring') {
      const now = new Date()
      const in7Days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
      list = list.filter(
        (u) =>
          u.role === 'VOL' &&
          u.volunteerExpiresAt &&
          (new Date(u.volunteerExpiresAt) <= in7Days || new Date(u.volunteerExpiresAt) < now)
      )
    }
    const order = sortBy === 'email' ? 'email' : sortBy === 'lastLogin' ? 'lastLoginAt' : 'createdAt'
    list.sort((a, b) => {
      const aVal = a[order] ? new Date(a[order]).getTime() : 0
      const bVal = b[order] ? new Date(b[order]).getTime() : 0
      if (sortBy === 'email') return (a.email || '').localeCompare(b.email || '')
      return (bVal || 0) - (aVal || 0)
    })
    return list
  }, [users, searchQuery, roleFilter, statusFilter, sortBy, activeTab])

  const totalPages = Math.ceil(filteredUsers.length / PAGE_SIZE) || 1
  const paginatedUsers = useMemo(
    () => filteredUsers.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    [filteredUsers, page, PAGE_SIZE]
  )

  const expiringCount = useMemo(
    () =>
      users.filter((u) => {
        if (u.role !== 'VOL' || !u.volunteerExpiresAt) return false
        const exp = new Date(u.volunteerExpiresAt)
        const now = new Date()
        const in7 = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        return exp <= in7 || exp < now
      }).length,
    [users]
  )

  const isSup = currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADMIN'

  useEffect(() => {
    loadData()
  }, [])

  const loadData = async () => {
    try {
      setLoadError(false)
      const userResponse = await fetch('/api/auth/me')
      if (!userResponse.ok) {
        router.push('/login')
        return
      }
      const userData = await userResponse.json()
      setCurrentUser(userData.user)

      if (userData.user.role !== 'SUPPORT' && userData.user.role !== 'ADM' && userData.user.role !== 'ADMIN') {
        router.push('/dashboard')
        toast.error('Недостаточно прав', {
          description: 'Требуются права администратора'
        })
        return
      }
      const restricted = userData.user.restrictedFeatures ?? []
      if (Array.isArray(restricted) && restricted.includes('adminPanel')) {
        router.push('/dashboard')
        toast.error('Доступ в админку ограничен')
        return
      }

      const [usersResponse, wsStatsRes] = await Promise.all([
        fetch('/api/admin/users'),
        fetch('/api/admin/workspace-stats'),
      ])
      const usersData = await usersResponse.json()
      if (!usersResponse.ok) {
        throw new Error(usersData.error || 'Failed to fetch users')
      }
      setUsers(usersData.users || [])

      if (wsStatsRes.ok) {
        const wsData = await wsStatsRes.json()
        setWorkspaceStats({ active: wsData.active ?? 0, archived: wsData.archived ?? 0 })
      } else {
        setWorkspaceStats(null)
      }

      if (userData.user.role === 'ADMIN') {
        const setRes = await fetch('/api/admin/settings')
        if (setRes.ok) {
          const setData = await setRes.json()
          setSystemSettings({
            sendAsEnabledSup: 'true',
            sendAsEnabledAdm: 'true',
            activityViewVolSup: 'true',
            workspaceTabTemplatesSup: 'true',
            workspaceTabEmojiImportSup: 'true',
            workspaceTabUsersAddSup: 'true',
            workspaceTabTemplatesAdm: 'true',
            ...(setData.settings || {}),
          })
        }
      }
    } catch (error) {
      console.error('Load data error:', error)
      setLoadError(true)
      toast.error('Ошибка загрузки данных', {
        action: {
          label: 'Повторить',
          onClick: () => loadData(),
        },
      })
    } finally {
      setLoading(false)
    }
  }

  const handleResetPassword = async (user: any) => {
    if (!confirm('Вы уверены, что хотите сбросить пароль этого пользователя?')) {
      return
    }

    try {
      const response = await fetch(`/api/admin/users/${user.id}/reset-password`, {
        method: 'POST'
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error)
      }

      const data = await response.json()
      setResetPasswordResult({ email: user.email, newPassword: data.newPassword })
      toast.success('Пароль сброшен — скопируйте и передайте пользователю')
    } catch (error: any) {
      toast.error('Ошибка', {
        description: error.message || 'Не удалось сбросить пароль'
      })
    }
  }

  const copyPasswordToClipboard = () => {
    if (!resetPasswordResult) return
    navigator.clipboard.writeText(resetPasswordResult.newPassword)
    toast.success('Пароль скопирован в буфер обмена')
  }

  const handleCreateInvite = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!createForm.login.trim()) {
      toast.error('Укажите логин')
      return
    }
    setCreateLoading(true)
    setCreateInviteLink(null)
    try {
      const res = await fetch('/api/admin/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: createForm.login.trim().toLowerCase(),
          role: createForm.role,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      setCreateInviteLink(data.link || '')
      toast.success('Ссылка приглашения создана', { description: 'Ссылка активна 1 час' })
      if (data.link) {
        try {
          await navigator.clipboard.writeText(data.link)
          toast.success('Ссылка скопирована в буфер обмена')
        } catch (_) {}
      }
    } catch (err: any) {
      toast.error(err.message || 'Ошибка создания приглашения')
    } finally {
      setCreateLoading(false)
    }
  }

  const closeCreateDialog = () => {
    setCreateOpen(false)
    setCreateForm({ login: '', role: 'USER' })
    setCreateInviteLink(null)
  }

  const copyInviteLink = () => {
    if (createInviteLink) {
      navigator.clipboard.writeText(createInviteLink)
      toast.success('Ссылка скопирована')
    }
  }

  const openEditRole = (user: any) => {
    setEditRoleUser(user)
    setEditRoleForm({
      role: user.role,
      volunteerExpiresAt: user.volunteerExpiresAt ? user.volunteerExpiresAt.slice(0, 10) : '',
      volunteerIntensive: user.volunteerIntensive || '',
    })
  }

  const handleEditRoleSubmit = async () => {
    if (!editRoleUser) return
    setEditRoleLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${editRoleUser.id}/role`, {
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
      setEditRoleUser(null)
      setEditRoleConfirmSup(false)
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка обновления роли')
    } finally {
      setEditRoleLoading(false)
    }
  }

  const handleEditRole = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!editRoleUser) return
    if (editRoleForm.role === 'SUPPORT') {
      setEditRoleConfirmSup(true)
      return
    }
    await handleEditRoleSubmit()
  }

  const handleBlock = async () => {
    if (!blockUser) return
    setBlockLoading(true)
    try {
      const res = await fetch(`/api/admin/users/${blockUser.id}/block`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: blockReason.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Пользователь заблокирован')
      setBlockUser(null)
      setBlockReason('')
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка блокировки')
    } finally {
      setBlockLoading(false)
    }
  }

  const handleUnblock = async (user: any) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/unblock`, { method: 'PATCH' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success('Пользователь разблокирован')
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка разблокировки')
    }
  }

  const handleExtendVol = async (user: any, addDays: number) => {
    try {
      const res = await fetch(`/api/admin/users/${user.id}/extend-vol`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ addDays }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Доступ продлён на ${addDays} дн.`)
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка продления')
    }
  }

  const handleBulkExtend = async () => {
    const ids = Array.from(selectedIds)
    if (ids.length === 0) {
      toast.error('Выберите пользователей')
      return
    }
    setBulkExtendLoading(true)
    try {
      const res = await fetch('/api/admin/users/bulk-extend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userIds: ids, addDays: 30 }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error)
      toast.success(`Доступ продлён ${data.extended} пользователям`)
      setSelectedIds(new Set())
      await loadData()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка продления')
    } finally {
      setBulkExtendLoading(false)
    }
  }

  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleSelectAll = () => {
    const volOnPage = paginatedUsers.filter((u) => u.role === 'VOL')
    if (selectedIds.size >= volOnPage.length) {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        volOnPage.forEach((u) => next.delete(u.id))
        return next
      })
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev)
        volOnPage.forEach((u) => next.add(u.id))
        return next
      })
    }
  }

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'SUPPORT': return 'destructive'
      case 'ADMIN': return 'default'
      case 'ADM': return 'default'
      case 'VOL': return 'secondary'
      default: return 'secondary'
    }
  }

  const resetFilters = () => {
    setSearchQuery('')
    setRoleFilter('all')
    setStatusFilter('all')
    setActiveTab('all')
    setPage(1)
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-muted/30 w-full max-w-full overflow-x-hidden">
        <div className="container max-w-6xl w-full px-3 sm:px-6 py-4 sm:py-8 mx-auto">
          <header className="mb-6 sm:mb-8">
            <div className="h-6 w-48 bg-muted animate-pulse rounded mb-4" />
            <div className="h-9 w-64 bg-muted animate-pulse rounded mb-2" />
            <div className="h-4 w-96 bg-muted animate-pulse rounded" />
          </header>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 sm:gap-4 mb-6">
            {[1, 2, 3].map((i) => (
              <div key={i} className="h-24 bg-muted animate-pulse rounded-lg" />
            ))}
          </div>
          <div className="border rounded-lg overflow-hidden">
            <div className="h-12 bg-muted/50 animate-pulse" />
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-14 border-t border-border/50 bg-card animate-pulse" />
            ))}
          </div>
        </div>
      </div>
    )
  }

  const totalUsers = users.length
  const activeUsers = users.filter(u => !u.isBlocked).length
  const adminUsers = users.filter(u => u.role === 'SUPPORT' || u.role === 'ADM' || u.role === 'ADMIN').length

  return (
    <div className="min-h-screen bg-muted/30 w-full max-w-full overflow-x-hidden">
      <div className="container max-w-6xl w-full px-3 sm:px-6 py-4 sm:py-8 mx-auto">
        <header className="mb-6 sm:mb-8">
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Админ панель', current: true },
            ]}
            className="mb-4"
          />
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold tracking-tight">Управление пользователями</h1>
              <p className="text-muted-foreground text-sm mt-1">
                Администрирование системы и пользователей
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {isSup && (
                <>
                  <Link href="/dashboard/admin/audit">
                    <Button variant="outline" size="sm" className="gap-2">
                      <FileText className="h-4 w-4" />
                      Журнал действий
                    </Button>
                  </Link>
                  {currentUser?.role === 'ADMIN' && (
                    <Link href="/dashboard/admin/security">
                      <Button variant="outline" size="sm" className="gap-2">
                        <ShieldCheck className="h-4 w-4" />
                        Защита
                      </Button>
                    </Link>
                  )}
                  <Button onClick={() => setCreateOpen(true)} size="sm" className="gap-2">
                    <UserPlus className="h-4 w-4" />
                    Создать приглашение
                  </Button>
                </>
              )}
            </div>
          </div>
        </header>

        {/* Статистика — компактные карточки */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3 sm:gap-4 mb-6 sm:mb-8">
          <Card className="border bg-card shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Всего</span>
                <Users className="h-4 w-4 text-muted-foreground/80" />
              </div>
              <p className="text-2xl font-bold mt-1">{totalUsers}</p>
              <p className="text-xs text-muted-foreground mt-0.5">пользователей</p>
            </CardContent>
          </Card>
          <Card className="border bg-card shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Активных</span>
                <Activity className="h-4 w-4 text-green-600/80" />
              </div>
              <p className="text-2xl font-bold text-green-600 mt-1">{activeUsers}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {totalUsers ? Math.round((activeUsers / totalUsers) * 100) : 0}%
              </p>
            </CardContent>
          </Card>
          <Card className="border bg-card shadow-sm">
            <CardContent className="p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-muted-foreground">Админов</span>
                <Shield className="h-4 w-4 text-destructive/80" />
              </div>
              <p className="text-2xl font-bold text-destructive mt-1">{adminUsers}</p>
              <p className="text-xs text-muted-foreground mt-0.5">SUPPORT + ADMIN + ADM</p>
            </CardContent>
          </Card>
          {workspaceStats !== null && (
            <>
              <Card className="border bg-card shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">Пространств</span>
                    <Server className="h-4 w-4 text-muted-foreground/80" />
                  </div>
                  <p className="text-2xl font-bold mt-1">{workspaceStats.active}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">активных</p>
                </CardContent>
              </Card>
              <Card className="border bg-card shadow-sm">
                <CardContent className="p-4 sm:p-5">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium text-muted-foreground">В архиве</span>
                    <Archive className="h-4 w-4 text-muted-foreground/80" />
                  </div>
                  <p className="text-2xl font-bold mt-1">{workspaceStats.archived}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">пространств</p>
                </CardContent>
              </Card>
            </>
          )}
        </div>

        {/* Настройки системы — только ADMIN */}
        {currentUser?.role === 'ADMIN' && (
          <Card className="border bg-card shadow-sm mb-6 sm:mb-8">
            <CardHeader>
              <CardTitle className="text-lg">Настройки системы</CardTitle>
              <CardDescription>Включение/отключение возможностей для SUPPORT и ADM</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">«Отправить от имени» для SUPPORT</p>
                  <p className="text-xs text-muted-foreground">Разрешить SUPPORT выбирать отправителя при планировании сообщения</p>
                </div>
                <Checkbox
                  checked={systemSettings.sendAsEnabledSup !== 'false'}
                  onCheckedChange={async (checked) => {
                    setSystemSettingsLoading(true)
                    const v = checked === true ? 'true' : 'false'
                    try {
                      const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sendAsEnabledSup: v }) })
                      const d = await r.json().catch(() => ({}))
                      if (r.ok && d.settings) {
                        setSystemSettings((prev) => ({ ...prev, ...d.settings }))
                        toast.success('Настройка сохранена')
                      } else if (!r.ok) toast.error(d.error || 'Ошибка сохранения')
                    } finally {
                      setSystemSettingsLoading(false)
                    }
                  }}
                  disabled={systemSettingsLoading}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">«Отправить от имени» для ADM</p>
                  <p className="text-xs text-muted-foreground">Разрешить ADM отправлять от имени ADM и VOL</p>
                </div>
                <Checkbox
                  checked={systemSettings.sendAsEnabledAdm !== 'false'}
                  onCheckedChange={async (checked) => {
                    setSystemSettingsLoading(true)
                    const v = checked === true ? 'true' : 'false'
                    try {
                      const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ sendAsEnabledAdm: v }) })
                      const d = await r.json().catch(() => ({}))
                      if (r.ok && d.settings) {
                        setSystemSettings((prev) => ({ ...prev, ...d.settings }))
                        toast.success('Настройка сохранена')
                      } else if (!r.ok) toast.error(d.error || 'Ошибка сохранения')
                    } finally {
                      setSystemSettingsLoading(false)
                    }
                  }}
                  disabled={systemSettingsLoading}
                />
              </div>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div>
                  <p className="font-medium">SUPPORT видит активность VOL</p>
                  <p className="text-xs text-muted-foreground">Разрешить SUPPORT просматривать активность волонтёров</p>
                </div>
                <Checkbox
                  checked={systemSettings.activityViewVolSup !== 'false'}
                  onCheckedChange={async (checked) => {
                    setSystemSettingsLoading(true)
                    const v = checked === true ? 'true' : 'false'
                    try {
                      const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ activityViewVolSup: v }) })
                      const d = await r.json().catch(() => ({}))
                      if (r.ok && d.settings) {
                        setSystemSettings((prev) => ({ ...prev, ...d.settings }))
                        toast.success('Настройка сохранена')
                      } else if (!r.ok) toast.error(d.error || 'Ошибка сохранения')
                    } finally {
                      setSystemSettingsLoading(false)
                    }
                  }}
                  disabled={systemSettingsLoading}
                />
              </div>
              <div className="border-t border-border/60 pt-4 mt-4">
                <p className="font-medium text-sm mb-3">Ограничение вкладок пространства (для SUPPORT и ADM)</p>
                <p className="text-xs text-muted-foreground mb-3">Снимите галочку, чтобы скрыть вкладку у указанной роли.</p>
                <div className="space-y-3">
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm">SUPPORT: вкладка «Шаблоны»</span>
                    <Checkbox
                      checked={systemSettings.workspaceTabTemplatesSup !== 'false'}
                      onCheckedChange={async (checked) => {
                        setSystemSettingsLoading(true)
                        const v = checked === true ? 'true' : 'false'
                        try {
                          const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceTabTemplatesSup: v }) })
                          const d = await r.json().catch(() => ({}))
                          if (r.ok && d.settings) { setSystemSettings((prev) => ({ ...prev, ...d.settings })); toast.success('Сохранено') }
                          else if (!r.ok) toast.error(d.error || 'Ошибка')
                        } finally { setSystemSettingsLoading(false) }
                      }}
                      disabled={systemSettingsLoading}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm">SUPPORT: вкладка «Импорт эмодзи»</span>
                    <Checkbox
                      checked={systemSettings.workspaceTabEmojiImportSup !== 'false'}
                      onCheckedChange={async (checked) => {
                        setSystemSettingsLoading(true)
                        const v = checked === true ? 'true' : 'false'
                        try {
                          const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceTabEmojiImportSup: v }) })
                          const d = await r.json().catch(() => ({}))
                          if (r.ok && d.settings) { setSystemSettings((prev) => ({ ...prev, ...d.settings })); toast.success('Сохранено') }
                          else if (!r.ok) toast.error(d.error || 'Ошибка')
                        } finally { setSystemSettingsLoading(false) }
                      }}
                      disabled={systemSettingsLoading}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm">SUPPORT: вкладка «Добавление пользователей»</span>
                    <Checkbox
                      checked={systemSettings.workspaceTabUsersAddSup !== 'false'}
                      onCheckedChange={async (checked) => {
                        setSystemSettingsLoading(true)
                        const v = checked === true ? 'true' : 'false'
                        try {
                          const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceTabUsersAddSup: v }) })
                          const d = await r.json().catch(() => ({}))
                          if (r.ok && d.settings) { setSystemSettings((prev) => ({ ...prev, ...d.settings })); toast.success('Сохранено') }
                          else if (!r.ok) toast.error(d.error || 'Ошибка')
                        } finally { setSystemSettingsLoading(false) }
                      }}
                      disabled={systemSettingsLoading}
                    />
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-3">
                    <span className="text-sm">ADM: вкладка «Шаблоны»</span>
                    <Checkbox
                      checked={systemSettings.workspaceTabTemplatesAdm !== 'false'}
                      onCheckedChange={async (checked) => {
                        setSystemSettingsLoading(true)
                        const v = checked === true ? 'true' : 'false'
                        try {
                          const r = await fetch('/api/admin/settings', { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ workspaceTabTemplatesAdm: v }) })
                          const d = await r.json().catch(() => ({}))
                          if (r.ok && d.settings) { setSystemSettings((prev) => ({ ...prev, ...d.settings })); toast.success('Сохранено') }
                          else if (!r.ok) toast.error(d.error || 'Ошибка')
                        } finally { setSystemSettingsLoading(false) }
                      }}
                      disabled={systemSettingsLoading}
                    />
                  </div>
                </div>
              </div>
              <div className="border-t border-border/60 pt-4 mt-4">
                <p className="font-medium text-sm mb-2">Контакт на странице «Заблокирован»</p>
                <p className="text-xs text-muted-foreground mb-2">Email, ссылка или текст — отображается заблокированным пользователям для связи с администратором.</p>
                <div className="flex gap-2 flex-wrap">
                  <Input
                    value={systemSettings.adminContact ?? ''}
                    onChange={(e) => setSystemSettings((prev) => ({ ...prev, adminContact: e.target.value }))}
                    placeholder="admin@example.com или контакт для связи"
                    className="max-w-sm"
                  />
                  <Button
                    size="sm"
                    disabled={systemSettingsLoading}
                    onClick={async () => {
                      setSystemSettingsLoading(true)
                      try {
                        const r = await fetch('/api/admin/settings', {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ adminContact: systemSettings.adminContact ?? '' }),
                        })
                        const d = await r.json().catch(() => ({}))
                        if (r.ok && d.settings) {
                          setSystemSettings((prev) => ({ ...prev, ...d.settings }))
                          toast.success('Контакт сохранён')
                        } else if (!r.ok) toast.error(d.error || 'Ошибка')
                      } finally {
                        setSystemSettingsLoading(false)
                      }
                    }}
                  >
                    {systemSettingsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Сохранить'}
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Блок пользователей */}
        <Card className="border bg-card shadow-sm overflow-hidden">
          <CardHeader className="pb-4 border-b bg-muted/30">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Users className="h-5 w-5 text-primary" />
                  Пользователи
                </CardTitle>
                <CardDescription className="mt-0.5">
                  Поиск и фильтры ниже
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent className="p-4 sm:p-6 space-y-4">
            <Tabs value={activeTab} onValueChange={(v) => { setActiveTab(v as 'all' | 'expiring'); setPage(1) }}>
              <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:inline-grid mb-4">
                <TabsTrigger value="all" className="text-sm">Все</TabsTrigger>
                <TabsTrigger value="expiring" className="text-sm gap-1.5">
                  Истекает доступ
                  {expiringCount > 0 && (
                    <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-xs">{expiringCount}</Badge>
                  )}
                </TabsTrigger>
              </TabsList>

              {/* Панель фильтров */}
              <div className="rounded-lg border bg-muted/20 p-3 space-y-3">
                <div className="flex flex-col sm:flex-row gap-2 sm:gap-3">
                  <div className="relative flex-1 min-w-0">
                    <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                    <Input
                      placeholder="Поиск по логину, имени..."
                      value={searchQuery}
                      onChange={(e) => { setSearchQuery(e.target.value); setPage(1) }}
                      className="pl-9 h-9"
                    />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Select value={roleFilter} onValueChange={(v) => { setRoleFilter(v); setPage(1) }}>
                      <SelectTrigger className="w-full sm:w-[130px] h-9">
                        <SelectValue placeholder="Роль" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все роли</SelectItem>
                        {ROLES.map((r) => (
                          <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Select value={statusFilter} onValueChange={(v) => { setStatusFilter(v); setPage(1) }}>
                      <SelectTrigger className="w-full sm:w-[130px] h-9">
                        <SelectValue placeholder="Статус" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Все</SelectItem>
                        <SelectItem value="active">Активен</SelectItem>
                        <SelectItem value="blocked">Заблокирован</SelectItem>
                      </SelectContent>
                    </Select>
                    <Select value={sortBy} onValueChange={(v) => { setSortBy(v); setPage(1) }}>
                      <SelectTrigger className="w-full sm:w-[180px] h-9">
                        <SelectValue placeholder="Сортировка" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="createdAt">По дате регистрации</SelectItem>
                        <SelectItem value="lastLogin">По последнему входу</SelectItem>
                        <SelectItem value="email">По логину</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                {isSup && selectedIds.size > 0 && (
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={handleBulkExtend}
                      disabled={bulkExtendLoading}
                      className="gap-1.5"
                    >
                      {bulkExtendLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <CalendarPlus className="h-4 w-4" />}
                      Продлить выбранным на 30 дн. ({selectedIds.size})
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setSelectedIds(new Set())}>
                      Снять выбор
                    </Button>
                  </div>
                )}
              </div>
            </Tabs>

            {filteredUsers.length === 0 ? (
              <div className="rounded-md border bg-card p-8 text-center">
                <p className="text-muted-foreground mb-4">Нет пользователей по выбранным фильтрам</p>
                <Button variant="outline" size="sm" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              </div>
            ) : (
            <div className="rounded-md border overflow-auto max-h-[min(70vh,600px)] min-w-0">
              <div className="overflow-x-auto min-w-0">
                <Table className="min-w-[800px]">
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      {isSup && (
                        <TableHead className="w-10">
                          {paginatedUsers.some((u) => u.role === 'VOL') && (
                            <Checkbox
                              checked={selectedIds.size > 0 && paginatedUsers.filter((u) => u.role === 'VOL').every((u) => selectedIds.has(u.id))}
                              onCheckedChange={toggleSelectAll}
                            />
                          )}
                        </TableHead>
                      )}
                      <TableHead>Пользователь</TableHead>
                      <TableHead>Логин</TableHead>
                      <TableHead>Роль</TableHead>
                      <TableHead>Статус</TableHead>
                      <TableHead>Пространства</TableHead>
                      <TableHead>Последний вход</TableHead>
                      <TableHead>Создан</TableHead>
                      <TableHead className="text-right">Действия</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {paginatedUsers.map((user) => (
                      <TableRow key={user.id} className="hover:bg-muted/50 transition-colors">
                        {isSup && (
                          <TableCell>
                            {user.role === 'VOL' && (
                              <Checkbox
                                checked={selectedIds.has(user.id)}
                                onCheckedChange={() => toggleSelect(user.id)}
                              />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="py-3">
                          <div className="flex items-center gap-2 sm:gap-3 min-w-0">
                            <Avatar className="h-8 w-8 sm:h-9 sm:w-9 shrink-0">
                              {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                              <AvatarFallback className={`${generateAvatarColor(user.email)} text-white text-xs sm:text-sm font-semibold`}>
                                {getInitials(user.name || user.email)}
                              </AvatarFallback>
                            </Avatar>
                            <div className="min-w-0">
                              <div className="font-medium truncate">{user.name || 'Без имени'}</div>
                              {user.username && (
                                <div className="text-xs text-muted-foreground truncate">@{user.username}</div>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm font-mono py-3 max-w-[180px] truncate" title={user.email}>{user.email}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(user.role)}>
                            {user.role}
                          </Badge>
                        </TableCell>
                        <TableCell className="align-top sm:align-middle">
                          <div className="flex flex-col gap-1">
                            {user.isBlocked ? (
                              <Badge variant="destructive" className="w-fit">Заблокирован</Badge>
                            ) : (
                              <Badge variant="default" className="w-fit bg-green-600 hover:bg-green-700 text-white">
                                Активен
                              </Badge>
                            )}
                            {user.role === 'VOL' && user.volunteerExpiresAt && (
                              <span className="text-xs text-muted-foreground">
                                до {formatDate(user.volunteerExpiresAt, { day: '2-digit', month: '2-digit', year: 'numeric' })}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground py-3">{user._count?.workspaces ?? 0}</TableCell>
                        <TableCell className="text-sm text-muted-foreground py-3 whitespace-nowrap">
                          {user.lastLoginAt ? formatRelativeTime(user.lastLoginAt) : '—'}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground py-3 whitespace-nowrap">
                          {user.createdAt ? formatRelativeTime(user.createdAt) : '—'}
                        </TableCell>
                        <TableCell className="text-right py-3">
                          {user.id !== currentUser?.id && (user.role !== 'ADMIN' || currentUser?.role === 'ADMIN') && (isSup || (currentUser?.role === 'ADM' && user.role === 'VOL')) && (
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-8 w-8 p-0">
                                  <MoreVertical className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-48">
                                <DropdownMenuLabel>Действия</DropdownMenuLabel>
                                <DropdownMenuSeparator />
                                <DropdownMenuItem
                                  onClick={() => router.push(`/dashboard/admin/users/${user.id}`)}
                                  className="cursor-pointer"
                                >
                                  <Shield className="mr-2 h-4 w-4" />
                                  Просмотр активности
                                </DropdownMenuItem>
                                {isSup && (
                                  <>
                                    <DropdownMenuItem
                                      onClick={() => router.push(`/dashboard/admin/users/${user.id}`)}
                                      className="cursor-pointer"
                                    >
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Редактировать профиль
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => openEditRole(user)}
                                      className="cursor-pointer"
                                    >
                                      <Pencil className="mr-2 h-4 w-4" />
                                      Изменить роль
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                      onClick={() => handleResetPassword(user)}
                                      className="cursor-pointer"
                                    >
                                      <Key className="mr-2 h-4 w-4" />
                                      Сбросить пароль
                                    </DropdownMenuItem>
                                    {user.role === 'VOL' && (
                                      <DropdownMenuItem
                                        onClick={() => handleExtendVol(user, 30)}
                                        className="cursor-pointer"
                                      >
                                        <CalendarPlus className="mr-2 h-4 w-4" />
                                        Продлить доступ (30 дн.)
                                      </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                    {user.isBlocked ? (
                                      <DropdownMenuItem
                                        onClick={() => handleUnblock(user)}
                                        className="cursor-pointer"
                                      >
                                        <ShieldOff className="mr-2 h-4 w-4" />
                                        Разблокировать
                                      </DropdownMenuItem>
                                    ) : (
                                      <DropdownMenuItem
                                        onClick={() => { setBlockUser(user); setBlockReason(''); }}
                                        className="cursor-pointer text-red-600 focus:text-red-600"
                                      >
                                        <Ban className="mr-2 h-4 w-4" />
                                        Заблокировать
                                      </DropdownMenuItem>
                                    )}
                                  </>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
            )}
            {filteredUsers.length > 0 && totalPages > 1 && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-2 pt-4 border-t mt-4">
                  <p className="text-xs sm:text-sm text-muted-foreground order-2 sm:order-1">
                    {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, filteredUsers.length)} из {filteredUsers.length}
                  </p>
                  <div className="flex gap-2 order-1 sm:order-2">
                    <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      Назад
                    </Button>
                    <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                      Вперёд
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
      </div>

      {/* Create Invite Dialog */}
      <Dialog open={createOpen} onOpenChange={(open) => { if (!open) closeCreateDialog(); setCreateOpen(open); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Создать приглашение</DialogTitle>
            <DialogDescription>
              {createInviteLink
                ? 'Ссылка приглашения создана. Действует 1 час.'
                : 'Укажите логин (для кого приглашение) и роль. Будет создана ссылка на регистрацию (1 час).'}
            </DialogDescription>
          </DialogHeader>
          {createInviteLink ? (
            <div className="space-y-4">
              <p className="text-sm text-amber-600 dark:text-amber-500 font-medium">
                Сгенерированную ссылку нельзя никому передавать. Если по ссылке уже зарегистрировались, повторный переход по ней приведёт к ошибке.
              </p>
              <div className="rounded-lg border bg-muted/50 p-3 break-all text-sm">{createInviteLink}</div>
              <div className="flex gap-2">
                <Button type="button" onClick={copyInviteLink} className="flex-1">
                  <ClipboardCopy className="mr-2 h-4 w-4" />
                  Копировать ссылку
                </Button>
                <Button type="button" variant="outline" onClick={() => { closeCreateDialog(); setCreateOpen(false); }}>
                  Готово
                </Button>
              </div>
            </div>
          ) : (
          <form onSubmit={handleCreateInvite} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="create-login">Логин *</Label>
              <Input
                id="create-login"
                type="text"
                value={createForm.login}
                onChange={(e) => setCreateForm((f) => ({ ...f, login: e.target.value }))}
                placeholder="d.solyanov"
                required
              />
              <p className="text-xs text-muted-foreground">Логин, под которым пользователь зарегистрируется по ссылке</p>
            </div>
            <div className="space-y-2">
              <Label>Роль</Label>
              <Select value={createForm.role} onValueChange={(v) => setCreateForm((f) => ({ ...f, role: v }))}>
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
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeCreateDialog}>
                Отмена
              </Button>
              <Button type="submit" disabled={createLoading}>
                {createLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Сгенерировать ссылку
              </Button>
            </DialogFooter>
          </form>
          )}
        </DialogContent>
      </Dialog>

      {/* Edit Role Dialog */}
      <Dialog open={!!editRoleUser} onOpenChange={(open) => !open && setEditRoleUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Изменить роль</DialogTitle>
            <DialogDescription>
              {editRoleUser && <>Логин: {editRoleUser.email}</>}
            </DialogDescription>
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
              <Button type="button" variant="outline" onClick={() => setEditRoleUser(null)}>
                Отмена
              </Button>
              <Button type="submit" disabled={editRoleLoading}>
                {editRoleLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Сохранить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Block User AlertDialog */}
      <AlertDialog open={!!blockUser} onOpenChange={(open) => !open && setBlockUser(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заблокировать пользователя?</AlertDialogTitle>
            <AlertDialogDescription>
              {blockUser && (
                <>
                  Пользователь <strong>{blockUser.email}</strong> будет заблокирован и не сможет войти в систему до разблокировки. Причина (необязательно):
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {blockUser && (
            <div className="py-2">
              <Textarea
                placeholder="Причина блокировки"
                value={blockReason}
                onChange={(e) => setBlockReason(e.target.value)}
                className="min-h-[80px]"
              />
            </div>
          )}
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

      {/* Reset Password Result Dialog */}
      <Dialog open={!!resetPasswordResult} onOpenChange={(open) => !open && setResetPasswordResult(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Пароль сброшен</DialogTitle>
            <DialogDescription>
              Логин: {resetPasswordResult?.email} — скопируйте пароль и передайте пользователю. После закрытия пароль больше не будет показан.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 py-2">
            <Input
              readOnly
              value={resetPasswordResult?.newPassword ?? ''}
              className="font-mono"
            />
            <Button variant="outline" size="icon" onClick={copyPasswordToClipboard} title="Скопировать">
              <ClipboardCopy className="h-4 w-4" />
            </Button>
          </div>
          <DialogFooter>
            <Button onClick={() => setResetPasswordResult(null)}>Закрыть</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm SUPPORT role */}
      <AlertDialog open={editRoleConfirmSup} onOpenChange={(open) => !open && setEditRoleConfirmSup(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выдать права главного администратора?</AlertDialogTitle>
            <AlertDialogDescription>
              Пользователь получит полный доступ: админ-панель, создание пользователей, блокировка, смена ролей. Продолжить?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => { e.preventDefault(); handleEditRoleSubmit(); }}
              disabled={editRoleLoading}
            >
              {editRoleLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Подтвердить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Restrictions — только ADMIN */}
      <Dialog open={!!restrictUser} onOpenChange={(open) => !open && setRestrictUser(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Ограничения пользователя</DialogTitle>
            <DialogDescription>
              Логин: {restrictUser?.email} — запретить отдельные возможности (применяется к SUPPORT/ADM).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium text-sm">Запретить «Отправить от имени»</p>
                <p className="text-xs text-muted-foreground">Пользователь не сможет планировать сообщения от имени других</p>
              </div>
              <Checkbox
                checked={restrictForm.includes('sendAs')}
                onCheckedChange={(checked) => setRestrictForm((prev) => checked ? [...prev, 'sendAs'] : prev.filter((k) => k !== 'sendAs'))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium text-sm">Запретить просмотр активности других</p>
                <p className="text-xs text-muted-foreground">SUPPORT не увидит активность VOL; ADM не видит чужую активность</p>
              </div>
              <Checkbox
                checked={restrictForm.includes('activityView')}
                onCheckedChange={(checked) => setRestrictForm((prev) => checked ? [...prev, 'activityView'] : prev.filter((k) => k !== 'activityView'))}
              />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium text-sm">Запретить доступ в админку</p>
                <p className="text-xs text-muted-foreground">Скрыть раздел «Управление пользователями»</p>
              </div>
              <Checkbox
                checked={restrictForm.includes('adminPanel')}
                onCheckedChange={(checked) => setRestrictForm((prev) => checked ? [...prev, 'adminPanel'] : prev.filter((k) => k !== 'adminPanel'))}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setRestrictUser(null)}>Отмена</Button>
            <Button
              disabled={restrictLoading}
              onClick={async () => {
                if (!restrictUser) return
                setRestrictLoading(true)
                try {
                  const r = await fetch(`/api/admin/users/${restrictUser.id}/restrictions`, {
                    method: 'PATCH',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ restrictedFeatures: restrictForm }),
                  })
                  if (r.ok) {
                    const d = await r.json()
                    setUsers((prev) => prev.map((u) => u.id === restrictUser.id ? { ...u, restrictedFeatures: d.user.restrictedFeatures } : u))
                    toast.success('Ограничения сохранены')
                    setRestrictUser(null)
                  } else {
                    const d = await r.json()
                    toast.error(d.error || 'Ошибка сохранения')
                  }
                } finally {
                  setRestrictLoading(false)
                }
              }}
            >
              {restrictLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}