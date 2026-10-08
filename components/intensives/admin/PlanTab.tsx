'use client'

import { useMemo, useState } from 'react'
import { ClipboardList, FileStack, Loader2, Plus, RefreshCw, SearchX, Sparkles } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { ApiError, STATE_LABELS, apiFetch, formatDayHeading, pluralize } from '@/lib/intensives/ui'
import { PLAN_ITEM_STATES } from '@/lib/intensives/types'
import type { IntensiveDetail, PlanItemDto, PlanResponse } from '@/lib/intensives/types'
import { GeneratePlanDialog } from './GeneratePlanDialog'
import { GuardedDialog, InlineNotice, LoadError, ProgressSummary, errText, fieldErrorsOf, useBusyKey } from './kit'
import { PlanItemFormDialog } from './PlanItemFormDialog'
import { PlanItemRow } from './PlanItemRow'
import { PlanUpdatesDialog } from './PlanUpdatesDialog'

export type PlanData = {
  plan: PlanResponse | null
  /** Первая загрузка */
  loading: boolean
  /** Любая загрузка (данные остаются на месте) */
  fetching: boolean
  error: string | null
  reload: () => void
}

function announcements(n: number): string {
  return `${n} ${pluralize(n, 'анонс', 'анонса', 'анонсов')}`
}

function PlanSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Загрузка плана">
      <div className="space-y-2">
        <Skeleton className="h-4 w-72 max-w-full" />
        <Skeleton className="h-1.5 w-full" />
      </div>
      {[0, 1].map((g) => (
        <div key={g} className="space-y-2">
          <Skeleton className="h-4 w-60" />
          <div className="divide-y rounded-lg border bg-card">
            {[0, 1, 2].map((r) => (
              <div key={r} className="flex items-start gap-3 px-4 py-3">
                <Skeleton className="h-4 w-10" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
                <Skeleton className="size-8" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

function SkipDialog({
  item,
  intensiveId,
  onOpenChange,
  onDone,
}: {
  item: PlanItemDto | null
  intensiveId: string
  onOpenChange: (o: boolean) => void
  onDone: () => void | Promise<void>
}) {
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [prevId, setPrevId] = useState<string | null>(null)

  if ((item?.id ?? null) !== prevId) {
    setPrevId(item?.id ?? null)
    setReason('')
    setError(null)
    setSubmitting(false)
  }

  const trimmed = reason.trim()
  const tooLong = trimmed.length > 2000

  const submit = async () => {
    if (!item) return
    if (!trimmed) {
      setError('Укажите причину пропуска')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await apiFetch(`/api/intensives/${intensiveId}/plan/items/${item.id}`, { method: 'PATCH', json: { skipped: true, skipReason: trimmed } })
      toast.success('Пункт пропущен', { description: 'Он не считается отправленным.' })
      await onDone()
      onOpenChange(false)
    } catch (e) {
      const msg = fieldErrorsOf(e).skipReason ?? errText(e)
      setError(msg)
      toast.error('Не удалось пропустить пункт', { description: errText(e) })
      if (e instanceof ApiError && e.status === 409) void onDone()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GuardedDialog
      open={!!item}
      onOpenChange={onOpenChange}
      dirty={!!trimmed && !submitting}
      busy={submitting}
      title="Пропустить пункт"
      description={item ? `«${item.title}» не будет считаться отправленным и не войдёт в «Осталось». Причина сохранится в истории.` : undefined}
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form="skip-form" disabled={!trimmed || tooLong || submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            Пропустить
          </Button>
        </>
      }
    >
      <form
        id="skip-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <Field label="Причина пропуска" htmlFor="skip-reason" required error={error ?? (tooLong ? 'Не длиннее 2000 символов' : undefined)} hint={`${reason.length} / 2000`}>
          <Textarea
            id="skip-reason"
            rows={4}
            value={reason}
            autoFocus
            onChange={(e) => {
              setReason(e.target.value)
              setError(null)
            }}
            aria-invalid={!!error}
            disabled={submitting}
          />
        </Field>
      </form>
    </GuardedDialog>
  )
}

export function PlanTab({
  intensive,
  data,
  onChanged,
  onShowHistory,
}: {
  intensive: IntensiveDetail
  data: PlanData
  /** Перезагрузить план и карточку после изменения */
  onChanged: () => void | Promise<void>
  onShowHistory: (itemId: string, title: string) => void
}) {
  const { plan, loading, fetching, error, reload } = data
  const readOnly = intensive.status === 'CANCELLED' || intensive.status === 'ARCHIVED'
  const { busy, run } = useBusyKey()

  const [stateFilter, setStateFilter] = useState<string>('all')
  const [generateOpen, setGenerateOpen] = useState(false)
  const [addOpen, setAddOpen] = useState(false)
  const [editItem, setEditItem] = useState<PlanItemDto | null>(null)
  const [skipItem, setSkipItem] = useState<PlanItemDto | null>(null)
  const [unskipItem, setUnskipItem] = useState<PlanItemDto | null>(null)
  const [deleteItem, setDeleteItem] = useState<PlanItemDto | null>(null)
  const [updatesOpen, setUpdatesOpen] = useState(false)
  const [updatesFocus, setUpdatesFocus] = useState<string | null>(null)

  const titles = useMemo(() => new Map((plan?.items ?? []).map((i) => [i.id, i.title])), [plan])
  const updatesCount = useMemo(() => (plan?.items ?? []).filter((i) => i.updateAvailable).length, [plan])

  const matches = (i: PlanItemDto) => {
    if (stateFilter === 'all') return true
    if (stateFilter === 'attention')
      return i.state === 'FAILED' || i.state === 'AWAITING_OVERDUE' || i.details.hasFailedRepeat
    if (stateFilter === 'setup') return i.needsSetup
    return i.state === stateFilter
  }

  const grouped = useMemo(() => {
    if (!plan) return null
    const byId = new Map(plan.items.map((i) => [i.id, i]))
    const unscheduled = plan.unscheduledDayItemIds.map((id) => byId.get(id)).filter((i): i is PlanItemDto => !!i && matches(i))
    const days = plan.days
      .map((d) => ({ day: d, items: plan.items.filter((i) => i.dayNumber === d.dayNumber && !plan.unscheduledDayItemIds.includes(i.id) && matches(i)) }))
      .filter((g) => g.items.length > 0)
    return { unscheduled, days }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, stateFilter])

  const tz = intensive.timezone

  const doUnskip = async () => {
    if (!unskipItem) return
    const item = unskipItem
    await run(`unskip-${item.id}`, async () => {
      try {
        await apiFetch(`/api/intensives/${intensive.id}/plan/items/${item.id}`, { method: 'PATCH', json: { skipped: false } })
        toast.success('Пункт возвращён в план')
        setUnskipItem(null)
        await onChanged()
      } catch (e) {
        toast.error('Не удалось вернуть пункт', { description: errText(e) })
      }
    })
  }

  const doDelete = async () => {
    if (!deleteItem) return
    const item = deleteItem
    await run(`delete-${item.id}`, async () => {
      try {
        await apiFetch(`/api/intensives/${intensive.id}/plan/items/${item.id}`, { method: 'DELETE' })
        toast.success('Пункт удалён из плана')
        setDeleteItem(null)
        await onChanged()
      } catch (e) {
        toast.error('Не удалось удалить пункт', { description: errText(e) })
        if (e instanceof ApiError && e.status === 409) {
          setDeleteItem(null)
          await onChanged()
        }
      }
    })
  }

  if (loading && !plan) return <PlanSkeleton />
  if (!plan) return <LoadError message={error ?? 'План не загружен.'} onRetry={reload} retrying={fetching} />

  const total = plan.items.length
  const totalDays = intensive.day.totalDays

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      {!readOnly && (
        <>
          <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>
            <FileStack aria-hidden />
            Из шаблонов
          </Button>
          <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
            <Plus aria-hidden />
            Свой пункт
          </Button>
          {updatesCount > 0 && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setUpdatesFocus(null)
                setUpdatesOpen(true)
              }}
            >
              <Sparkles aria-hidden />
              Новые версии шаблонов ({updatesCount})
            </Button>
          )}
        </>
      )}
      <Button
        size="icon-sm"
        variant="ghost"
        className="ml-auto"
        aria-label="Обновить план"
        title="Обновить план"
        onClick={reload}
        disabled={fetching}
      >
        <RefreshCw className={cn(fetching && 'animate-spin')} aria-hidden />
      </Button>
    </div>
  )

  return (
    <div className="space-y-4">
      {readOnly && (
        <InlineNotice tone="info">
          {intensive.status === 'CANCELLED' ? 'Интенсив отменён' : 'Интенсив в архиве'}: план доступен только для просмотра.
        </InlineNotice>
      )}
      {error && <LoadError message={`${error} Показаны ранее загруженные данные.`} onRetry={reload} retrying={fetching} />}

      <div className="rounded-lg border bg-card p-4">
        <ProgressSummary progress={plan.progress} partial={plan.partial} status={intensive.status} />
      </div>

      {toolbar}

      {total === 0 ? (
        <EmptyState
          icon={<ClipboardList />}
          title="В плане пока нет пунктов"
          description={readOnly ? 'У этого интенсива нет плана анонсов.' : 'Добавьте анонсы из официальных шаблонов или создайте свой пункт.'}
        >
          {!readOnly && (
            <div className="mt-4 flex flex-wrap justify-center gap-2">
              <Button size="sm" onClick={() => setGenerateOpen(true)}>
                <FileStack aria-hidden />
                Из шаблонов
              </Button>
              <Button size="sm" variant="outline" onClick={() => setAddOpen(true)}>
                <Plus aria-hidden />
                Свой пункт
              </Button>
            </div>
          )}
        </EmptyState>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={stateFilter} onValueChange={setStateFilter}>
              <SelectTrigger size="sm" className="w-56" aria-label="Фильтр по состоянию">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все состояния</SelectItem>
                <SelectItem value="attention">Требуют внимания</SelectItem>
                <SelectItem value="setup">Требуют настройки</SelectItem>
                {PLAN_ITEM_STATES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {STATE_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground tabular-nums">{announcements(total)} в плане</span>
          </div>

          <div className={cn('space-y-6 transition-opacity', fetching && 'opacity-70')} aria-busy={fetching}>
            {grouped && grouped.unscheduled.length === 0 && grouped.days.length === 0 && (
              <EmptyState
                icon={<SearchX />}
                title="Нет пунктов в этом состоянии"
                description="Измените фильтр, чтобы увидеть остальные пункты."
                action={{ label: 'Показать все', onClick: () => setStateFilter('all') }}
              />
            )}
            {grouped && grouped.unscheduled.length > 0 && (
              <section aria-labelledby="plan-unscheduled">
                <div className="mb-2">
                  <h3 id="plan-unscheduled" className="text-sm font-semibold">
                    Требуют настройки
                  </h3>
                  <p className="text-xs text-muted-foreground">День не задан или выходит за пределы периода интенсива.</p>
                </div>
                <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                  {grouped.unscheduled.map((it) => (
                    <PlanItemRow key={it.id} item={it} tz={tz} readOnly={readOnly} busy={busy?.endsWith(it.id) ?? false} {...rowHandlers(it)} />
                  ))}
                </ul>
              </section>
            )}
            {grouped?.days.map(({ day, items }) => (
              <section key={day.dayNumber} aria-labelledby={`plan-day-${day.dayNumber}`}>
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3">
                  <h3 id={`plan-day-${day.dayNumber}`} className="text-sm font-semibold">
                    День {day.dayNumber} · {formatDayHeading(day.date)}
                  </h3>
                  <p className="text-xs text-muted-foreground tabular-nums">
                    {announcements(day.itemCount)} · Выполнено {day.completed} из {day.itemCount}
                  </p>
                </div>
                <ul className="divide-y overflow-hidden rounded-lg border bg-card">
                  {items.map((it) => (
                    <PlanItemRow key={it.id} item={it} tz={tz} readOnly={readOnly} busy={busy?.endsWith(it.id) ?? false} {...rowHandlers(it)} />
                  ))}
                </ul>
              </section>
            ))}
          </div>
        </>
      )}

      <GeneratePlanDialog
        open={generateOpen}
        onOpenChange={setGenerateOpen}
        intensiveId={intensive.id}
        startDate={intensive.startDate}
        totalDays={totalDays}
        onGenerated={onChanged}
      />
      <PlanItemFormDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        mode="create"
        intensiveId={intensive.id}
        startDate={intensive.startDate}
        totalDays={totalDays}
        onSaved={onChanged}
      />
      <PlanItemFormDialog
        open={!!editItem}
        onOpenChange={(o) => !o && setEditItem(null)}
        mode="edit"
        item={editItem ?? undefined}
        intensiveId={intensive.id}
        startDate={intensive.startDate}
        totalDays={totalDays}
        onSaved={onChanged}
      />
      <SkipDialog item={skipItem} intensiveId={intensive.id} onOpenChange={(o) => !o && setSkipItem(null)} onDone={onChanged} />
      <PlanUpdatesDialog
        open={updatesOpen}
        onOpenChange={setUpdatesOpen}
        intensiveId={intensive.id}
        titles={titles}
        focusItemId={updatesFocus}
        onApplied={onChanged}
      />
      <ConfirmDialog
        open={!!unskipItem}
        onOpenChange={(o) => !o && setUnskipItem(null)}
        title="Вернуть пункт в план?"
        description={unskipItem ? `«${unskipItem.title}» снова станет обычным пунктом и будет учитываться в прогрессе.` : undefined}
        confirmLabel="Вернуть в план"
        loading={!!busy && busy.startsWith('unskip-')}
        onConfirm={doUnskip}
      />
      <ConfirmDialog
        open={!!deleteItem}
        onOpenChange={(o) => !o && setDeleteItem(null)}
        title="Удалить пункт из плана?"
        description={
          deleteItem ? (
            <>
              «{deleteItem.title}» будет удалён. Это возможно, потому что к нему никогда не привязывались отправки. Исходный шаблон не изменится.
            </>
          ) : undefined
        }
        confirmLabel="Удалить"
        destructive
        loading={!!busy && busy.startsWith('delete-')}
        onConfirm={doDelete}
      />
    </div>
  )

  function rowHandlers(it: PlanItemDto) {
    void it
    return {
      onEdit: (i: PlanItemDto) => setEditItem(i),
      onSkip: (i: PlanItemDto) => setSkipItem(i),
      onUnskip: (i: PlanItemDto) => setUnskipItem(i),
      onDelete: (i: PlanItemDto) => setDeleteItem(i),
      onShowUpdate: (i: PlanItemDto) => {
        if (i.hasEverLinkedMessages) {
          toast.info('Есть отправки', { description: 'Новую версию нельзя применить к пункту с отправками.' })
          return
        }
        setUpdatesFocus(i.id)
        setUpdatesOpen(true)
      },
      onHistory: (i: PlanItemDto) => onShowHistory(i.id, i.title),
    }
  }
}
