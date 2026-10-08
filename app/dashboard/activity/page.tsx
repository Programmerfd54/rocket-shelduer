"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { History, RefreshCw, SearchX } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { EmptyState } from '@/components/common/EmptyState'
import {
  ActivityFeed,
  ActivityFeedSkeleton,
  ACTIVITY_FILTER_GROUPS,
  ACTIVITY_LABELS,
  type ActivityLogEntry,
} from '@/components/_components/activity'

type Scope = 'me' | 'vol' | 'all'
type Period = 'all' | 'today' | '7d' | '30d'

const PERIOD_OPTIONS: { value: Period; label: string }[] = [
  { value: 'all', label: 'За всё время' },
  { value: 'today', label: 'Сегодня' },
  { value: '7d', label: 'Последние 7 дней' },
  { value: '30d', label: 'Последние 30 дней' },
]

const API_LIMIT = 200

function periodStart(period: Period): number | null {
  const now = new Date()
  if (period === 'today') return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  if (period === '7d') return now.getTime() - 7 * 86400000
  if (period === '30d') return now.getTime() - 30 * 86400000
  return null
}

export default function ActivityPage() {
  const [logs, setLogs] = useState<ActivityLogEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [failed, setFailed] = useState(false)
  const [filterAction, setFilterAction] = useState('all')
  const [period, setPeriod] = useState<Period>('all')
  const [scope, setScope] = useState<Scope>('me')
  const [userRole, setUserRole] = useState<string | null>(null)
  const requestId = useRef(0)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { user?: { role?: string } }) => setUserRole(d?.user?.role ?? null))
      .catch(() => setUserRole(null))
  }, [])

  const loadLogs = useCallback(async () => {
    const id = ++requestId.current
    setLoading(true)
    setFailed(false)
    try {
      const params = new URLSearchParams()
      if (filterAction && filterAction !== 'all') params.set('action', filterAction)
      if (scope === 'vol' && userRole === 'SUP') params.set('scope', 'vol')
      if (scope === 'all' && userRole === 'LEAD_SUP') params.set('scope', 'all')
      const url = `/api/activity${params.toString() ? `?${params}` : ''}`
      const response = await fetch(url)
      if (id !== requestId.current) return
      if (!response.ok) throw new Error('bad status')
      const data = await response.json()
      setLogs(data.logs ?? [])
    } catch {
      if (id !== requestId.current) return
      setFailed(true)
      toast.error('Не удалось загрузить историю', { description: 'Проверьте соединение и нажмите «Обновить».' })
    } finally {
      if (id === requestId.current) setLoading(false)
    }
  }, [filterAction, scope, userRole])

  useEffect(() => {
    loadLogs()
  }, [loadLogs])

  const visibleLogs = useMemo(() => {
    const from = periodStart(period)
    if (from == null) return logs
    return logs.filter((l) => new Date(l.createdAt).getTime() >= from)
  }, [logs, period])

  const counts = useMemo(
    () => ({
      messages: visibleLogs.filter((l) => l.action.startsWith('MESSAGE_')).length,
      workspaces: visibleLogs.filter((l) => l.action.startsWith('WORKSPACE_')).length,
      errors: visibleLogs.filter((l) => l.action === 'MESSAGE_FAILED').length,
    }),
    [visibleLogs],
  )

  const filtersActive = filterAction !== 'all' || period !== 'all'
  const resetFilters = () => {
    setFilterAction('all')
    setPeriod('all')
  }

  const canChooseScope = userRole === 'SUP' || userRole === 'LEAD_SUP'
  const showSkeleton = loading && logs.length === 0

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'История действий', current: true },
            ]}
          />
        }
        title="История действий"
        description="Журнал входов, изменений и отправки сообщений."
        actions={
          <Button variant="outline" size="sm" onClick={loadLogs} disabled={loading}>
            <RefreshCw className={loading ? 'animate-spin' : undefined} aria-hidden />
            Обновить
          </Button>
        }
      />

      {/* Фильтры */}
      <div className="mb-4 flex flex-wrap items-end gap-3">
        {canChooseScope && (
          <div className="space-y-1.5">
            <Label htmlFor="activity-scope" className="text-[13px] font-medium">Чьи события</Label>
            <Select value={scope} onValueChange={(v: Scope) => setScope(v)}>
              <SelectTrigger id="activity-scope" size="sm" className="w-[190px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Только мои</SelectItem>
                {userRole === 'SUP' && <SelectItem value="vol">Волонтёры</SelectItem>}
                {userRole === 'LEAD_SUP' && <SelectItem value="all">Все пользователи</SelectItem>}
              </SelectContent>
            </Select>
          </div>
        )}
        <div className="space-y-1.5">
          <Label htmlFor="activity-type" className="text-[13px] font-medium">Тип события</Label>
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger id="activity-type" size="sm" className="w-[230px]">
              <SelectValue placeholder="Все события" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все события</SelectItem>
              {ACTIVITY_FILTER_GROUPS.map((group) => (
                <SelectGroup key={group.label}>
                  <SelectLabel>{group.label}</SelectLabel>
                  {group.actions.map((a) => (
                    <SelectItem key={a} value={a}>
                      {ACTIVITY_LABELS[a] ?? a}
                    </SelectItem>
                  ))}
                </SelectGroup>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="activity-period" className="text-[13px] font-medium">Период</Label>
          <Select value={period} onValueChange={(v: Period) => setPeriod(v)}>
            <SelectTrigger id="activity-period" size="sm" className="w-[190px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PERIOD_OPTIONS.map((o) => (
                <SelectItem key={o.value} value={o.value}>
                  {o.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {filtersActive && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            Сбросить
          </Button>
        )}
      </div>

      {/* Сводка */}
      {!showSkeleton && !failed && visibleLogs.length > 0 && (
        <p className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-muted-foreground">
          <span>
            Событий: <span className="font-medium text-foreground">{visibleLogs.length}</span>
          </span>
          <span>
            Сообщения: <span className="font-medium text-foreground">{counts.messages}</span>
          </span>
          <span>
            Пространства: <span className="font-medium text-foreground">{counts.workspaces}</span>
          </span>
          {counts.errors > 0 && <Badge variant="danger">Ошибок отправки: {counts.errors}</Badge>}
        </p>
      )}

      {/* Журнал */}
      {showSkeleton ? (
        <ActivityFeedSkeleton />
      ) : failed && logs.length === 0 ? (
        <EmptyState
          icon={<History />}
          title="Не удалось загрузить историю"
          description="Проверьте соединение и попробуйте ещё раз."
          action={{ label: 'Повторить', onClick: loadLogs }}
        />
      ) : visibleLogs.length === 0 ? (
        filtersActive ? (
          <EmptyState
            icon={<SearchX />}
            title="Ничего не найдено"
            description="Нет событий с выбранными фильтрами. Измените тип события или период."
            action={{ label: 'Сбросить фильтры', onClick: resetFilters }}
          />
        ) : (
          <EmptyState
            icon={<History />}
            title="Пока нет событий"
            description="Здесь появятся входы, действия с пространствами и отправленные сообщения."
          />
        )
      ) : (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <ActivityFeed logs={visibleLogs} />
          {logs.length >= API_LIMIT && (
            <p className="mt-3 text-xs text-muted-foreground">
              Показаны последние {API_LIMIT} событий. Чтобы найти более старые, уточните тип события.
            </p>
          )}
        </div>
      )}
    </PageContainer>
  )
}
