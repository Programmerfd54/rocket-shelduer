'use client'

import { useCallback, useRef, useState } from 'react'
import { History as HistoryIcon, Loader2, RefreshCw, X } from 'lucide-react'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { AUDIENCE_LABELS, apiFetch, formatYmd } from '@/lib/intensives/ui'
import type { HistoryResponse, IntensiveEventDto, IntensiveEventType, MessageStatus, PlanItemAudience } from '@/lib/intensives/types'
import { LoadError, MESSAGE_STATUS_LABELS, errText, formatInstant, useDeferredEffect, useSeq } from './kit'

const EVENT_LABEL: Record<IntensiveEventType, string> = {
  INTENSIVE_CREATED: 'Интенсив создан',
  INTENSIVE_UPDATED: 'Интенсив изменён',
  INTENSIVE_PUBLISHED: 'Интенсив опубликован',
  INTENSIVE_CANCELLED: 'Интенсив отменён',
  INTENSIVE_ARCHIVED: 'Интенсив архивирован',
  PLAN_GENERATED: 'План сформирован из шаблонов',
  PLAN_ITEM_ADDED: 'Пункт добавлен в план',
  PLAN_ITEM_UPDATED: 'Пункт плана изменён',
  PLAN_ITEM_SOURCE_UPDATED: 'Применена новая версия шаблона',
  PLAN_ITEM_SKIPPED: 'Пункт пропущен',
  PLAN_ITEM_UNSKIPPED: 'Пропуск снят',
  PLAN_ITEM_DELETED: 'Пункт удалён из плана',
  MESSAGE_SCHEDULED: 'Сообщение запланировано',
  MESSAGE_REPEAT_SCHEDULED: 'Повтор запланирован',
  MESSAGE_SENT: 'Сообщение отправлено',
  MESSAGE_FAILED: 'Ошибка отправки',
  MESSAGE_CANCELLED: 'Сообщение отменено',
  MESSAGE_RETRIED: 'Повторная попытка отправки',
  MESSAGE_DELETED: 'Сообщение удалено',
  MESSAGE_LINKED: 'Старое сообщение привязано к пункту',
  MESSAGE_DETACHED: 'Сообщение отвязано от интенсива',
}

const FIELD_LABEL: Record<string, string> = {
  name: 'Название',
  description: 'Описание',
  startDate: 'Начало',
  endDate: 'Окончание',
  timezone: 'Часовой пояс',
  title: 'Название',
  body: 'Текст',
  channel: 'Канал',
  dayNumber: 'День',
  time: 'Время',
  audience: 'Аудитория',
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null
}

