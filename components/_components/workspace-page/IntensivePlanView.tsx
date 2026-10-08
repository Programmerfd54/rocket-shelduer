"use client"

import { useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileText, History, ListFilter } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/common/EmptyState'
import { IntensiveHistorySheet } from '@/components/intensives/shared/IntensiveHistorySheet'
import { LoadErrorBlock } from '@/components/intensives/shared/LoadErrorBlock'
import { PlanItemRow, type PlanItemRowHandlers } from '@/components/intensives/shared/PlanItemRow'
import { PlanProgressSummary } from '@/components/intensives/shared/PlanProgressSummary'
import { announcementsText, dayGroupHeading, itemNeedsAttention } from '@/components/intensives/shared/format'
import type { IntensiveSummary, PlanItemDto } from '@/lib/intensives/types'
import { formatYmd } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'

import type { IntensivePlanState } from './useIntensiveContext'

type StateFilter = 'all' | 'not_scheduled' | 'scheduled' | 'attention' | 'sent' | 'failed' | 'skipped'

const STATE_FILTERS: { value: StateFilter; label: string }[] = [
  { value: 'all', label: 'Все состояния' },
  { value: 'not_scheduled', label: 'Не запланировано' },
  { value: 'scheduled', label: 'Запланировано' },
  { value: 'attention', label: 'Требуют внимания' },
  { value: 'sent', label: 'Отправлено' },
  { value: 'failed', label: 'Ошибка' },
  { value: 'skipped', label: 'Пропущено' },
]

function matchesState(item: PlanItemDto, f: StateFilter): boolean {
  switch (f) {
    case 'all':
      return true
    case 'not_scheduled':
      return item.state === 'NOT_SCHEDULED' || item.state === 'CANCELLED'
    case 'scheduled':
      return item.state === 'SCHEDULED' || item.state === 'AWAITING_OVERDUE'
    case 'attention':
      return itemNeedsAttention(item)
    case 'sent':
      return item.state === 'SENT'
    case 'failed':
      return item.state === 'FAILED'
    case 'skipped':
      return item.state === 'SKIPPED'
  }
}

/** Можно ли планировать из плана этого интенсива и почему нет. */
export function planScheduleAvailability(i: Pick<IntensiveSummary, 'status' | 'phase'>): { ok: boolean; reason?: string } {
  if (i.status === 'DRAFT') return { ok: false, reason: 'Черновик: планирование станет доступно после публикации интенсива' }
  if (i.status === 'CANCELLED') return { ok: false, reason: 'Интенсив отменён — планирование недоступно' }
  if (i.status === 'ARCHIVED') return { ok: false, reason: 'Интенсив в архиве — планирование недоступно' }
  if (i.phase === 'FINISHED') return { ok: false, reason: 'Интенсив завершён — планирование недоступно' }
  return { ok: true }
}

type Group = {
  key: string
  heading: string
  meta: string
  isToday?: boolean
  setup?: boolean
  items: PlanItemDto[]
}

