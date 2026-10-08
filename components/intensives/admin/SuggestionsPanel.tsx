'use client'

import { useMemo, useState } from 'react'
import { Lightbulb, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import type { OrgSpaceConnection, OrgSpaceDto, OrgSpaceSuggestionGroup } from '@/lib/intensives/types'
import { GuardedDialog, InlineNotice, LoadError, errText, fieldErrorsOf } from './kit'

type GroupConn = OrgSpaceSuggestionGroup['connections'][number]

function ConnLine({ c }: { c: OrgSpaceConnection }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
        {c.workspaceName}
        {c.isArchived && <Badge variant="muted">Архив</Badge>}
        {!c.isActive && <Badge variant="muted">Неактивно</Badge>}
      </p>
      <p className="text-xs text-muted-foreground">
        Владелец: {c.owner.name ?? 'неизвестно'} · логин {c.username}
      </p>
    </div>
  )
}

/** Создать пространство по группе подключений: название + явно отмеченные подключения (по умолчанию ничего не отмечено). */
function CreateFromGroupDialog({
  group,
  onOpenChange,
  onDone,
}: {
  group: OrgSpaceSuggestionGroup | null
  onOpenChange: (o: boolean) => void
  onDone: () => void | Promise<void>
}) {
  const [name, setName] = useState('')
  const [picked, setPicked] = useState<Set<string>>(new Set())
  const [nameError, setNameError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [prevUrl, setPrevUrl] = useState<string | null>(null)

  if ((group?.sampleUrl ?? null) !== prevUrl) {
    setPrevUrl(group?.sampleUrl ?? null)
    setName(group?.suggestedName ?? '')
    setPicked(new Set())
    setNameError(null)
    setSubmitting(false)
  }

  const free = (group?.connections ?? []).filter((c) => !c.orgSpaceId)
  const trimmed = name.trim()
  const invalid = !trimmed ? 'Укажите название' : trimmed.length > 120 ? 'Не длиннее 120 символов' : null

  const submit = async () => {
    if (invalid || submitting) return
    setSubmitting(true)
    setNameError(null)
    try {
      const created = await apiFetch<{ orgSpace: OrgSpaceDto }>('/api/org-spaces', { method: 'POST', json: { name: trimmed } })
      let ok = 0
      const failed: string[] = []
      for (const id of picked) {
        try {
          await apiFetch(`/api/org-spaces/${created.orgSpace.id}/link`, { method: 'POST', json: { workspaceId: id } })
          ok += 1
        } catch {
          failed.push(free.find((c) => c.id === id)?.workspaceName ?? id)
        }
      }
      if (failed.length === 0) toast.success('Пространство создано', { description: ok ? `Привязано подключений: ${ok}` : undefined })
      else toast.warning('Пространство создано, но не все подключения привязаны', { description: `Не удалось: ${failed.join(', ')}. Привяжите их вручную.` })
      await onDone()
      onOpenChange(false)
    } catch (e) {
      const fe = fieldErrorsOf(e)
      setNameError(fe.name ?? (e instanceof ApiError && e.code === 'ORG_SPACE_NAME_TAKEN' ? e.message : null))
      toast.error('Не удалось создать пространство', { description: errText(e) })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GuardedDialog
      open={!!group}
      onOpenChange={onOpenChange}
      dirty={(picked.size > 0 || (!!group && name !== group.suggestedName)) && !submitting}
      busy={submitting}
      title="Создать пространство по группе"
      description="Подключения отмечаете вы сами — автоматически ничего не привязывается."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="button" disabled={!!invalid || submitting} onClick={() => void submit()}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            Создать{picked.size > 0 ? ` и привязать (${picked.size})` : ''}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Название пространства" htmlFor="cg-name" required error={nameError ?? undefined}>
          <Input id="cg-name" value={name} maxLength={140} onChange={(e) => { setName(e.target.value); setNameError(null) }} disabled={submitting} aria-invalid={!!nameError} />
        </Field>
        <fieldset className="space-y-1.5">
          <legend className="mb-1 text-[13px] font-medium">Привязать подключения</legend>
          {free.length === 0 ? (
            <p className="text-sm text-muted-foreground">Все подключения группы уже привязаны.</p>
          ) : (
            <ul className="divide-y rounded-md border">
              {free.map((c) => {
                const id = `cg-${c.id}`
                return (
                  <li key={c.id} className="flex items-start gap-2.5 px-3 py-2">
                    <Checkbox
                      id={id}
                      className="mt-0.5"
                      checked={picked.has(c.id)}
                      disabled={submitting}
                      onCheckedChange={(v) =>
                        setPicked((s) => {
                          const n = new Set(s)
                          if (v === true) n.add(c.id)
                          else n.delete(c.id)
                          return n
                        })
                      }
                    />
                    <label htmlFor={id} className="min-w-0 flex-1 cursor-pointer">
                      <ConnLine c={c} />
                    </label>
                  </li>
                )
              })}
            </ul>
          )}
        </fieldset>
      </div>
    </GuardedDialog>
  )
}

/** Подсказки по подключениям (один сервер Rocket.Chat). Только подсказка: привязку подтверждает Lead_SUP. */
export function SuggestionsPanel({
  groups,
  loading,
  error,
  onRetry,
  spaces,
  onChanged,
}: {
  groups: OrgSpaceSuggestionGroup[] | null
  loading: boolean
  error: string | null
  onRetry: () => void
  spaces: OrgSpaceDto[]
  onChanged: () => void | Promise<void>
}) {
  const [target, setTarget] = useState<Record<string, string>>({})
  const [busyId, setBusyId] = useState<string | null>(null)
  const [createFor, setCreateFor] = useState<OrgSpaceSuggestionGroup | null>(null)

  const spaceName = (id: string | null) => spaces.find((s) => s.id === id)?.name ?? 'пространство'
  const visible = useMemo(() => (groups ?? []).filter((g) => g.connections.some((c) => !c.orgSpaceId)), [groups])

  const link = async (c: GroupConn) => {
    const spaceId = target[c.id]
    if (!spaceId || busyId) return
    setBusyId(c.id)
    try {
      await apiFetch(`/api/org-spaces/${spaceId}/link`, { method: 'POST', json: { workspaceId: c.id } })
      toast.success('Подключение привязано', { description: `«${c.workspaceName}» → «${spaceName(spaceId)}»` })
      await onChanged()
    } catch (e) {
      toast.error('Не удалось привязать подключение', { description: errText(e) })
      await onChanged()
    } finally {
      setBusyId(null)
    }
  }

  return (
    <section aria-labelledby="suggestions-title" className="space-y-3">
      <div className="space-y-1">
        <h2 id="suggestions-title" className="flex items-center gap-2 text-sm font-semibold">
          <Lightbulb className="size-4 text-muted-foreground" aria-hidden />
          Подсказки по подключениям
        </h2>
        <p className="max-w-2xl text-[13px] text-muted-foreground text-pretty">
          Подключения, у которых совпадает адрес сервера Rocket.Chat. Это только подсказка — привязку подтверждает Lead_SUP. Совпадение адреса ничего не объединяет автоматически и не даёт доступа к чужим данным.
        </p>
      </div>

      {loading && !groups && (
        <div className="space-y-2" role="status" aria-busy="true" aria-label="Загрузка подсказок">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-24 w-full" />
          ))}
        </div>
      )}
      {error && <LoadError message={groups ? `${error} Показаны ранее загруженные данные.` : error} onRetry={onRetry} retrying={loading} />}
      {groups && visible.length === 0 && !error && (
        <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">Подсказок нет: все подключения уже привязаны.</p>
      )}

      {visible.length > 0 && (
        <ul className="space-y-3">
          {visible.map((g) => (
            <li key={g.sampleUrl} className="overflow-hidden rounded-lg border bg-card">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b px-4 py-2.5">
                <p className="min-w-0 flex-1 break-all font-mono text-xs">{g.sampleUrl}</p>
                <Badge variant="muted">Подсказка</Badge>
                <span className="text-xs text-muted-foreground tabular-nums">Подключений: {g.connections.length}</span>
                <Button type="button" size="sm" variant="outline" onClick={() => setCreateFor(g)}>
                  Создать пространство…
                </Button>
              </div>
              <ul className="divide-y">
                {g.connections.map((c) => (
                  <li key={c.id} className="flex flex-col gap-2 px-4 py-2.5 sm:flex-row sm:items-center sm:gap-4">
                    <div className="min-w-0 flex-1">
                      <ConnLine c={c} />
                    </div>
                    {c.orgSpaceId ? (
                      <Badge variant="outline">Привязано: {spaceName(c.orgSpaceId)}</Badge>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Select value={target[c.id] ?? ''} onValueChange={(v) => setTarget((t) => ({ ...t, [c.id]: v }))} disabled={spaces.length === 0 || busyId !== null}>
                          <SelectTrigger size="sm" className="w-44" aria-label={`Пространство для «${c.workspaceName}»`}>
                            <SelectValue placeholder="Пространство…" />
                          </SelectTrigger>
                          <SelectContent>
                            {spaces.map((s) => (
                              <SelectItem key={s.id} value={s.id}>
                                {s.name}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        <Button type="button" size="sm" disabled={!target[c.id] || busyId !== null} onClick={() => void link(c)}>
                          {busyId === c.id && <Loader2 className="animate-spin" aria-hidden />}
                          Привязать
                        </Button>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      {visible.length > 0 && spaces.length === 0 && <InlineNotice tone="info">Сначала создайте пространство — привязывать пока некуда.</InlineNotice>}

      <CreateFromGroupDialog group={createFor} onOpenChange={(o) => !o && setCreateFor(null)} onDone={onChanged} />
    </section>
  )
}
