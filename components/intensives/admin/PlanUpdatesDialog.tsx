'use client'

import { useCallback, useState } from 'react'
import { Check, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { AUDIENCE_LABELS, apiFetch } from '@/lib/intensives/ui'
import type { PlanUpdateDiffField, PlanUpdateEntry, PlanItemAudience } from '@/lib/intensives/types'
import { InlineNotice, LoadError, errText, useBusyKey, useDeferredEffect, useSeq } from './kit'

const FIELD_LABEL: Record<PlanUpdateDiffField['field'], string> = {
  title: 'Название',
  body: 'Текст',
  channel: 'Канал',
  dayNumber: 'День',
  time: 'Время',
  audience: 'Аудитория',
  categories: 'Категории',
}

function showValue(field: PlanUpdateDiffField['field'], v: unknown): string {
  if (v === null || v === undefined || v === '') return '— пусто —'
  if (field === 'categories' && Array.isArray(v)) return v.length ? v.join(', ') : '— пусто —'
  if (field === 'audience') return AUDIENCE_LABELS[v as PlanItemAudience] ?? String(v)
  if (field === 'dayNumber') return `День ${String(v)}`
  return String(v)
}

/** «Доступна новая версия шаблона»: отличия и применение (только к пунктам без отправок). */
export function PlanUpdatesDialog({
  open,
  onOpenChange,
  intensiveId,
  titles,
  focusItemId,
  onApplied,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  intensiveId: string
  /** planItemId → название в плане */
  titles: Map<string, string>
  /** Показать только этот пункт (из бейджа строки) */
  focusItemId?: string | null
  onApplied: () => void | Promise<void>
}) {
  const [updates, setUpdates] = useState<PlanUpdateEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [applied, setApplied] = useState<Set<string>>(new Set())
  const { busy, run } = useBusyKey()
  const seq = useSeq()

  const load = useCallback(async () => {
    const token = seq.begin()
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ updates: PlanUpdateEntry[] }>(`/api/intensives/${intensiveId}/plan/updates`)
      if (seq.isCurrent(token)) setUpdates(res.updates)
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setLoading(false)
    }
  }, [intensiveId, seq])

  useDeferredEffect(() => {
    if (open) {
      setUpdates(null)
      setApplied(new Set())
      void load()
    }
  }, [open, load])

  const apply = async (entry: PlanUpdateEntry): Promise<boolean> => {
    try {
      await apiFetch(`/api/intensives/${intensiveId}/plan/items/${entry.planItemId}/apply-update`, { method: 'POST' })
      setApplied((s) => new Set(s).add(entry.planItemId))
      return true
    } catch (e) {
      toast.error(`Не удалось применить: ${titles.get(entry.planItemId) ?? 'пункт'}`, { description: errText(e) })
      return false
    }
  }

  const visible = (updates ?? []).filter((u) => !focusItemId || u.planItemId === focusItemId)
  const pending = visible.filter((u) => u.applicable && !applied.has(u.planItemId))

  const applyOne = async (entry: PlanUpdateEntry) => {
    const ok = await run(entry.planItemId, () => apply(entry))
    if (ok) {
      toast.success('Новая версия применена', { description: titles.get(entry.planItemId) })
      await onApplied()
    } else {
      void load()
    }
  }

  const applyAll = async () => {
    const res = await run('all', async () => {
      let ok = 0
      for (const u of pending) {
        if (await apply(u)) ok += 1
      }
      return ok
    })
    if (res && res > 0) {
      toast.success(`Применено обновлений: ${res}`)
      await onApplied()
    }
    void load()
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !busy && onOpenChange(v)}>
      <DialogContent className="max-h-[92vh] gap-0 overflow-hidden p-0 sm:max-w-2xl">
        <DialogHeader className="border-b px-5 py-4 pr-12">
          <DialogTitle>Новые версии шаблонов</DialogTitle>
          <DialogDescription>
            Применить можно только к пунктам без отправок. Пункты с отправками остаются в прежней версии, чтобы история не менялась.
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto px-5 py-4">
          {loading && !updates && (
            <div className="space-y-3" role="status" aria-busy="true" aria-label="Загрузка отличий">
              {[0, 1].map((i) => (
                <div key={i} className="space-y-2 rounded-md border p-3">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-full" />
                  <Skeleton className="h-3 w-3/4" />
                </div>
              ))}
            </div>
          )}
          {error && <LoadError message={error} onRetry={() => void load()} retrying={loading} />}
          {updates && visible.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">Новых версий шаблонов нет.</p>}
          {updates && visible.length > 0 && (
            <ul className="space-y-3">
              {visible.map((u) => {
                const done = applied.has(u.planItemId)
                return (
                  <li key={u.planItemId} className="rounded-md border">
                    <div className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
                      <p className="min-w-0 flex-1 truncate text-sm font-medium">{titles.get(u.planItemId) ?? 'Пункт плана'}</p>
                      {u.sourceScope && <Badge variant="outline">{u.sourceScope}</Badge>}
                      {done ? (
                        <Badge variant="success">
                          <Check aria-hidden /> Применено
                        </Badge>
                      ) : u.applicable ? (
                        <Button type="button" size="sm" disabled={busy !== null} onClick={() => void applyOne(u)}>
                          {busy === u.planItemId && <Loader2 className="animate-spin" aria-hidden />}
                          Применить
                        </Button>
                      ) : (
                        <Badge variant="muted">Есть отправки — применить нельзя</Badge>
                      )}
                    </div>
                    <dl className="divide-y text-[13px]">
                      {u.diff.length === 0 && <p className="px-3 py-2 text-muted-foreground">Отличий в полях плана нет — обновится только версия источника.</p>}
                      {u.diff.map((d) => (
                        <div key={d.field} className="grid gap-1 px-3 py-2 sm:grid-cols-[7rem_1fr]">
                          <dt className="text-xs font-medium text-muted-foreground">{FIELD_LABEL[d.field]}</dt>
                          <dd className="min-w-0 space-y-0.5">
                            <p className="whitespace-pre-wrap break-words text-muted-foreground line-through decoration-muted-foreground/50">
                              {showValue(d.field, d.from)}
                            </p>
                            <p className="whitespace-pre-wrap break-words">{showValue(d.field, d.to)}</p>
                          </dd>
                        </div>
                      ))}
                    </dl>
                  </li>
                )
              })}
            </ul>
          )}
          {updates && pending.length > 1 && !focusItemId && (
            <InlineNotice tone="info" className="mt-3">
              Тексты в плане изменятся только у пунктов без отправок. Сообщения, уже созданные из старой версии, не меняются.
            </InlineNotice>
          )}
        </div>
        <DialogFooter className="border-t px-5 py-3">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={busy !== null}>
            Закрыть
          </Button>
          {pending.length > 1 && (
            <Button type="button" onClick={() => void applyAll()} disabled={busy !== null}>
              {busy === 'all' && <Loader2 className="animate-spin" aria-hidden />}
              Применить все ({pending.length})
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
