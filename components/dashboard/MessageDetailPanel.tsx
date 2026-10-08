"use client"

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Ban,
  CalendarClock,
  CheckCircle2,
  CircleAlert,
  ExternalLink,
  Loader2,
  MessageSquareOff,
  Pencil,
  RotateCcw,
  Send,
  Trash2,
  X,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { MessageStatusBadge } from '@/components/common/MessageStatusBadge'
import { getMessageActions, type ActionViewer } from '@/lib/message-actions'
import { sanitizeErrorReason } from '@/lib/message-status'
import { buildSendTimeline, type TimelineEvent } from '@/lib/send-timeline'
import { safeExternalHref } from '@/lib/sanitize'
import { formatUntil } from '@/lib/message-queue'
import { getTimeZoneLabel } from '@/lib/schedule-datetime'
import { cn } from '@/lib/utils'
import { channelLabel, userLabel, type ExternalStatus, type QueueMessage } from './types'

interface FreshData {
  message: Partial<QueueMessage>
  externalStatus: ExternalStatus
  /** Ссылка на сообщение в Rocket.Chat (сервер определил тип комнаты) или null */
  rcPermalink: string | null
}

/** Из ответа GET /api/messages/[id] берём только нужные поля (там лежит и полная запись пространства). */
function pickFresh(data: unknown): FreshData | null {
  if (!data || typeof data !== 'object') return null
  const { message, externalStatus, rcPermalink } = data as {
    message?: Record<string, unknown>
    externalStatus?: string
    rcPermalink?: unknown
  }
  if (!message || typeof message !== 'object' || typeof message.id !== 'string') return null
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined)
  const strOrNull = (v: unknown) => (typeof v === 'string' ? v : v === null ? null : undefined)
  const picked: Partial<QueueMessage> = {
    id: message.id,
    status: str(message.status),
    message: str(message.message),
    scheduledFor: str(message.scheduledFor),
    sentAt: strOrNull(message.sentAt),
    error: strOrNull(message.error),
    channelId: strOrNull(message.channelId),
    channelName: strOrNull(message.channelName),
    messageId_RC: strOrNull(message.messageId_RC),
    createdAt: str(message.createdAt),
    updatedAt: str(message.updatedAt),
  }
  // undefined-поля не должны затирать данные из списка
  for (const k of Object.keys(picked) as (keyof QueueMessage)[]) {
    if (picked[k] === undefined) delete picked[k]
  }
  const ext: ExternalStatus =
    externalStatus === 'DELETED_IN_RC' || externalStatus === 'EDITED_IN_RC' || externalStatus === 'SYNCHRONIZED'
      ? externalStatus
      : 'UNKNOWN'
  return { message: picked, externalStatus: ext, rcPermalink: safeExternalHref(typeof rcPermalink === 'string' ? rcPermalink : null) }
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-x-3 gap-y-0.5 py-2 text-sm sm:grid-cols-[7.5rem_minmax(0,1fr)]">
      <dt className="text-[13px] text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

const TIMELINE_ICONS = {
  created: CalendarClock,
  scheduled: CalendarClock,
  sent: Send,
  failed: CircleAlert,
  cancelled: Ban,
} as const

const TONE_DOT: Record<TimelineEvent['tone'], string> = {
  neutral: 'text-muted-foreground',
  success: 'text-emerald-700 dark:text-emerald-300',
  danger: 'text-destructive',
  muted: 'text-muted-foreground',
}

