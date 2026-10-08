'use client'

import { useState, useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from 'next/navigation'
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
import { Field } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
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
  SlidersHorizontal,
  AlertTriangle,
  Lock,
  UserX,
  FileWarning,
  Ban,
  Activity,
  Eye,
  ChevronLeft,
  ChevronRight,
  RefreshCw,
  X,
} from 'lucide-react'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/roles'

const EVENT_TYPES = [
  { value: '', label: 'Все типы', icon: Shield },
  { value: 'LOGIN_FAILED', label: 'Неудачный вход', icon: Lock },
  { value: 'LOGIN_RATE_LIMIT', label: 'Лимит попыток входа', icon: Ban },
  { value: 'AUTH_RATE_LIMIT', label: 'Лимит запросов авторизации', icon: Activity },
  { value: 'INVALID_TOKEN', label: 'Недействительный токен', icon: ShieldAlert },
  { value: 'UNAUTHORIZED_ACCESS', label: 'Несанкционированный доступ', icon: AlertTriangle },
  { value: 'SUSPICIOUS_INPUT', label: 'Подозрительный ввод', icon: Eye },
  { value: 'REGISTER_FAILED', label: 'Ошибка регистрации', icon: UserX },
  { value: 'WORKSPACE_AUTH_FAILED', label: 'Ошибка подключения', icon: ShieldAlert },
  { value: 'PATH_TRAVERSAL_ATTEMPT', label: 'Попытка обхода пути', icon: FileWarning },
  { value: 'BLOCKED_USER_LOGIN', label: 'Вход заблокированного', icon: UserX },
  { value: 'SESSION_HIJACKING_ATTEMPT', label: 'Попытка кражи сессии', icon: AlertTriangle },
]

const CRITICAL_TYPES = ['SESSION_HIJACKING_ATTEMPT', 'PATH_TRAVERSAL_ATTEMPT', 'UNAUTHORIZED_ACCESS']

function getEventIcon(type: string) {
  const found = EVENT_TYPES.find((t) => t.value === type)
  return found?.icon ?? Shield
}

function formatEventType(type: string): string {
  const found = EVENT_TYPES.find((t) => t.value === type)
  return found?.label ?? type
}

function getSeverityColor(type: string, blocked: boolean): string {
  if (!blocked) return 'text-red-600 dark:text-red-400'

  const high = ['LOGIN_FAILED', 'INVALID_TOKEN', 'BLOCKED_USER_LOGIN']
  const medium = ['SUSPICIOUS_INPUT', 'AUTH_RATE_LIMIT', 'LOGIN_RATE_LIMIT']

  if (CRITICAL_TYPES.includes(type)) return 'text-red-600 dark:text-red-400'
  if (high.includes(type)) return 'text-amber-600 dark:text-amber-400'
  if (medium.includes(type)) return 'text-yellow-600 dark:text-yellow-400'
  return 'text-muted-foreground'
}

/** Значение для input[type=datetime-local] в локальном времени. */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function useDebounced<T>(value: T, delay = 350): T {
  const [v, setV] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return v
}

