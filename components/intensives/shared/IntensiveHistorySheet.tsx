"use client"

import { useEffect, useRef, useState } from 'react'
import { Ban, CalendarClock, CircleX, FileText, History, Link2, Lock, Repeat, Send, Settings2, Trash2 } from 'lucide-react'

import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import type { HistoryResponse, IntensiveEventDto, IntensiveEventType } from '@/lib/intensives/types'
import { apiFetch, ApiError } from '@/lib/intensives/ui'
import { sanitizeErrorReason } from '@/lib/message-status'

import { formatInstantInTz, userName } from './format'
import { LoadErrorBlock } from './LoadErrorBlock'

const EVENT_LABELS: Record<IntensiveEventType, string> = {
  INTENSIVE_CREATED: 'Интенсив создан',
  INTENSIVE_UPDATED: 'Интенсив изменён',
  INTENSIVE_PUBLISHED: 'Интенсив опубликован',
  INTENSIVE_CANCELLED: 'Интенсив отменён',
  INTENSIVE_ARCHIVED: 'Интенсив перенесён в архив',
  PLAN_GENERATED: 'План сформирован',
  PLAN_ITEM_ADDED: 'Пункт добавлен в план',
  PLAN_ITEM_UPDATED: 'Пункт изменён',
  PLAN_ITEM_SOURCE_UPDATED: 'Пункт обновлён до новой версии шаблона',
  PLAN_ITEM_SKIPPED: 'Пункт пропущен',
  PLAN_ITEM_UNSKIPPED: 'Пропуск пункта отменён',
  PLAN_ITEM_DELETED: 'Пункт удалён из плана',
  MESSAGE_SCHEDULED: 'Сообщение запланировано',
  MESSAGE_REPEAT_SCHEDULED: 'Повтор запланирован',
  MESSAGE_SENT: 'Сообщение отправлено',
  MESSAGE_FAILED: 'Ошибка отправки',
  MESSAGE_CANCELLED: 'Сообщение отменено',
  MESSAGE_RETRIED: 'Отправка повторена',
  MESSAGE_DELETED: 'Сообщение удалено',
  MESSAGE_LINKED: 'Сообщение привязано к пункту',
  MESSAGE_DETACHED: 'Привязка сообщения снята',
}

const FIELD_LABELS: Record<string, string> = {
  name: 'название',
  description: 'описание',
  startDate: 'дата начала',
  endDate: 'дата окончания',
  timezone: 'часовой пояс',
}

function eventIcon(type: IntensiveEventType) {
  switch (type) {
    case 'MESSAGE_SCHEDULED':
      return CalendarClock
    case 'MESSAGE_REPEAT_SCHEDULED':
    case 'MESSAGE_RETRIED':
      return Repeat
    case 'MESSAGE_SENT':
      return Send
    case 'MESSAGE_FAILED':
      return CircleX
    case 'MESSAGE_CANCELLED':
    case 'INTENSIVE_CANCELLED':
      return Ban
    case 'MESSAGE_DELETED':
    case 'PLAN_ITEM_DELETED':
      return Trash2
    case 'MESSAGE_LINKED':
    case 'MESSAGE_DETACHED':
      return Link2
    case 'PLAN_GENERATED':
    case 'PLAN_ITEM_ADDED':
    case 'PLAN_ITEM_UPDATED':
    case 'PLAN_ITEM_SOURCE_UPDATED':
    case 'PLAN_ITEM_SKIPPED':
    case 'PLAN_ITEM_UNSKIPPED':
      return FileText
    default:
      return Settings2
  }
}

const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v : null)

/** Короткая строка деталей события (без текста сообщений — его в истории нет). */
function eventDetails(e: IntensiveEventDto, tz: string): string[] {
  const d = e.details ?? {}
  const out: string[] = []
  const channel = str(d.channelName)
  if (channel) out.push(`#${channel.replace(/^#/, '')}`)
  const sentAt = str(d.sentAt)
  const scheduledFor = str(d.scheduledFor)
  if (e.type === 'MESSAGE_SENT' && sentAt) out.push(`отправлено ${formatInstantInTz(sentAt, tz)}`)
  else if (scheduledFor && e.type.startsWith('MESSAGE_')) out.push(`на ${formatInstantInTz(scheduledFor, tz)}`)
  const err = e.type === 'MESSAGE_FAILED' ? sanitizeErrorReason(str(d.error)) : null
  if (err) out.push(err)
  const reason = str(d.reason)
  if (reason) out.push(`Причина: ${reason}`)
  if (d.planEditedFromSnapshot === true) out.push('текст изменён относительно плана')
  if (e.type === 'INTENSIVE_UPDATED' && d.changes && typeof d.changes === 'object') {
    const fields = Object.keys(d.changes as Record<string, unknown>).map((k) => FIELD_LABELS[k] ?? k)
    if (fields.length) out.push(`изменено: ${fields.join(', ')}`)
  }
  return out
}

type Loaded = { forId: string; events: IntensiveEventDto[]; nextCursor: string | null }

/**
 * История интенсива (GET /api/intensives/[id]/history): новые сверху, постранично («Показать ещё»).
 * Урезанные события (сообщение недоступно вызывающему) помечены отдельно.
 */
