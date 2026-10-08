"use client"

import { useEffect, useState } from 'react'
import { CalendarPlus, Copy, ExternalLink, Eye, Lock, Repeat, TriangleAlert } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { MessageStatusBadge } from '@/components/common/MessageStatusBadge'
import type { IntensiveSummary, PlanItemDto, PlanItemSend } from '@/lib/intensives/types'
import { AUDIENCE_LABELS, formatTimezone } from '@/lib/intensives/ui'
import { sanitizeErrorReason } from '@/lib/message-status'
import { safeExternalHref } from '@/lib/sanitize'

import { formatInstantInTz, planScheduleLine, setupReasonsText, userName } from './format'
import { PlanItemStateBadge } from './PlanItemStateBadge'

const SOURCE_LABELS: Record<PlanItemDto['sourceType'], string> = {
  OFFICIAL: 'Общий шаблон',
  USER_TEMPLATE: 'Пользовательский шаблон',
  CUSTOM: 'Свой пункт плана',
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[7.5rem_minmax(0,1fr)] gap-x-3 py-2 text-sm">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** Ссылки на сообщения в Rocket.Chat для видимых успешных отправок (GET /api/messages/[id] → rcPermalink). */
function useRcLinks(sends: PlanItemSend[], enabled: boolean) {
  const [links, setLinks] = useState<Record<string, string | null>>({})
  const ids = sends
    .filter((s) => s.canView && s.status === 'SENT')
    .slice(-5)
    .map((s) => s.messageId)
  const key = ids.join(',')
  useEffect(() => {
    if (!enabled || !key) return
    const ctrl = new AbortController()
    for (const id of key.split(',')) {
      fetch(`/api/messages/${encodeURIComponent(id)}`, { signal: ctrl.signal, headers: { 'X-Error-Handling': 'local' } })
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { rcPermalink?: unknown } | null) => {
          const href = safeExternalHref(typeof d?.rcPermalink === 'string' ? d.rcPermalink : null)
          setLinks((prev) => ({ ...prev, [id]: href }))
        })
        .catch(() => {})
    }
    return () => ctrl.abort()
  }, [enabled, key])
  return links
}

/**
 * Панель «Подробности» пункта плана: снимок текста, рекомендуемая дата в поясе интенсива,
 * список отправок (статус, время, ошибка, ссылка на RC — если сообщение доступно вызывающему),
 * отметка «текст изменён относительно шаблона».
 */
