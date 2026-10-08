'use client'

import { useMemo, useState } from 'react'
import { Loader2, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import type { OrgSpaceConnection, OrgSpaceDto, OrgSpaceSuggestionGroup } from '@/lib/intensives/types'
import { GuardedDialog, InlineNotice, LoadError, errText } from './kit'

type Flat = OrgSpaceConnection & { orgSpaceId: string | null; sameServerAsLinked: boolean }

/** Привязка подключения к пространству: список без секретов, перенос из другого пространства — только с явным подтверждением. */
export function LinkWorkspaceDialog({
  space,
  allSpaces,
  groups,
  loading,
  error,
  onRetry,
  onOpenChange,
  onLinked,
}: {
  space: OrgSpaceDto | null
  allSpaces: OrgSpaceDto[]
  groups: OrgSpaceSuggestionGroup[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  onOpenChange: (o: boolean) => void
  onLinked: () => void | Promise<void>
}) {
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmMove, setConfirmMove] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [prevId, setPrevId] = useState<string | null>(null)

  if ((space?.id ?? null) !== prevId) {
    setPrevId(space?.id ?? null)
    setQuery('')
    setSelectedId(null)
    setConfirmMove(false)
    setSubmitting(false)
  }

  const spaceName = (id: string | null) => allSpaces.find((s) => s.id === id)?.name ?? 'другому пространству'

  const flat = useMemo<Flat[]>(() => {
    if (!space || !groups) return []
    const out: Flat[] = []
    for (const g of groups) {
      const sameServer = g.connections.some((c) => c.orgSpaceId === space.id)
      for (const c of g.connections) {
        if (c.orgSpaceId === space.id) continue
        out.push({ ...c, sameServerAsLinked: sameServer })
      }
    }
    return out.sort((a, b) => Number(b.sameServerAsLinked) - Number(a.sameServerAsLinked) || a.workspaceName.localeCompare(b.workspaceName, 'ru'))
  }, [groups, space])

  const q = query.trim().toLowerCase()
  const shown = q
    ? flat.filter((c) => `${c.workspaceName} ${c.workspaceUrl} ${c.username} ${c.owner.name ?? ''}`.toLowerCase().includes(q))
    : flat
  const selected = flat.find((c) => c.id === selectedId) ?? null
  const needsMove = !!selected?.orgSpaceId

  const submit = async () => {
    if (!space || !selected || submitting) return
    if (needsMove && !confirmMove) return
    setSubmitting(true)
    try {
      await apiFetch(`/api/org-spaces/${space.id}/link`, {
        method: 'POST',
        json: { workspaceId: selected.id, ...(needsMove ? { move: true } : {}) },
      })
      toast.success('Подключение привязано', { description: `«${selected.workspaceName}» → «${space.name}»` })
      await onLinked()
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'WORKSPACE_LINKED_ELSEWHERE') {
        toast.warning('Подключение уже привязано к другому пространству', { description: 'Подтвердите перенос галочкой и повторите.' })
        await onLinked()
      } else {
        toast.error('Не удалось привязать подключение', { description: errText(e) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GuardedDialog
      open={!!space}
      onOpenChange={onOpenChange}
      dirty={!!selected && !submitting}
      busy={submitting}
      title={space ? `Привязать подключение к «${space.name}»` : 'Привязать подключение'}
      description="Привязку подтверждаете вы. Совпадение адреса сервера — лишь подсказка и не даёт доступа автоматически. Токены и пароли здесь не показываются."
      className="sm:max-w-2xl"
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="button" disabled={!selected || (needsMove && !confirmMove) || submitting} onClick={() => void submit()}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {needsMove ? 'Перенести и привязать' : 'Привязать'}
          </Button>
        </>
      }
    >
      <div className="space-y-3">
        {loading && !groups && (
          <div className="space-y-2" role="status" aria-busy="true" aria-label="Загрузка подключений">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-14 w-full" />
            ))}
          </div>
        )}
        {error && <LoadError message={error} onRetry={onRetry} retrying={loading} />}
        {groups && (
          <>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Поиск: название, адрес, владелец" aria-label="Поиск подключения" className="pl-8" />
            </div>
            {flat.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Нет подключений, которые можно привязать.</p>
            ) : shown.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">Ничего не найдено.</p>
            ) : (
              <ul role="radiogroup" aria-label="Подключения" className="max-h-80 divide-y overflow-y-auto rounded-md border">
                {shown.map((c) => {
                  const id = `link-ws-${c.id}`
                  const active = selectedId === c.id
                  return (
                    <li key={c.id}>
                      <label htmlFor={id} className={cn('flex cursor-pointer items-start gap-2.5 px-3 py-2.5 hover:bg-muted/40', active && 'bg-muted/50')}>
                        <input
                          id={id}
                          type="radio"
                          name="link-ws"
                          checked={active}
                          onChange={() => {
                            setSelectedId(c.id)
                            setConfirmMove(false)
                          }}
                          className="mt-1 size-4 shrink-0 accent-[var(--primary)]"
                        />
                        <span className="min-w-0 flex-1 space-y-0.5">
                          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <span className="text-sm font-medium">{c.workspaceName}</span>
                            {c.orgSpaceId && <Badge variant="warning">Привязано: {spaceName(c.orgSpaceId)}</Badge>}
                            {c.sameServerAsLinked && <Badge variant="muted">Тот же сервер, что у привязанных</Badge>}
                            {c.isArchived && <Badge variant="muted">Архив</Badge>}
                            {!c.isActive && <Badge variant="muted">Неактивно</Badge>}
                          </span>
                          <span className="block break-all font-mono text-xs text-muted-foreground">{c.workspaceUrl}</span>
                          <span className="block text-xs text-muted-foreground">
                            Владелец: {c.owner.name ?? 'неизвестно'} · логин {c.username}
                          </span>
                        </span>
                      </label>
                    </li>
                  )
                })}
              </ul>
            )}
            {needsMove && selected && (
              <InlineNotice tone="warning">
                <p>
                  «{selected.workspaceName}» сейчас привязано к «{spaceName(selected.orgSpaceId)}». При переносе старая привязка снимется; сообщения, уже связанные с интенсивами, останутся связанными.
                </p>
                <div className="mt-2 flex items-start gap-2">
                  <Checkbox id="confirm-move" checked={confirmMove} onCheckedChange={(v) => setConfirmMove(v === true)} className="mt-0.5" />
                  <Label htmlFor="confirm-move" className="text-[13px] font-normal leading-snug">
                    Подтверждаю перенос подключения
                  </Label>
                </div>
              </InlineNotice>
            )}
          </>
        )}
      </div>
    </GuardedDialog>
  )
}