function formatEventTime(at: string | null): string {
  if (!at) return '—'
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

/**
 * История отправки: вертикальная линия, время слева, событие справа. Статус передаётся иконкой и текстом,
 * а не только цветом. Показываем только то, что хранится в записи (итог отправки, без «попыток»).
 */
function SendTimeline({ events, note }: { events: TimelineEvent[]; note: string | null }) {
  if (events.length === 0) return null
  return (
    <section aria-label="История отправки" className="space-y-2">
      <h3 className="text-[13px] font-medium">История</h3>
      <ol className="space-y-0">
        {events.map((e, i) => {
          const Icon = TIMELINE_ICONS[e.key]
          const href = safeExternalHref(e.link)
          const last = i === events.length - 1
          return (
            <li key={e.key} className="grid grid-cols-[4.75rem_1.25rem_minmax(0,1fr)] gap-x-2 text-sm">
              <time
                dateTime={e.at ?? undefined}
                className="pt-0.5 text-right text-xs tabular-nums text-muted-foreground"
              >
                {formatEventTime(e.at)}
              </time>
              <div className="relative flex justify-center">
                {!last && <span aria-hidden className="absolute bottom-0 top-5 w-px bg-border" />}
                <span
                  aria-hidden
                  className={cn(
                    'z-10 mt-0.5 flex size-5 items-center justify-center rounded-full border bg-card',
                    e.state === 'upcoming' && 'border-dashed',
                    TONE_DOT[e.tone],
                  )}
                >
                  <Icon className="size-3" />
                </span>
              </div>
              <div className={cn('min-w-0 pb-3', last && 'pb-0')}>
                <p className="break-words font-medium leading-snug">
                  {e.label}
                  {e.state === 'upcoming' && <span className="font-normal text-muted-foreground"> · ещё впереди</span>}
                </p>
                {e.detail && <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{e.detail}</p>}
                {href && (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex items-center gap-1 text-[13px] text-primary underline-offset-4 hover:underline focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
                  >
                    <ExternalLink className="size-3.5" aria-hidden />
                    Открыть в Rocket.Chat
                    <span className="sr-only"> (откроется в новой вкладке)</span>
                  </a>
                )}
              </div>
            </li>
          )
        })}
      </ol>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
    </section>
  )
}

/**
 * Панель деталей сообщения. Данные из списка показываются сразу, свежие — подгружаются одним запросом
 * GET /api/messages/[id] (не на каждую строку). Компонент нужно монтировать с key={message.id},
 * чтобы при смене сообщения не оставалось данных предыдущего.
 * Изменение времени — через существующий диалог (MessageDialog), он открывается родителем (onEdit).
 */
export function MessageDetailPanel({
  message,
  inList,
  viewer,
  now,
  busy,
  justSaved,
  layout,
  onClose,
  onEdit,
  onRetry,
  onDelete,
}: {
  message: QueueMessage
  /** Сообщение всё ещё есть в загруженном списке (после перезагрузки списка могло пропасть — например, отправилось) */
  inList: boolean
  viewer: ActionViewer | null
  now: Date
  busy: boolean
  /** Только что успешно сохранено (родитель сбрасывает флаг через несколько секунд) */
  justSaved: boolean
  layout: 'inline' | 'sheet'
  onClose: () => void
  onEdit: (message: QueueMessage) => void
  onRetry: (message: QueueMessage) => void
  onDelete: (message: QueueMessage) => void
}) {
  const id = message.id
  const [tick, setTick] = useState(0)
  // Результат привязан к ключу запроса: после сохранения/перезагрузки списка старый ответ не подмешивается
  const [fresh, setFresh] = useState<(FreshData & { key: string }) | null>(null)
  const [problem, setProblem] = useState<{ key: string; kind: 'error' | 'gone' } | null>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const requestKey = `${message.updatedAt ?? ''}|${inList ? 1 : 0}|${tick}`
  const freshNow = fresh?.key === requestKey ? fresh : null
  const problemNow = problem?.key === requestKey ? problem.kind : null
  const loading = !freshNow && !problemNow
  const gone = problemNow === 'gone'
  const loadFailed = problemNow === 'error'

  // Фокус в панель при открытии (inline). В режиме sheet фокусом управляет Radix.
  useEffect(() => {
    if (layout === 'inline') headingRef.current?.focus({ preventScroll: true })
  }, [layout])

  useEffect(() => {
    const ctrl = new AbortController()
    const key = requestKey
    fetch(`/api/messages/${encodeURIComponent(id)}`, { signal: ctrl.signal })
      .then(async (res) => {
        if (res.status === 404 || res.status === 403) {
          setProblem({ key, kind: 'gone' })
          return
        }
        if (!res.ok) {
          setProblem({ key, kind: 'error' })
          return
        }
        const picked = pickFresh(await res.json().catch(() => null))
        if (!picked) {
          setProblem({ key, kind: 'error' })
          return
        }
        setFresh({ ...picked, key })
      })
      .catch((e: unknown) => {
        if ((e as { name?: string })?.name === 'AbortError') return
        setProblem({ key, kind: 'error' })
      })
    return () => ctrl.abort()
  }, [id, requestKey])

  const view: QueueMessage = useMemo(
    () => (freshNow ? { ...message, ...freshNow.message } : message),
    [message, freshNow],
  )
  const externalStatus = freshNow?.externalStatus
  const rcPermalink = view.status === 'SENT' ? (freshNow?.rcPermalink ?? null) : null
  const actions = getMessageActions(view, viewer)
  const at = new Date(view.scheduledFor)
  const atValid = !Number.isNaN(at.getTime())
  const tz = atValid ? getTimeZoneLabel(at).label : ''
  const reason = view.status === 'FAILED' ? sanitizeErrorReason(view.error) : null
  const sender = userLabel(view.user)
  const scheduledBy = userLabel(view.scheduledBy)
  const workspaceId = view.workspace?.id ?? view.workspaceId
  const timeline = useMemo(() => buildSendTimeline({ ...view, rcPermalink }, now), [view, rcPermalink, now])

  const whenText = atValid
    ? at.toLocaleString('ru-RU', {
        weekday: 'long',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : '—'

  const headerCloseButton = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className="-mr-1.5 size-9 shrink-0 pointer-coarse:size-11"
      onClick={onClose}
      aria-label="Закрыть панель"
    >
      <X />
    </Button>
  )

  if (gone) {
    return (
      <div className="flex flex-col">
        <div className={cn('flex items-start justify-between gap-2 border-b px-4 py-3', layout === 'sheet' && 'pr-12')}>
          <h2 ref={headingRef} tabIndex={-1} className="text-sm font-semibold outline-none">
            Сообщение недоступно
          </h2>
          {layout === 'inline' && headerCloseButton}
        </div>
        <div className="flex flex-col items-center px-6 py-10 text-center">
          <div className="mb-3 flex size-10 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <MessageSquareOff className="size-5" aria-hidden />
          </div>
          <p className="text-sm font-medium">Сообщение удалено или недоступно</p>
          <p className="mt-1 max-w-xs text-[13px] text-muted-foreground text-balance">
            Возможно, его удалили или у вас больше нет доступа. Список можно обновить кнопкой «Обновить».
          </p>
          <Button variant="outline" size="sm" className="mt-4" onClick={onClose}>
            Закрыть
          </Button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className={cn('flex items-start justify-between gap-2 border-b px-4 py-3', layout === 'sheet' && 'pr-12')}>
        <div className="min-w-0 space-y-1.5">
          <h2
            ref={headingRef}
            tabIndex={-1}
            className="break-words text-base font-semibold leading-snug outline-none"
          >
            {channelLabel(view)}
          </h2>
          <div className="flex flex-wrap items-center gap-1.5">
            <MessageStatusBadge status={view.status} scheduledFor={view.scheduledFor} now={now} />
            {externalStatus === 'DELETED_IN_RC' && <Badge variant="danger">Удалено в Rocket.Chat</Badge>}
            {externalStatus === 'EDITED_IN_RC' && <Badge variant="info">Изменено в Rocket.Chat</Badge>}
          </div>
        </div>
        {layout === 'inline' && headerCloseButton}
      </div>

      <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3">
        <div aria-live="polite" className="space-y-2 empty:hidden">
          {loading && (
            <p className="flex items-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="size-3.5 animate-spin" aria-hidden /> Обновляем данные…
            </p>
          )}
          {loadFailed && (
            <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[13px]">
              <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="font-medium">Не удалось обновить данные</p>
                <p className="text-muted-foreground">Показаны данные из списка — они могли устареть.</p>
              </div>
              <Button variant="ghost" size="sm" className="shrink-0" onClick={() => setTick((n) => n + 1)}>
                Повторить
              </Button>
            </div>
          )}
          {justSaved && !loading && (
            <p role="status" className="flex items-center gap-2 text-[13px] text-emerald-700 dark:text-emerald-300">
              <CheckCircle2 className="size-4" aria-hidden /> Изменения сохранены
            </p>
          )}
          {!inList && !!freshNow && view.status !== 'PENDING' && (
            <p className="text-[13px] text-muted-foreground">Сообщение больше не в очереди: его статус изменился.</p>
          )}
        </div>

        <dl className="divide-y">
          <DetailRow label="Время">
            {loading && !atValid ? (
              <Skeleton className="h-4 w-40" />
            ) : (
              <>
                <span className="tabular-nums">{whenText}</span>
                {tz && <span className="block text-xs text-muted-foreground">Часовой пояс: {tz}</span>}
                {view.status === 'PENDING' && atValid && at.getTime() > now.getTime() && (
                  <span className="block text-xs text-muted-foreground">{formatUntil(at, now)}</span>
                )}
              </>
            )}
          </DetailRow>
          {view.status === 'SENT' && view.sentAt && (
            <DetailRow label="Отправлено">
              <span className="tabular-nums">{new Date(view.sentAt).toLocaleString('ru-RU')}</span>
            </DetailRow>
          )}
          <DetailRow label="Канал">{channelLabel(view)}</DetailRow>
          <DetailRow label="Пространство">
            {view.workspace?.workspaceName ?? 'Не указано'}
          </DetailRow>
          {sender && <DetailRow label="Отправитель">{sender}</DetailRow>}
          {scheduledBy && <DetailRow label="Запланировал(а)">{scheduledBy}</DetailRow>}
        </dl>

        {view.status === 'FAILED' && (
          <div role="alert" className="rounded-md border border-destructive/30 px-3 py-2.5 text-sm">
            <p className="font-medium text-destructive">Не отправлено</p>
            <p className="mt-1 break-words text-[13px] text-muted-foreground">
              {reason ?? 'Причина в данных не указана.'}
            </p>
          </div>
        )}

        <SendTimeline events={timeline.events} note={timeline.note} />

        <div className="space-y-1.5">
          <p className="text-[13px] font-medium">Текст сообщения</p>
          <div
            className={cn(
              'max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm leading-relaxed',
              loading && 'opacity-80',
            )}
          >
            {view.message?.trim() ? view.message : <span className="text-muted-foreground">Без текста</span>}
          </div>
        </div>
      </div>

      <div className="space-y-2 border-t px-4 py-3">
        {actions.notOwner && (
          <p className="text-xs text-muted-foreground">Изменять и удалять сообщение может только его автор.</p>
        )}
        <div className="flex flex-wrap gap-2">
          {actions.canEdit && (
            <Button
              size="sm"
              className="pointer-coarse:h-10"
              onClick={() => onEdit(view)}
              disabled={busy || loading}
            >
              <Pencil aria-hidden />
              {view.status === 'SENT' ? 'Редактировать в Rocket.Chat' : 'Изменить время и текст'}
            </Button>
          )}
          {actions.canRetry && (
            <Button size="sm" className="pointer-coarse:h-10" onClick={() => onRetry(view)} disabled={busy || loading}>
              <RotateCcw aria-hidden />
              Повторить отправку
            </Button>
          )}
          {workspaceId && (
            <Button asChild variant="outline" size="sm" className="pointer-coarse:h-10">
              <Link href={`/dashboard/workspaces/${workspaceId}`}>
                <ExternalLink aria-hidden />
                В пространство
              </Link>
            </Button>
          )}
          {actions.canDelete && (
            <Button
              variant="outline"
              size="sm"
              className="text-destructive hover:text-destructive pointer-coarse:h-10 sm:ml-auto"
              onClick={() => onDelete(view)}
              disabled={busy || loading}
            >
              <Trash2 aria-hidden />
              Удалить
            </Button>
          )}
        </div>
      </div>
    </div>
  )
}
