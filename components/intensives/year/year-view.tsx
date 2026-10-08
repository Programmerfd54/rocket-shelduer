"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarRange, Info, RefreshCw, RotateCcw, TriangleAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { EmptyState } from '@/components/common/EmptyState'
import type { IntensiveSummary } from '@/lib/intensives/types'
import { ApiError, apiFetch, formatYmd } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'
import { IntensivePanelDocked, IntensivePanelSheet, type CalendarTarget } from './intensive-panel'
import { YearMobileList } from './year-mobile-list'
import { YearSkeleton } from './year-skeleton'
import { YearTimeline, focusBar } from './year-timeline'
import { localYmd } from './year-layout'
import { useMediaQuery } from './use-layout'

export type { CalendarTarget }

type PhaseFilter = 'all' | 'upcoming' | 'running' | 'finished'

interface LoadedData {
  key: string
  year: number
  intensives: IntensiveSummary[]
}

interface LoadError {
  /** Запрос (фильтры + номер перезагрузки), на который получена ошибка */
  fetchKey: string
  message: string
  code: string
}

const PHASE_OPTIONS: { value: PhaseFilter; label: string }[] = [
  { value: 'all', label: 'Все фазы' },
  { value: 'upcoming', label: 'Предстоящие' },
  { value: 'running', label: 'Идут' },
  { value: 'finished', label: 'Завершённые' },
]

function Legend({ today, hasToday }: { today: string; hasToday: boolean }) {
  return (
    <ul className="no-print hidden flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground lg:flex" aria-label="Обозначения">
      {hasToday && (
        <li className="inline-flex items-center gap-1.5">
          <span aria-hidden className="inline-block h-3.5 w-px bg-foreground/70" /> Сегодня, {formatYmd(today, false)}
        </li>
      )}
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-5 rounded-sm border-2 border-foreground bg-foreground/15" /> Идёт
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-foreground/60 bg-foreground/10" /> Предстоящий
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-foreground/30 bg-foreground/[0.06]" /> Завершён
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-5 rounded-sm border border-dashed border-foreground/60" /> Черновик
      </li>
      <li className="inline-flex items-center gap-1.5">
        <span aria-hidden className="inline-block h-3 w-5 rounded-sm border bg-muted/60" /> Отменён или в архиве
      </li>
      <li>◂ ▸ — продолжается за границей года</li>
    </ul>
  )
}

/**
 * Годовой вид календаря интенсивов (ТЗ §5): строки — пространства, шкала — 12 месяцев, интенсив — полоса.
 * Тексты сообщений не загружаются; прогресс считает сервер.
 */
