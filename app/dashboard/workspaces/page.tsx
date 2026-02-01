"use client"

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Server,
  Archive,
  RefreshCw,
  Search,
  LayoutGrid,
  List,
  Shield,
  ChevronRight,
} from 'lucide-react'
import { toast } from 'sonner'
import { WorkspaceDialog } from '@/components/_components/workspace-dialog'
import WorkspaceForm, { type Workspace } from '@/components/_components/WorkspaceForm'
import { Skeleton } from '@/components/ui/skeleton'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

const FAVORITES_KEY = 'workspaces_favorites'

export default function WorkspacesPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [groups, setGroups] = useState<Array<{ id: string; name: string; workspaces: { workspaceId: string }[] }>>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string>('USER')
  const [userBlocked, setUserBlocked] = useState(false)
  const [userVolunteerExpiresAt, setUserVolunteerExpiresAt] = useState<string | null>(null)
  const [userVolunteerIntensive, setUserVolunteerIntensive] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [sortBy, setSortBy] = useState<'name' | 'createdAt' | 'endDate' | 'lastConnected'>('createdAt')
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('grid')
  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set()
    try {
      const raw = localStorage.getItem(FAVORITES_KEY)
      if (!raw) return new Set()
      const arr = JSON.parse(raw) as string[]
      return new Set(Array.isArray(arr) ? arr : [])
    } catch {
      return new Set()
    }
  })

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user
        setUserRole(u?.role ?? 'USER')
        setUserBlocked(!!u?.blocked)
        setUserVolunteerExpiresAt(u?.volunteerExpiresAt ?? null)
        setUserVolunteerIntensive(u?.volunteerIntensive ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    loadWorkspaces()
  }, [])

  useEffect(() => {
    const ended = workspaces.filter((ws) =>
      ws.endDate &&
      new Date(ws.endDate) < new Date() &&
      !ws.isArchived
    )
    if (ended.length > 0) {
      toast.warning('Завершенные интенсивы', {
        description: `${ended.length} ${ended.length === 1 ? 'интенсив завершен' : 'интенсива завершены'}. Рекомендуется заархивировать их.`,
        duration: 10000,
        action: {
          label: 'Перейти в архивы',
          onClick: () => router.push('/dashboard/workspaces/archived'),
        },
      })
    }
  }, [workspaces, router])

  const loadWorkspaces = async () => {
    try {
      setLoading(true)
      const response = await fetch('/api/workspace')
      if (response.ok) {
        const data = await response.json()
        setWorkspaces(data.workspaces || [])
        setGroups(data.groups || [])
      } else {
        toast.error('Ошибка загрузки пространств')
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error)
      toast.error('Ошибка загрузки пространств')
    } finally {
      setLoading(false)
    }
  }

  const groupNamesByWorkspaceId = useMemo(() => {
    const map: Record<string, string> = {}
    for (const g of groups) {
      for (const w of g.workspaces || []) {
        map[w.workspaceId] = g.name
      }
    }
    return map
  }, [groups])

  const filteredAndSorted = useMemo(() => {
    let list = workspaces
    const q = searchQuery.trim().toLowerCase()
    if (q) {
      list = list.filter(
        (w) =>
          w.workspaceName?.toLowerCase().includes(q) ||
          w.workspaceUrl?.toLowerCase().includes(q) ||
          w.username?.toLowerCase().includes(q)
      )
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return (a.workspaceName || '').localeCompare(b.workspaceName || '')
      if (sortBy === 'createdAt') return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
      if (sortBy === 'endDate') {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0
        return aEnd - bEnd
      }
      if (sortBy === 'lastConnected') {
        const aLast = a.lastConnected ? new Date(a.lastConnected).getTime() : 0
        const bLast = b.lastConnected ? new Date(b.lastConnected).getTime() : 0
        return bLast - aLast
      }
      return 0
    })
    const fav = list.filter((w) => favoriteIds.has(w.id))
    const rest = list.filter((w) => !favoriteIds.has(w.id))
    return [...fav, ...rest]
  }, [workspaces, searchQuery, sortBy, favoriteIds])

  const handleOpenWorkspace = (workspace: Workspace) => {
    router.push(`/dashboard/workspaces/${workspace.id}`)
  }

  const handleTestConnection = async (workspaceId: string) => {
    toast.loading('Проверка подключения к Rocket.Chat...', { id: 'test-connection' })
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/channels`)
      toast.dismiss('test-connection')
      if (response.ok) {
        toast.success('Подключение успешно!')
        loadWorkspaces()
      } else {
        const errorData = await response.json().catch(() => ({}))
        toast.error(errorData.error || 'Ошибка подключения', {
          action: {
            label: 'Повторить',
            onClick: () => handleTestConnection(workspaceId),
          },
        })
      }
    } catch {
      toast.dismiss('test-connection')
      toast.error('Ошибка проверки подключения', {
        action: {
          label: 'Повторить',
          onClick: () => handleTestConnection(workspaceId),
        },
      })
    }
  }

  const handleArchive = async (workspaceId: string) => {
    const res = await fetch(`/api/workspace/${workspaceId}/archive`, { method: 'POST' })
    if (!res.ok) {
      const data = await res.json()
      throw new Error(data.error || 'Ошибка архивации')
    }
    await loadWorkspaces()
  }

  const toggleFavorite = (workspaceId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev)
      if (next.has(workspaceId)) next.delete(workspaceId)
      else next.add(workspaceId)
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]))
      } catch {}
      return next
    })
  }

  const isFavorite = (workspaceId: string) => favoriteIds.has(workspaceId)

  const volExpiryInfo = useMemo(() => {
    if (userRole !== 'VOL' || !userVolunteerExpiresAt || userBlocked) return null
    const expiresAt = new Date(userVolunteerExpiresAt)
    if (expiresAt <= new Date()) return null
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    return { daysLeft, expiresAt }
  }, [userRole, userVolunteerExpiresAt, userBlocked])

  return (
    <div className="flex-1 space-y-6 p-8 pt-6">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Пространства', current: true },
        ]}
        className="mb-2"
      />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Пространства</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Управление подключенными Rocket.Chat пространствами
          </p>
          {userRole === 'VOL' && workspaces.length > 0 && (
            <p className="text-xs text-muted-foreground mt-1">
              Активное пространство: 1 из 1
            </p>
          )}
          {volExpiryInfo && (
            <p className={`text-xs mt-1 ${volExpiryInfo.daysLeft <= 7 ? 'text-amber-600 font-medium' : 'text-muted-foreground'}`}>
              Доступ до {volExpiryInfo.expiresAt.toLocaleDateString('ru-RU')}
              {volExpiryInfo.daysLeft <= 7 && ` (осталось ${volExpiryInfo.daysLeft} ${volExpiryInfo.daysLeft === 1 ? 'день' : 'дней'})`}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={loadWorkspaces}
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
          {userRole !== 'VOL' ? (
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/workspaces/archived">
                <Archive className="h-4 w-4 mr-2" />
                Архивы
              </Link>
            </Button>
          ) : (
            <Button variant="outline" size="sm" disabled title="Архивы недоступны для волонтёров">
              <Archive className="h-4 w-4 mr-2" />
              Архивы
            </Button>
          )}
          {(userRole === 'SUPPORT' || userRole === 'ADMIN') && (
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/admin">
                <Shield className="h-4 w-4 mr-2" />
                Админка
              </Link>
            </Button>
          )}
          <WorkspaceDialog
            onSuccess={loadWorkspaces}
            userRole={userRole}
            disableAddButton={userRole === 'VOL' || (userBlocked && workspaces.length >= 1)}
          />
        </div>
      </div>

      {!loading && workspaces.length > 0 && (
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Поиск по названию, URL, логину..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
            <SelectTrigger className="w-[220px]">
              <SelectValue placeholder="Сортировка" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">По названию</SelectItem>
              <SelectItem value="createdAt">По дате добавления</SelectItem>
              <SelectItem value="endDate">По дате окончания интенсива</SelectItem>
              <SelectItem value="lastConnected">По последнему подключению</SelectItem>
            </SelectContent>
          </Select>
          <div className="flex gap-1">
            <Button
              variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-9 w-9"
              onClick={() => setViewMode('grid')}
              title="Сетка карточек"
            >
              <LayoutGrid className="h-4 w-4" />
            </Button>
            <Button
              variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
              size="icon"
              className="h-9 w-9"
              onClick={() => setViewMode('compact')}
              title="Компактный список"
            >
              <List className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i}>
              <CardContent className="pt-6 space-y-4">
                <Skeleton className="h-5 w-[200px]" />
                <Skeleton className="h-4 w-[150px]" />
                <Skeleton className="h-16 w-full" />
                <div className="flex gap-2">
                  <Skeleton className="h-6 w-20" />
                  <Skeleton className="h-6 w-16" />
                </div>
                <div className="flex gap-2">
                  <Skeleton className="h-9 flex-1" />
                  <Skeleton className="h-9 w-9" />
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <WorkspaceForm
          workspaces={filteredAndSorted}
          onOpenWorkspace={handleOpenWorkspace}
          onTestConnection={handleTestConnection}
          onArchive={userRole === 'SUPPORT' || userRole === 'ADMIN' ? handleArchive : undefined}
          loading={loading}
          userRole={userRole}
          volunteerExpiresAt={userVolunteerExpiresAt}
          volunteerIntensive={userVolunteerIntensive}
          viewMode={viewMode}
          groupNamesByWorkspaceId={groupNamesByWorkspaceId}
          isFavorite={isFavorite}
          onToggleFavorite={toggleFavorite}
        />
      )}

      {!loading && workspaces.length > 0 && filteredAndSorted.length === 0 && (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Search className="h-10 w-10 text-muted-foreground mb-3" />
            <p className="text-sm text-muted-foreground">По запросу «{searchQuery}» ничего не найдено</p>
            <Button variant="link" onClick={() => setSearchQuery('')} className="mt-2">
              Сбросить поиск
            </Button>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
