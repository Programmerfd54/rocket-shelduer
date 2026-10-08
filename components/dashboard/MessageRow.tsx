"use client"

import { memo } from 'react'
import { MoreVertical } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { MessageStatusBadge } from '@/components/common/MessageStatusBadge'
import { cn } from '@/lib/utils'
import { formatClock, formatDayLabel } from '@/lib/message-queue'
import { getMessageActions, type ActionViewer } from '@/lib/message-actions'
import { channelLabel, userLabel, type QueueMessage } from './types'

/**
 * Строка очереди: время | канал + пространство, текст, отправитель | статус | меню действий.
 * Вся основная зона строки — одна кнопка (Enter/Space, фокус-кольцо); меню — отдельная кнопка рядом,
 * поэтому открытие меню не открывает панель. Ошибки/просрочка — иконкой и текстом, без цветной заливки строки.
 */
function MessageRowImpl({
  message,
  now,
  viewer,
  selected,
  busy,
  onSelect,
  onEdit,
  onRetry,
  onDelete,
}: {
  message: QueueMessage
  now: Date
  viewer: ActionViewer | null
  selected: boolean
  busy: boolean
  onSelect: (message: QueueMessage) => void
  onEdit: (message: QueueMessage) => void
  onRetry: (message: QueueMessage) => void
  onDelete: (message: QueueMessage) => void
}) {
  const actions = getMessageActions(message, viewer)
  const sender = message.user && message.user.id !== viewer?.id ? userLabel(message.user) : ''
  const workspaceName = message.workspace?.workspaceName ?? ''
  const text = (message.message ?? '').trim()
  const channel = channelLabel(message)

  return (
    <li
      className={cn(
        'flex items-stretch transition-colors',
        selected ? 'bg-muted ring-1 ring-inset ring-primary/40' : 'hover:bg-muted/40',
      )}
    >
      <button
        type="button"
        data-row-button={message.id}
        aria-current={selected ? 'true' : undefined}
        onClick={() => onSelect(message)}
        className="flex min-h-14 min-w-0 flex-1 items-start gap-3 px-3 py-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/60 sm:px-4"
      >
        <span className="w-14 shrink-0">
          <span className="block text-sm font-medium tabular-nums">{formatClock(message.scheduledFor)}</span>
          <span className="block truncate text-xs text-muted-foreground">{formatDayLabel(message.scheduledFor, now)}</span>
        </span>

        <span className="min-w-0 flex-1 space-y-0.5">
          <span className="flex min-w-0 items-baseline gap-1.5">
            <span className="max-w-[60%] shrink-0 truncate text-sm font-medium">{channel}</span>
            {workspaceName && (
              <span className="min-w-0 truncate text-xs text-muted-foreground">{workspaceName}</span>
            )}
          </span>
          <span className="block truncate text-[13px] text-foreground/80">
            {text || <span className="text-muted-foreground">Без текста</span>}
          </span>
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground sm:hidden">
            <MessageStatusBadge status={message.status} scheduledFor={message.scheduledFor} now={now} compact />
            {sender && <span className="min-w-0 truncate">От: {sender}</span>}
          </span>
          {sender && <span className="hidden min-w-0 truncate text-xs text-muted-foreground sm:block">От: {sender}</span>}
        </span>

        <span className="mt-0.5 hidden w-40 shrink-0 sm:flex">
          <MessageStatusBadge status={message.status} scheduledFor={message.scheduledFor} now={now} compact />
        </span>
      </button>

      <div className="flex shrink-0 items-start px-1 pt-1.5 sm:items-center sm:px-2 sm:pt-0">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-9 pointer-coarse:size-11"
              aria-label={`Действия: сообщение в ${channel}, ${formatClock(message.scheduledFor)}`}
              disabled={busy}
            >
              <MoreVertical />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="min-w-52">
            <DropdownMenuItem onSelect={() => onSelect(message)}>Открыть детали</DropdownMenuItem>
            {(actions.canEdit || actions.canRetry || actions.canDelete) && <DropdownMenuSeparator />}
            {actions.canRetry && <DropdownMenuItem onSelect={() => onRetry(message)}>Повторить отправку</DropdownMenuItem>}
            {actions.canEdit && (
              <DropdownMenuItem onSelect={() => onEdit(message)}>
                {message.status === 'SENT' ? 'Редактировать в Rocket.Chat' : 'Изменить время и текст'}
              </DropdownMenuItem>
            )}
            {actions.canDelete && (
              <DropdownMenuItem
                onSelect={() => onDelete(message)}
                className="text-destructive focus:text-destructive"
              >
                Удалить…
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </li>
  )
}

export const MessageRow = memo(MessageRowImpl)