export function YearView({
  year,
  canManage,
  onOpenCalendar,
  refreshKey = 0,
}: {
  year: number
  /** Lead_SUP: видит черновики и ссылку «Управление интенсивом» */
  canManage: boolean
  onOpenCalendar: (target: CalendarTarget) => void
  /** Увеличение значения перезагружает данные (кнопка «Обновить» страницы) */
  refreshKey?: number
}) {
  const [orgFilter, setOrgFilter] = useState('all')
  const [phase, setPhase] = useState<PhaseFilter>('all')
  const [showInactive, setShowInactive] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [data, setData] = useState<LoadedData | null>(null)
  const [errorState, setError] = useState<LoadError | null>(null)
  const [settledKey, setSettledKey] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [todayYmd] = useState(() => localYmd(new Date()))
  const seqRef = useRef(0)
  const isDesktop = useMediaQuery('(min-width: 1024px)')

  const statuses = useMemo(() => {
    // Фильтр по фазе относится только к опубликованным
    if (phase !== 'all') return 'PUBLISHED'
    const list = canManage ? ['DRAFT', 'PUBLISHED'] : ['PUBLISHED']
    if (showInactive) list.push('CANCELLED', 'ARCHIVED')
    return list.join(',')
  }, [phase, showInactive, canManage])

  const requestKey = `${year}|${phase}|${statuses}`
  const fetchKey = `${requestKey}|${reload}|${refreshKey}`
  // Ответ на текущий запрос ещё не пришёл → идёт загрузка (старые данные остаются на экране)
  const pending = settledKey !== fetchKey
  const error = errorState && errorState.fetchKey === fetchKey ? errorState : null

  // Загрузка с защитой от «позднего ответа»: учитывается только последний запрос.
  useEffect(() => {
    const seq = ++seqRef.current
    const ctrl = new AbortController()
    const qs = new URLSearchParams({ year: String(year), status: statuses, progress: 'true' })
    if (phase !== 'all') qs.set('phase', phase)
    apiFetch<{ intensives: IntensiveSummary[] }>(`/api/intensives?${qs.toString()}`, { signal: ctrl.signal })
      .then((res) => {
        if (seq !== seqRef.current) return
        setData({ key: requestKey, year, intensives: res.intensives ?? [] })
        setError(null)
        setSettledKey(fetchKey)
      })
      .catch((e: unknown) => {
        if (seq !== seqRef.current || ctrl.signal.aborted) return
        if (e instanceof ApiError) {
          setError({
            fetchKey,
            code: e.code,
            message: e.status >= 500 || !e.message ? 'Не удалось загрузить интенсивы. Попробуйте ещё раз.' : e.message,
          })
        } else {
          setError({ fetchKey, code: 'NETWORK', message: 'Не удалось загрузить интенсивы. Проверьте соединение и повторите.' })
        }
        setSettledKey(fetchKey)
      })
    return () => ctrl.abort()
    // fetchKey однозначно определяет year/phase/statuses/перезагрузку
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fetchKey])

  // Данные показываем только если они не старее текущего набора фильтров или пока грузится новый (без мигания)
  const shown = data
  const shownYear = shown?.year ?? year
  const busy = pending && shown !== null
  const staleOnError = error !== null && shown !== null && shown.key !== requestKey

  const orgOptions = useMemo(() => {
    const map = new Map<string, string>()
    shown?.intensives.forEach((i) => map.set(i.orgSpace.id, i.orgSpace.name))
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [shown])

  const visible = useMemo(
    () => (shown ? shown.intensives.filter((i) => orgFilter === 'all' || i.orgSpace.id === orgFilter) : []),
    [shown, orgFilter]
  )
  const selected = useMemo(() => visible.find((i) => i.id === selectedId) ?? null, [visible, selectedId])

  const hasFilters = orgFilter !== 'all' || phase !== 'all' || showInactive
  const resetFilters = () => {
    setOrgFilter('all')
    setPhase('all')
    setShowInactive(false)
  }

  const select = useCallback((i: IntensiveSummary) => {
    setSelectedId((cur) => (cur === i.id ? null : i.id))
  }, [])
  const closePanel = useCallback(() => {
    if (selectedId && isDesktop) {
      const id = selectedId
      requestAnimationFrame(() => focusBar(id))
    }
    setSelectedId(null)
  }, [selectedId, isDesktop])

  const todayInYear = todayYmd.startsWith(String(shownYear))

  const filters = (
    <div className="no-print space-y-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <Select value={orgFilter} onValueChange={setOrgFilter}>
          <SelectTrigger size="sm" className="w-[200px]" aria-label="Пространство">
            <SelectValue placeholder="Пространство" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все пространства</SelectItem>
            {orgOptions.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
            {orgFilter !== 'all' && !orgOptions.some((o) => o.id === orgFilter) && (
              <SelectItem value={orgFilter}>Выбранное пространство</SelectItem>
            )}
          </SelectContent>
        </Select>
        <Select value={phase} onValueChange={(v) => setPhase(v as PhaseFilter)}>
          <SelectTrigger size="sm" className="w-[160px]" aria-label="Фаза интенсива">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PHASE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="flex min-h-9 items-center gap-2">
          <Checkbox
            id="year-show-inactive"
            checked={showInactive}
            disabled={phase !== 'all'}
            onCheckedChange={(v) => setShowInactive(v === true)}
          />
          <Label htmlFor="year-show-inactive" className={cn('text-[13px] font-normal', phase !== 'all' && 'text-muted-foreground')}>
            Показывать отменённые и архивные
          </Label>
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
            <RotateCcw /> Сбросить
          </Button>
        )}
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
        <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
        <span>
          Показаны интенсивы пространств, к которым у вас есть доступ.
          {canManage ? ' Черновики видны только Lead_SUP.' : ''}
          {phase !== 'all' ? ' С выбранной фазой показываются только опубликованные.' : ''}
        </span>
      </p>
    </div>
  )

  const errorBlock = error && error.code !== 'FEATURE_DISABLED' && (
    <div role="alert" className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-destructive/30 px-3 py-2.5 text-sm">
      <TriangleAlert className="size-4 shrink-0 text-destructive" aria-hidden />
      <span className="min-w-0 flex-1">
        {error.message}
      </span>
      <Button variant="outline" size="sm" onClick={() => setReload((n) => n + 1)} disabled={pending}>
        <RefreshCw className={cn(pending && 'motion-safe:animate-spin')} /> Повторить
      </Button>
    </div>
  )

  let body: React.ReactNode
  if (error?.code === 'FEATURE_DISABLED') {
    body = (
      <EmptyState
        icon={<CalendarRange />}
        title="Интенсивы сейчас недоступны"
        description="Раздел отключён администратором. Календарь сообщений работает как обычно."
      />
    )
  } else if (!shown) {
    body = error ? null : <YearSkeleton />
  } else if (staleOnError) {
    body = null
  } else if (visible.length === 0) {
    body = hasFilters ? (
      <EmptyState
        icon={<CalendarRange />}
        title="По выбранным условиям интенсивов нет"
        description={`Измените фильтры или выберите другой год: сейчас показан ${shownYear} год.`}
        action={{ label: 'Сбросить фильтры', onClick: resetFilters }}
      />
    ) : (
      <EmptyState
        icon={<CalendarRange />}
        title="Интенсивы пока не опубликованы"
        description={`В ${shownYear} году для вас нет опубликованных интенсивов. Попробуйте другой год.`}
        action={canManage ? { label: 'Управление интенсивами', href: '/dashboard/admin/intensives' } : undefined}
      />
    )
  } else {
    body = (
      <div className={cn('grid gap-4', selected && isDesktop && 'lg:grid-cols-[minmax(0,1fr)_340px]')}>
        <div className="min-w-0 space-y-3">
          <div className="hidden lg:block">
            <YearTimeline
              year={shownYear}
              intensives={visible}
              todayYmd={todayYmd}
              selectedId={selected?.id ?? null}
              onSelect={select}
              busy={busy}
            />
          </div>
          <div className="lg:hidden">
            <YearMobileList year={shownYear} intensives={visible} selectedId={selected?.id ?? null} onSelect={select} busy={busy} />
          </div>
          <Legend today={todayYmd} hasToday={todayInYear} />
          <p className="sr-only" aria-live="polite">
            {busy ? 'Обновление данных' : `Показано интенсивов: ${visible.length}`}
          </p>
        </div>
        {selected && isDesktop && (
          <IntensivePanelDocked intensive={selected} canManage={canManage} onOpenCalendar={onOpenCalendar} onClose={closePanel} />
        )}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {filters}
      {errorBlock}
      {body}
      {!isDesktop && (
        <IntensivePanelSheet intensive={selected} canManage={canManage} onOpenCalendar={onOpenCalendar} onClose={closePanel} />
      )}
    </div>
  )
}
