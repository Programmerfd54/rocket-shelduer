'use client'

import type { ReactNode } from 'react'
import { ChevronDown, ChevronRight, FileText, SearchX } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'
import { announcementsCount, dayTitle } from './lib'

export function TemplatesSkeleton({ withTabs = true }: { withTabs?: boolean }) {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Загрузка шаблонов">
      {withTabs && <Skeleton className="h-9 w-72 max-w-full" />}
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-32" />
      </div>
      <ListSkeleton />
    </div>
  )
}

export function ListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="divide-y rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка списка">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-4 shrink-0" />
          <Skeleton className="h-4 w-10 shrink-0" />
          <Skeleton className="h-5 w-20 shrink-0" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="ml-auto h-8 w-24 shrink-0" />
        </div>
      ))}
    </div>
  )
}

export function ListEmpty({
  hasItems,
  filtersActive,
  onReset,
  emptyTitle = 'Нет шаблонов',
  emptyDescription = 'Здесь пока ничего нет.',
  children,
}: {
  hasItems: boolean
  filtersActive: boolean
  onReset: () => void
  emptyTitle?: string
  emptyDescription?: string
  children?: ReactNode
}) {
  if (hasItems && filtersActive) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="Ничего не найдено"
        description="Измените запрос или сбросьте фильтры."
        action={{ label: 'Сбросить фильтры', onClick: onReset }}
      />
    )
  }
  return (
    <EmptyState icon={<FileText />} title={emptyTitle} description={emptyDescription}>
      {children}
    </EmptyState>
  )
}

/** Блок группы (день/канал): заголовок со счётчиком и список строк с разделителями. */
export function GroupBlock({
  title,
  count,
  collapsible,
  collapsed,
  onToggle,
  children,
}: {
  title: ReactNode
  count: number
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
  children: ReactNode
}) {
  const headerInner = (
    <>
      {collapsible &&
        (collapsed ? (
          <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ) : (
          <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        ))}
      <span className="min-w-0 truncate text-sm font-medium">{title}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{announcementsCount(count)}</span>
    </>
  )
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      {collapsible && onToggle ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex min-h-10 w-full items-center gap-2 bg-muted/30 px-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/30"
          onClick={onToggle}
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex min-h-10 items-center gap-2 bg-muted/30 px-3">{headerInner}</div>
      )}
      {!collapsed && <div className="divide-y border-t">{children}</div>}
    </section>
  )
}

export function ChannelTag({ channel }: { channel: string }) {
  return (
    <Badge variant="muted" className="max-w-[9rem] font-mono" title={`#${channel}`}>
      <span className="truncate">#{channel}</span>
    </Badge>
  )
}

/** Сегментированный переключатель (аудитория, группировка). */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  ariaLabel,
  className,
}: {
  value: T
  options: readonly (readonly [T, string])[]
  onChange: (v: T) => void
  ariaLabel: string
  className?: string
}) {
  return (
    <div className={cn('flex gap-0.5 rounded-md bg-muted p-[3px]', className)} role="group" aria-label={ariaLabel}>
      {options.map(([v, label]) => (
        <button
          key={v || '_all'}
          type="button"
          aria-pressed={value === v}
          onClick={() => onChange(v)}
          className={cn(
            'h-8 flex-1 rounded-[5px] px-3 text-[13px] font-medium whitespace-nowrap transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
            value === v ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {label}
        </button>
      ))}
    </div>
  )
}

/** Фильтр по дню: «Все дни | День 1 | День 2 | …». */
export function DayChips({ days, value, onChange }: { days: number[]; value: string; onChange: (v: string) => void }) {
  if (days.length === 0) return null
  return (
    <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Фильтр по дню">
      {['_all', ...days.map(String)].map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={cn(
            'h-9 shrink-0 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
            value === d ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
          )}
        >
          {d === '_all' ? 'Все дни' : dayTitle(Number(d))}
        </button>
      ))}
    </div>
  )
}
