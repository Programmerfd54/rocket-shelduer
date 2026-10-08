"use client"

import { useMemo } from 'react'
import type { IntensiveSummary } from '@/lib/intensives/types'
import { cn } from '@/lib/utils'
import {
  BAR_H,
  LANE_H,
  MONTH_HEADERS,
  ROW_PAD,
  clipToYear,
  computeGeometry,
  dayIndexInYear,
  daysInYear,
  formatRangeShort,
  groupByOrgSpace,
  monthSpans,
  packLanes,
  rowHeight,
  type BarGeometry,
  type ClippedSpan,
  type OrgRow,
} from './year-layout'
import { barAriaLabel, intensiveView, progressShort, type BarKind, type IntensiveView } from './year-meta'
import { useElementWidth } from './use-layout'

const LABEL_COL = 168
const DEFAULT_TRACK = 780

/** Возвращает фокус на полосу (после закрытия панели). */
export function focusBar(id: string) {
  if (typeof document === 'undefined') return
  const el = document.querySelector<HTMLElement>(`[data-bar-id="${CSS.escape(id)}"]`)
  el?.focus()
}

const BAR_STYLE: Record<BarKind, string> = {
  running: 'border-2 border-foreground bg-foreground/15',
  upcoming: 'border border-foreground/60 bg-foreground/10',
  finished: 'border border-foreground/30 bg-foreground/[0.06]',
  draft: 'border border-dashed border-foreground/60 bg-transparent',
  cancelled: 'border border-border bg-muted/60',
  archived: 'border border-border/70 bg-muted/40',
}

const TEXT_STYLE: Record<BarKind, string> = {
  running: 'text-foreground',
  upcoming: 'text-foreground',
  finished: 'text-muted-foreground',
  draft: 'text-foreground',
  cancelled: 'text-muted-foreground',
  archived: 'text-muted-foreground',
}

interface PlacedBar {
  item: IntensiveSummary
  view: IntensiveView
  span: ClippedSpan
  geom: BarGeometry
  lane: number
  nameText: string
  dates: string
}

interface PlacedRow {
  row: OrgRow
  bars: PlacedBar[]
  height: number
}

function BarLabel({ bar }: { bar: PlacedBar }) {
  const { view, span, nameText, dates } = bar
  const Icon = view.Icon
  return (
    <span className={cn('flex min-w-0 items-center gap-1.5', TEXT_STYLE[view.kind])}>
      <Icon className="size-3.5 shrink-0" aria-hidden />
      <span className="min-w-0 truncate">
        <span className={cn('font-medium', view.kind === 'cancelled' && 'line-through')}>
          {span.continuesFromPrev ? '◂ ' : ''}
          {nameText}
        </span>{' '}
        <span className="text-muted-foreground">
          {dates}
          {span.continuesToNext ? ' ▸' : ''}
        </span>
      </span>
    </span>
  )
}

function Bar({
  bar,
  selected,
  onSelect,
}: {
  bar: PlacedBar
  selected: boolean
  onSelect: (i: IntensiveSummary) => void
}) {
  const { item, view, geom, span, lane } = bar
  const footW = geom.footRight - geom.footLeft
  const progress = item.progress
  const fillPct =
    item.status === 'PUBLISHED' && progress && progress.total > 0
      ? Math.round((progress.completed / progress.total) * 100)
      : 0
  const short = progressShort(progress)
  const barShape = cn(
    'rounded-md',
    span.continuesFromPrev && 'rounded-l-none border-l-0',
    span.continuesToNext && 'rounded-r-none border-r-0'
  )
  const barEl = (
    <span
      aria-hidden
      className={cn(
        'block overflow-hidden',
        geom.labelMode === 'inside' ? 'absolute inset-0' : 'relative h-full shrink-0',
        BAR_STYLE[view.kind],
        barShape
      )}
      style={geom.labelMode === 'inside' ? undefined : { width: geom.barWidth }}
    >
      {fillPct > 0 && <span className="absolute inset-y-0 left-0 bg-foreground/20" style={{ width: `${fillPct}%` }} />}
    </span>
  )
  const title = `${item.name} · ${formatRangeShort(item.startDate, item.endDate)} · ${view.label}${short && item.status === 'PUBLISHED' ? ` · выполнено ${short}` : ''}`

  return (
    <button
      type="button"
      data-bar-id={item.id}
      aria-label={barAriaLabel(item, view)}
      aria-pressed={selected}
      title={title}
      onClick={() => onSelect(item)}
      className={cn(
        'absolute flex items-center rounded-md text-left text-xs outline-none',
        'focus-visible:ring-2 focus-visible:ring-ring motion-safe:transition-colors',
        geom.labelMode === 'inside' ? 'hover:ring-1 hover:ring-foreground/30' : 'gap-2 hover:bg-muted/60',
        selected && geom.labelMode !== 'inside' && 'bg-muted ring-1 ring-foreground/30',
        selected && geom.labelMode === 'inside' && 'ring-2 ring-foreground/40'
      )}
      style={{ left: geom.footLeft, width: footW, top: ROW_PAD + lane * LANE_H, height: BAR_H }}
    >
      {geom.labelMode === 'inside' && (
        <>
          {barEl}
          <span className="pointer-events-none absolute inset-0 flex items-center px-2">
            <BarLabel bar={bar} />
          </span>
        </>
      )}
      {geom.labelMode === 'right' && (
        <>
          {barEl}
          <span className="min-w-0 flex-1 pr-1">
            <BarLabel bar={bar} />
          </span>
        </>
      )}
      {geom.labelMode === 'left' && (
        <>
          <span className="min-w-0 flex-1 pl-1">
            <BarLabel bar={bar} />
          </span>
          {barEl}
        </>
      )}
    </button>
  )
}

