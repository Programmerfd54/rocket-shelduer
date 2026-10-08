'use client'

/**
 * Общие мелкие компоненты и хелперы админки интенсивов (локальные для components/intensives/admin).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type DependencyList, type ReactNode } from 'react'
import { AlertCircle, AlertTriangle, CircleHelp, Loader2, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { cn } from '@/lib/utils'
import { ApiError, STATE_LABELS, INTENSIVE_STATUS_LABELS, PHASE_LABELS, formatRange, pluralize } from '@/lib/intensives/ui'
import type {
  IntensiveOverlapRef,
  IntensivePhase,
  IntensiveStatus,
  MessageStatus,
  PlanItemState,
  PlanProgress,
} from '@/lib/intensives/types'

/* ───────────── Запросы ───────────── */

/**
 * Защита от «позднего ответа»: begin() выдаёт токен, isCurrent(token) — актуален ли он.
 * При размонтировании все токены протухают.
 */
export function useSeq() {
  const ref = useRef(0)
  useEffect(() => {
    const r = ref
    return () => {
      r.current += 1
    }
  }, [])
  return useMemo(
    () => ({
      begin: () => ++ref.current,
      isCurrent: (token: number) => token === ref.current,
      invalidate: () => {
        ref.current += 1
      },
    }),
    [],
  )
}

/**
 * useEffect, который запускается в микротаске: запросы данных начинаются после коммита без синхронных
 * setState внутри тела эффекта (в StrictMode первый, отменённый запуск ничего не делает).
 */
