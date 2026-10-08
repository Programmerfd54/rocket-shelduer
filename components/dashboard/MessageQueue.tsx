"use client"

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarCheck, CalendarClock, CheckCircle2, RotateCcw, SearchX, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { filterByView, pluralRu, type QueueView } from '@/lib/message-queue'
import type { ActionViewer } from '@/lib/message-actions'
import { MessageRow } from './MessageRow'
import { userLabel, type QueueMessage, type QueueUser } from './types'

const PAGE_SIZE = 30

const VIEW_LABELS: Record<QueueView, string> = {
  today: 'Сегодня',
  queue: 'Очередь',
  attention: 'Требуют внимания',
}

const segmentClass = (active: boolean) =>
  cn(
    'inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50 pointer-coarse:min-h-10',
    active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground',
  )

export interface QueueFilters {
  workspaceId: string
  userId: string | null
}

export function MessageQueue({
  messages,
  loading,
  pendingError,
  failedError,
  failedLimit,
  failedLimited,
  now,
  viewer,
  view,
  onViewChange,
  filters,
  onFiltersChange,
  users,
  selectedId,
  busyId,
  onSelect,
  onEdit,
  onRetryMessage,
  onDelete,
  onReload,
}: {
  /** Все загруженные: PENDING (полностью) + FAILED (до failedLimit) */
  messages: QueueMessage[]
  loading: boolean
  pendingError: boolean
  failedError: boolean
  failedLimit: number
  failedLimited: boolean
  now: Date
  viewer: ActionViewer | null
  view: QueueView
  onViewChange: (v: QueueView) => void
  filters: QueueFilters
  onFiltersChange: (f: QueueFilters) => void
  /** Пользователи для фильтра (только SUP/ADM/Lead_SUP, как раньше) */
  users: QueueUser[]
  selectedId: string | null
  busyId: string | null
  onSelect: (m: QueueMessage) => void
  onEdit: (m: QueueMessage) => void
  onRetryMessage: (m: QueueMessage) => void
  onDelete: (m: QueueMessage) => void
  onReload: () => void
}) {
  // Сколько показано: сбрасывается при смене представления/фильтров (а не при закрытии панели)
  const scopeKey = `${view}|${filters.workspaceId}|${filters.userId ?? ''}`
  const [shownState, setShownState] = useState({ key: scopeKey, n: PAGE_SIZE })
  const shownCount = shownState.key === scopeKey ? shownState.n : PAGE_SIZE

  const workspaceOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const m of messages) {
      const id = m.workspace?.id ?? m.workspaceId
      if (id && !map.has(id)) map.set(id, m.workspace?.workspaceName ?? 'Без названия')
    }
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [messages])

  const scoped = useMemo(
    () =>
      filters.workspaceId === 'all'
        ? messages
        : messages.filter((m) => (m.workspace?.id ?? m.workspaceId) === filters.workspaceId),
    [messages, filters.workspaceId],
  )

  const counts = useMemo(
    () => ({
      today: filterByView(scoped, 'today', now).length,
      queue: filterByView(scoped, 'queue', now).length,
      attention: filterByView(scoped, 'attention', now).length,
    }),
    [scoped, now],
  )

  const visible = useMemo(() => filterByView(scoped, view, now), [scoped, view, now])
  const rows = visible.slice(0, shownCount)

  const selectedUser = filters.userId ? users.find((u) => u.id === filters.userId) : null
  const selectedWorkspaceName =
    filters.workspaceId !== 'all' ? workspaceOptions.find((w) => w.id === filters.workspaceId)?.name ?? 'Пространство' : null
  const hasFilters = filters.workspaceId !== 'all' || !!filters.userId
  const resetFilters = () => onFiltersChange({ workspaceId: 'all', userId: null })

  // Если выбранное пространство исчезло из данных (после перезагрузки) — фильтр нельзя оставлять «невидимым»
  const workspaceOptionMissing = filters.workspaceId !== 'all' && !workspaceOptions.some((w) => w.id === filters.workspaceId)

  const caption: string[] = []
  if (view === 'today') {
    caption.push('Запланированное на сегодня. Уже отправленные сегодня здесь не показываются.')
  } else if (view === 'queue') {
    caption.push('Все ожидающие отправки сообщения по времени.')
  } else {
    caption.push('Не отправленные и ожидающие с прошедшим временем.')
    if (failedLimited) caption.push(`Показаны последние ${failedLimit} не отправленных — более ранние здесь не видны.`)
  }

  const countLabel = (n: number, partial = false) => (pendingError ? '—' : `${n}${partial ? '+' : ''}`)

  const onListKeyDown = (e: React.KeyboardEvent<HTMLUListElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const target = e.target as HTMLElement
    if (!target.matches('[data-row-button]')) return
    const buttons = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[data-row-button]'))
    const idx = buttons.indexOf(target)
    const next = buttons[idx + (e.key === 'ArrowDown' ? 1 : -1)]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <section aria-label="Очередь сообщений" className="space-y-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Представление очереди">
          {(['today', 'queue', 'attention'] as const).map((v) => (
            <button
              key={v}
              type="button"
              aria-pressed={view === v}
              className={segmentClass(view === v)}
              onClick={() => onViewChange(v)}
            >
              {VIEW_LABELS[v]}
              <span
                className={cn(
                  'text-xs tabular-nums',
                  v === 'attention' && counts.attention > 0 && !pendingError && 'font-semibold text-foreground',
                  view !== v && 'text-muted-foreground',
                )}
              >
                {loading ? '…' : countLabel(counts[v], v === 'attention' && failedLimited)}
              </span>
            </button>
          ))}
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          {users.length > 0 && (
            <Select
              value={filters.userId ?? 'all'}
              onValueChange={(v) => onFiltersChange({ ...filters, userId: v === 'all' ? null : v })}
            >
              <SelectTrigger size="sm" className="w-full min-w-40 sm:w-[190px]" aria-label="Фильтр по пользователю">
                <SelectValue placeholder="Мои сообщения" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Мои сообщения</SelectItem>
                {users.map((u) => (
                  <SelectItem key={u.id} value={u.id ?? ''}>
                    {userLabel(u)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {(workspaceOptions.length > 1 || filters.workspaceId !== 'all') && (
            <Select value={filters.workspaceId} onValueChange={(v) => onFiltersChange({ ...filters, workspaceId: v })}>
              <SelectTrigger size="sm" className="w-full min-w-40 sm:w-[190px]" aria-label="Фильтр по пространству">
                <SelectValue placeholder="Все пространства" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все пространства</SelectItem>
                {workspaceOptionMissing && <SelectItem value={filters.workspaceId}>{selectedWorkspaceName}</SelectItem>}
                {workspaceOptions.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </div>

      {hasFilters && (
        <div className="flex flex-wrap items-center gap-1.5" aria-label="Выбранные фильтры" role="group">
          {filters.userId && (
            <FilterChip
              label={`Пользователь: ${selectedUser ? userLabel(selectedUser) : 'выбран'}`}
              onRemove={() => onFiltersChange({ ...filters, userId: null })}
            />
          )}
          {selectedWorkspaceName && (
            <FilterChip
              label={`Пространство: ${selectedWorkspaceName}`}
              onRemove={() => onFiltersChange({ ...filters, workspaceId: 'all' })}
            />
          )}
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetFilters}>
            <RotateCcw /> Сбросить
          </Button>
        </div>
      )}

      <p className="text-xs text-muted-foreground">{caption.join(' ')}</p>

      {view === 'attention' && (failedError || pendingError) && !loading && (
        <div role="alert" className="flex items-start gap-2 rounded-md border border-amber-500/30 bg-amber-500/5 px-3 py-2 text-[13px]">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <p className="min-w-0 flex-1">
            {failedError
              ? 'Не удалось загрузить не отправленные сообщения — список ниже может быть неполным.'
              : 'Не удалось загрузить ожидающие сообщения — список ниже может быть неполным.'}
          </p>
          <Button variant="ghost" size="sm" className="shrink-0" onClick={onReload}>
            Повторить
          </Button>
        </div>
      )}

      {loading ? (
        <div className="divide-y rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка очереди">
          {[1, 2, 3, 4].map((i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <div className="w-14 space-y-1.5">
                <Skeleton className="h-4 w-11" />
                <Skeleton className="h-3 w-10" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/3" />
                <Skeleton className="h-3.5 w-3/4" />
              </div>
              <Skeleton className="hidden h-5 w-28 sm:block" />
            </div>
          ))}
        </div>
      ) : pendingError && view !== 'attention' ? (
        <QueueEmpty
          icon={<AlertTriangle />}
          title="Не удалось загрузить очередь"
          description="Проверьте подключение к интернету и повторите попытку."
          action={
            <Button variant="outline" size="sm" onClick={onReload}>
              Повторить
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        hasFilters ? (
          <QueueEmpty
            icon={<SearchX />}
            title="По выбранным фильтрам ничего нет"
            description="Измените или сбросьте фильтры, чтобы увидеть остальные сообщения."
            action={
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            }
          />
        ) : view === 'attention' ? (
          failedError || pendingError ? (
            <QueueEmpty icon={<AlertTriangle />} title="Не удалось проверить все сообщения" description="Повторите загрузку, чтобы увидеть, что требует внимания." />
          ) : (
            <QueueEmpty
              icon={<CheckCircle2 />}
              title="Ничего не требует внимания"
              description="Нет не отправленных сообщений и сообщений с прошедшим временем."
            />
          )
        ) : view === 'today' ? (
          <QueueEmpty
            icon={<CalendarCheck />}
            title="На сегодня ничего не запланировано"
            description={
              counts.queue > 0
                ? `В очереди ${counts.queue} ${pluralRu(counts.queue, ['сообщение', 'сообщения', 'сообщений'])} на другие дни.`
                : 'Запланируйте сообщение — оно появится здесь.'
            }
            action={
              counts.queue > 0 ? (
                <Button variant="outline" size="sm" onClick={() => onViewChange('queue')}>
                  Показать очередь
                </Button>
              ) : undefined
            }
          />
        ) : (
          <QueueEmpty
            icon={<CalendarClock />}
            title="Очередь пуста"
            description="Нет сообщений, ожидающих отправки. Запланируйте сообщение или откройте календарь."
            action={
              <Button variant="outline" size="sm" asChild>
                <Link href="/dashboard/calendar">Открыть календарь</Link>
              </Button>
            }
          />
        )
      ) : (
        <div className="overflow-hidden rounded-lg border bg-card">
          <ul className="divide-y" onKeyDown={onListKeyDown}>
            {rows.map((m) => (
              <MessageRow
                key={m.id}
                message={m}
                now={now}
                viewer={viewer}
                selected={m.id === selectedId}
                busy={busyId === m.id}
                onSelect={onSelect}
                onEdit={onEdit}
                onRetry={onRetryMessage}
                onDelete={onDelete}
              />
            ))}
          </ul>
          {visible.length > rows.length && (
            <div className="border-t p-1.5">
              <Button
                variant="ghost"
                size="sm"
                className="w-full text-muted-foreground"
                onClick={() => setShownState({ key: scopeKey, n: shownCount + PAGE_SIZE })}
              >
                Показать ещё (показано {rows.length} из {visible.length})
              </Button>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className="inline-flex max-w-full items-center gap-1 rounded-md border bg-muted/50 py-0.5 pl-2 pr-0.5 text-xs">
      <span className="min-w-0 truncate">{label}</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Убрать фильтр: ${label}`}
        className="inline-flex size-6 items-center justify-center rounded text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </span>
  )
}

function QueueEmpty({
  icon,
  title,
  description,
  action,
}: {
  icon: React.ReactNode
  title: string
  description?: string
  action?: React.ReactNode
}) {
  return (
    <div className="rounded-lg border border-dashed">
      <div className="flex flex-col items-center px-4 py-10 text-center">
        <div className="mb-2.5 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:size-4">
          {icon}
        </div>
        <p className="text-sm font-medium">{title}</p>
        {description && <p className="mt-0.5 max-w-sm text-[13px] text-muted-foreground text-balance">{description}</p>}
        {action && <div className="mt-3">{action}</div>}
      </div>
    </div>
  )
}