export function IntensiveHistorySheet({
  open,
  onOpenChange,
  intensive,
  itemTitles,
  unknownItemLabel = 'Пункт удалён или скрыт',
  description,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  intensive: { id: string; name: string; timezone: string }
  /** planItemId → название пункта (из загруженного плана) */
  itemTitles: Record<string, string>
  /** Подпись события пункта, которого нет в itemTitles (например, пункт другого набора у Lead_SUP) */
  unknownItemLabel?: string
  /** Пояснение под заголовком (например, «История по всем наборам») */
  description?: string
}) {
  const [loaded, setLoaded] = useState<Loaded | null>(null)
  const [error, setError] = useState<{ forId: string; message: string } | null>(null)
  const [tick, setTick] = useState(0)
  const [moreLoading, setMoreLoading] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const seqRef = useRef(0)
  const id = intensive.id
  const current = loaded?.forId === id ? loaded : null
  const currentError = error?.forId === id ? error.message : null
  const firstLoading = open && !current && !currentError

  useEffect(() => {
    if (!open || current || currentError) return
    const seq = ++seqRef.current
    apiFetch<HistoryResponse>(`/api/intensives/${encodeURIComponent(id)}/history?limit=50`)
      .then((res) => {
        if (seq !== seqRef.current) return
        setLoaded({ forId: id, events: res.events, nextCursor: res.nextCursor })
      })
      .catch((e: unknown) => {
        if (seq !== seqRef.current) return
        setError({ forId: id, message: e instanceof ApiError ? e.message : 'Нет соединения с сервером' })
      })
  }, [open, id, current, currentError, tick])

  const loadMore = async () => {
    if (!current?.nextCursor || moreLoading) return
    const seq = ++seqRef.current
    setMoreLoading(true)
    setMoreError(null)
    try {
      const res = await apiFetch<HistoryResponse>(
        `/api/intensives/${encodeURIComponent(id)}/history?limit=50&cursor=${encodeURIComponent(current.nextCursor)}`,
      )
      if (seq !== seqRef.current) return
      setLoaded((prev) =>
        prev && prev.forId === id ? { forId: id, events: [...prev.events, ...res.events], nextCursor: res.nextCursor } : prev,
      )
    } catch (e) {
      if (seq === seqRef.current) setMoreError(e instanceof ApiError ? e.message : 'Нет соединения с сервером')
    } finally {
      if (seq === seqRef.current) setMoreLoading(false)
    }
  }

  return (
    <Sheet
      open={open}
      onOpenChange={(v) => {
        // При следующем открытии история загружается заново (свежие события)
        if (!v) {
          seqRef.current += 1
          setLoaded(null)
          setError(null)
          setMoreError(null)
          setMoreLoading(false)
        }
        onOpenChange(v)
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-lg">
        <SheetHeader className="space-y-1 border-b px-4 py-3 pr-12">
          <SheetTitle className="flex items-center gap-2 text-base">
            <History className="size-4 text-muted-foreground" aria-hidden />
            История
          </SheetTitle>
          <SheetDescription className="text-[13px]">
            {intensive.name} · планирование, отправки и изменения плана. Время — по поясу интенсива.
            {description && <span className="block">{description}</span>}
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3" aria-busy={firstLoading}>
          {firstLoading ? (
            <ul className="space-y-4" aria-label="Загрузка истории">
              {Array.from({ length: 6 }).map((_, i) => (
                <li key={i} className="flex gap-3">
                  <Skeleton className="size-5" />
                  <div className="flex-1 space-y-1.5">
                    <Skeleton className="h-4 w-48" />
                    <Skeleton className="h-3 w-64 max-w-full" />
                  </div>
                </li>
              ))}
            </ul>
          ) : currentError ? (
            <LoadErrorBlock
              title="Не удалось загрузить историю"
              message={currentError}
              onRetry={() => {
                setError(null)
                setTick((t) => t + 1)
              }}
            />
          ) : current && current.events.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">Событий пока нет.</p>
          ) : current ? (
            <>
              <ol className="divide-y">
                {current.events.map((e) => {
                  const Icon = eventIcon(e.type)
                  const title = e.planItemId ? (itemTitles[e.planItemId] ?? unknownItemLabel) : null
                  const details = eventDetails(e, intensive.timezone)
                  const actor = userName(e.actor)
                  return (
                    <li key={e.id} className="flex gap-3 py-2.5 text-sm">
                      <Icon className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                          <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                          {e.redacted && (
                            <Badge variant="muted">
                              <Lock aria-hidden />
                              Детали скрыты
                            </Badge>
                          )}
                        </p>
                        {title && <p className="break-words text-[13px] text-foreground">{title}</p>}
                        {details.length > 0 && (
                          <p className="break-words text-xs text-muted-foreground">{details.join(' · ')}</p>
                        )}
                        <p className="text-xs tabular-nums text-muted-foreground">
                          {formatInstantInTz(e.createdAt, intensive.timezone)}
                          {actor ? ` · ${actor}` : ''}
                        </p>
                        {e.redacted && (
                          <p className="text-xs text-muted-foreground">Сообщение вам недоступно — видны только статус и время.</p>
                        )}
                      </div>
                    </li>
                  )
                })}
              </ol>
              {moreError && <p className="pt-2 text-xs text-destructive">{moreError}</p>}
              {current.nextCursor && (
                <div className="pt-3">
                  <Button type="button" variant="outline" size="sm" onClick={loadMore} disabled={moreLoading}>
                    {moreLoading && <Spinner className="size-4" />}
                    Показать ещё
                  </Button>
                </div>
              )}
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  )
}