function Stat({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-1 bg-card p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-2xl font-semibold tabular-nums leading-tight">{children}</div>
      {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

type SecurityEvent = {
  id: string
  type: string
  blocked: boolean
  createdAt: string
  method?: string | null
  path?: string | null
  details?: string | null
  ipAddress?: string | null
  userAgent?: string | null
}

export default function AdminSecurityPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [events, setEvents] = useState<SecurityEvent[]>([])
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
  const requestId = useRef(0)

  const debIp = useDebounced(ipFilter)
  const debPath = useDebounced(pathFilter)
  const debDetails = useDebounced(detailsFilter)

  // Статистика
  const [statsLoading, setStatsLoading] = useState(true)
  const [stats, setStats] = useState({
    total24h: 0,
    blocked24h: 0,
    critical24h: 0,
    trend: 0,
  })

  const dateError =
    dateFrom && dateTo && new Date(dateFrom).getTime() > new Date(dateTo).getTime()
      ? 'Начало периода позже конца'
      : ''

  useEffect(() => {
    loadEvents()
  }, [page, typeFilter, debIp, debPath, debDetails, blockedFilter, dateFrom, dateTo])

  useEffect(() => {
    loadStats()
  }, [])

  const loadStats = async () => {
    try {
      setStatsLoading(true)
      const now = new Date()
      const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000)
      const twoDaysAgo = new Date(now.getTime() - 48 * 60 * 60 * 1000)

      const [last24h, prev24h] = await Promise.all([
        fetch(`/api/admin/security/events?dateFrom=${yesterday.toISOString()}&limit=1000`).then(r => r.json()),
        fetch(`/api/admin/security/events?dateFrom=${twoDaysAgo.toISOString()}&dateTo=${yesterday.toISOString()}&limit=1000`).then(r => r.json()),
      ])

      const blocked24h = last24h.events?.filter((e: SecurityEvent) => e.blocked).length ?? 0
      const critical24h = last24h.events?.filter((e: SecurityEvent) => CRITICAL_TYPES.includes(e.type)).length ?? 0

      const trend = last24h.total - (prev24h.total ?? 0)

      setStats({
        total24h: last24h.total ?? 0,
        blocked24h,
        critical24h,
        trend,
      })
    } catch (e) {
      console.error('Failed to load stats:', e)
    } finally {
      setStatsLoading(false)
    }
  }

  const setDatePreset = (preset: '24h' | '7d' | '30d') => {
    const end = new Date()
    const start = new Date()
    if (preset === '24h') start.setHours(start.getHours() - 24)
    else if (preset === '7d') start.setDate(start.getDate() - 7)
    else start.setDate(start.getDate() - 30)
    setDateFrom(toLocalInput(start))
    setDateTo(toLocalInput(end))
    setPage(1)
  }

  const clearDateFilter = () => {
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const resetAllFilters = () => {
    setTypeFilter('')
    setIpFilter('')
    setPathFilter('')
    setDetailsFilter('')
    setBlockedFilter('')
    setDateFrom('')
    setDateTo('')
    setPage(1)
  }

  const loadEvents = async () => {
    if (dateError) return
    const myId = ++requestId.current
    try {
      setLoading(true)
      setLoadError(false)
      const params = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (typeFilter) params.set('type', typeFilter)
      if (debIp.trim()) params.set('ip', debIp.trim())
      if (debPath.trim()) params.set('path', debPath.trim())
      if (debDetails.trim()) params.set('details', debDetails.trim())
      if (blockedFilter === 'true') params.set('blocked', 'true')
      if (blockedFilter === 'false') params.set('blocked', 'false')
      if (dateFrom) params.set('dateFrom', new Date(dateFrom).toISOString())
      if (dateTo) params.set('dateTo', new Date(dateTo).toISOString())
      const res = await fetch(`/api/admin/security/events?${params}`)
      if (myId !== requestId.current) return
      if (!res.ok) {
        if (res.status === 403) {
          router.push('/dashboard/admin')
          toast.error(`Доступ только для ${ROLE_LABELS.LEAD_SUP}`)
          return
        }
        throw new Error('Failed to load security events')
      }
      const data = await res.json()
      if (myId !== requestId.current) return
      setEvents(data.events ?? [])
      setTotal(data.total ?? 0)
      setTotalPages(data.totalPages ?? 0)
    } catch (e) {
      if (myId !== requestId.current) return
      console.error(e)
      setLoadError(true)
      toast.error('Не удалось загрузить журнал защиты. Проверьте соединение и повторите.', {
        action: { label: 'Повторить', onClick: () => loadEvents() },
      })
    } finally {
      if (myId === requestId.current) setLoading(false)
    }
  }

  const refreshAll = async () => {
    await Promise.all([loadEvents(), loadStats()])
    toast.success('Данные обновлены')
  }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role !== 'LEAD_SUP') {
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

  const extraActive = [pathFilter, detailsFilter, dateFrom, dateTo].filter((v) => v.trim()).length
  const anyFilter =
    !!typeFilter || !!blockedFilter || !!ipFilter.trim() || extraActive > 0
  const firstLoad = loading && events.length === 0 && !loadError

  return (
    <PageContainer size="wide">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Защита', current: true },
            ]}
          />
        }
        title="Защита"
        description="Попытки входа, подозрительный ввод, лимиты запросов и отражённые атаки."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={refreshAll}
            disabled={loading || statsLoading}
            aria-label="Обновить журнал защиты"
          >
            <RefreshCw className={cn('size-4', (loading || statsLoading) && 'animate-spin')} />
            Обновить
          </Button>
        }
      />

      {/* Статистика */}
      <div className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-4">
        {statsLoading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="space-y-2 bg-card p-4">
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-7 w-14" />
              <Skeleton className="h-3 w-32" />
            </div>
          ))
        ) : (
          <>
            <Stat
              label="События за 24 часа"
              hint={
                stats.trend > 0 ? (
                  <span>
                    <span className="text-red-600 dark:text-red-400">+{stats.trend}</span> к предыдущим 24 часам
                  </span>
                ) : stats.trend < 0 ? (
                  <span>
                    <span className="text-emerald-600 dark:text-emerald-400">{stats.trend}</span> к предыдущим 24 часам
                  </span>
                ) : (
                  'Без изменений за предыдущие 24 часа'
                )
              }
            >
              {stats.total24h}
            </Stat>
            <Stat
              label="Отражено атак"
              hint={
                stats.total24h > 0
                  ? `${Math.round((stats.blocked24h / stats.total24h) * 100)}% от всех событий`
                  : 'Нет событий'
              }
            >
              {stats.blocked24h}
            </Stat>
            <Stat label="Критические" hint="Кража сессии, обход пути, несанкц. доступ">
              <span className={stats.critical24h > 0 ? 'text-red-600 dark:text-red-400' : undefined}>
                {stats.critical24h}
              </span>
            </Stat>
            <Stat label={anyFilter ? 'Найдено по фильтрам' : 'Всего записей'} hint="в журнале">
              {total.toLocaleString('ru-RU')}
            </Stat>
          </>
        )}
      </div>

      {/* Фильтры */}
      <div className="mb-3 space-y-3">
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Тип события" htmlFor="sec-type" className="w-full sm:w-64">
            <Select
              value={typeFilter || 'all'}
              onValueChange={(v) => {
                setTypeFilter(v === 'all' ? '' : v)
                setPage(1)
              }}
            >
              <SelectTrigger id="sec-type" size="sm" className="w-full">
                <SelectValue placeholder="Все типы" />
              </SelectTrigger>
              <SelectContent>
                {EVENT_TYPES.map((t) => {
                  const Icon = t.icon
                  return (
                    <SelectItem key={t.value || 'all'} value={t.value || 'all'}>
                      <span className="flex items-center gap-2">
                        <Icon className="size-3.5" />
                        {t.label}
                      </span>
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Статус защиты" htmlFor="sec-blocked" className="w-full sm:w-44">
            <Select
              value={blockedFilter || 'all'}
              onValueChange={(v) => {
                setBlockedFilter(v === 'all' ? '' : v)
                setPage(1)
              }}
            >
              <SelectTrigger id="sec-blocked" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все</SelectItem>
                <SelectItem value="true">Отражено</SelectItem>
                <SelectItem value="false">Прошло</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="IP-адрес" htmlFor="sec-ip" className="w-full sm:w-44">
            <Input
              id="sec-ip"
              placeholder="192.168.1.1"
              value={ipFilter}
              onChange={(e) => {
                setIpFilter(e.target.value)
                setPage(1)
              }}
              className="h-8 w-full font-mono text-[13px]"
            />
          </Field>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setShowFilters((v) => !v)}
              aria-expanded={showFilters}
              aria-controls="sec-extra-filters"
            >
              <SlidersHorizontal className="size-4" />
              Ещё фильтры
              {extraActive > 0 && (
                <Badge variant="muted" className="ml-0.5 px-1">
                  {extraActive}
                </Badge>
              )}
            </Button>
            {anyFilter && (
              <Button variant="ghost" size="sm" onClick={resetAllFilters}>
                <X className="size-4" />
                Сбросить
              </Button>
            )}
          </div>
        </div>

        {showFilters && (
          <div
            id="sec-extra-filters"
            className="grid grid-cols-1 gap-3 rounded-lg border bg-card p-3 sm:grid-cols-2 lg:grid-cols-4"
          >
            <Field label="Путь" htmlFor="sec-path">
              <Input
                id="sec-path"
                placeholder="/api/auth/login"
                value={pathFilter}
                onChange={(e) => {
                  setPathFilter(e.target.value)
                  setPage(1)
                }}
                className="h-8 w-full font-mono text-[13px]"
              />
            </Field>
            <Field label="Текст в деталях" htmlFor="sec-details">
              <Input
                id="sec-details"
                placeholder="Поиск в описании"
                value={detailsFilter}
                onChange={(e) => {
                  setDetailsFilter(e.target.value)
                  setPage(1)
                }}
                className="h-8 w-full text-[13px]"
              />
            </Field>
            <Field label="Период с" htmlFor="sec-from" error={dateError || undefined}>
              <Input
                id="sec-from"
                type="datetime-local"
                value={dateFrom}
                aria-invalid={!!dateError}
                onChange={(e) => {
                  setDateFrom(e.target.value)
                  setPage(1)
                }}
                className="h-8 w-full text-[13px]"
              />
            </Field>
            <Field label="Период по" htmlFor="sec-to">
              <Input
                id="sec-to"
                type="datetime-local"
                value={dateTo}
                aria-invalid={!!dateError}
                onChange={(e) => {
                  setDateTo(e.target.value)
                  setPage(1)
                }}
                className="h-8 w-full text-[13px]"
              />
            </Field>
            <div className="flex flex-wrap items-center gap-1.5 sm:col-span-2 lg:col-span-4">
              <span className="mr-1 text-xs text-muted-foreground">Быстрый выбор:</span>
              <Button variant="outline" size="sm" onClick={() => setDatePreset('24h')} title="За последние 24 часа">
                24 ч
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDatePreset('7d')} title="За 7 дней">
                7 дн
              </Button>
              <Button variant="outline" size="sm" onClick={() => setDatePreset('30d')} title="За 30 дней">
                30 дн
              </Button>
              {(dateFrom || dateTo) && (
                <Button variant="ghost" size="sm" onClick={clearDateFilter}>
                  Сбросить даты
                </Button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Журнал */}
      {firstLoad ? (
        <div
          className="divide-y rounded-lg border bg-card"
          role="status"
          aria-busy="true"
          aria-label="Загрузка журнала"
        >
          <div className="flex gap-4 bg-muted/40 px-4 py-2.5">
            {Array.from({ length: 5 }).map((_, i) => (
              <Skeleton key={i} className="h-3 w-20" />
            ))}
          </div>
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-32 shrink-0" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="hidden h-4 w-48 sm:block" />
              <Skeleton className="ml-auto h-5 w-16" />
            </div>
          ))}
        </div>
      ) : events.length === 0 ? (
        loadError ? (
          <EmptyState
            icon={<Shield />}
            title="Не удалось загрузить журнал"
            description="Проверьте соединение и попробуйте ещё раз."
            action={{ label: 'Повторить', onClick: () => loadEvents() }}
          />
        ) : anyFilter ? (
          <EmptyState
            icon={<Shield />}
            title="Ничего не найдено"
            description="Измените или сбросьте фильтры."
            action={{ label: 'Сбросить фильтры', onClick: resetAllFilters }}
          />
        ) : (
          <EmptyState
            icon={<ShieldCheck />}
            title="Событий безопасности нет"
            description="Здесь появятся неудачные входы, лимиты запросов и отражённые атаки."
          />
        )
      ) : (
        <div
          className={cn('overflow-hidden rounded-lg border bg-card transition-opacity', loading && 'opacity-60')}
          aria-busy={loading}
        >
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/40 hover:bg-muted/40">
                <TableHead className="w-[150px]">Дата и время</TableHead>
                <TableHead className="w-[210px]">Тип события</TableHead>
                <TableHead className="min-w-[160px]">Путь</TableHead>
                <TableHead className="min-w-[200px]">Детали</TableHead>
                <TableHead className="w-[130px]">IP-адрес</TableHead>
                <TableHead className="w-[140px]">User-Agent</TableHead>
                <TableHead className="w-[110px]">Защита</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {events.map((ev) => {
                const Icon = getEventIcon(ev.type)
                const severityColor = getSeverityColor(ev.type, ev.blocked)

                return (
                  <TableRow key={ev.id} className="hover:bg-muted/40">
                    <TableCell className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                      {formatDate(ev.createdAt)}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <Icon className={cn('size-4 shrink-0', severityColor)} />
                        <span className="text-sm">{formatEventType(ev.type)}</span>
                      </div>
                    </TableCell>
                    <TableCell className="text-sm">
                      {ev.method && (
                        <Badge variant="muted" className="mr-2 font-mono">
                          {ev.method}
                        </Badge>
                      )}
                      <span className="font-mono text-xs">{ev.path ?? '—'}</span>
                    </TableCell>
                    <TableCell className="max-w-[300px] text-sm">
                      <div className="truncate" title={ev.details ?? ''}>
                        {ev.details ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">
                      {ev.ipAddress ?? '—'}
                    </TableCell>
                    <TableCell className="max-w-[140px] text-xs text-muted-foreground">
                      <div className="truncate" title={ev.userAgent ?? ''}>
                        {ev.userAgent ?? '—'}
                      </div>
                    </TableCell>
                    <TableCell>
                      {ev.blocked ? (
                        <Badge variant="success">Отражено</Badge>
                      ) : (
                        <Badge variant="danger">Прошло</Badge>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
          {totalPages > 1 && (
            <div className="flex flex-col gap-2 border-t px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Показано {events.length} из {total.toLocaleString('ru-RU')} · страница {page} из {totalPages}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                  Назад
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Вперёд
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