export function YearTimeline({
  year,
  intensives,
  todayYmd,
  selectedId,
  onSelect,
  busy,
}: {
  year: number
  intensives: IntensiveSummary[]
  todayYmd: string
  selectedId: string | null
  onSelect: (i: IntensiveSummary) => void
  busy: boolean
}) {
  const [trackRef, measured] = useElementWidth<HTMLDivElement>()
  const trackW = measured > 0 ? measured : DEFAULT_TRACK
  const n = daysInYear(year)
  const months = useMemo(() => monthSpans(year), [year])

  const placed: PlacedRow[] = useMemo(() => {
    return groupByOrgSpace(intensives).map((row) => {
      const inputs = row.items.flatMap((item) => {
        const span = clipToYear(item.startDate, item.endDate, year)
        if (!span) return []
        const dates = formatRangeShort(item.startDate, item.endDate)
        return [{ item, span, dates, geom: computeGeometry({ id: item.id, name: item.name, dates, span }, year, trackW) }]
      })
      const { lanes, laneCount } = packLanes(inputs.map((i) => i.geom))
      const bars: PlacedBar[] = inputs.map((i) => ({
        item: i.item,
        view: intensiveView(i.item),
        span: i.span,
        geom: i.geom,
        lane: lanes.get(i.item.id) ?? 0,
        nameText: i.item.name,
        dates: i.dates,
      }))
      return { row, bars, height: rowHeight(laneCount) }
    })
  }, [intensives, year, trackW])

  const todayIdx = dayIndexInYear(todayYmd, year)
  const todayPct = todayIdx >= 0 && todayIdx < n ? ((todayIdx + 0.5) / n) * 100 : null

  // Навигация стрелками: ←/→ в строке, ↑/↓ — к ближайшей по дате в соседней строке
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    const id = (e.target as HTMLElement).closest<HTMLElement>('[data-bar-id]')?.dataset.barId
    if (!id) return
    const rIdx = placed.findIndex((r) => r.bars.some((b) => b.item.id === id))
    if (rIdx < 0) return
    const bars = placed[rIdx].bars
    const bIdx = bars.findIndex((b) => b.item.id === id)
    let target: string | undefined
    if (e.key === 'ArrowRight') target = bars[bIdx + 1]?.item.id
    else if (e.key === 'ArrowLeft') target = bars[bIdx - 1]?.item.id
    else {
      const other = placed[rIdx + (e.key === 'ArrowDown' ? 1 : -1)]
      if (other && other.bars.length) {
        const cur = bars[bIdx].span.startIdx
        target = other.bars.reduce((best, b) =>
          Math.abs(b.span.startIdx - cur) < Math.abs(best.span.startIdx - cur) ? b : best
        ).item.id
      }
    }
    if (target) {
      e.preventDefault()
      focusBar(target)
    }
  }

  return (
    <div
      className={cn('overflow-x-auto rounded-lg border bg-card motion-safe:transition-opacity', busy && 'opacity-60')}
      aria-busy={busy}
    >
      <div className="min-w-[900px]" onKeyDown={onKeyDown}>
        {/* Шапка: месяцы */}
        <div className="flex border-b bg-muted/40">
          <div
            className="sticky left-0 z-20 flex shrink-0 items-center border-r bg-muted px-3 text-xs font-medium text-muted-foreground"
            style={{ width: LABEL_COL, height: 36 }}
          >
            Пространство
          </div>
          <div ref={trackRef} className="relative h-9 flex-1" aria-hidden>
            {months.map((m) => (
              <div
                key={m.month}
                className={cn(
                  'absolute inset-y-0 flex items-center px-2 text-xs font-medium text-muted-foreground',
                  m.month > 0 && 'border-l'
                )}
                style={{ left: `${(m.startIdx / n) * 100}%`, width: `${(m.days / n) * 100}%` }}
              >
                {MONTH_HEADERS[m.month]}
              </div>
            ))}
          </div>
        </div>

        {/* Строки пространств */}
        {placed.map(({ row, bars, height }) => (
          <div key={row.orgSpaceId} className="flex border-b last:border-b-0" role="group" aria-label={`Пространство ${row.orgSpaceName}`}>
            <div
              className="sticky left-0 z-20 flex shrink-0 flex-col justify-center gap-0.5 border-r bg-card px-3"
              style={{ width: LABEL_COL, height }}
            >
              <span className="line-clamp-2 text-sm font-medium leading-tight" title={row.orgSpaceName}>
                {row.orgSpaceName}
              </span>
              <span className="text-xs text-muted-foreground">
                {row.items.length} {row.items.length === 1 ? 'интенсив' : row.items.length < 5 ? 'интенсива' : 'интенсивов'}
              </span>
            </div>
            <div className="relative flex-1" style={{ height }}>
              {months.slice(1).map((m) => (
                <span
                  key={m.month}
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-px bg-border"
                  style={{ left: `${(m.startIdx / n) * 100}%` }}
                />
              ))}
              {todayPct !== null && (
                <span
                  aria-hidden
                  className="pointer-events-none absolute inset-y-0 w-px bg-foreground/70"
                  style={{ left: `${todayPct}%` }}
                />
              )}
              {bars.map((b) => (
                <Bar key={b.item.id} bar={b} selected={b.item.id === selectedId} onSelect={onSelect} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
