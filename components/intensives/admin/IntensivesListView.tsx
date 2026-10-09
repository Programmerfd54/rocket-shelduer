'use client'

import { Suspense, useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { AlertTriangle, CalendarRange, ChevronRight, Layers, Plus, RefreshCw, SearchX, X } from 'lucide-react'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { PageLoading } from '@/components/common/PageLoading'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { apiFetch, formatTimezone, pluralize } from '@/lib/intensives/ui'
import type { IntensiveSummary } from '@/lib/intensives/types'
import { FeatureGate } from './FeatureGate'
import { useWorkspaceTargets } from './hooks'
import { IntensiveFormDialog } from './IntensiveFormDialog'
import { IntensiveBadges, LoadError, ProgressSummary, daysLabel, errText, overlapText, periodLabel, useDeferredEffect, useSeq } from './kit'

const STATUS_FILTERS = [
  { value: 'active', label: 'Активные', query: 'DRAFT,PUBLISHED' },
  { value: 'DRAFT', label: 'Только черновики', query: 'DRAFT' },
  { value: 'PUBLISHED', label: 'Только опубликованные', query: 'PUBLISHED' },
  { value: 'CANCELLED', label: 'Отменённые', query: 'CANCELLED' },
  { value: 'ARCHIVED', label: 'В архиве', query: 'ARCHIVED' },
  { value: 'all', label: 'Все статусы', query: 'DRAFT,PUBLISHED,CANCELLED,ARCHIVED' },
] as const

const PHASE_FILTERS = [
  { value: 'all', label: 'Любой период' },
  { value: 'upcoming', label: 'Предстоящие' },
  { value: 'running', label: 'Идут сейчас' },
  { value: 'finished', label: 'Завершённые' },
] as const

type Filters = { year: string; workspace: string; status: string; phase: string }
const DEFAULT_FILTERS: Filters = { year: 'all', workspace: 'all', status: 'active', phase: 'all' }

function ListSkeleton() {
  return (
    <div className="space-y-6" role="status" aria-busy="true" aria-label="Загрузка списка интенсивов">
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-40" />
          <div className="divide-y rounded-lg border bg-card">
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-56 max-w-full" />
                  <Skeleton className="h-3 w-72 max-w-full" />
                </div>
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-8 w-full sm:w-56" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function IntensiveRow({ item }: { item: IntensiveSummary }) {
  const href = `/dashboard/admin/intensives/${item.id}`
  const overlaps = item.overlaps ?? []
  return (
    <li className="relative flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <Link
          href={href}
          className="block truncate text-sm font-medium outline-none after:absolute after:inset-0 focus-visible:underline"
        >
          {item.name}
        </Link>
        <p className="text-xs text-muted-foreground">
          {periodLabel(item.startDate, item.endDate)} · {daysLabel(item.day.totalDays)} · {formatTimezone(item.timezone)}
          {item.status === 'PUBLISHED' && item.phase === 'RUNNING' && item.day.dayNumber
            ? ` · День ${item.day.dayNumber} из ${item.day.totalDays}`
            : ''}
        </p>
        {overlaps.length > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
            <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
            <span>
              Пересечение периодов: {overlaps.slice(0, 2).map(overlapText).join('; ')}
              {overlaps.length > 2 ? ` и ещё ${overlaps.length - 2}` : ''}
              {item.status === 'DRAFT' ? '. Публикация заблокирована.' : ''}
            </span>
          </p>
        )}
      </div>
      <div className="flex shrink-0 flex-wrap items-center gap-1.5 sm:w-48">
        <IntensiveBadges status={item.status} phase={item.phase} />
      </div>
      <div className="sm:w-60 sm:shrink-0">
        {item.status === 'DRAFT' ? (
          <p className="text-[13px] text-muted-foreground">
            {item.progress && item.progress.total > 0
              ? `В плане ${item.progress.total} ${pluralize(item.progress.total, 'пункт', 'пункта', 'пунктов')}`
              : 'План не сформирован'}
          </p>
        ) : (
          <ProgressSummary progress={item.progress} partial={item.partial} compact status={item.status} />
        )}
      </div>
      <ChevronRight className="absolute right-3 top-3 size-4 text-muted-foreground sm:static sm:right-auto sm:top-auto" aria-hidden />
    </li>
  )
}

function ListContent() {
  const router = useRouter()
  const params = useSearchParams()
  const { workspaces, error: spacesError, loading: spacesLoading, reload: reloadSpaces } = useWorkspaceTargets()

  const [filters, setFilters] = useState<Filters>(() => ({
    year: params.get('year') ?? DEFAULT_FILTERS.year,
    workspace: params.get('workspace') ?? DEFAULT_FILTERS.workspace,
    status: params.get('status') ?? DEFAULT_FILTERS.status,
    phase: params.get('phase') ?? DEFAULT_FILTERS.phase,
  }))
  const [items, setItems] = useState<IntensiveSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)
  const [createOpen, setCreateOpen] = useState(() => params.get('create') === '1')
  const seq = useSeq()

  const now = new Date().getFullYear()
  const years = useMemo(() => [now - 2, now - 1, now, now + 1, now + 2], [now])

  const load = useCallback(
    async (f: Filters) => {
      const token = seq.begin()
      setFetching(true)
      setError(null)
      const q = new URLSearchParams()
      if (f.year !== 'all') q.set('year', f.year)
      if (f.workspace !== 'all') q.set('workspaceId', f.workspace)
      if (f.phase !== 'all') q.set('phase', f.phase)
      else q.set('status', (STATUS_FILTERS.find((s) => s.value === f.status) ?? STATUS_FILTERS[0]).query)
      try {
        const res = await apiFetch<{ intensives: IntensiveSummary[] }>(`/api/intensives?${q.toString()}`)
        if (!seq.isCurrent(token)) return
        setItems(res.intensives)
      } catch (e) {
        if (!seq.isCurrent(token)) return
        setError(errText(e))
      } finally {
        if (seq.isCurrent(token)) setFetching(false)
      }
    },
    [seq],
  )

  useDeferredEffect(() => {
    void load(filters)
  }, [filters, load])

  const changeFilter = (patch: Partial<Filters>) => {
    const next = { ...filters, ...patch }
    setFilters(next)
    const q = new URLSearchParams()
    for (const k of Object.keys(next) as (keyof Filters)[]) {
      if (next[k] !== DEFAULT_FILTERS[k]) q.set(k, next[k])
    }
    const qs = q.toString()
    window.history.replaceState(null, '', qs ? `?${qs}` : window.location.pathname)
  }

  const filtersChanged = (Object.keys(filters) as (keyof Filters)[]).some((k) => filters[k] !== DEFAULT_FILTERS[k])

  const spaceRefs = useMemo(() => workspaces ?? [], [workspaces])
  /** Название группы — пространства (подключения) Lead_SUP, привязанные к OrgSpace интенсива; иначе имя OrgSpace */
  const groupNameByOrgSpace = useMemo(() => {
    const m = new Map<string, string[]>()
    for (const w of spaceRefs) {
      if (!w.orgSpaceId) continue
      m.set(w.orgSpaceId, [...(m.get(w.orgSpaceId) ?? []), w.name])
    }
    return m
  }, [spaceRefs])

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; name: string; list: IntensiveSummary[] }>()
    for (const it of items ?? []) {
      const names = groupNameByOrgSpace.get(it.orgSpace.id)
      const g = map.get(it.orgSpace.id) ?? { id: it.orgSpace.id, name: names?.join(', ') ?? it.orgSpace.name, list: [] }
      g.list.push(it)
      map.set(it.orgSpace.id, g)
    }
    const arr = Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
    for (const g of arr) g.list.sort((a, b) => b.startDate.localeCompare(a.startDate))
    return arr
  }, [items, groupNameByOrgSpace])

  const noSpaces = !spacesLoading && !spacesError && spaceRefs.length === 0

  return (
    <PageContainer size="default" className="px-4 sm:px-6">
      <PageHeader
        title="Интенсивы"
        description="График интенсивов ваших пространств: период, часовой пояс, план анонсов и прогресс. Создание и публикация ничего не отправляют."
        breadcrumbs={
          <Breadcrumbs items={[{ label: 'Админ панель', href: '/dashboard/admin' }, { label: 'Интенсивы', current: true }]} />
        }
        actions={
          <>
            <Button size="sm" onClick={() => setCreateOpen(true)} disabled={spacesLoading || !!spacesError || noSpaces}>
              <Plus aria-hidden />
              Создать интенсив
            </Button>
          </>
        }
      />

      {spacesError && <LoadError className="mb-4" message={`Список пространств: ${spacesError}`} onRetry={() => void reloadSpaces()} retrying={spacesLoading} />}

      <div className="mb-4 grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" role="group" aria-label="Фильтры интенсивов">
        <Select value={filters.year} onValueChange={(v) => changeFilter({ year: v })}>
          <SelectTrigger size="sm" className="w-full sm:w-36" aria-label="Год">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все годы</SelectItem>
            {years.map((y) => (
              <SelectItem key={y} value={String(y)}>
                {y}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.workspace} onValueChange={(v) => changeFilter({ workspace: v })} disabled={spaceRefs.length === 0 && filters.workspace === 'all'}>
          <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Пространство">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все пространства</SelectItem>
            {spaceRefs.map((o) => (
              <SelectItem key={o.id} value={o.id}>
                {o.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.status} onValueChange={(v) => changeFilter({ status: v })} disabled={filters.phase !== 'all'}>
          <SelectTrigger size="sm" className="w-full sm:w-52" aria-label="Статус" title={filters.phase !== 'all' ? 'При выборе периода показываются только опубликованные' : undefined}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {STATUS_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filters.phase} onValueChange={(v) => changeFilter({ phase: v })}>
          <SelectTrigger size="sm" className="w-full sm:w-44" aria-label="Период">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PHASE_FILTERS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {filtersChanged && (
          <Button type="button" variant="ghost" size="sm" onClick={() => changeFilter({ ...DEFAULT_FILTERS })}>
            <X aria-hidden />
            Сбросить
          </Button>
        )}
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="ml-auto hidden sm:inline-flex"
          aria-label="Обновить список"
          title="Обновить список"
          disabled={fetching}
          onClick={() => void load(filters)}
        >
          <RefreshCw className={cn(fetching && 'animate-spin')} aria-hidden />
        </Button>
      </div>
      {filters.phase !== 'all' && <p className="-mt-2 mb-3 text-xs text-muted-foreground">Фильтр по периоду показывает только опубликованные интенсивы.</p>}

      {items === null && fetching && <ListSkeleton />}

      {error && (
        <LoadError
          className="mb-4"
          message={items ? `${error} Показаны ранее загруженные данные.` : error}
          onRetry={() => void load(filters)}
          retrying={fetching}
        />
      )}

      {items !== null && (
        <div className={cn('transition-opacity', fetching && 'opacity-60')} aria-busy={fetching}>
          {groups.length === 0 ? (
            !error &&
            (filtersChanged ? (
              <EmptyState
                icon={<SearchX />}
                title="Ничего не найдено"
                description="Под выбранные фильтры не подходит ни один интенсив."
                action={{ label: 'Сбросить фильтры', onClick: () => changeFilter({ ...DEFAULT_FILTERS }) }}
              />
            ) : noSpaces ? (
              <EmptyState
                icon={<Layers />}
                title="Сначала добавьте пространство"
                description="Интенсивы создаются в графике пространства (подключения к Rocket.Chat)."
                action={{ label: 'Перейти к пространствам', href: '/dashboard/workspaces' }}
              />
            ) : (
              <EmptyState
                icon={<CalendarRange />}
                title="Интенсивов пока нет"
                description="Создайте черновик, соберите план анонсов из шаблонов и опубликуйте."
                action={{ label: 'Создать интенсив', onClick: () => setCreateOpen(true) }}
              />
            ))
          ) : (
            <div className="space-y-6">
              {groups.map((g) => (
                <section key={g.id} aria-labelledby={`space-${g.id}`}>
                  <div className="mb-2 flex items-center justify-between gap-3">
                    <h2 id={`space-${g.id}`} className="text-sm font-semibold">
                      {g.name} <span className="ml-1 font-normal text-muted-foreground tabular-nums">{g.list.length}</span>
                    </h2>
                  </div>
                  <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                    {g.list.map((it) => (
                      <IntensiveRow key={it.id} item={it} />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          )}
        </div>
      )}

      <p className="mt-8 text-xs text-muted-foreground">
        Дополнительно:{' '}
        <Link href="/dashboard/admin/org-spaces" className="underline-offset-2 hover:text-foreground hover:underline focus-visible:underline">
          организационные пространства
        </Link>{' '}
        — ручная привязка нескольких подключений к одному графику (обычно не нужна: график создаётся автоматически).
      </p>

      <IntensiveFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        mode="create"
        workspaces={spaceRefs}
        siblings={items ?? []}
        onSaved={({ intensive }) => {
          router.push(`/dashboard/admin/intensives/${intensive.id}`)
        }}
      />
    </PageContainer>
  )
}

export function IntensivesListView() {
  return (
    <FeatureGate fallback={<PageLoading variant="list" />}>
      {() => (
        <Suspense fallback={<PageLoading variant="list" />}>
          <ListContent />
        </Suspense>
      )}
    </FeatureGate>
  )
}
