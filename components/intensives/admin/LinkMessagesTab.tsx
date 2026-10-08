'use client'

import { useCallback, useMemo, useState } from 'react'
import { Link2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch, formatYmd, pluralize } from '@/lib/intensives/ui'
import type { IntensiveStatus, LinkCandidate, LinkResult, LinkResultStatus } from '@/lib/intensives/types'
import { InlineNotice, LoadError, MESSAGE_STATUS_LABELS, MESSAGE_STATUS_VARIANT, errText, formatInstant, useDeferredEffect, useSeq } from './kit'

const RESULT_LABEL: Record<LinkResultStatus, string> = {
  linked: 'Привязано',
  already_linked: 'Уже было привязано',
  linked_elsewhere: 'Привязано к другому интенсиву или пункту',
  conflict_active_send: 'У пункта уже есть активная отправка',
  outside_period: 'Вне периода интенсива',
  not_in_org_space: 'Подключение не относится к этому пространству',
  item_not_found: 'Пункт плана не найден',
  item_skipped: 'Пункт пропущен',
  message_not_found: 'Сообщение не найдено',
}

const OK_RESULTS: LinkResultStatus[] = ['linked', 'already_linked']

type LinkSummary = { processed: number; counts: Partial<Record<LinkResultStatus, number>> }

const key = (c: { messageId: string; planItemId: string }) => `${c.messageId}:${c.planItemId}`