function plainValue(field: string, v: unknown): string {
  if (v === null || v === undefined || v === '') return 'пусто'
  if ((field === 'startDate' || field === 'endDate') && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return formatYmd(v)
  if (field === 'audience') return AUDIENCE_LABELS[v as PlanItemAudience] ?? String(v)
  if (field === 'body') return 'текст изменён'
  return String(v)
}

/** Человекочитаемые детали события (без текстов сообщений). */
function describe(ev: IntensiveEventDto, tz: string, itemTitle: string | undefined): string[] {
  const d = (ev.details ?? {}) as Record<string, unknown>
  const lines: string[] = []
  if (itemTitle && ev.planItemId) lines.push(`Пункт: ${itemTitle}`)
  const when = str(d.scheduledFor)
  if (when && !ev.type.startsWith('PLAN_') && ev.type !== 'INTENSIVE_UPDATED') lines.push(`Время: ${formatInstant(when, tz, true)}`)
  const sentAt = str(d.sentAt)
  if (sentAt) lines.push(`Фактически: ${formatInstant(sentAt, tz, true)}`)
  const ch = str(d.channelName)
  if (ch) lines.push(`Канал: #${ch.replace(/^#/, '')}`)
  const from = str(d.fromStatus)
  const to = str(d.toStatus)
  if (from && to) {
    lines.push(`Статус: ${MESSAGE_STATUS_LABELS[from as MessageStatus] ?? from} → ${MESSAGE_STATUS_LABELS[to as MessageStatus] ?? to}`)
  } else if (str(d.status)) {
    lines.push(`Статус: ${MESSAGE_STATUS_LABELS[d.status as MessageStatus] ?? String(d.status)}`)
  }
  const err = str(d.error)
  if (err) lines.push(`Причина ошибки: ${err}`)
  const reason = str(d.reason)
  if (reason) lines.push(`Причина: ${reason}`)
  if (d.planEditedFromSnapshot === true) lines.push('Текст изменён вручную относительно снимка')
  if (ev.type === 'INTENSIVE_UPDATED' && d.changes && typeof d.changes === 'object') {
    for (const [field, change] of Object.entries(d.changes as Record<string, { from: unknown; to: unknown }>)) {
      lines.push(`${FIELD_LABEL[field] ?? field}: ${plainValue(field, change?.from)} → ${plainValue(field, change?.to)}`)
    }
  }
  if (ev.type === 'PLAN_GENERATED') {
    if (Array.isArray(d.templateIds)) lines.push(`Добавлено пунктов: ${d.templateIds.length}`)
    if (Array.isArray(d.alreadyInPlan) && d.alreadyInPlan.length > 0) lines.push(`Уже были в плане: ${d.alreadyInPlan.length}`)
  }
  if (ev.type === 'PLAN_ITEM_SOURCE_UPDATED' && Array.isArray(d.fields)) {
    lines.push(`Изменены поля: ${(d.fields as string[]).map((f) => FIELD_LABEL[f] ?? f).join(', ')}`)
  }
  if (ev.type === 'INTENSIVE_CANCELLED' && str(d.resolution)) {
    lines.push(d.resolution === 'cancel_messages' ? 'Ожидающие сообщения отменены' : d.resolution === 'detach_messages' ? 'Ожидающие сообщения отвязаны от интенсива' : '')
  }
  return lines.filter(Boolean)
}

function EventRow({ ev, tz, titles }: { ev: IntensiveEventDto; tz: string; titles: Map<string, string> }) {
  const [raw, setRaw] = useState(false)
  const title = ev.planItemId ? (titles.get(ev.planItemId) ?? str((ev.details ?? {}).title) ?? undefined) : undefined
  const lines = ev.redacted ? [] : describe(ev, tz, title)
  const redactedLines = ev.redacted ? describe({ ...ev, planItemId: null }, tz, undefined) : []
  return (
    <li className="px-3 py-3 sm:px-4">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-baseline sm:gap-4">
        <time dateTime={ev.createdAt} className="w-36 shrink-0 text-xs tabular-nums text-muted-foreground">
          {formatInstant(ev.createdAt, tz, true)}
        </time>
        <div className="min-w-0 flex-1 space-y-0.5">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <p className="text-sm font-medium">{EVENT_LABEL[ev.type] ?? ev.type}</p>
            {ev.redacted && <Badge variant="muted">Скрыто: сообщение недоступно вам</Badge>}
          </div>
          <p className="text-xs text-muted-foreground">
            {ev.actor?.name ? `Автор: ${ev.actor.name}` : ev.type.startsWith('MESSAGE_') && ev.type !== 'MESSAGE_SCHEDULED' ? 'Автор: система' : ev.redacted ? 'Автор скрыт' : 'Автор не указан'}
          </p>
          {(ev.redacted ? redactedLines : lines).map((l) => (
            <p key={l} className="break-words text-[13px] text-pretty">
              {l}
            </p>
          ))}
          {!ev.redacted && ev.details && Object.keys(ev.details).length > 0 && (
            <div>
              <button type="button" className="text-xs text-muted-foreground underline-offset-2 hover:underline focus-visible:underline" onClick={() => setRaw((v) => !v)} aria-expanded={raw}>
                {raw ? 'Скрыть технические данные' : 'Технические данные'}
              </button>
              {raw && <pre className="mt-1 max-h-48 overflow-auto rounded-md border bg-muted/30 p-2 text-[11px]">{JSON.stringify(ev.details, null, 2)}</pre>}
            </div>
          )}
        </div>
      </div>
    </li>
  )
}

function HistorySkeleton() {
  return (
    <div className="divide-y rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка истории">
      {[0, 1, 2, 3, 4].map((i) => (
        <div key={i} className="flex gap-4 px-4 py-3">
          <Skeleton className="h-3 w-28" />
          <div className="flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </div>
      ))}
    </div>
  )
}

export function HistoryTab({
  intensiveId,
  timezone,
  titles,
  itemFilter,
  onClearFilter,
}: {
  intensiveId: string
  timezone: string
  titles: Map<string, string>
  itemFilter: { id: string; title: string } | null
  onClearFilter: () => void
}) {
  const [events, setEvents] = useState<IntensiveEventDto[] | null>(null)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)
  const [more, setMore] = useState(false)
  const [moreError, setMoreError] = useState<string | null>(null)
  const seq = useSeq()
  const genRef = useRef(0)
  const filterId = itemFilter?.id ?? null

  const buildUrl = useCallback(
    (cursor?: string | null) => {
      const q = new URLSearchParams({ limit: '50' })
      if (cursor) q.set('cursor', cursor)
      if (filterId) q.set('planItemId', filterId)
      return `/api/intensives/${intensiveId}/history?${q.toString()}`
    },
    [intensiveId, filterId],
  )

  const loadFirst = useCallback(async () => {
    const token = seq.begin()
    genRef.current = token
    setMore(false)
    setFetching(true)
    setError(null)
    setMoreError(null)
    try {
      const res = await apiFetch<HistoryResponse>(buildUrl())
      if (!seq.isCurrent(token)) return
      setEvents(res.events)
      setNextCursor(res.nextCursor)
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setFetching(false)
    }
  }, [buildUrl, seq])

  useDeferredEffect(() => {
    setEvents(null)
    void loadFirst()
  }, [loadFirst])

  const loadMore = async () => {
    if (!nextCursor || more) return
    const gen = genRef.current
    setMore(true)
    setMoreError(null)
    try {
      const res = await apiFetch<HistoryResponse>(buildUrl(nextCursor))
      if (genRef.current !== gen || !seq.isCurrent(gen)) return
      setEvents((prev) => {
        const seen = new Set((prev ?? []).map((e) => e.id))
        return [...(prev ?? []), ...res.events.filter((e) => !seen.has(e.id))]
      })
      setNextCursor(res.nextCursor)
    } catch (e) {
      if (genRef.current === gen && seq.isCurrent(gen)) setMoreError(errText(e))
    } finally {
      if (genRef.current === gen) setMore(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        {itemFilter && (
          <Badge variant="outline" className="h-7 gap-1.5 px-2 text-[13px] font-normal">
            Пункт: {itemFilter.title}
            <button type="button" onClick={onClearFilter} aria-label="Показать историю всего интенсива" className="rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <X className="size-3.5" aria-hidden />
            </button>
          </Badge>
        )}
        <p className="text-xs text-muted-foreground">Новые события сверху. Попытки отправки учитываются только с момента появления серверного учёта.</p>
        <Button type="button" variant="ghost" size="icon-sm" className="ml-auto" aria-label="Обновить историю" title="Обновить историю" onClick={() => void loadFirst()} disabled={fetching}>
          <RefreshCw className={fetching ? 'animate-spin' : undefined} aria-hidden />
        </Button>
      </div>

      {events === null && fetching && <HistorySkeleton />}
      {error && <LoadError message={events ? `${error} Показаны ранее загруженные события.` : error} onRetry={() => void loadFirst()} retrying={fetching} />}
      {events !== null && events.length === 0 && !error && (
        <EmptyState icon={<HistoryIcon />} title="Событий пока нет" description={itemFilter ? 'По этому пункту ещё ничего не происходило.' : 'Здесь появятся изменения интенсива, плана и отправок.'} />
      )}
      {events !== null && events.length > 0 && (
        <ul className="divide-y overflow-hidden rounded-lg border bg-card">
          {events.map((ev) => (
            <EventRow key={ev.id} ev={ev} tz={timezone} titles={titles} />
          ))}
        </ul>
      )}
      {moreError && <LoadError message={moreError} onRetry={() => void loadMore()} retrying={more} />}
      {nextCursor && (
        <div className="flex justify-center">
          <Button type="button" variant="outline" size="sm" onClick={() => void loadMore()} disabled={more}>
            {more && <Loader2 className="animate-spin" aria-hidden />}
            Показать ещё
          </Button>
        </div>
      )}
    </div>
  )
}