export function PlanItemDetailsSheet({
  open,
  onOpenChange,
  item,
  intensive,
  canSchedule,
  scheduleBlockedReason,
  disabled,
  onSchedule,
  onOpenSend,
  onCopy,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  item: PlanItemDto | null
  intensive: IntensiveSummary
  canSchedule: boolean
  scheduleBlockedReason?: string
  disabled?: boolean
  onSchedule: (item: PlanItemDto, repeat: boolean) => void
  onOpenSend: (item: PlanItemDto, send: PlanItemSend) => void
  onCopy: (item: PlanItemDto) => void
}) {
  const tz = intensive.timezone
  const links = useRcLinks(item?.sends ?? [], open && !!item)
  const sends = item ? [...item.sends].reverse() : []
  const recommended = item ? planScheduleLine(intensive, item.recommended.date, item.recommended.time) : null
  const scheduleAction = item && (item.state === 'NOT_SCHEDULED' || item.state === 'CANCELLED')

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        {item ? (
          <>
            <SheetHeader className="space-y-1.5 border-b px-4 py-3 pr-12">
              <SheetTitle className="break-words text-base font-semibold leading-snug">{item.title || '(без названия)'}</SheetTitle>
              <SheetDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
                  <PlanItemStateBadge item={item} timeZone={tz} />
                </div>
              </SheetDescription>
            </SheetHeader>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">
              <dl className="divide-y">
                <Row label="Рекомендовано">
                  {recommended ? (
                    <span className="tabular-nums">{recommended}</span>
                  ) : (
                    <span className="text-muted-foreground">Дата не определена</span>
                  )}
                  {item.needsSetup && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-foreground">
                      <TriangleAlert className="size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                      {setupReasonsText(item)} — дату и время выберите вручную
                    </span>
                  )}
                  {item.recommended.isPast && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">Рекомендуемое время уже прошло</span>
                  )}
                  {item.recommended.dstIssue && (
                    <span className="mt-0.5 block text-xs text-muted-foreground">
                      {item.recommended.dstIssue === 'AMBIGUOUS'
                        ? 'В этот день время повторяется (перевод часов) — при планировании выберите вариант явно'
                        : 'В этот день такого времени нет (перевод часов) — выберите другое время'}
                    </span>
                  )}
                </Row>
                <Row label="Канал">#{item.channel.replace(/^#/, '')}</Row>
                <Row label="Для кого">{AUDIENCE_LABELS[item.audience]}</Row>
                <Row label="Источник">{SOURCE_LABELS[item.sourceType]}</Row>
                <Row label="Часовой пояс">
                  {formatTimezone(tz)} <span className="text-muted-foreground">({tz})</span>
                </Row>
                {item.skipped && (
                  <Row label="Пропущено">
                    {item.skipReason || 'Причина не указана'}
                    {(userName(item.skippedBy) || item.skippedAt) && (
                      <span className="mt-0.5 block text-xs text-muted-foreground">
                        {[userName(item.skippedBy), item.skippedAt ? formatInstantInTz(item.skippedAt, tz) : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    )}
                  </Row>
                )}
              </dl>

              <section className="space-y-1.5" aria-label="Текст из плана">
                <h3 className="text-[13px] font-medium">Текст из плана</h3>
                <pre className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 font-sans text-sm leading-relaxed">
                  {item.body || 'Без текста'}
                </pre>
                <p className="text-xs text-muted-foreground">
                  Это снимок шаблона на момент формирования плана: изменения исходного шаблона его не меняют.
                </p>
              </section>

              <section className="space-y-2" aria-label="Отправки">
                <h3 className="text-[13px] font-medium">
                  Отправки <span className="tabular-nums text-muted-foreground">{item.sends.length}</span>
                </h3>
                {sends.length === 0 ? (
                  <p className="text-[13px] text-muted-foreground">По этому пункту ещё ничего не планировали.</p>
                ) : (
                  <ul className="divide-y rounded-md border">
                    {sends.map((s) => {
                      const reason = s.status === 'FAILED' ? sanitizeErrorReason(s.error) : null
                      const link = links[s.messageId]
                      return (
                        <li key={s.messageId} className="space-y-1 px-3 py-2.5 text-sm">
                          <div className="flex flex-wrap items-center gap-2">
                            <MessageStatusBadge status={s.status} scheduledFor={s.scheduledFor} compact />
                            {s.isPlanRepeat && <Badge variant="muted">Повтор</Badge>}
                            <span className="text-xs tabular-nums text-muted-foreground">
                              {s.status === 'SENT' && s.sentAt
                                ? `отправлено ${formatInstantInTz(s.sentAt, tz)}`
                                : `на ${formatInstantInTz(s.scheduledFor, tz)}`}
                            </span>
                          </div>
                          {s.canView ? (
                            <>
                              <p className="text-xs text-muted-foreground">
                                {[
                                  s.channelName ? `#${s.channelName.replace(/^#/, '')}` : null,
                                  userName(s.author) ? `отправитель: ${userName(s.author)}` : null,
                                  userName(s.plannedBy) && userName(s.plannedBy) !== userName(s.author)
                                    ? `запланировал(а): ${userName(s.plannedBy)}`
                                    : null,
                                ]
                                  .filter(Boolean)
                                  .join(' · ')}
                              </p>
                              {s.status === 'FAILED' && (
                                <p className="break-words text-xs text-destructive">{reason ?? 'Причина ошибки не указана'}</p>
                              )}
                              {s.planEditedFromSnapshot && (
                                <p className="text-xs text-muted-foreground">Текст изменён относительно плана</p>
                              )}
                              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5">
                                <button
                                  type="button"
                                  onClick={() => onOpenSend(item, s)}
                                  className="inline-flex items-center gap-1 rounded-sm text-[13px] text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                                >
                                  <Eye className="size-3.5" aria-hidden />
                                  Открыть сообщение
                                </button>
                                {link && (
                                  <a
                                    href={link}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 rounded-sm text-[13px] text-primary underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring/50"
                                  >
                                    <ExternalLink className="size-3.5" aria-hidden />
                                    Открыть в Rocket.Chat
                                    <span className="sr-only"> (откроется в новой вкладке)</span>
                                  </a>
                                )}
                              </div>
                            </>
                          ) : (
                            <p className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Lock className="size-3.5" aria-hidden />
                              Отправка другого сотрудника: видно только состояние
                            </p>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </section>
            </div>

            <div className="flex flex-wrap gap-2 border-t px-4 py-3">
              {scheduleAction && (
                <Button
                  size="sm"
                  disabled={disabled || !canSchedule}
                  title={!canSchedule ? scheduleBlockedReason : undefined}
                  onClick={() => onSchedule(item, false)}
                >
                  <CalendarPlus aria-hidden />
                  {item.state === 'CANCELLED' ? 'Запланировать заново' : 'Запланировать'}
                </Button>
              )}
              {item.state === 'SENT' && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled || !canSchedule}
                  title={!canSchedule ? scheduleBlockedReason : undefined}
                  onClick={() => onSchedule(item, true)}
                >
                  <Repeat aria-hidden />
                  Запланировать повтор
                </Button>
              )}
              <Button size="sm" variant="outline" onClick={() => onCopy(item)}>
                <Copy aria-hidden />
                Копировать текст
              </Button>
            </div>
          </>
        ) : (
          <SheetHeader className="px-4 py-3">
            <SheetTitle className="text-base">Пункт не найден</SheetTitle>
            <SheetDescription>Возможно, его удалили из плана. Обновите страницу.</SheetDescription>
          </SheetHeader>
        )}
      </SheetContent>
    </Sheet>
  )
}