export function useDeferredEffect(effect: () => void | (() => void), deps: DependencyList) {
  useEffect(() => {
    let cancelled = false
    let cleanup: void | (() => void)
    queueMicrotask(() => {
      if (!cancelled) cleanup = effect()
    })
    return () => {
      cancelled = true
      if (typeof cleanup === 'function') cleanup()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}

export const NETWORK_ERROR_TEXT = 'Нет связи с сервером. Проверьте соединение и повторите.'

export function errText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return NETWORK_ERROR_TEXT
}

export function fieldErrorsOf(e: unknown): Record<string, string> {
  if (e instanceof ApiError && e.body.fieldErrors && typeof e.body.fieldErrors === 'object') {
    return e.body.fieldErrors as Record<string, string>
  }
  return {}
}

/** Блок «не удалось загрузить» (ошибка ≠ пусто) с повтором. */
export function LoadError({
  message,
  onRetry,
  retrying,
  className,
}: {
  message: string
  onRetry?: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col gap-3 rounded-lg border bg-card p-4 sm:flex-row sm:items-center', className)}>
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
        <div className="min-w-0">
          <p className="text-sm font-medium">Не удалось загрузить данные</p>
          <p className="text-[13px] text-muted-foreground text-pretty">{message}</p>
        </div>
      </div>
      {onRetry && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying}>
          {retrying ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
          Повторить
        </Button>
      )}
    </div>
  )
}

/** Плоское предупреждение (без цветных заливок): иконка + текст. */
export function InlineNotice({
  tone = 'warning',
  children,
  className,
}: {
  tone?: 'warning' | 'danger' | 'info'
  children: ReactNode
  className?: string
}) {
  return (
    <div
      role={tone === 'danger' ? 'alert' : 'note'}
      className={cn('flex items-start gap-2 rounded-md border bg-card px-3 py-2 text-[13px]', className)}
    >
      <AlertTriangle
        className={cn(
          'mt-0.5 size-4 shrink-0',
          tone === 'warning' && 'text-amber-600 dark:text-amber-400',
          tone === 'danger' && 'text-destructive',
          tone === 'info' && 'text-muted-foreground',
        )}
        aria-hidden
      />
      <div className="min-w-0 flex-1 text-pretty">{children}</div>
    </div>
  )
}

/* ───────────── Диалог с защитой от потери несохранённого ───────────── */

export function GuardedDialog({
  open,
  onOpenChange,
  dirty,
  busy,
  title,
  description,
  footer,
  children,
  className,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  /** Есть несохранённые изменения → при закрытии спросим */
  dirty: boolean
  /** Идёт запрос → закрыть нельзя */
  busy?: boolean
  title: ReactNode
  description?: ReactNode
  footer: ReactNode
  children: ReactNode
  className?: string
}) {
  const [askDiscard, setAskDiscard] = useState(false)

  useEffect(() => {
    if (!open || !dirty) return
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault()
      e.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [open, dirty])

  const requestClose = (next: boolean) => {
    if (next) {
      onOpenChange(true)
      return
    }
    if (busy) return
    if (dirty) setAskDiscard(true)
    else onOpenChange(false)
  }

  return (
    <>
      <Dialog open={open} onOpenChange={requestClose}>
        <DialogContent className={cn('max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-lg', className)}>
          <DialogHeader className="border-b px-5 py-4 pr-12">
            <DialogTitle>{title}</DialogTitle>
            {description ? <DialogDescription>{description}</DialogDescription> : <DialogDescription className="sr-only">{typeof title === 'string' ? title : 'Форма'}</DialogDescription>}
          </DialogHeader>
          <div className="min-h-0 overflow-y-auto px-5 py-4">{children}</div>
          <DialogFooter className="border-t px-5 py-3">{footer}</DialogFooter>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={askDiscard}
        onOpenChange={setAskDiscard}
        title="Закрыть без сохранения?"
        description="Введённые данные будут потеряны."
        confirmLabel="Закрыть без сохранения"
        cancelLabel="Продолжить редактирование"
        destructive
        onConfirm={() => {
          setAskDiscard(false)
          onOpenChange(false)
        }}
      />
    </>
  )
}

/* ───────────── Бейджи ───────────── */

const STATUS_VARIANT: Record<IntensiveStatus, 'muted' | 'outline' | 'danger' | 'secondary'> = {
  DRAFT: 'muted',
  PUBLISHED: 'outline',
  CANCELLED: 'danger',
  ARCHIVED: 'secondary',
}

const PHASE_VARIANT: Record<IntensivePhase, 'success' | 'info' | 'muted'> = {
  RUNNING: 'success',
  UPCOMING: 'info',
  FINISHED: 'muted',
}

export function IntensiveBadges({ status, phase }: { status: IntensiveStatus; phase: IntensivePhase | null }) {
  return (
    <>
      <Badge variant={STATUS_VARIANT[status]}>{INTENSIVE_STATUS_LABELS[status]}</Badge>
      {status === 'PUBLISHED' && phase && <Badge variant={PHASE_VARIANT[phase]}>{PHASE_LABELS[phase]}</Badge>}
    </>
  )
}

const STATE_VARIANT: Record<PlanItemState, 'muted' | 'info' | 'warning' | 'success' | 'danger' | 'secondary'> = {
  NOT_SCHEDULED: 'muted',
  SCHEDULED: 'info',
  AWAITING_OVERDUE: 'warning',
  SENT: 'success',
  FAILED: 'danger',
  CANCELLED: 'muted',
  SKIPPED: 'secondary',
}

export function StateBadge({ state }: { state: PlanItemState }) {
  return <Badge variant={STATE_VARIANT[state]}>{STATE_LABELS[state]}</Badge>
}

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  PENDING: 'Запланировано',
  SENT: 'Отправлено',
  FAILED: 'Ошибка',
  CANCELLED: 'Отменено',
}

export const MESSAGE_STATUS_VARIANT: Record<MessageStatus, 'info' | 'success' | 'danger' | 'muted'> = {
  PENDING: 'info',
  SENT: 'success',
  FAILED: 'danger',
  CANCELLED: 'muted',
}

/* ───────────── Прогресс ───────────── */

export function ProgressHelp() {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" aria-label="Как считается прогресс" className="text-muted-foreground">
          <CircleHelp aria-hidden />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 text-[13px]">
        <p className="mb-1.5 text-sm font-semibold">Как считается прогресс</p>
        <ul className="list-disc space-y-1 pl-4 text-muted-foreground">
          <li>Считается по пунктам плана этого интенсива, а не по шаблонам и не по странице списка.</li>
          <li>Пункт выполнен, если есть хотя бы одна успешная отправка. Несколько отправок — это один выполненный пункт.</li>
          <li>Пропущенный пункт не считается отправленным и не входит в «Осталось».</li>
          <li>«Требуют внимания» — ошибки отправки, просроченные ожидающие сообщения и повторы с ошибкой.</li>
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/** «Отправлено 18 из 24 · Пропущено 2 · Осталось 4» */
export function progressSentence(p: PlanProgress): string {
  if (p.total === 0) return 'План пуст'
  const parts = [`Отправлено ${p.completed} из ${p.total}`]
  if (p.skipped > 0) parts.push(`Пропущено ${p.skipped}`)
  parts.push(`Осталось ${p.remaining}`)
  return parts.join(' · ')
}

export function ProgressSummary({
  progress,
  partial,
  compact,
  status,
  className,
}: {
  progress: PlanProgress | null
  partial?: boolean
  compact?: boolean
  status?: IntensiveStatus
  className?: string
}) {
  if (!progress) return <p className={cn('text-[13px] text-muted-foreground', className)}>Нет данных о прогрессе</p>
  if (progress.total === 0) {
    return (
      <p className={cn('text-[13px] text-muted-foreground', className)}>
        {status === 'DRAFT' || !status ? 'План не сформирован' : 'В плане нет пунктов'}
      </p>
    )
  }
  const pct = Math.round((progress.completed / progress.total) * 100)
  return (
    <div className={cn('space-y-1.5', className)}>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[13px]">
        <span className="font-medium tabular-nums">{progressSentence(progress)}</span>
        {!compact && <ProgressHelp />}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-valuenow={progress.completed}
        aria-label="Выполнено пунктов плана"
        className="h-1.5 w-full overflow-hidden rounded-sm bg-muted"
      >
        <div className="h-full bg-primary" style={{ width: `${pct}%` }} />
      </div>
      {!compact ? (
        <p className="text-xs text-muted-foreground tabular-nums">
          Запланировано {progress.scheduled} · Не запланировано {progress.notScheduled}
          {progress.failed > 0 && ` · Ошибок ${progress.failed}`}
          {progress.needsAttention > 0 && ` · Требуют внимания ${progress.needsAttention}`}
        </p>
      ) : (
        progress.needsAttention > 0 && (
          <p className="text-xs text-amber-700 dark:text-amber-400">Требуют внимания: {progress.needsAttention}</p>
        )
      )}
      {partial && <p className="text-xs text-muted-foreground">Доступные вам анонсы</p>}
    </div>
  )
}

/* ───────────── Форматирование ───────────── */

/** Период с годом: «12–25 октября 2026». */
export function periodLabel(start: string, end: string): string {
  const base = formatRange(start, end)
  return start.slice(0, 4) === end.slice(0, 4) ? `${base} ${start.slice(0, 4)}` : base
}

/** Момент (ISO UTC) в часовом поясе интенсива: «12 окт., 10:00». */
export function formatInstant(iso: string | null | undefined, timeZone?: string, withYear = false): string {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  const opts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
    hour: '2-digit',
    minute: '2-digit',
  }
  try {
    return new Intl.DateTimeFormat('ru-RU', { ...opts, timeZone }).format(d)
  } catch {
    return new Intl.DateTimeFormat('ru-RU', opts).format(d)
  }
}

/** «GMT+03:00» для пояса. */
export function tzOffsetLabel(tz: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'longOffset' }).formatToParts(new Date())
    const v = parts.find((p) => p.type === 'timeZoneName')?.value ?? ''
    return v === 'GMT' ? 'UTC+00:00' : v.replace('GMT', 'UTC')
  } catch {
    return ''
  }
}

