'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
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
  Shield, 
  ShieldCheck, 
  ShieldAlert, 
  Filter, 
  Calendar,
  AlertTriangle,
  Lock,
  UserX,
  FileWarning,
  Ban,
  Activity,
  TrendingUp,
  TrendingDown,
  Eye,
  EyeOff,
  Clock,
  MapPin,
  Smartphone,
} from 'lucide-react'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const EVENT_TYPES = [
  { value: '', label: 'Все типы', icon: Shield, color: 'default' },
  { value: 'LOGIN_FAILED', label: 'Неудачный вход', icon: Lock, color: 'red' },
  { value: 'LOGIN_RATE_LIMIT', label: 'Лимит попыток входа', icon: Ban, color: 'orange' },
  { value: 'AUTH_RATE_LIMIT', label: 'Лимит запросов auth', icon: Activity, color: 'yellow' },
  { value: 'INVALID_TOKEN', label: 'Недействительный токен', icon: ShieldAlert, color: 'red' },
  { value: 'UNAUTHORIZED_ACCESS', label: 'Несанкционированный доступ', icon: AlertTriangle, color: 'red' },
  { value: 'SUSPICIOUS_INPUT', label: 'Подозрительный ввод', icon: Eye, color: 'orange' },
  { value: 'REGISTER_FAILED', label: 'Ошибка регистрации', icon: UserX, color: 'red' },
  { value: 'WORKSPACE_AUTH_FAILED', label: 'Ошибка подключения', icon: ShieldAlert, color: 'orange' },
  { value: 'PATH_TRAVERSAL_ATTEMPT', label: 'Попытка обхода пути', icon: FileWarning, color: 'red' },
  { value: 'BLOCKED_USER_LOGIN', label: 'Вход заблокированного', icon: UserX, color: 'red' },
  { value: 'SESSION_HIJACKING_ATTEMPT', label: '🚨 Попытка кражи сессии', icon: AlertTriangle, color: 'red' },
]

function getEventIcon(type: string) {
  const found = EVENT_TYPES.find((t) => t.value === type)
  return found?.icon ?? Shield
}

function getEventColor(type: string): string {
  const found = EVENT_TYPES.find((t) => t.value === type)
  return found?.color ?? 'default'
}

function formatEventType(type: string): string {
  const found = EVENT_TYPES.find((t) => t.value === type)
  return found?.label ?? type
}

function getSeverityColor(type: string, blocked: boolean): string {
  if (!blocked) return 'text-red-500 dark:text-red-400'
  
  const critical = ['SESSION_HIJACKING_ATTEMPT', 'PATH_TRAVERSAL_ATTEMPT', 'UNAUTHORIZED_ACCESS']
  const high = ['LOGIN_FAILED', 'INVALID_TOKEN', 'BLOCKED_USER_LOGIN']
  const medium = ['SUSPICIOUS_INPUT', 'AUTH_RATE_LIMIT', 'LOGIN_RATE_LIMIT']
  
  if (critical.includes(type)) return 'text-red-600 dark:text-red-400'
  if (high.includes(type)) return 'text-orange-600 dark:text-orange-400'
  if (medium.includes(type)) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-blue-600 dark:text-blue-400'
}

