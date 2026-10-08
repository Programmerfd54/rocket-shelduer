"use client"

import type { ReactNode } from "react"
import { CalendarPlus, ChevronDown, ChevronRight, Copy } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"

export interface TemplateRowProps {
  id: string
  /** 'HH:mm' — примерное время по расписанию */
  time: string
  channel: string
  title: string
  /** Шаблон только для кампусов с МК */
  mk?: boolean
  body: string
  open: boolean
  onToggle: () => void
  /** Статус шаблона в этом пространстве (бейдж) */
  status: ReactNode
  onSend: () => void
  onCopy: () => void
}

/**
 * Плоская строка шаблона: время · #канал · название · статус · [Запланировать] [Копировать].
 * Клик по строке раскрывает текст шаблона.
 */
export function TemplateRow({
  id,
  time,
  channel,
  title,
  mk,
  body,
  open,
  onToggle,
  status,
  onSend,
  onCopy,
}: TemplateRowProps) {
  const bodyId = `template-body-${id}`
  const channelLabel = channel.replace(/^#/, "")
  return (
    <div className="border-b last:border-b-0">
      <div
        className="flex min-h-12 cursor-pointer flex-wrap items-center gap-x-2 gap-y-1 px-2 py-2 transition-colors hover:bg-muted/40 sm:px-3"
        onClick={onToggle}
      >
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="shrink-0 text-muted-foreground"
          aria-expanded={open}
          aria-controls={bodyId}
          aria-label={open ? "Свернуть текст шаблона" : "Показать текст шаблона"}
          onClick={(e) => {
            e.stopPropagation()
            onToggle()
          }}
        >
          {open ? <ChevronDown /> : <ChevronRight />}
        </Button>
        <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">~{time}</span>
        <span className="inline-flex min-w-0 max-w-40 shrink-0 items-center rounded-md border bg-muted/50 px-1.5 py-0.5 text-xs font-medium text-muted-foreground">
          <span className="truncate">#{channelLabel}</span>
        </span>
        {mk && <Badge variant="muted">МК</Badge>}
        <span className="min-w-32 flex-1 truncate text-sm font-medium">{title}</span>
        <span className="shrink-0">{status}</span>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button
            type="button"
            size="sm"
            onClick={(e) => {
              e.stopPropagation()
              onSend()
            }}
          >
            <CalendarPlus />
            Запланировать
          </Button>
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            title="Копировать текст"
            aria-label="Копировать текст"
            onClick={(e) => {
              e.stopPropagation()
              onCopy()
            }}
          >
            <Copy />
          </Button>
        </div>
      </div>
      {open && (
        <div id={bodyId} className="px-3 pb-3 pt-1 sm:pl-12">
          <pre className="max-w-full overflow-x-auto whitespace-pre-wrap break-words rounded-md border bg-muted/40 p-3 font-sans text-xs leading-relaxed">
            {body}
          </pre>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button type="button" size="sm" onClick={onSend}>
              <CalendarPlus />
              Запланировать
            </Button>
            <Button type="button" variant="outline" size="sm" onClick={onCopy}>
              <Copy />
              Копировать текст
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
