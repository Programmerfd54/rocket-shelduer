'use client'

import { useState } from 'react'
import { AlertTriangle, ChevronDown, ChevronRight, History, Loader2, MoreHorizontal, Pencil, RotateCcw, SkipForward, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { AUDIENCE_LABELS, formatYmd, pluralize } from '@/lib/intensives/ui'
import type { PlanItemDto, PlanItemSend, PlanItemSetupReason } from '@/lib/intensives/types'
import { MESSAGE_STATUS_LABELS, MESSAGE_STATUS_VARIANT, StateBadge, formatInstant } from './kit'

const SETUP_REASON_TEXT: Record<PlanItemSetupReason, string> = {
  DAY_OUTSIDE_PERIOD: 'День вне периода интенсива',
  NO_DAY: 'Не задан день',
  NO_TIME: 'Не задано время',
}

const SOURCE_LABEL: Record<PlanItemDto['sourceType'], string> = {
  OFFICIAL: 'Официальный шаблон',
  USER_TEMPLATE: 'Личный шаблон',
  CUSTOM: 'Свой пункт',
}

/** Краткая строка состояния: «Отправлено · 1 отправка», «Повтор запланирован на …» и т. д. */
export function stateLine(item: PlanItemDto, tz: string): string {
  const d = item.details
  switch (item.state) {
    case 'SENT': {
      let s = `Отправлено · ${d.sentCount} ${pluralize(d.sentCount, 'отправка', 'отправки', 'отправок')}`
      if (d.hasFailedRepeat) s += ' · Повтор завершился ошибкой'
      else if (d.pendingRepeatAt) s += ` · Повтор запланирован на ${formatInstant(d.pendingRepeatAt, tz)}`
      return s
    }
    case 'SCHEDULED':
      return `Запланировано на ${formatInstant(d.scheduledFor, tz)}`
    case 'AWAITING_OVERDUE':
      return `Время ${formatInstant(d.scheduledFor, tz)} прошло, сообщение ждёт отправки`
    case 'FAILED':
      return 'Последняя отправка завершилась ошибкой'
    case 'CANCELLED':
      return 'Последняя отправка отменена'
    case 'SKIPPED':
      return item.skipReason ? `Причина: ${item.skipReason}` : 'Пропущено'
    default: {
      const r = item.recommended
      if (!r.date) return 'Дата не определена'
      return `Рекомендовано: ${formatYmd(r.date, false)}${r.time ? `, ${r.time}` : ''}${r.isPast ? ' · время прошло' : ''}`
    }
  }
}

function SendLine({ send, tz }: { send: PlanItemSend; tz: string }) {
  if (!send.canView) {
    return (
      <li className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
        <Badge variant={MESSAGE_STATUS_VARIANT[send.status]}>{MESSAGE_STATUS_LABELS[send.status]}</Badge>
        <span className="tabular-nums text-muted-foreground">{formatInstant(send.sentAt ?? send.scheduledFor, tz, true)}</span>
        <span className="text-muted-foreground">Детали скрыты: сообщение недоступно</span>
      </li>
    )
  }
  return (
    <li className="space-y-0.5 text-xs">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <Badge variant={MESSAGE_STATUS_VARIANT[send.status]}>{MESSAGE_STATUS_LABELS[send.status]}</Badge>
        {send.isPlanRepeat && <Badge variant="outline">Повтор</Badge>}
        <span className="tabular-nums">{formatInstant(send.sentAt ?? send.scheduledFor, tz, true)}</span>
        {send.channelName && <span className="text-muted-foreground">#{send.channelName.replace(/^#/, '')}</span>}
        {send.author?.name && <span className="text-muted-foreground">от {send.author.name}</span>}
        {send.plannedBy?.name && send.plannedBy.name !== send.author?.name && (
          <span className="text-muted-foreground">запланировал {send.plannedBy.name}</span>
        )}
        {send.planEditedFromSnapshot && <span className="text-muted-foreground">текст изменён вручную</span>}
      </div>
      {send.error && <p className="text-destructive text-pretty">Ошибка: {send.error}</p>}
    </li>
  )
}

export function PlanItemRow({
  item,
  tz,
  readOnly,
  busy,
  onEdit,
  onSkip,
  onUnskip,
  onDelete,
  onShowUpdate,
  onHistory,
}: {
  item: PlanItemDto
  tz: string
  readOnly: boolean
  busy: boolean
  onEdit: (item: PlanItemDto) => void
  onSkip: (item: PlanItemDto) => void
  onUnskip: (item: PlanItemDto) => void
  onDelete: (item: PlanItemDto) => void
  onShowUpdate: (item: PlanItemDto) => void
  onHistory: (item: PlanItemDto) => void
}) {
  const [open, setOpen] = useState(false)
  const lockedForEdit = item.hasEverLinkedMessages
  const activeSend = item.state === 'SCHEDULED' || item.state === 'AWAITING_OVERDUE' || item.state === 'SENT'
  const dst = item.recommended.dstIssue

  return (
    <li className="px-3 py-3 sm:px-4" data-plan-item={item.id}>
      <div className="flex items-start gap-2 sm:gap-3">
        <div className="w-11 shrink-0 pt-0.5 text-sm tabular-nums text-muted-foreground sm:w-12">{item.time ?? '—'}</div>
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <button
              type="button"
              onClick={() => setOpen((v) => !v)}
              aria-expanded={open}
              className="flex min-w-0 items-center gap-1 rounded-sm text-left text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
            >
              {open ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronRight className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />}
              <span className="min-w-0 break-words">{item.title}</span>
            </button>
            <StateBadge state={item.state} />
            {item.updateAvailable && (
              <button type="button" onClick={() => onShowUpdate(item)} className="rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50" aria-label={`Доступна новая версия шаблона: ${item.title}`}>
                <Badge variant="info">Доступна новая версия</Badge>
              </button>
            )}
            {item.audience !== 'ALL' && <Badge variant="outline">{AUDIENCE_LABELS[item.audience]}</Badge>}
          </div>
          <p className="text-xs text-muted-foreground text-pretty">
            #{item.channel.replace(/^#/, '')} · {SOURCE_LABEL[item.sourceType]} · {stateLine(item, tz)}
          </p>
          {item.needsSetup && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                Требует настройки: {item.setupReasons.map((r) => SETUP_REASON_TEXT[r]).join(', ').toLowerCase()}. Сотрудник не сможет запланировать пункт автоматически.
              </span>
            </p>
          )}
          {dst && (
            <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
              <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
              <span>
                {dst === 'NONEXISTENT'
                  ? 'Такого местного времени в этот день нет (переход часов): время нужно выбрать явно.'
                  : 'Это местное время в этот день встречается дважды (переход часов): время нужно выбрать явно.'}
              </span>
            </p>
          )}
        </div>
        {!readOnly && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label={`Действия с пунктом «${item.title}»`} disabled={busy} className="shrink-0">
                {busy ? <Loader2 className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem disabled={lockedForEdit} onSelect={() => onEdit(item)}>
                <Pencil aria-hidden />
                <span className="flex flex-col">
                  Редактировать
                  {lockedForEdit && <span className="text-xs font-normal text-muted-foreground">Есть отправки — снимок не меняется</span>}
                </span>
              </DropdownMenuItem>
              {item.skipped ? (
                <DropdownMenuItem onSelect={() => onUnskip(item)}>
                  <RotateCcw aria-hidden />
                  Вернуть в план
                </DropdownMenuItem>
              ) : (
                <DropdownMenuItem disabled={activeSend} onSelect={() => onSkip(item)}>
                  <SkipForward aria-hidden />
                  <span className="flex flex-col">
                    Пропустить…
                    {activeSend && <span className="text-xs font-normal text-muted-foreground">Есть активная отправка</span>}
                  </span>
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onSelect={() => onHistory(item)}>
                <History aria-hidden />
                История пункта
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={lockedForEdit} onSelect={() => onDelete(item)}>
                <Trash2 aria-hidden />
                <span className="flex flex-col">
                  Удалить
                  {lockedForEdit && <span className="text-xs font-normal text-muted-foreground">Есть отправки — только пропуск</span>}
                </span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>

      {open && (
        <div className="mt-3 space-y-3 pl-[3.25rem] sm:pl-[3.75rem]">
          <div>
            <p className="mb-1 text-xs font-medium text-muted-foreground">Текст анонса (снимок шаблона)</p>
            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 px-3 py-2 text-[13px]">{item.body}</p>
          </div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 text-xs">
            <dt className="text-muted-foreground">День</dt>
            <dd>{item.dayNumber ?? 'не задан'}</dd>
            {item.categories.length > 0 && (
              <>
                <dt className="text-muted-foreground">Категории</dt>
                <dd>{item.categories.join(', ')}</dd>
              </>
            )}
            {item.skipped && (
              <>
                <dt className="text-muted-foreground">Пропущено</dt>
                <dd>
                  {item.skippedBy?.name ? `${item.skippedBy.name}, ` : ''}
                  {item.skippedAt ? formatInstant(item.skippedAt, tz, true) : ''}
                  {item.skipReason ? ` — ${item.skipReason}` : ''}
                </dd>
              </>
            )}
          </dl>
          {item.sends.length > 0 && (
            <div>
              <p className="mb-1 text-xs font-medium text-muted-foreground">Отправки ({item.sends.length})</p>
              <ul className="space-y-1.5">
                {item.sends.map((s) => (
                  <SendLine key={s.messageId} send={s} tz={tz} />
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </li>
  )
}
