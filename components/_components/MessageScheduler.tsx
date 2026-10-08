"use client"

import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { EmptyState } from "@/components/common/EmptyState"
import { Clock, Pencil, Trash2, MessageSquare } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Message {
  id: string
  workspaceId: string
  channelName: string
  message: string
  scheduledFor: Date | string
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'
  sentAt?: Date | null
  error?: string | null
  workspace: {
    workspaceName: string
  }
}

interface MessageSchedulerProps {
  messages: Message[]
  onEdit: (message: Message) => void
  onDelete: (messageId: string) => void
}

const STATUS_META: Record<string, { label: string; variant: 'warning' | 'success' | 'danger' | 'muted' }> = {
  PENDING: { label: 'Ожидает', variant: 'warning' },
  SENT: { label: 'Отправлено', variant: 'success' },
  FAILED: { label: 'Ошибка', variant: 'danger' },
  CANCELLED: { label: 'Отменено', variant: 'muted' },
}

export default function MessageScheduler({ messages, onEdit, onDelete }: MessageSchedulerProps) {
  if (messages.length === 0) {
    return (
      <EmptyState
        icon={<MessageSquare />}
        title="Нет запланированных сообщений"
        description="Добавьте пространство и запланируйте первое сообщение."
      />
    )
  }

  return (
    <ul className="divide-y rounded-lg border bg-card">
      {messages.map((message) => {
        const meta = STATUS_META[message.status]
        return (
          <li key={message.id} className="space-y-2 px-4 py-3 transition-colors hover:bg-muted/40">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                  <span className="font-medium">{message.workspace.workspaceName}</span>
                  <span className="text-muted-foreground">#{message.channelName}</span>
                  <Badge variant={meta?.variant ?? 'muted'}>{meta?.label ?? message.status}</Badge>
                </div>
                <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Clock className="size-3.5" aria-hidden />
                  {formatDate(message.scheduledFor)}
                </p>
              </div>

              <div className="flex shrink-0 items-center gap-0.5">
                {message.status === 'PENDING' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onEdit(message)}
                    title="Редактировать"
                    aria-label="Редактировать сообщение"
                  >
                    <Pencil />
                  </Button>
                )}
                {message.status !== 'SENT' && (
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => onDelete(message.id)}
                    className="text-muted-foreground hover:text-destructive"
                    title="Удалить"
                    aria-label="Удалить сообщение"
                  >
                    <Trash2 />
                  </Button>
                )}
              </div>
            </div>

            <p className="whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
              {message.message}
            </p>

            {message.error && (
              <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">Ошибка отправки</p>
                <p className="mt-0.5 break-words text-xs text-muted-foreground">{message.error}</p>
              </div>
            )}
          </li>
        )
      })}
    </ul>
  )
}