export function overlapText(o: IntensiveOverlapRef): string {
  return `«${o.name}» (${periodLabel(o.startDate, o.endDate)}, ${INTENSIVE_STATUS_LABELS[o.status].toLowerCase()})`
}

export function daysLabel(n: number): string {
  return `${n} ${pluralize(n, 'день', 'дня', 'дней')}`
}

/** Состояние «идёт запрос» для действий с несколькими независимыми кнопками. */
export function useBusyKey() {
  const [busy, setBusy] = useState<string | null>(null)
  const run = useCallback(async <T,>(key: string, fn: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key)
    try {
      return await fn()
    } finally {
      setBusy(null)
    }
  }, [])
  return { busy, run }
}

/** Радио-вариант с заголовком и пояснением (нативный input — работает с клавиатурой и скринридерами). */
export function RadioRow({
  name,
  value,
  checked,
  onChange,
  title,
  description,
  disabled,
}: {
  name: string
  value: string
  checked: boolean
  onChange: (value: string) => void
  title: ReactNode
  description?: ReactNode
  disabled?: boolean
}) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-start gap-2.5 rounded-md border bg-background px-3 py-2.5 text-sm transition-colors hover:border-foreground/25',
        checked && 'border-foreground/40',
        disabled && 'cursor-not-allowed opacity-60',
      )}
    >
      <input
        type="radio"
        name={name}
        value={value}
        checked={checked}
        disabled={disabled}
        onChange={() => onChange(value)}
        className="mt-0.5 size-4 shrink-0 accent-[var(--primary)]"
      />
      <span className="min-w-0">
        <span className="block font-medium">{title}</span>
        {description && <span className="block text-xs text-muted-foreground text-pretty">{description}</span>}
      </span>
    </label>
  )
}