/** Скелет по форме плана: шапка + группы дней со строками. */
function PlanSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Загрузка плана">
      <div className="space-y-2">
        <Skeleton className="h-5 w-72 max-w-full" />
        <Skeleton className="h-4 w-96 max-w-full" />
      </div>
      <div className="flex gap-2">
        <Skeleton className="h-9 w-40" />
        <Skeleton className="h-9 w-44" />
      </div>
      {Array.from({ length: 2 }).map((_, g) => (
        <div key={g} className="overflow-hidden rounded-lg border bg-card">
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
            <Skeleton className="h-4 w-56" />
            <Skeleton className="ml-auto h-3 w-32" />
          </div>
          {Array.from({ length: 3 }).map((__, r) => (
            <div key={r} className="flex items-center gap-3 border-b px-3 py-3 last:border-b-0">
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-5 w-20" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-5 w-28 sm:block" />
              <Skeleton className="h-8 w-28" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

/**
 * План анонсов выбранного интенсива (вкладка «Шаблоны»): шапка с прогрессом, фильтры по дню и состоянию,
 * группы «День 1 · Понедельник, 12 октября — 4 анонса · Выполнено 2 из 4», пункты «требуют настройки» отдельно.
 */
export function IntensivePlanView({
  intensive: selected,
  plan,
  handlers,
}: {
  intensive: IntensiveSummary
  plan: IntensivePlanState
  handlers: PlanItemRowHandlers
}) {
  const [dayFilter, setDayFilter] = useState<string>('all')
  const [stateFilter, setStateFilter] = useState<StateFilter>('all')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [historyOpen, setHistoryOpen] = useState(false)

  const data = plan.data && plan.data.intensive.id === selected.id ? plan.data : null
  const intensive = data?.intensive ?? selected
  const availability = planScheduleAvailability(intensive)

  const groups: Group[] = useMemo(() => {
    if (!data) return []
    const setupIds = new Set(data.unscheduledDayItemIds)
    const byDay = new Map<number, PlanItemDto[]>()
    const setup: PlanItemDto[] = []
    for (const item of data.items) {
      if (setupIds.has(item.id) || item.dayNumber == null) setup.push(item)
      else byDay.set(item.dayNumber, [...(byDay.get(item.dayNumber) ?? []), item])
    }
    const out: Group[] = data.days.map((d) => ({
      key: `day:${d.dayNumber}`,
      heading: dayGroupHeading(d.dayNumber, d.date),
      meta: `${announcementsText(d.itemCount)} · Выполнено ${d.completed} из ${d.itemCount}`,
      isToday: d.date === data.intensive.day.today,
      items: byDay.get(d.dayNumber) ?? [],
    }))
    if (setup.length > 0) {
      out.push({
        key: 'setup',
        heading: 'Требуют настройки',
        meta: `${announcementsText(setup.length)} · день вне периода или не указан — дату выберите вручную`,
        setup: true,
        items: setup,
      })
    }
    return out
  }, [data])

  const visibleGroups = groups
    .filter((g) => dayFilter === 'all' || g.key === dayFilter)
    .map((g) => ({ ...g, items: g.items.filter((i) => matchesState(i, stateFilter)) }))
    .filter((g) => g.items.length > 0)

  const itemTitles = useMemo(
    () => Object.fromEntries((data?.items ?? []).map((i) => [i.id, i.title || '(без названия)'])),
    [data],
  )

  const toggle = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const filtersActive = dayFilter !== 'all' || stateFilter !== 'all'

  return (
    <section className="space-y-4" aria-label="План анонсов">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <span className="min-w-0 break-words">План анонсов · {intensive.name}</span>
            {plan.refreshing && <Spinner className="size-3.5 text-muted-foreground" aria-label="Обновление плана" />}
          </h2>
          {data && <PlanProgressSummary progress={data.progress} partial={data.partial} />}
        </div>
        <Button type="button" variant="outline" size="sm" className="self-start" onClick={() => setHistoryOpen(true)}>
          <History aria-hidden />
          История
        </Button>
      </div>

      {!availability.ok && (
        <p className="rounded-md border bg-muted/40 px-3 py-2 text-[13px] text-muted-foreground">
          {availability.reason}. Просмотр плана и истории доступен.
        </p>
      )}

      {plan.loading ? (
        <PlanSkeleton />
      ) : plan.error && !data ? (
        <LoadErrorBlock title="Не удалось загрузить план" message={plan.error} onRetry={() => void plan.reload()} retrying={plan.busy} />
      ) : data && data.items.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title="План пуст"
          description="Руководитель ещё не добавил анонсы в план этого интенсива. Сообщения можно планировать как обычно."
        />
      ) : data ? (
        <>
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Фильтры плана">
            <ListFilter className="hidden size-4 text-muted-foreground sm:block" aria-hidden />
            <Select value={dayFilter} onValueChange={setDayFilter}>
              <SelectTrigger size="sm" className="w-full sm:w-56" aria-label="Фильтр по дню">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все дни</SelectItem>
                {data.days.map((d) => (
                  <SelectItem key={d.dayNumber} value={`day:${d.dayNumber}`}>
                    День {d.dayNumber} · {formatYmd(d.date, false)}
                  </SelectItem>
                ))}
                {groups.some((g) => g.setup) && <SelectItem value="setup">Требуют настройки</SelectItem>}
              </SelectContent>
            </Select>
            <Select value={stateFilter} onValueChange={(v) => setStateFilter(v as StateFilter)}>
              <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Фильтр по состоянию">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STATE_FILTERS.map((f) => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {filtersActive && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDayFilter('all')
                  setStateFilter('all')
                }}
              >
                Сбросить
              </Button>
            )}
          </div>

          {visibleGroups.length === 0 ? (
            <EmptyState
              icon={<ListFilter />}
              title="Нет пунктов по выбранным фильтрам"
              description="Смените день или состояние."
              action={{
                label: 'Сбросить фильтры',
                onClick: () => {
                  setDayFilter('all')
                  setStateFilter('all')
                },
              }}
            />
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              {visibleGroups.map((g) => {
                const isCollapsed = collapsed.has(g.key)
                const bodyId = `plan-group-${g.key.replace(':', '-')}`
                return (
                  <div key={g.key} className="border-b last:border-b-0">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      aria-controls={bodyId}
                      onClick={() => toggle(g.key)}
                      className="flex w-full flex-wrap items-center gap-x-2 gap-y-0.5 border-b bg-muted/40 px-3 py-2 text-left outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60"
                    >
                      {isCollapsed ? (
                        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      ) : (
                        <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      )}
                      <span className="min-w-0 text-sm font-medium">{g.heading}</span>
                      {g.isToday && <Badge variant="outline">Сегодня</Badge>}
                      <span className={cn('basis-full pl-6 text-xs text-muted-foreground sm:ml-auto sm:basis-auto sm:pl-0', 'tabular-nums')}>
                        {g.meta}
                      </span>
                    </button>
                    {!isCollapsed && (
                      <div id={bodyId}>
                        {g.items.map((item) => (
                          <PlanItemRow
                            key={item.id}
                            item={item}
                            timeZone={intensive.timezone}
                            disabled={!data}
                            canSchedule={availability.ok}
                            scheduleBlockedReason={availability.reason}
                            handlers={handlers}
                          />
                        ))}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      ) : null}

      <IntensiveHistorySheet
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        intensive={{ id: intensive.id, name: intensive.name, timezone: intensive.timezone }}
        itemTitles={itemTitles}
      />
    </section>
  )
}
