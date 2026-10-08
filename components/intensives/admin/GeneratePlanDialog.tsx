'use client'

import { useCallback, useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { dayDate } from '@/lib/intensives/dates'
import { apiFetch, formatDayHeading, pluralize } from '@/lib/intensives/ui'
import type { OfficialTemplateOption } from '@/lib/intensives/types'
import { GuardedDialog, InlineNotice, LoadError, errText, useDeferredEffect, useSeq } from './kit'

type DayGroup = { day: number; items: OfficialTemplateOption[] }

/** Формирование плана из официальных шаблонов: мультивыбор по дням, «уже в плане» недоступны. */
export function GeneratePlanDialog({
  open,
  onOpenChange,
  intensiveId,
  startDate,
  totalDays,
  onGenerated,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  intensiveId: string
  startDate: string
  totalDays: number
  onGenerated: () => void | Promise<void>
}) {
  const [templates, setTemplates] = useState<OfficialTemplateOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)
  const seq = useSeq()

  const load = useCallback(async () => {
    const token = seq.begin()
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ templates: OfficialTemplateOption[] }>(
        `/api/intensives/templates?intensiveId=${encodeURIComponent(intensiveId)}`,
      )
      if (!seq.isCurrent(token)) return
      setTemplates(res.templates)
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setLoading(false)
    }
  }, [intensiveId, seq])

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setSelected(new Set())
      setQuery('')
      setTemplates(null)
      setSubmitting(false)
    }
  }

  useDeferredEffect(() => {
    if (open) void load()
  }, [open, load])

  const q = query.trim().toLowerCase()
  const groups = useMemo<DayGroup[]>(() => {
    const map = new Map<number, OfficialTemplateOption[]>()
    for (const t of templates ?? []) {
      if (q && !`${t.title} ${t.channel}`.toLowerCase().includes(q)) continue
      const day = t.intensiveDay >= 1 ? t.intensiveDay : 0
      map.set(day, [...(map.get(day) ?? []), t])
    }
    return Array.from(map.entries())
      .sort(([a], [b]) => (a === 0 ? 1 : b === 0 ? -1 : a - b))
      .map(([day, items]) => ({ day, items: items.sort((a, b) => a.time.localeCompare(b.time)) }))
  }, [templates, q])

  const selectable = useMemo(() => (templates ?? []).filter((t) => !t.inPlan), [templates])
  const visibleSelectable = useMemo(() => groups.flatMap((g) => g.items).filter((t) => !t.inPlan), [groups])

  const toggle = (id: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) n.add(id)
      else n.delete(id)
      return n
    })

  const toggleMany = (ids: string[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      for (const id of ids) {
        if (on) n.add(id)
        else n.delete(id)
      }
      return n
    })

  const submit = async () => {
    if (selected.size === 0 || submitting) return
    setSubmitting(true)
    try {
      const res = await apiFetch<{ created: string[]; alreadyInPlan: string[] }>(`/api/intensives/${intensiveId}/plan/generate`, {
        method: 'POST',
        json: { templateIds: Array.from(selected) },
      })
      const parts = [`Добавлено ${res.created.length} ${pluralize(res.created.length, 'пункт', 'пункта', 'пунктов')}`]
      if (res.alreadyInPlan.length > 0) parts.push(`уже были в плане: ${res.alreadyInPlan.length}`)
      toast.success('План обновлён', { description: parts.join(', ') })
      await onGenerated()
      onOpenChange(false)
    } catch (e) {
      toast.error('Не удалось сформировать план', { description: errText(e) })
      void load() // возможно, часть шаблонов уже добавлена
    } finally {
      setSubmitting(false)
    }
  }

  const allVisibleSelected = visibleSelectable.length > 0 && visibleSelectable.every((t) => selected.has(t.id))

  return (
    <GuardedDialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={selected.size > 0 && !submitting}
      busy={submitting}
      title="Добавить в план из шаблонов"
      description="Берётся снимок официальных шаблонов: позже изменённый шаблон не меняет план автоматически. Сообщения при этом не создаются."
      className="sm:max-w-2xl"
      footer={
        <>
          <span className="text-[13px] text-muted-foreground sm:mr-auto sm:self-center" aria-live="polite">
            Выбрано: {selected.size}
          </span>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="button" disabled={selected.size === 0 || submitting} onClick={() => void submit()}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            Добавить в план{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
        </>
      }
    >
      {loading && !templates && (
        <div className="space-y-3" role="status" aria-busy="true" aria-label="Загрузка шаблонов">
          {[0, 1, 2].map((i) => (
            <div key={i} className="space-y-2">
              <Skeleton className="h-4 w-48" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      )}
      {error && <LoadError message={error} onRetry={() => void load()} retrying={loading} />}
      {templates && (
        <div className="space-y-4">
          {templates.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Официальных шаблонов пока нет.</p>
          ) : (
            <>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative flex-1">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск по названию или каналу" aria-label="Поиск шаблонов" className="pl-8" />
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={visibleSelectable.length === 0}
                  onClick={() => toggleMany(visibleSelectable.map((t) => t.id), !allVisibleSelected)}
                >
                  {allVisibleSelected ? 'Снять выбор' : 'Выбрать все доступные'}
                </Button>
              </div>
              {selectable.length === 0 && <InlineNotice tone="info">Все официальные шаблоны уже есть в плане.</InlineNotice>}
              {groups.length === 0 && <p className="py-4 text-center text-sm text-muted-foreground">Ничего не найдено.</p>}
              {groups.map((g) => {
                const free = g.items.filter((t) => !t.inPlan)
                const selectedInDay = free.filter((t) => selected.has(t.id)).length
                const outside = g.day > totalDays
                const heading =
                  g.day === 0
                    ? 'Без дня'
                    : outside
                      ? `День ${g.day} · вне периода интенсива`
                      : `День ${g.day} · ${formatDayHeading(dayDate(startDate, g.day))}`
                const groupId = `gen-day-${g.day}`
                return (
                  <section key={g.day} aria-labelledby={groupId}>
                    <div className="mb-1.5 flex items-center gap-2">
                      <Checkbox
                        aria-label={`Выбрать все шаблоны: ${heading}`}
                        disabled={free.length === 0}
                        checked={free.length > 0 && selectedInDay === free.length ? true : selectedInDay > 0 ? 'indeterminate' : false}
                        onCheckedChange={(c) => toggleMany(free.map((t) => t.id), c === true)}
                      />
                      <h3 id={groupId} className="text-[13px] font-semibold">
                        {heading}
                      </h3>
                      {(g.day === 0 || outside) && <Badge variant="warning">Потребует настройки</Badge>}
                    </div>
                    <ul className="divide-y rounded-md border">
                      {g.items.map((t) => {
                        const id = `gen-${t.id}`
                        return (
                          <li key={t.id} className="flex items-start gap-2.5 px-3 py-2">
                            <Checkbox
                              id={id}
                              className="mt-0.5"
                              disabled={t.inPlan}
                              checked={t.inPlan ? true : selected.has(t.id)}
                              onCheckedChange={(c) => toggle(t.id, c === true)}
                            />
                            <label htmlFor={id} className={t.inPlan ? 'min-w-0 flex-1 cursor-not-allowed opacity-60' : 'min-w-0 flex-1 cursor-pointer'}>
                              <span className="block text-sm">{t.title}</span>
                              <span className="block text-xs text-muted-foreground">
                                {t.time || 'без времени'} · #{t.channel.replace(/^#/, '')} · {t.scope === 'ADM' ? 'ADM' : 'SUP'}
                                {t.audience === 'mk' ? ' · МК' : ''}
                              </span>
                            </label>
                            {t.inPlan && <Badge variant="muted">Уже в плане</Badge>}
                          </li>
                        )
                      })}
                    </ul>
                  </section>
                )
              })}
            </>
          )}
        </div>
      )}
    </GuardedDialog>
  )
}
