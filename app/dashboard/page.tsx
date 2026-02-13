"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Server, 
  MessageSquare, 
  Calendar, 
  TrendingUp, 
  Clock,
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Plus,
  Archive,
  Users,
  Filter
} from 'lucide-react'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { toast } from 'sonner'
import { formatLocalDate, formatRelativeTime } from '@/lib/utils'

export default function DashboardPage() {
  const router = useRouter()
  const [stats, setStats] = useState({
    workspaces: 0,
    activeWorkspaces: 0,
    archivedWorkspaces: 0,
    totalMessages: 0,
    pendingMessages: 0,
    sentMessages: 0,
    failedMessages: 0,
    todayMessages: 0,
  })
  const [recentMessages, setRecentMessages] = useState([])
  const [messagesDisplayLimit, setMessagesDisplayLimit] = useState(10)
  const [soonToSend, setSoonToSend] = useState<any[]>([])
  const [recentWorkspaces, setRecentWorkspaces] = useState([])
  const [expiringWorkspaces, setExpiringWorkspaces] = useState([])
  const [allUsers, setAllUsers] = useState<any[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [externalStatuses, setExternalStatuses] = useState<Record<string, 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'>>({})

  useEffect(() => {
    loadDashboardData()
  }, [selectedUserId])

  const loadDashboardData = async () => {
    try {
      // Load current user first
      const userResponse = await fetch('/api/auth/me')
      if (userResponse.ok) {
        const userData = await userResponse.json()
        setCurrentUser(userData.user)
        
        // Load all users for filter (if admin)
        if (userData.user && (userData.user.role === 'SUPPORT' || userData.user.role === 'ADM' || userData.user.role === 'ADMIN')) {
          const usersResponse = await fetch('/api/admin/users')
          if (usersResponse.ok) {
            const usersData = await usersResponse.json()
            setAllUsers(usersData.users || [])
          }
        }
      }

      // Load stats
      const statsResponse = await fetch('/api/dashboard/stats')
      if (statsResponse.ok) {
        const statsData = await statsResponse.json()
        setStats(statsData)
      }

      // Сообщения, запланированные в ближайшие 30 минут (напоминание)
      const soonRes = await fetch('/api/dashboard/soon-to-send')
      if (soonRes.ok) {
        const soonData = await soonRes.json()
        setSoonToSend(soonData.messages ?? [])
      }

      // Load recent messages with optional user filter
      const messagesUrl = selectedUserId 
        ? `/api/messages?userId=${selectedUserId}&limit=50&sort=recent`
        : '/api/messages?limit=50&sort=recent'
      const messagesResponse = await fetch(messagesUrl)
      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        const msgs = messagesData.messages.slice(0, 50)
        setRecentMessages(msgs)
        setMessagesDisplayLimit(10)

        // После загрузки сообщений — проверяем их статус в Rocket.Chat (только SENT с messageId_RC)
        checkExternalMessageStatuses(msgs)
      }

      // Load workspaces
      const workspacesResponse = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      if (workspacesResponse.ok) {
        const workspacesData = await workspacesResponse.json()
        setRecentWorkspaces(workspacesData.workspaces.slice(0, 3))
        
        // Find expiring workspaces (ending in 7 days or already ended)
        const now = new Date()
        const sevenDaysLater = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
        const expiring = workspacesData.workspaces.filter((ws: any) => 
          ws.endDate && 
          new Date(ws.endDate) <= sevenDaysLater && 
          new Date(ws.endDate) >= now &&
          !ws.isArchived
        )
        setExpiringWorkspaces(expiring)
        
        // Check for ended intensives and show notification
        const ended = workspacesData.workspaces.filter((ws: any) => 
          ws.endDate && 
          new Date(ws.endDate) < now &&
          !ws.isArchived
        )
        if (ended.length > 0) {
          toast.warning('Интенсивы завершены', {
            description: `${ended.length} ${ended.length === 1 ? 'интенсив завершен' : 'интенсива завершены'}. Рекомендуется заархивировать их.`,
            duration: 12000,
            action: {
              label: 'Перейти в архивы',
              onClick: () => router.push('/dashboard/workspaces/archived')
            }
          })
        }
        
        // Check for intensives ending soon (within 3 days)
        const endingSoon = workspacesData.workspaces.filter((ws: any) => 
          ws.endDate && 
          new Date(ws.endDate) >= now &&
          new Date(ws.endDate) <= new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000) &&
          !ws.isArchived
        )
        if (endingSoon.length > 0 && ended.length === 0) {
          toast.info('Интенсивы скоро завершатся', {
            description: `${endingSoon.length} ${endingSoon.length === 1 ? 'интенсив завершится' : 'интенсива завершатся'} в ближайшие 3 дня.`,
            duration: 8000,
          })
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
      toast.error('Ошибка загрузки данных', {
        description: 'Проверьте подключение к интернету'
      })
    } finally {
      setLoading(false)
    }
  }

  const checkExternalMessageStatuses = async (messages: any[]) => {
    // Берём только отправленные сообщения, у которых есть messageId_RC
    const toCheck = messages.filter(
      (m) => m.status === 'SENT' && m.messageId_RC
    ) as { id: string; status: string; messageId_RC?: string | null }[]

    if (toCheck.length === 0) return

    const newStatuses: Record<string, 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'> = {}

    await Promise.all(
      toCheck.map(async (msg) => {
        try {
          const res = await fetch(`/api/messages/${msg.id}`)
          if (!res.ok) {
            newStatuses[msg.id] = 'UNKNOWN'
            return
          }
          const data = await res.json()
          newStatuses[msg.id] = data.externalStatus || 'UNKNOWN'
        } catch {
          newStatuses[msg.id] = 'UNKNOWN'
        }
      })
    )

    setExternalStatuses((prev) => ({ ...prev, ...newStatuses }))
  }

  const statCards = [
    {
      title: 'Активных',
      value: stats.activeWorkspaces,
      total: stats.workspaces,
      description: `из ${stats.workspaces} пространств`,
      icon: Server,
      color: 'text-blue-600',
      bgColor: 'bg-blue-50 dark:bg-blue-950',
      trend: '+2 за неделю'
    },
    {
      title: 'Ожидают',
      value: stats.pendingMessages,
      total: stats.todayMessages,
      description: `${stats.todayMessages} на сегодня`,
      icon: Clock,
      color: 'text-yellow-600',
      bgColor: 'bg-yellow-50 dark:bg-yellow-950',
      trend: stats.todayMessages > 0 ? 'Есть на сегодня' : 'Нет на сегодня'
    },
    {
      title: 'Отправлено',
      value: stats.sentMessages,
      total: stats.totalMessages,
      description: 'Всего сообщений',
      icon: CheckCircle2,
      color: 'text-green-600',
      bgColor: 'bg-green-50 dark:bg-green-950',
      trend: `${Math.round((stats.sentMessages / (stats.totalMessages || 1)) * 100)}% успешно`
    },
    {
      title: 'Ошибки',
      value: stats.failedMessages,
      total: stats.totalMessages,
      description: stats.failedMessages > 0 ? 'Требуют внимания' : 'Всё в порядке',
      icon: XCircle,
      color: 'text-red-600',
      bgColor: 'bg-red-50 dark:bg-red-950',
      trend: stats.failedMessages === 0 ? 'Отлично!' : 'Проверьте'
    },
  ]

  const getStatusBadge = (status: string) => {
    const badges = {
      PENDING: <Badge className="bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200"><Clock className="w-3 h-3 mr-1" />Ожидает</Badge>,
      SENT: <Badge className="bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Отправлено</Badge>,
      FAILED: <Badge variant="destructive"><XCircle className="w-3 h-3 mr-1" />Ошибка</Badge>,
      CANCELLED: <Badge variant="outline">Отменено</Badge>
    }
    return badges[status as keyof typeof badges] || <Badge>{status}</Badge>
  }

  const getExternalStatusBadge = (messageId: string) => {
    const status = externalStatuses[messageId]
    if (!status) return null

    if (status === 'DELETED_IN_RC') {
      return (
        <Badge variant="destructive" className="text-xs">
          Удалено в Rocket.Chat
        </Badge>
      )
    }

    if (status === 'EDITED_IN_RC') {
      return (
        <Badge variant="outline" className="text-xs border-blue-400 text-blue-700 dark:text-blue-200 dark:border-blue-500">
          Изменено в Rocket.Chat
        </Badge>
      )
    }

    // Для SYNCHRONIZED / UNKNOWN ничего не показываем, чтобы не перегружать UI
    return null
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold bg-gradient-to-r from-primary to-primary/60 bg-clip-text text-transparent">
            Добро пожаловать! 👋
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Обзор вашей активности и запланированных сообщений
          </p>
        </div>
        {currentUser?.role !== 'VOL' && (
          <Button asChild size="lg" className="bg-gradient-to-r from-red-600 to-red-700 shadow-lg hover:shadow-xl transition-all">
            <Link href="/dashboard/workspaces">
              <Plus className="w-5 h-5 mr-2" />
              Новое пространство
            </Link>
          </Button>
        )}
      </div>

      {/* Expiring Workspaces Alert */}
      {expiringWorkspaces.length > 0 && (
        <Card className="border-yellow-200 bg-yellow-50 dark:border-yellow-800 dark:bg-yellow-950/20">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <AlertCircle className="w-6 h-6 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                  Интенсивы скоро закончатся
                </h3>
                <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-3">
                  {expiringWorkspaces.length} {expiringWorkspaces.length === 1 ? 'интенсив заканчивается' : 'интенсива заканчиваются'} в ближайшие 7 дней
                </p>
                <div className="space-y-2">
                  {expiringWorkspaces.map((ws: any) => (
                    <div key={ws.id} className="flex items-center justify-between bg-white/50 dark:bg-black/20 rounded-lg p-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ backgroundColor: ws.color || '#ef4444' }}>
                          <Server className="w-4 h-4 text-white" />
                        </div>
                        <div>
                          <p className="font-medium text-sm">{ws.workspaceName}</p>
                          <p className="text-xs text-muted-foreground">
                            Завершится {new Date(ws.endDate).toLocaleDateString('ru-RU')}
                          </p>
                        </div>
                      </div>
                      <Button variant="outline" size="sm" asChild>
                        <Link href={`/dashboard/workspaces/${ws.id}`}>
                          Открыть
                        </Link>
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Скоро к отправке — напоминание */}
      {soonToSend.length > 0 && (
        <Card className="border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <Clock className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <h3 className="font-semibold text-amber-900 dark:text-amber-200 mb-1">
                  Скоро к отправке
                </h3>
                <p className="text-sm text-amber-800 dark:text-amber-300 mb-3">
                  {soonToSend.length} {soonToSend.length === 1 ? 'сообщение' : 'сообщения'} запланированы в ближайшие 30 минут
                </p>
                <div className="space-y-2">
                  {soonToSend.map((msg: any) => {
                    const at = new Date(msg.scheduledFor)
                    const mins = Math.round((at.getTime() - Date.now()) / 60000)
                    const workspaceId = msg.workspace?.id
                    return (
                      <div key={msg.id} className="flex items-center justify-between bg-white/60 dark:bg-black/20 rounded-lg p-3">
                        <div className="min-w-0 flex-1">
                          <p className="font-medium text-sm truncate">{msg.channelName ?? '—'} · {(msg.user?.name || msg.user?.email) ?? '—'}</p>
                          <p className="text-xs text-muted-foreground">
                            {at.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                            {mins > 0 && ` · через ${mins} мин`}
                          </p>
                        </div>
                        {workspaceId && (
                          <Button variant="outline" size="sm" asChild>
                            <Link href={`/dashboard/workspaces/${workspaceId}`}>
                              Открыть
                            </Link>
                          </Button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Stats Grid */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {statCards.map((stat) => {
          const Icon = stat.icon
          return (
            <Card key={stat.title} className="border-muted hover:shadow-lg transition-shadow">
              <CardContent className="pt-6">
                <div className="flex items-center justify-between mb-4">
                  <div className={`${stat.bgColor} p-3 rounded-xl`}>
                    <Icon className={`w-6 h-6 ${stat.color}`} />
                  </div>
                  <Badge variant="outline" className="text-xs">
                    {stat.trend}
                  </Badge>
                </div>
                <div className="space-y-1">
                  <p className="text-sm font-medium text-muted-foreground">
                    {stat.title}
                  </p>
                  <div className="flex items-baseline gap-2">
                    <p className="text-3xl font-bold">{stat.value}</p>
                    {stat.total > 0 && (
                      <p className="text-sm text-muted-foreground">/ {stat.total}</p>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {stat.description}
                  </p>
                </div>
              </CardContent>
            </Card>
          )
        })}
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Recent Workspaces */}
        <Card className="border-muted">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <Server className="w-5 h-5 text-primary" />
                  Активные пространства
                </CardTitle>
                <CardDescription className="mt-1.5">
                  Недавно используемые
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/workspaces" className="text-primary">
                  Все
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {recentWorkspaces.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <Server className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Нет подключенных пространств
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/workspaces">
                    <Plus className="w-4 h-4 mr-2" />
                    Добавить первое
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentWorkspaces.map((workspace: any) => (
                  <Link
                    key={workspace.id}
                    href={`/dashboard/workspaces/${workspace.id}`}
                    className="block group"
                  >
                    <div className="flex items-center gap-3 p-4 rounded-xl border hover:bg-muted/50 transition-all group-hover:shadow-md">
                      <div
                        className="w-12 h-12 rounded-xl flex items-center justify-center shadow-sm"
                        style={{ backgroundColor: workspace.color || '#ef4444' }}
                      >
                        <Server className="w-6 h-6 text-white" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-semibold text-sm group-hover:text-primary transition-colors truncate">
                          {workspace.workspaceName}
                        </p>
                        <p className="text-xs text-muted-foreground truncate">
                          {workspace.workspaceUrl.replace(/^https?:\/\//, '')}
                        </p>
                        {workspace.lastConnected && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {formatRelativeTime(workspace.lastConnected)}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {workspace.isArchived && (
                          <Badge variant="outline" className="text-xs">
                            <Archive className="w-3 h-3 mr-1" />
                            Архив
                          </Badge>
                        )}
                        <Badge variant={workspace.isActive ? 'default' : 'secondary'} className="text-xs">
                          {workspace.isActive ? 'Активно' : 'Неактивно'}
                        </Badge>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Recent Messages */}
        <Card className="border-muted">
          <CardHeader>
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <MessageSquare className="w-5 h-5 text-primary" />
                  Последние сообщения
                </CardTitle>
                <CardDescription className="mt-1.5">
                  {currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADM' || currentUser?.role === 'ADMIN'
                    ? 'Недавно запланированные (можно фильтровать по пользователю)'
                    : 'Все сообщения, где вы указаны как отправитель (в т.ч. запланированные от вашего имени)'}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/calendar" className="text-primary">
                  Календарь
                  <ArrowRight className="w-4 h-4 ml-1" />
                </Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* User Filter */}
            {allUsers.length > 0 && (
              <div className="mb-4 flex items-center gap-2">
                <Filter className="w-4 h-4 text-muted-foreground" />
                <Select value={selectedUserId || 'all'} onValueChange={(value) => {
                  setSelectedUserId(value === 'all' ? null : value)
                }}>
                  <SelectTrigger className="w-[200px]">
                    <SelectValue placeholder="Все пользователи" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Все пользователи</SelectItem>
                    {allUsers.map((user: any) => (
                      <SelectItem key={user.id} value={user.id}>
                        {user.name || user.username || user.email}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {selectedUserId && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setSelectedUserId(null)}
                  >
                    Сбросить
                  </Button>
                )}
              </div>
            )}

            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="p-4 rounded-xl border space-y-2">
                    <Skeleton className="h-4 w-3/4" />
                    <Skeleton className="h-3 w-1/2" />
                    <Skeleton className="h-3 w-full" />
                  </div>
                ))}
              </div>
            ) : recentMessages.length === 0 ? (
              <div className="text-center py-12">
                <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="w-8 h-8 text-muted-foreground" />
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  Нет запланированных сообщений
                </p>
                <Button variant="outline" size="sm" asChild>
                  <Link href="/dashboard/workspaces">
                    <Plus className="w-4 h-4 mr-2" />
                    Создать первое
                  </Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-3">
                {recentMessages.slice(0, messagesDisplayLimit).map((message: any) => (
                  <div
                    key={message.id}
                    className="p-4 rounded-xl border hover:bg-muted/50 transition-colors"
                  >
                    <div className="flex items-start justify-between gap-3 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 mb-1 flex-wrap">
                          <p className="text-sm font-semibold truncate">
                            #{message.channelName}
                          </p>
                          {getStatusBadge(message.status)}
                          {getExternalStatusBadge(message.id)}
                          {message.workspace?.username && (
                            <Badge variant="outline" className="text-xs">
                              <Users className="w-3 h-3 mr-1" />
                              {message.workspace.username}
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <span className="truncate">
                            {message.workspace?.workspaceName || 'Unknown workspace'}
                          </span>
                          {message.user && message.user.id !== currentUser?.id && (
                            <>
                              <span>•</span>
                              <span>{message.user.name || message.user.username || message.user.email}</span>
                            </>
                          )}
                          {currentUser?.role === 'ADMIN' && message.scheduledBy && (
                            <>
                              <span>•</span>
                              <span className="text-amber-600 dark:text-amber-500">
                                Запланировано: {message.scheduledBy.name || message.scheduledBy.email}
                              </span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>
                    <p className="text-sm text-foreground/80 line-clamp-2 mb-2">
                      {message.message}
                    </p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="w-3 h-3" />
                      <span>{new Date(message.scheduledFor).toLocaleString('ru-RU')}</span>
                      {message.sentAt && (
                        <>
                          <span>•</span>
                          <span>Отправлено: {new Date(message.sentAt).toLocaleString('ru-RU')}</span>
                        </>
                      )}
                    </div>
                  </div>
                ))}
                {recentMessages.length > messagesDisplayLimit && (
                  <div className="pt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="w-full text-muted-foreground"
                      onClick={() => setMessagesDisplayLimit((prev) => Math.min(prev + 20, recentMessages.length))}
                    >
                      Показать ещё ({recentMessages.length - messagesDisplayLimit} из {recentMessages.length})
                    </Button>
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Actions */}
      <Card className="border-muted bg-gradient-to-br from-muted/30 to-muted/10">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="w-5 h-5 text-primary" />
            Быстрые действия
          </CardTitle>
          <CardDescription>
            Часто используемые функции
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {currentUser?.role !== 'VOL' && (
              <Button variant="outline" className="h-auto py-6 flex-col gap-3 hover:bg-primary/5 hover:border-primary" asChild>
                <Link href="/dashboard/workspaces">
                  <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                    <Plus className="w-6 h-6 text-primary" />
                  </div>
                  <span className="font-semibold">Новое пространство</span>
                </Link>
              </Button>
            )}
            <Button variant="outline" className="h-auto py-6 flex-col gap-3 hover:bg-primary/5 hover:border-primary" asChild>
              <Link href="/dashboard/calendar">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                  <Calendar className="w-6 h-6 text-primary" />
                </div>
                <span className="font-semibold">Календарь</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-6 flex-col gap-3 hover:bg-primary/5 hover:border-primary" asChild>
              <Link href="/dashboard/activity">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                  <Clock className="w-6 h-6 text-primary" />
                </div>
                <span className="font-semibold">История</span>
              </Link>
            </Button>
            <Button variant="outline" className="h-auto py-6 flex-col gap-3 hover:bg-primary/5 hover:border-primary" asChild>
              <Link href="/dashboard/settings">
                <div className="w-12 h-12 bg-primary/10 rounded-xl flex items-center justify-center">
                  <Server className="w-6 h-6 text-primary" />
                </div>
                <span className="font-semibold">Настройки</span>
              </Link>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}