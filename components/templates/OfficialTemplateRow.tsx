'use client'

import { CalendarClock, Check, ChevronDown, ChevronRight, Copy, CopyPlus, MoreHorizontal, Pencil, RotateCcw, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import type { OfficialTemplateDto, TemplateScope } from '@/lib/templates/types'
import { otherScope } from './lib'
import { ChannelTag } from './shared'

export type OfficialRowHandlers = {
  onSchedule: () => void
  onCopyText: () => void
  onEdit?: () => void
  onDelete?: () => void
  onReset?: () => void
  onCopyToOther?: () => void
}

/** Компактная строка официального шаблона: время, канал, название, бейджи, действия; раскрывается текст. */
export function OfficialTemplateRow({
  t,
  open,
  onToggle,
  justCopied,
  busy,
  manage,
  handlers,
}: {
  t: OfficialTemplateDto
  open: boolean
  onToggle: () => void
  justCopied: boolean
  busy: boolean
  /** Lead_SUP: правка/удаление/меню */
  manage: boolean
  handlers: OfficialRowHandlers
}) {
  const bodyId = `tpl-body-${t.scope}-${t.id}`
  const other: TemplateScope = otherScope(t.scope)
  return (
    <div className={cn('transition-colors hover:bg-muted/40', busy && 'opacity-60')} aria-busy={busy || undefined}>
      <div className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-1.5" onClick={onToggle}>
        <div className="flex min-h-9 min-w-0 flex-1 basis-[16rem] items-center gap-2">
          <Button
            variant="ghost"
            size="icon-sm"
            className="-ml-1 shrink-0"
            aria-expanded={open}
            aria-controls={bodyId}
            aria-label={open ? `Свернуть текст шаблона «${t.title}»` : `Показать текст шаблона «${t.title}»`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </Button>
          <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground" title={t.timeNote ?? undefined}>
            ~{t.time}
          </span>
          <ChannelTag channel={t.channel} />
          <span className="min-w-0 flex-1 truncate text-sm font-medium" title={t.title}>
            {t.title || t.dayLabel || '—'}
          </span>
          <span className="flex shrink-0 items-center gap-1">
            {t.audience === 'mk' && (
              <Badge variant="info" title="Только кампусы с МК">
                МК
              </Badge>
            )}
            {manage && t.isModified && (
              <Badge variant="warning" title="Встроенный шаблон изменён">
                Изменён
              </Badge>
            )}
            {manage && t.source === 'custom' && (
              <Badge variant="outline" title="Создан Lead_SUP">
                Свой
              </Badge>
            )}
          </span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1" onClick={(e) => e.stopPropagation()}>
          {manage ? (
            <>
              <Button variant="ghost" size="icon-sm" onClick={handlers.onEdit} disabled={busy} aria-label={`Редактировать шаблон «${t.title}»`} title="Редактировать">
                <Pencil aria-hidden />
              </Button>
              <Button
                variant="ghost"
                size="icon-sm"
                className="text-muted-foreground hover:text-destructive"
                onClick={handlers.onDelete}
                disabled={busy}
                aria-label={`Удалить шаблон «${t.title}»`}
                title="Удалить"
              >
                <Trash2 aria-hidden />
              </Button>
              {/* modal={false}: пункты меню открывают диалоги — не оставляем «залипший» pointer-events на body */}
              <DropdownMenu modal={false}>
                <DropdownMenuTrigger asChild>
                  <Button variant="ghost" size="icon-sm" disabled={busy} aria-label={`Другие действия с шаблоном «${t.title}»`} title="Ещё">
                    <MoreHorizontal aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-60">
                  <DropdownMenuItem onSelect={handlers.onSchedule}>
                    <CalendarClock aria-hidden />
                    Запланировать…
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handlers.onCopyText}>
                    <Copy aria-hidden />
                    Копировать текст
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={handlers.onCopyToOther}>
                    <CopyPlus aria-hidden />
                    Копировать в набор {other}…
                  </DropdownMenuItem>
                  {t.source === 'builtin' && t.isModified && (
                    <>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem onSelect={handlers.onReset}>
                        <RotateCcw aria-hidden />
                        Сбросить к умолчанию…
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </>
          ) : (
            <>
              <Button variant="outline" size="sm" className="h-9 sm:h-8" onClick={handlers.onSchedule}>
                <CalendarClock aria-hidden />
                Запланировать
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className={cn(justCopied && 'text-primary')}
                onClick={handlers.onCopyText}
                aria-label={justCopied ? 'Скопировано' : 'Копировать текст'}
                title="Копировать текст"
              >
                {justCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
              </Button>
            </>
          )}
        </div>
      </div>
      {open && (
        <div id={bodyId} className="space-y-1.5 px-3 pb-3 sm:pl-14">
          {(t.timeNote || t.dayLabel) && (
            <p className="text-xs text-muted-foreground">
              {t.dayLabel}
              {t.timeNote ? ` · ${t.timeNote}` : ''}
            </p>
          )}
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-[13px] leading-relaxed [word-break:break-word]">
            {t.body}
          </pre>
        </div>
      )}
    </div>
  )
}
