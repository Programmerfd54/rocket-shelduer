"use client"

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
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
  Star,
  Zap,
  Clock,
  AlertCircle,
  CheckCircle2,
  Users,
} from 'lucide-react'
import { toast } from 'sonner'
import { WorkspaceDialog } from '@/components/_components/workspace-dialog'
import WorkspaceForm, { type Workspace } from '@/components/_components/WorkspaceForm'
import { Skeleton } from '@/components/ui/skeleton'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { cn } from '@/lib/utils'

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

  // Статистика
  const stats = useMemo(() => {
    const total = workspaces.length
    const active = workspaces.filter(w => w.isActive).length
    const hasIssues = workspaces.filter(w => !w.isActive).length
    const multiUser = workspaces.filter(w => w.isMultiUser).length
    
    return { total, active, hasIssues, multiUser }
  }, [workspaces])

  return (
    <div className="min-h-screen bg-gradient-to-b from-background to-muted/20">
      {/* Hero Section */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Пространства', current: true },
            ]}
            className="mb-6"
          />
          
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="space-y-3">
              <div className="inline-flex items-center gap-2 rounded-full bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
                <Zap className="h-3 w-3" />
                <span>Rocket.Chat Integration</span>
              </div>
              <h1 className="text-4xl sm:text-5xl font-bold tracking-tight bg-gradient-to-br from-foreground via-foreground to-foreground/70 bg-clip-text text-transparent">
                Пространства
              </h1>
              <p className="text-lg text-muted-foreground max-w-2xl">
                Управляйте подключенными Rocket.Chat пространствами, планируйте сообщения и работайте с календарём событий
              </p>
              
              {/* Volunteer Info */}
              {userRole === 'VOL' && workspaces.length > 0 && (
                <div className="flex flex-wrap items-center gap-3 pt-2">
                  <Badge variant="outline" className="gap-1.5">
                    <Server className="h-3 w-3" />
                    Активное пространство: 1 из 1
                  </Badge>
                  {volExpiryInfo && (
                    <Badge 
                      variant={volExpiryInfo.daysLeft <= 7 ? "destructive" : "secondary"}
                      className="gap-1.5"
                    >
                      <Clock className="h-3 w-3" />
                      Доступ до {volExpiryInfo.expiresAt.toLocaleDateString('ru-RU')}
                      {volExpiryInfo.daysLeft <= 7 && ` (${volExpiryInfo.daysLeft}д)`}
                    </Badge>
                  )}
                </div>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={loadWorkspaces}
                disabled={loading}
                className="gap-2"
              >
                <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} />
                Обновить
              </Button>
              
              {userRole !== 'VOL' ? (
                <Button variant="outline" size="sm" asChild className="gap-2">
                  <Link href="/dashboard/workspaces/archived">
                    <Archive className="h-4 w-4" />
                    Архивы
                  </Link>
                </Button>
              ) : (
                <Button variant="outline" size="sm" disabled className="gap-2">
                  <Archive className="h-4 w-4" />
                  Архивы
                </Button>
              )}
              
              {(userRole === 'SUPPORT' || userRole === 'ADMIN') && (
                <Button variant="outline" size="sm" asChild className="gap-2">
                  <Link href="/dashboard/admin">
                    <Shield className="h-4 w-4" />
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
        </div>
      </div>

      {/* Stats Cards */}
      {!loading && workspaces.length > 0 && (
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <Card className="border-none shadow-sm bg-gradient-to-br from-blue-500/10 via-blue-500/5 to-transparent">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Всего</p>
                    <h3 className="text-3xl font-bold mt-2">{stats.total}</h3>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-blue-500/20 flex items-center justify-center">
                    <Server className="h-6 w-6 text-blue-600 dark:text-blue-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm bg-gradient-to-br from-green-500/10 via-green-500/5 to-transparent">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Активных</p>
                    <h3 className="text-3xl font-bold mt-2">{stats.active}</h3>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-green-500/20 flex items-center justify-center">
                    <CheckCircle2 className="h-6 w-6 text-green-600 dark:text-green-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm bg-gradient-to-br from-amber-500/10 via-amber-500/5 to-transparent">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">С проблемами</p>
                    <h3 className="text-3xl font-bold mt-2">{stats.hasIssues}</h3>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <AlertCircle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="border-none shadow-sm bg-gradient-to-br from-purple-500/10 via-purple-500/5 to-transparent">
              <CardContent className="p-6">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-sm font-medium text-muted-foreground">Многопольз.</p>
                    <h3 className="text-3xl font-bold mt-2">{stats.multiUser}</h3>
                  </div>
                  <div className="h-12 w-12 rounded-xl bg-purple-500/20 flex items-center justify-center">
                    <Users className="h-6 w-6 text-purple-600 dark:text-purple-400" />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* Main Content */}
      <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6 space-y-6">
        {/* Filters */}
        {!loading && workspaces.length > 0 && (
          <Card className="border-none shadow-sm">
            <CardContent className="p-4">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск по названию, URL, логину..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-9 border-none bg-muted/50 focus-visible:ring-1"
                  />
                </div>
                
                <div className="flex items-center gap-2">
                  <Select value={sortBy} onValueChange={(v: any) => setSortBy(v)}>
                    <SelectTrigger className="w-[200px] border-none bg-muted/50">
                      <SelectValue placeholder="Сортировка" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="name">По названию</SelectItem>
                      <SelectItem value="createdAt">По дате добавления</SelectItem>
                      <SelectItem value="endDate">По дате окончания</SelectItem>
                      <SelectItem value="lastConnected">По подключению</SelectItem>
                    </SelectContent>
                  </Select>
                  
                  <div className="flex gap-1 bg-muted/50 rounded-lg p-1">
                    <Button
                      variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode('grid')}
                    >
                      <LayoutGrid className="h-4 w-4" />
                    </Button>
                    <Button
                      variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
                      size="icon"
                      className="h-8 w-8"
                      onClick={() => setViewMode('compact')}
                    >
                      <List className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Workspaces Grid/List */}
        {loading ? (
          <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <Card key={i} className="border-none shadow-sm">
                <CardContent className="p-6 space-y-4">
                  <div className="flex items-start justify-between">
                    <Skeleton className="h-10 w-10 rounded-xl" />
                    <Skeleton className="h-6 w-6 rounded" />
                  </div>
                  <div className="space-y-2">
                    <Skeleton className="h-6 w-3/4" />
                    <Skeleton className="h-4 w-full" />
                  </div>
                  <div className="flex gap-2">
                    <Skeleton className="h-6 w-20" />
                    <Skeleton className="h-6 w-24" />
                  </div>
                  <Skeleton className="h-10 w-full" />
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

        {/* Empty Search State */}
        {!loading && workspaces.length > 0 && filteredAndSorted.length === 0 && (
          <Card className="border-dashed border-2">
            <CardContent className="flex flex-col items-center justify-center py-16">
              <div className="h-20 w-20 rounded-full bg-muted/50 flex items-center justify-center mb-4">
                <Search className="h-10 w-10 text-muted-foreground" />
              </div>
              <h3 className="text-lg font-semibold mb-2">Ничего не найдено</h3>
              <p className="text-sm text-muted-foreground mb-4">
                По запросу «{searchQuery}» ничего не найдено
              </p>
              <Button variant="outline" onClick={() => setSearchQuery('')}>
                Сбросить поиск
              </Button>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}