export default function AdminSecurityPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [events, setEvents] = useState<any[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [typeFilter, setTypeFilter] = useState('')
  const [ipFilter, setIpFilter] = useState('')
  const [pathFilter, setPathFilter] = useState('')
  const [detailsFilter, setDetailsFilter] = useState('')
  const [blockedFilter, setBlockedFilter] = useState<string>('')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [showFilters, setShowFilters] = useState(false)
  const limit = 50

  // Статистика
  const [stats, setStats] = useState({
    total24h: 0,
    blocked24h: 0,
    critical24h: 0,
    trend: 0,
  })

  useEffect(() => {
    loadEvents()
    loadStats()
  }, [page, typeFilter, ipFilter, pathFilter, detailsFilter, blockedFilter, dateFrom, dateTo])

  const loadStats = async () => {
    try {
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)
      
      const [last24h, prev24h] = await Promise.all([
        fetch(`/api/admin/security/events?dateFrom=${yesterday.toISOString()}&limit=1000`).then(r => r.json()),
        fetch(`/api/admin/security/events?dateFrom=${twoDaysAgo.toISOString()}&dateTo=${yesterday.toISOString()}&limit=1000`).then(r => r.json()),
      ])
      
      const blocked24h = last24h.events?.filter((e: any) => e.blocked).length ?? 0
      const critical24h = last24h.events?.filter((e: any) => 
        ['SESSION_HIJACKING_ATTEMPT', 'PATH_TRAVERSAL_ATTEMPT', 'UNAUTHORIZED_ACCESS'].includes(e.type)
      ).length ?? 0
      
      const trend = last24h.total - (prev24h.total ?? 0)
      
      setStats({
        total24h: last24h.total ?? 0,
        blocked24h,
        critical24h,
        trend,
      })
    } catch (e) {
      console.error('Failed to load stats:', e)
    }
  }

  const setDatePreset = (preset: '24h' | '7d' | '30d') => {
    const end = new Date()
    const start = new Date()
    if (preset === '24h') start.setHours(start.getHours() - 24)
    else if (preset === '7d') start.setDate(start.getDate() - 7)
    else start.setDate(start.getDate() - 30)
    setDateFrom(start.toISOString().slice(0, 16))
    setDateTo(end.toISOString().slice(0, 16))
    setPage(1)
  }

  const clearDateFilter = () => {
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const loadEvents = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (typeFilter) params.set('type', typeFilter)
      if (ipFilter.trim()) params.set('ip', ipFilter.trim())
      if (pathFilter.trim()) params.set('path', pathFilter.trim())
      if (detailsFilter.trim()) params.set('details', detailsFilter.trim())
      if (blockedFilter === 'true') params.set('blocked', 'true')
      if (blockedFilter === 'false') params.set('blocked', 'false')
      if (dateFrom) params.set('dateFrom', new Date(dateFrom).toISOString())
      if (dateTo) params.set('dateTo', new Date(dateTo).toISOString())
      const res = await fetch(`/api/admin/security/events?${params}`)
      if (!res.ok) {
        if (res.status === 403) {
          router.push('/dashboard/admin')
          toast.error('Доступ только для главного администратора')
          return
        }
        throw new Error('Failed to load security events')
      }
      const data = await res.json()
      setEvents(data.events ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 0)
    } catch (e) {
      console.error(e)
      toast.error('Ошибка загрузки журнала защиты', {
        action: { label: 'Повторить', onClick: () => loadEvents() },
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role !== 'ADMIN') {
          router.push('/dashboard/admin')
        }
      })
      .catch(() => router.push('/login'))
  }, [router])

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr)
    return d.toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
  }

  if (loading && events.length === 0) {
    return (
      <div className="w-full container max-w-7xl py-8 px-4 sm:px-6 mx-auto">
        <div className="h-6 w-48 bg-muted animate-pulse rounded mb-6" />
        
        {/* Stats skeleton */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="h-32 bg-muted animate-pulse rounded-lg" />
          ))}
        </div>
        
        <Card>
          <CardHeader>
            <div className="h-6 w-64 bg-muted animate-pulse rounded" />
            <div className="h-4 w-96 bg-muted animate-pulse rounded mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full container max-w-7xl py-8 px-4 sm:px-6 mx-auto">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Админ панель', href: '/dashboard/admin' },
          { label: 'Защита', current: true },
        ]}
        className="mb-6"
      />

      {/* Статистика */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <Card className="border-l-4 border-l-blue-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                События за 24ч
              </CardTitle>
              <Activity className="h-4 w-4 text-blue-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{stats.total24h}</div>
            <div className="flex items-center text-xs text-muted-foreground mt-1">
              {stats.trend > 0 ? (
                <>
                  <TrendingUp className="h-3 w-3 text-red-500 mr-1" />
                  <span className="text-red-500">+{stats.trend}</span>
                </>
              ) : stats.trend < 0 ? (
                <>
                  <TrendingDown className="h-3 w-3 text-green-500 mr-1" />
                  <span className="text-green-500">{stats.trend}</span>
                </>
              ) : (
                <span>без изменений</span>
              )}
              <span className="ml-1">за предыдущие 24ч</span>
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-green-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Отражено атак
              </CardTitle>
              <ShieldCheck className="h-4 w-4 text-green-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-green-600 dark:text-green-400">
              {stats.blocked24h}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              {stats.total24h > 0 
                ? `${Math.round((stats.blocked24h / stats.total24h) * 100)}% от общего числа`
                : 'Нет событий'
              }
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-red-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Критические
              </CardTitle>
              <AlertTriangle className="h-4 w-4 text-red-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold text-red-600 dark:text-red-400">
              {stats.critical24h}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Hijacking, Path Traversal, Unauth
            </div>
          </CardContent>
        </Card>

        <Card className="border-l-4 border-l-purple-500 hover:shadow-md transition-shadow">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-medium text-muted-foreground">
                Всего записей
              </CardTitle>
              <Shield className="h-4 w-4 text-purple-500" />
            </div>
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{total.toLocaleString()}</div>
            <div className="text-xs text-muted-foreground mt-1">
              в базе данных
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Основная карточка */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Shield className="h-5 w-5" />
                Журнал защиты
              </CardTitle>
              <CardDescription className="mt-1">
                Попытки входа, подозрительный ввод, лимиты и отражённые атаки
              </CardDescription>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters(!showFilters)}
              className="shrink-0"
            >
              {showFilters ? (
                <>
                  <EyeOff className="h-4 w-4 mr-2" />
                  Скрыть фильтры
                </>
              ) : (
                <>
                  <Filter className="h-4 w-4 mr-2" />
                  Показать фильтры
                </>
              )}
            </Button>
          </div>
        </CardHeader>
        
        <CardContent className="space-y-4">
          {/* Фильтры */}
          {showFilters && (
            <div className="space-y-4 pb-4 border-b">
              <div className="flex items-center gap-2 text-muted-foreground text-sm">
                <Filter className="h-4 w-4" />
                <span>Фильтры</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Тип события</label>
                  <Select value={typeFilter || 'all'} onValueChange={(v) => { setTypeFilter(v === 'all' ? '' : v); setPage(1) }}>
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="Все типы" />
                    </SelectTrigger>
                    <SelectContent>
                      {EVENT_TYPES.map((t) => {
                        const Icon = t.icon
                        return (
                          <SelectItem key={t.value || 'all'} value={t.value || 'all'}>
                            <div className="flex items-center gap-2">
                              <Icon className="h-3.5 w-3.5" />
                              {t.label}
                            </div>
                          </SelectItem>
                        )
                      })}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">IP адрес</label>
                  <Input
                    placeholder="192.168.1.1"
                    value={ipFilter}
                    onChange={(e) => setIpFilter(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
                    className="w-full font-mono text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Путь</label>
                  <Input
                    placeholder="/api/auth/login"
                    value={pathFilter}
                    onChange={(e) => setPathFilter(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Детали</label>
                  <Input
                    placeholder="Поиск в описании"
                    value={detailsFilter}
                    onChange={(e) => setDetailsFilter(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && setPage(1)}
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Статус защиты</label>
                  <Select value={blockedFilter || 'all'} onValueChange={(v) => { setBlockedFilter(v === 'all' ? '' : v); setPage(1) }}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все</SelectItem>
                      <SelectItem value="true">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-3.5 w-3.5 text-green-500" />
                          Отражено
                        </div>
                      </SelectItem>
                      <SelectItem value="false">
                        <div className="flex items-center gap-2">
                          <ShieldAlert className="h-3.5 w-3.5 text-red-500" />
                          Не отражено
                        </div>
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Дата с</label>
                  <Input
                    type="datetime-local"
                    value={dateFrom}
                    onChange={(e) => { setDateFrom(e.target.value); setPage(1) }}
                    className="w-full text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-muted-foreground mb-1 block">Дата по</label>
                  <Input
                    type="datetime-local"
                    value={dateTo}
                    onChange={(e) => { setDateTo(e.target.value); setPage(1) }}
                    className="w-full text-sm"
                  />
                </div>
                <div className="flex flex-col justify-end gap-2">
                  <div className="flex gap-1">
                    <Button variant="outline" size="sm" onClick={() => setDatePreset('24h')} title="За последние 24 часа" className="flex-1">
                      24ч
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDatePreset('7d')} title="За 7 дней" className="flex-1">
                      7д
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setDatePreset('30d')} title="За 30 дней" className="flex-1">
                      30д
                    </Button>
                  </div>
                  <Button variant="ghost" size="sm" onClick={clearDateFilter}>
                    Сбросить даты
                  </Button>
                </div>
              </div>
              <div className="flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => loadEvents()}>
                  Обновить
                </Button>
                <Button 
                  variant="outline" 
                  size="sm" 
                  onClick={() => {
                    setTypeFilter('')
                    setIpFilter('')
                    setPathFilter('')
                    setDetailsFilter('')
                    setBlockedFilter('')
                    setDateFrom('')
                    setDateTo('')
                    setPage(1)
                  }}
                >
                  Сбросить все фильтры
                </Button>
              </div>
            </div>
          )}

          {events.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12">
              <Shield className="h-16 w-16 text-muted-foreground/50 mb-4" />
              <p className="text-center text-muted-foreground text-lg font-medium">Нет записей</p>
              <p className="text-center text-muted-foreground text-sm mt-1">
                События безопасности будут отображаться здесь
              </p>
            </div>
          ) : (
            <>
              <div className="rounded-lg border overflow-hidden">
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow className="hover:bg-transparent bg-muted/50">
                        <TableHead className="w-[140px]">
                          <div className="flex items-center gap-1">
                            <Clock className="h-3.5 w-3.5" />
                            Дата и время
                          </div>
                        </TableHead>
                        <TableHead className="w-[180px]">Тип события</TableHead>
                        <TableHead className="min-w-[140px]">
                          <div className="flex items-center gap-1">
                            <MapPin className="h-3.5 w-3.5" />
                            Путь
                          </div>
                        </TableHead>
                        <TableHead className="min-w-[200px] max-w-[300px]">Детали</TableHead>
                        <TableHead className="w-[120px]">IP адрес</TableHead>
                        <TableHead className="w-[140px]">
                          <div className="flex items-center gap-1">
                            <Smartphone className="h-3.5 w-3.5" />
                            User Agent
                          </div>
                        </TableHead>
                        <TableHead className="w-[110px]">Защита</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {events.map((ev: any) => {
                        const Icon = getEventIcon(ev.type)
                        const severityColor = getSeverityColor(ev.type, ev.blocked)
                        
                        return (
                          <TableRow 
                            key={ev.id} 
                            className={cn(
                              "hover:bg-muted/50 transition-colors",
                              !ev.blocked && "bg-red-50/50 dark:bg-red-950/10"
                            )}
                          >
                            <TableCell className="text-sm text-muted-foreground whitespace-nowrap font-mono">
                              {formatDate(ev.createdAt)}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-2">
                                <Icon className={cn("h-4 w-4 shrink-0", severityColor)} />
                                <span className="text-sm font-medium truncate">
                                  {formatEventType(ev.type)}
                                </span>
                              </div>
                            </TableCell>
                            <TableCell className="text-sm">
                              {ev.method && (
                                <Badge variant="outline" className="mr-2 font-mono text-xs">
                                  {ev.method}
                                </Badge>
                              )}
                              <span className="font-mono text-xs">{ev.path ?? '—'}</span>
                            </TableCell>
                            <TableCell className="text-sm max-w-[300px]">
                              <div className="truncate" title={ev.details ?? ''}>
                                {ev.details ?? '—'}
                              </div>
                            </TableCell>
                            <TableCell className="text-sm font-mono text-muted-foreground">
                              {ev.ipAddress ? (
                                <Badge variant="secondary" className="font-mono">
                                  {ev.ipAddress}
                                </Badge>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground max-w-[140px]">
                              <div className="truncate" title={ev.userAgent ?? ''}>
                                {ev.userAgent ? (ev.userAgent.length > 30 ? ev.userAgent.slice(0, 30) + '…' : ev.userAgent) : '—'}
                              </div>
                            </TableCell>
                            <TableCell>
                              {ev.blocked ? (
                                <Badge className="bg-green-600 hover:bg-green-700 gap-1.5">
                                  <ShieldCheck className="h-3 w-3" />
                                  Отражено
                                </Badge>
                              ) : (
                                <Badge variant="destructive" className="gap-1.5">
                                  <ShieldAlert className="h-3 w-3" />
                                  Прошло
                                </Badge>
                              )}
                            </TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                  </Table>
                </div>
              </div>
              {totalPages > 1 && (
                <div className="flex items-center justify-between pt-4 border-t">
                  <p className="text-sm text-muted-foreground">
                    Показано {events.length} из {total.toLocaleString()} записей • Страница {page} из {totalPages}
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page <= 1}
                      onClick={() => setPage((p) => p - 1)}
                    >
                      ← Назад
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={page >= totalPages}
                      onClick={() => setPage((p) => p + 1)}
                    >
                      Вперёд →
                    </Button>
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  )
}