"use client"

import { Ban, CalendarClock, Circle, CircleCheck, CircleX, ClockAlert, SkipForward, TriangleAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import type { PlanItemDto, PlanItemState } from '@/lib/intensives/types'
import { STATE_LABELS } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'

import { formatInstantInTz, sendCountText } from './format'

const ICONS: Record<PlanItemState, typeof Circle> = {
  NOT_SCHEDULED: Circle,
  SCHEDULED: CalendarClock,
  AWAITING_OVERDUE: ClockAlert,
  SENT: CircleCheck,
  FAILED: CircleX,
  CANCELLED: Ban,
  SKIPPED: SkipForward,
}

const VARIANT: Record<PlanItemState, 'info' | 'warning' | 'danger' | 'muted' | null> = {
  NOT_SCHEDULED: null,
  SCHEDULED: 'info',
  AWAITING_OVERDUE: 'warning',
  SENT: null,
  FAILED: 'danger',
  CANCELLED: 'muted',
  SKIPPED: 'muted',
}

/** Детали состояния одной строкой: «на 13 октября, 10:00», «1 отправка», «Повтор запланирован на …». */
export function planItemStateDetails(
  item: Pick<PlanItemDto, 'state' | 'details' | 'skipReason'>,
  timeZone: string,
): { text: string | null; warning: string | null } {
  const d = item.details
  switch (item.state) {
    case 'SCHEDULED':
    case 'AWAITING_OVERDUE':
      return { text: d.scheduledFor ? `на ${formatInstantInTz(d.scheduledFor, timeZone)}` : null, warning: null }
    case 'SENT': {
      const parts: string[] = []
      if (d.pendingRepeatAt) parts.push(`Повтор запланирован на ${formatInstantInTz(d.pendingRepeatAt, timeZone)}`)
      return {
        text: parts.length ? parts.join(' · ') : null,
        warning: d.hasFailedRepeat ? 'Повтор завершился ошибкой' : null,
      }
    }
    case 'FAILED':
      return { text: d.sentCount > 0 ? sendCountText(d.sentCount) : null, warning: null }
    case 'SKIPPED':
      return { text: item.skipReason ? `Причина: ${item.skipReason}` : null, warning: null }
    default:
      return { text: null, warning: null }
  }
}

/**
 * Состояние пункта плана: иконка + текст (никогда только цвет).
 * Выполненные пункты — приглушённые (галочка без «кнопочного» фона), чтобы не выглядеть как неотправленные.
 */
export function PlanItemStateBadge({
  item,
  timeZone,
  showDetails = true,
  className,
}: {
  item: Pick<PlanItemDto, 'state' | 'details' | 'skipReason'>
  timeZone: string
  showDetails?: boolean
  className?: string
}) {
  const Icon = ICONS[item.state]
  const variant = VARIANT[item.state]
  const label =
    item.state === 'SENT' ? `${STATE_LABELS.SENT} · ${sendCountText(Math.max(1, item.details.sentCount))}` : STATE_LABELS[item.state]
  const { text, warning } = showDetails ? planItemStateDetails(item, timeZone) : { text: null, warning: null }

  const main =
    variant == null ? (
      <span
        className={cn(
          'inline-flex items-center gap-1 text-xs font-medium',
          item.state === 'SENT' ? 'text-muted-foreground' : 'text-muted-foreground/90',
        )}
      >
        <Icon
          className={cn('size-3.5 shrink-0', item.state === 'SENT' && 'text-emerald-600/80 dark:text-emerald-400/80')}
          aria-hidden
        />
        {label}
      </span>
    ) : (
      <Badge variant={variant}>
        <Icon aria-hidden />
        {label}
      </Badge>
    )

  return (
    <span className={cn('inline-flex min-w-0 flex-col gap-0.5', className)}>
      {main}
      {warning && (
        <span className="inline-flex items-center gap-1 text-xs text-foreground">
          <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          {warning}
        </span>
      )}
      {text && <span className="min-w-0 break-words text-xs text-muted-foreground">{text}</span>}
    </span>
  )
}
