"use client"

import { CalendarPlus, Copy, Eye, Info, MoreHorizontal, Repeat, TriangleAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import type { PlanItemDto, PlanItemSend } from '@/lib/intensives/types'
import { AUDIENCE_LABELS, STATE_PRIMARY_ACTION } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'

import { primarySend, setupReasonsText, userName } from './format'
import { PlanItemStateBadge } from './PlanItemStateBadge'

export interface PlanItemRowHandlers {
  /** Запланировать (repeat=true — «Запланировать повтор» после успешной отправки) */
  onSchedule: (item: PlanItemDto, repeat: boolean) => void
  /** Открыть существующую отправку (сообщение) */
  onOpenSend: (item: PlanItemDto, send: PlanItemSend) => void
  /** Панель «Подробности» пункта */
  onDetails: (item: PlanItemDto) => void
  /** Копировать текст снимка (прогресс не меняется) */
  onCopy: (item: PlanItemDto) => void
}

/** Только «Не запланировано» и «Отменено» получают заметную (основную) кнопку. */
export function isProminentState(state: PlanItemDto['state']): boolean {
  return state === 'NOT_SCHEDULED' || state === 'CANCELLED'
}

/** Выполнить основное действие строки по состоянию (ТЗ §7). */
export function runPrimaryAction(item: PlanItemDto, h: Pick<PlanItemRowHandlers, 'onSchedule' | 'onOpenSend' | 'onDetails'>) {
  if (item.state === 'NOT_SCHEDULED' || item.state === 'CANCELLED') return h.onSchedule(item, false)
  if (item.state === 'SKIPPED') return h.onDetails(item)
  const send = primarySend(item)
  if (send?.canView) return h.onOpenSend(item, send)
  return h.onDetails(item)
}

/** Кто запланировал / отправил — только если вызывающий видит сообщение. */
function whoText(item: PlanItemDto): string | null {
  const send = primarySend(item)
  if (!send?.canView) return null
  if (item.state === 'SENT') {
    const n = userName(send.author)
    return n ? `Отправитель: ${n}` : null
  }
  const n = userName(send.plannedBy)
  return n ? `Запланировал(а): ${n}` : null
}

/**
 * Строка пункта плана: время · канал · название · состояние · кто · основное действие · «⋯».
 * Основное действие зависит от состояния (STATE_PRIMARY_ACTION); выполненные пункты — приглушённая
 * вторичная кнопка, а не та же зелёная, что у незапланированных.
 */
export function PlanItemRow({
  item,
  timeZone,
  disabled = false,
  canSchedule = true,
  scheduleBlockedReason,
  handlers,
}: {
  item: PlanItemDto
  timeZone: string
  /** План загружается / обновляется для другого интенсива — действия недоступны */
  disabled?: boolean
  /** Интенсив позволяет планировать (опубликован и не завершён) */
  canSchedule?: boolean
  scheduleBlockedReason?: string
  handlers: PlanItemRowHandlers
}) {
  const prominent = isProminentState(item.state)
  const scheduleAction = item.state === 'NOT_SCHEDULED' || item.state === 'CANCELLED'
  const primaryDisabled = disabled || (scheduleAction && !canSchedule)
  const label = STATE_PRIMARY_ACTION[item.state]
  const channel = item.channel.replace(/^#/, '')
  const who = whoText(item)
  const titleId = `plan-item-${item.id}-title`
  const PrimaryIcon = scheduleAction ? CalendarPlus : item.state === 'SKIPPED' ? Info : item.state === 'FAILED' ? TriangleAlert : Eye

  return (
    <div
      className={cn(
        'flex min-h-12 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-2 transition-colors last:border-b-0 hover:bg-muted/40',
        item.state === 'SENT' && 'text-muted-foreground',
      )}
      aria-labelledby={titleId}
      role="group"
    >
      <span className="w-11 shrink-0 text-sm tabular-nums text-muted-foreground" title="Рекомендуемое время (пояс интенсива)">
        {item.time ?? '—'}
      </span>
      <span className="inline-flex min-w-0 max-w-36 shrink-0 items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
        <span className="truncate">#{channel}</span>
      </span>

      <div className="min-w-[10rem] flex-1 basis-48">
        <button
          type="button"
          id={titleId}
          onClick={() => handlers.onDetails(item)}
          className={cn(
            'block max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50',
            item.state === 'SENT' ? 'text-muted-foreground' : 'text-foreground',
          )}
          title={item.title}
        >
          {item.title || '(без названия)'}
        </button>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
          {item.audience !== 'ALL' && <Badge variant="muted">{AUDIENCE_LABELS[item.audience]}</Badge>}
          {item.needsSetup && (
            <span className="inline-flex items-center gap-1 text-xs text-foreground">
              <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              {setupReasonsText(item)}
            </span>
          )}
          {who && <span className="text-xs text-muted-foreground">{who}</span>}
        </div>
      </div>

      <PlanItemStateBadge item={item} timeZone={timeZone} className="w-full shrink-0 sm:w-52" />

      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button
          type="button"
          size="sm"
          variant={prominent ? 'default' : item.state === 'SENT' || item.state === 'SKIPPED' ? 'ghost' : 'outline'}
          disabled={primaryDisabled}
          title={scheduleAction && !canSchedule ? scheduleBlockedReason : undefined}
          onClick={() => runPrimaryAction(item, handlers)}
          aria-describedby={titleId}
          className="min-w-0"
        >
          <PrimaryIcon aria-hidden />
          {label}
        </Button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button type="button" variant="ghost" size="icon-sm" aria-label={`Действия: ${item.title}`} disabled={disabled}>
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuItem onSelect={() => handlers.onCopy(item)}>
              <Copy aria-hidden />
              Копировать текст
            </DropdownMenuItem>
            {item.state === 'SENT' && (
              <DropdownMenuItem disabled={!canSchedule} onSelect={() => handlers.onSchedule(item, true)}>
                <Repeat aria-hidden />
                Запланировать повтор
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => handlers.onDetails(item)}>
              <Info aria-hidden />
              Подробности
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  )
}
