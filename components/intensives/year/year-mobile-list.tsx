"use client"

import type { IntensiveSummary } from '@/lib/intensives/types'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { MONTHS_NOM, formatTimezone } from '@/lib/intensives/ui'
import { groupByStartMonth } from './year-layout'
import { dayLine, formatPeriod, intensiveView, progressShort } from './year-meta'

function Row({
  item,
  selected,
  onSelect,
}: {
  item: IntensiveSummary
  selected: boolean
  onSelect: (i: IntensiveSummary) => void
}) {
  const view = intensiveView(item)
  const Icon = view.Icon
  const short = progressShort(item.progress)
  const muted = view.kind === 'cancelled' || view.kind === 'archived' || view.kind === 'finished'
  return (
    <button
      type="button"
      data-row-id={item.id}
      aria-pressed={selected}
      onClick={() => onSelect(item)}
      className={cn(
        'flex min-h-14 w-full items-start gap-3 border-b px-3 py-2.5 text-left outline-none',
        'hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring',
        'motion-safe:transition-colors',
        selected && 'bg-muted/60'
      )}
    >
      <Icon className={cn('mt-0.5 size-4 shrink-0', muted ? 'text-muted-foreground' : 'text-foreground')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-start justify-between gap-2">
          <span
            className={cn(
              'min-w-0 text-sm font-medium leading-snug',
              muted && 'text-muted-foreground',
              view.kind === 'cancelled' && 'line-through'
            )}
          >
            {item.name}
          </span>
          <Badge
            variant={view.kind === 'running' ? 'info' : 'muted'}
            className={cn(view.kind === 'draft' && 'border-dashed border-foreground/40', view.kind === 'running' && 'ring-1 ring-sky-500/40')}
          >
            {view.label}
          </Badge>
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {item.orgSpace.name} · {formatPeriod(item.startDate, item.endDate)}
        </span>
        <span className="mt-0.5 block text-xs text-muted-foreground">
          {dayLine(item)} · {formatTimezone(item.timezone)}
          {short && item.status === 'PUBLISHED' ? ` · выполнено ${short}` : ''}
        </span>
      </span>
    </button>
  )
}

/** Мобильный вид: список интенсивов, сгруппированный по месяцу начала, с липкими заголовками. */
export function YearMobileList({
  year,
  intensives,
  selectedId,
  onSelect,
  busy,
}: {
  year: number
  intensives: IntensiveSummary[]
  selectedId: string | null
  onSelect: (i: IntensiveSummary) => void
  busy: boolean
}) {
  const groups = groupByStartMonth(intensives, year)
  return (
    <div
      className={cn('overflow-hidden rounded-lg border bg-card motion-safe:transition-opacity', busy && 'opacity-60')}
      aria-busy={busy}
    >
      {groups.map((g) => (
        <section key={String(g.key)} aria-label={g.key === 'prev' ? 'Начались в прошлом году' : MONTHS_NOM[g.key]}>
          <h3 className="sticky top-0 z-10 border-b bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {g.key === 'prev' ? `Начались до ${year} года` : `${MONTHS_NOM[g.key]} ${year}`}
          </h3>
          {g.items.map((it) => (
            <Row key={it.id} item={it} selected={it.id === selectedId} onSelect={onSelect} />
          ))}
        </section>
      ))}
    </div>
  )
}
