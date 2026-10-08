"use client"

import { useState } from 'react'
import { CalendarRange, Check, ChevronDown, RotateCcw } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import type { IntensiveSummary } from '@/lib/intensives/types'
import { formatRange, INTENSIVE_STATUS_LABELS, PHASE_LABELS } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'

import { intensiveMetaLine } from './format'

/** Подпись состояния интенсива: фаза для опубликованного, иначе хранимый статус. */
export function intensiveStateLabel(i: Pick<IntensiveSummary, 'status' | 'phase'>): string {
  return i.status === 'PUBLISHED' && i.phase ? PHASE_LABELS[i.phase] : INTENSIVE_STATUS_LABELS[i.status]
}

function stateVariant(i: Pick<IntensiveSummary, 'status' | 'phase'>): 'success' | 'info' | 'muted' | 'warning' {
  if (i.status === 'PUBLISHED') return i.phase === 'RUNNING' ? 'success' : i.phase === 'UPCOMING' ? 'info' : 'muted'
  if (i.status === 'DRAFT') return 'warning'
  return 'muted'
}

type Group = { key: string; label: string; items: IntensiveSummary[] }

/** Группы списка: идёт / предстоящие / завершённые / черновики / отменённые и архивные. */
export function groupIntensives(list: IntensiveSummary[]): Group[] {
  const byStart = (a: IntensiveSummary, b: IntensiveSummary) => a.startDate.localeCompare(b.startDate)
  const pub = list.filter((i) => i.status === 'PUBLISHED')
  const groups: Group[] = [
    { key: 'running', label: 'Идёт', items: pub.filter((i) => i.phase === 'RUNNING').sort(byStart) },
    { key: 'upcoming', label: 'Предстоящие', items: pub.filter((i) => i.phase === 'UPCOMING').sort(byStart) },
    { key: 'finished', label: 'Завершённые', items: pub.filter((i) => i.phase === 'FINISHED').sort((a, b) => -byStart(a, b)) },
    { key: 'draft', label: 'Черновики', items: list.filter((i) => i.status === 'DRAFT').sort(byStart) },
    {
      key: 'other',
      label: 'Отменённые и архивные',
      items: list.filter((i) => i.status === 'CANCELLED' || i.status === 'ARCHIVED').sort((a, b) => -byStart(a, b)),
    },
  ]
  return groups.filter((g) => g.items.length > 0)
}

function Option({
  selected,
  onClick,
  title,
  meta,
  badge,
}: {
  selected: boolean
  onClick: () => void
  title: string
  meta?: string
  badge?: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      onClick={onClick}
      className={cn(
        'flex min-h-10 w-full items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm outline-none transition-colors hover:bg-muted/60 focus-visible:bg-muted/60',
        selected && 'bg-muted',
      )}
    >
      <Check className={cn('mt-0.5 size-4 shrink-0', selected ? 'text-foreground' : 'invisible')} aria-hidden />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="truncate font-medium">{title}</span>
          {badge}
        </span>
        {meta && <span className="block truncate text-xs text-muted-foreground">{meta}</span>}
      </span>
    </button>
  )
}

/**
 * Блок выбора интенсива над вкладками пространства:
 * «Октябрьский интенсив · 12–25 октября · День 3 из 14 · Москва · Выбрать другой ▾».
 * Список — будущие/текущие/прошедшие интенсивы OrgSpace этого подключения и «Без привязки к интенсиву».
 */
export function IntensiveSelector({
  intensives,
  selected,
  onSelect,
  loading = false,
  error,
  onRetry,
  className,
}: {
  intensives: IntensiveSummary[]
  selected: IntensiveSummary | null
  onSelect: (id: string | null) => void
  loading?: boolean
  error?: string | null
  onRetry?: () => void
  className?: string
}) {
  const [open, setOpen] = useState(false)
  const groups = groupIntensives(intensives)
  const pick = (id: string | null) => {
    setOpen(false)
    if ((selected?.id ?? null) !== id) onSelect(id)
  }

  if (loading) {
    return (
      <div className={cn('flex items-center gap-3 rounded-lg border bg-card px-3 py-2.5', className)} aria-busy="true" aria-label="Загрузка интенсивов">
        <Skeleton className="size-4" />
        <div className="flex-1 space-y-1.5">
          <Skeleton className="h-4 w-48" />
          <Skeleton className="h-3 w-64 max-w-full" />
        </div>
        <Skeleton className="h-8 w-32" />
      </div>
    )
  }

  return (
    <div
      className={cn('flex flex-col gap-2 rounded-lg border bg-card px-3 py-2.5 sm:flex-row sm:items-center sm:gap-3', className)}
      aria-label="Интенсив"
      role="region"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <CalendarRange className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
        {selected ? (
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-sm font-semibold">{selected.name}</span>
              <Badge variant={stateVariant(selected)}>{intensiveStateLabel(selected)}</Badge>
            </div>
            <p className="text-[13px] text-muted-foreground">{intensiveMetaLine(selected)}</p>
          </div>
        ) : (
          <div className="min-w-0">
            <p className="text-sm font-semibold">Без привязки к интенсиву</p>
            <p className="text-[13px] text-muted-foreground">
              {error
                ? 'Не удалось загрузить интенсивы — пространство работает как раньше.'
                : intensives.length === 0
                  ? 'Для этого пространства нет опубликованных интенсивов.'
                  : 'Сообщения и шаблоны — как раньше, без плана анонсов.'}
            </p>
          </div>
        )}
      </div>

      {error && onRetry ? (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} className="self-start sm:self-auto">
          <RotateCcw aria-hidden />
          Повторить
        </Button>
      ) : (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="self-start sm:self-auto"
              aria-haspopup="listbox"
              aria-expanded={open}
            >
              {selected ? 'Выбрать другой' : 'Выбрать интенсив'}
              <ChevronDown aria-hidden />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-[min(22rem,calc(100vw-2rem))] p-1">
            <div role="listbox" aria-label="Интенсивы пространства" className="max-h-[min(60vh,420px)] overflow-y-auto">
              {groups.map((g) => (
                <div key={g.key} role="group" aria-label={g.label} className="pb-1">
                  <p className="px-2 pb-1 pt-2 text-xs font-medium text-muted-foreground">{g.label}</p>
                  {g.items.map((i) => (
                    <Option
                      key={i.id}
                      selected={selected?.id === i.id}
                      onClick={() => pick(i.id)}
                      title={i.name}
                      meta={formatRange(i.startDate, i.endDate)}
                      badge={
                        g.key === 'draft' || g.key === 'other' ? (
                          <Badge variant="muted">{intensiveStateLabel(i)}</Badge>
                        ) : undefined
                      }
                    />
                  ))}
                </div>
              ))}
              <div className={cn(groups.length > 0 && 'border-t pt-1')}>
                <Option
                  selected={!selected}
                  onClick={() => pick(null)}
                  title="Без привязки к интенсиву"
                  meta="История использования вне интенсивов"
                />
              </div>
            </div>
          </PopoverContent>
        </Popover>
      )}
    </div>
  )
}