export function LinkMessagesTab({
  intensiveId,
  timezone,
  status,
  onLinked,
}: {
  intensiveId: string
  timezone: string
  status: IntensiveStatus
  onLinked: () => void | Promise<void>
}) {
  const readOnly = status === 'CANCELLED' || status === 'ARCHIVED'
  const [candidates, setCandidates] = useState<LinkCandidate[] | null>(null)
  const [truncated, setTruncated] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [summary, setSummary] = useState<LinkSummary | null>(null)
  const [rowResults, setRowResults] = useState<Map<string, LinkResultStatus>>(new Map())
  const seq = useSeq()

  const load = useCallback(async () => {
    const token = seq.begin()
    setFetching(true)
    setError(null)
    try {
      const res = await apiFetch<{ candidates: LinkCandidate[]; truncated: boolean }>(`/api/intensives/${intensiveId}/link-candidates`)
      if (!seq.isCurrent(token)) return
      setCandidates(res.candidates)
      setTruncated(res.truncated)
      // Выбор сохраняем только для кандидатов, которые остались
      const keys = new Set(res.candidates.map(key))
      setSelected((s) => new Set(Array.from(s).filter((k) => keys.has(k))))
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setFetching(false)
    }
  }, [intensiveId, seq])

  useDeferredEffect(() => {
    void load()
  }, [load])

  const groups = useMemo(() => {
    const map = new Map<string, { id: string; title: string; items: LinkCandidate[] }>()
    for (const c of candidates ?? []) {
      const g = map.get(c.planItemId) ?? { id: c.planItemId, title: c.planItemTitle, items: [] }
      g.items.push(c)
      map.set(c.planItemId, g)
    }
    return Array.from(map.values())
  }, [candidates])

  const toggle = (c: LinkCandidate, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      if (on) {
        // Одно сообщение — один пункт
        for (const other of candidates ?? []) if (other.messageId === c.messageId) n.delete(key(other))
        n.add(key(c))
      } else n.delete(key(c))
      return n
    })

  const toggleGroup = (items: LinkCandidate[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s)
      for (const c of items) {
        if (c.wouldConflict) continue
        if (on) {
          for (const other of candidates ?? []) if (other.messageId === c.messageId) n.delete(key(other))
          n.add(key(c))
        } else n.delete(key(c))
      }
      return n
    })

  const chosen = (candidates ?? []).filter((c) => selected.has(key(c)))
  const itemCount = new Set(chosen.map((c) => c.planItemId)).size

  const submit = async () => {
    if (chosen.length === 0) return
    setSubmitting(true)
    try {
      const results: LinkResult[] = []
      let processed = 0
      for (let i = 0; i < chosen.length; i += 500) {
        const part = chosen.slice(i, i + 500)
        const res = await apiFetch<{ results: LinkResult[]; processed: number }>(`/api/intensives/${intensiveId}/link-messages`, {
          method: 'POST',
          json: { links: part.map((c) => ({ messageId: c.messageId, planItemId: c.planItemId })) },
        })
        results.push(...res.results)
        processed += res.processed
      }
      const counts: LinkSummary['counts'] = {}
      for (const r of results) counts[r.result] = (counts[r.result] ?? 0) + 1
      setSummary({ processed, counts })
      setRowResults(new Map(results.map((r) => [key(r), r.result])))
      const ok = results.filter((r) => OK_RESULTS.includes(r.result)).length
      const rejected = results.length - ok
      if (rejected === 0) toast.success(`Привязано сообщений: ${ok}`)
      else toast.warning(`Привязано: ${ok}, отклонено: ${rejected}`, { description: 'Причины показаны в списке.' })
      setConfirmOpen(false)
      setSelected(new Set())
      await onLinked()
      await load()
    } catch (e) {
      toast.error('Не удалось привязать сообщения', { description: errText(e) })
      setConfirmOpen(false)
      if (e instanceof ApiError && e.status === 409) void load()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="rounded-lg border bg-card p-4 text-[13px]">
        <p className="mb-1 text-sm font-semibold">Привязка старых сообщений</p>
        <p className="text-muted-foreground text-pretty">
          Здесь показаны сообщения без интенсива в подключениях этого пространства, которые попадают в период интенсива и созданы из тех же шаблонов, что и пункты плана.
          Ничего не привязывается автоматически — отметьте нужные и подтвердите.
        </p>
        <p className="mt-1.5 font-medium text-pretty">
          Привязка меняет только связь с интенсивом и пунктом. Текст, время, автор, отправитель и статус сообщения не меняются. Операцию безопасно повторять.
        </p>
      </div>

      {readOnly && <InlineNotice tone="info">Для отменённого или архивного интенсива привязка недоступна.</InlineNotice>}

      {summary && (
        <div className="rounded-lg border bg-card p-4 text-[13px]" role="status">
          <p className="mb-1 text-sm font-semibold">Результат: обработано {summary.processed}</p>
          <ul className="space-y-0.5 text-muted-foreground">
            {(Object.entries(summary.counts) as [LinkResultStatus, number][]).map(([r, n]) => (
              <li key={r} className={cn(!OK_RESULTS.includes(r) && 'text-foreground')}>
                {RESULT_LABEL[r]}: {n}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {candidates ? `Кандидатов: ${candidates.length}${chosen.length ? ` · выбрано ${chosen.length}` : ''}` : ' '}
        </p>
        <Button type="button" variant="ghost" size="icon-sm" aria-label="Обновить список кандидатов" title="Обновить список" onClick={() => void load()} disabled={fetching || submitting}>
          <RefreshCw className={cn(fetching && 'animate-spin')} aria-hidden />
        </Button>
      </div>

      {candidates === null && fetching && (
        <div className="divide-y rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка кандидатов">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-start gap-3 px-4 py-3">
              <Skeleton className="size-4" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      )}
      {error && <LoadError message={candidates ? `${error} Показан ранее загруженный список.` : error} onRetry={() => void load()} retrying={fetching} />}

      {candidates !== null && candidates.length === 0 && !error && (
        <EmptyState
          icon={<Link2 />}
          title="Кандидатов для привязки нет"
          description="Нет сообщений без интенсива за этот период, созданных из шаблонов, которые есть в плане."
        />
      )}

      {truncated && <InlineNotice tone="info">Показаны не все кандидаты. Привяжите эти сообщения и обновите список — появятся следующие.</InlineNotice>}

      {groups.map((g) => {
        const free = g.items.filter((c) => !c.wouldConflict)
        const sel = free.filter((c) => selected.has(key(c))).length
        const activeSelected = g.items.filter((c) => selected.has(key(c)) && (c.status === 'PENDING' || c.status === 'SENT')).length
        return (
          <section key={g.id} aria-labelledby={`link-group-${g.id}`}>
            <div className="mb-1.5 flex items-center gap-2">
              <Checkbox
                aria-label={`Выбрать все сообщения пункта «${g.title}»`}
                disabled={free.length === 0 || readOnly || submitting}
                checked={free.length > 0 && sel === free.length ? true : sel > 0 ? 'indeterminate' : false}
                onCheckedChange={(c) => toggleGroup(g.items, c === true)}
              />
              <h3 id={`link-group-${g.id}`} className="min-w-0 truncate text-[13px] font-semibold">
                Пункт плана: {g.title}
              </h3>
              <span className="text-xs text-muted-foreground tabular-nums">{g.items.length}</span>
            </div>
            {activeSelected > 1 && (
              <p className="mb-1.5 text-xs text-amber-700 dark:text-amber-400">
                Выбрано несколько активных сообщений для одного пункта: у пункта может быть только одна активная отправка, лишние будут отклонены.
              </p>
            )}
            <ul className="divide-y overflow-hidden rounded-lg border bg-card">
              {g.items.map((c) => {
                const k = key(c)
                const id = `link-${k}`
                const res = rowResults.get(k)
                return (
                  <li key={k} className="flex items-start gap-2.5 px-3 py-2.5 sm:px-4">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      disabled={c.wouldConflict || readOnly || submitting}
                      checked={selected.has(k)}
                      onCheckedChange={(v) => toggle(c, v === true)}
                    />
                    <label htmlFor={id} className={cn('min-w-0 flex-1 space-y-0.5', c.wouldConflict || readOnly ? 'cursor-not-allowed' : 'cursor-pointer')}>
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge variant={MESSAGE_STATUS_VARIANT[c.status]}>{MESSAGE_STATUS_LABELS[c.status]}</Badge>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {c.status === 'SENT' && c.sentAt ? formatInstant(c.sentAt, timezone, true) : formatInstant(c.scheduledFor, timezone, true)}
                        </span>
                        <span className="text-xs text-muted-foreground">{formatYmd(c.localDate)}</span>
                        {c.wouldConflict && <Badge variant="warning">У пункта уже есть активная отправка</Badge>}
                        {res && <Badge variant={OK_RESULTS.includes(res) ? 'success' : 'danger'}>{RESULT_LABEL[res]}</Badge>}
                      </span>
                      <span className="line-clamp-2 block break-words text-[13px]">{c.preview || '— без текста —'}</span>
                      <span className="block text-xs text-muted-foreground">
                        {c.workspaceName} · #{c.channelName.replace(/^#/, '')}
                        {c.author?.name ? ` · ${c.author.name}` : ''}
                      </span>
                    </label>
                  </li>
                )
              })}
            </ul>
          </section>
        )
      })}

      {candidates !== null && candidates.length > 0 && !readOnly && (
        <div className="sticky bottom-0 -mx-1 flex flex-wrap items-center justify-between gap-2 border-t bg-background/95 px-1 py-3">
          <p className="text-[13px] text-muted-foreground" aria-live="polite">
            {chosen.length > 0
              ? `Выбрано ${chosen.length} ${pluralize(chosen.length, 'сообщение', 'сообщения', 'сообщений')} · пунктов: ${itemCount}`
              : 'Отметьте сообщения, которые нужно привязать'}
          </p>
          <Button type="button" disabled={chosen.length === 0 || submitting} onClick={() => setConfirmOpen(true)}>
            <Link2 aria-hidden />
            Проверить и привязать…
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Привязать выбранные сообщения?"
        description={
          <div className="space-y-2 text-sm">
            <p>
              Будет привязано сообщений: <b>{chosen.length}</b>, пунктов плана: <b>{itemCount}</b>.
            </p>
            <p className="text-muted-foreground">
              Меняется только связь с интенсивом и пунктом. Текст, время, автор, отправитель и статус сообщений остаются прежними; сообщения не отправляются заново. Сервер отклонит те, что нельзя привязать, — вы увидите причины.
            </p>
          </div>
        }
        confirmLabel="Привязать"
        loading={submitting}
        onConfirm={submit}
      />
    </div>
  )
}
