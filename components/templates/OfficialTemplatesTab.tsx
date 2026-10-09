'use client'

/**
 * Вкладка «Шаблоны SUP» / «Шаблоны ADM».
 *  - Все роли: поиск, фильтры (день, канал, аудитория), список по дням, «Запланировать», копирование текста.
 *  - Lead_SUP (manage): «Добавить шаблон», правка всех полей, удаление (встроенный — скрыть с восстановлением,
 *    созданный — безвозвратно), «Сбросить к умолчанию» (POST …/reset), «Копировать в другой набор»,
 *    «Удалённые (N)» с восстановлением, «Каналы» (словарь каналов).
 */
import { useMemo, useState } from 'react'
import { ArchiveRestore, Hash, Lock, Plus, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { LoadError } from '@/components/intensives/admin/kit'
import { apiFetch } from '@/lib/intensives/ui'
import type { OfficialTemplateDto, TemplateScope } from '@/lib/templates/types'
import { ChannelsManagerDialog } from './ChannelsManagerDialog'
import { DeletedTemplatesDialog } from './DeletedTemplatesDialog'
import { OfficialTemplateFormDialog, type OfficialFormTarget } from './OfficialTemplateFormDialog'
import { OfficialTemplateRow } from './OfficialTemplateRow'
import { SCOPE_TAB_LABELS, copyToClipboard, dayTitle, errText, matchesSearch, otherScope, type LoadStatus, type ScheduleSource } from './lib'
import { DayChips, GroupBlock, ListEmpty, ListSkeleton, Segmented } from './shared'

type AudienceFilter = '' | 'all' | 'mk'

const AUDIENCE_FILTERS = [
  ['', 'Все'],
  ['all', 'Для всех'],
  ['mk', 'МК'],
] as const

export function OfficialTemplatesTab({
  scope,
  templates,
  status,
  error,
  onRetry,
  manage,
  reload,
  onSchedule,
  onSwitchScope,
}: {
  scope: TemplateScope
  /** Шаблоны этого набора; у Lead_SUP — вместе с удалёнными (isDeleted) */
  templates: OfficialTemplateDto[]
  status: LoadStatus
  error: string | null
  onRetry: () => void
  manage: boolean
  reload: () => Promise<void>
  onSchedule: (src: ScheduleSource) => void
  onSwitchScope: (scope: TemplateScope) => void
}) {
  const [search, setSearch] = useState('')
  const [filterDay, setFilterDay] = useState('_all')
  const [filterChannel, setFilterChannel] = useState('_all')
  const [filterAudience, setFilterAudience] = useState<AudienceFilter>('')
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [dayCollapsed, setDayCollapsed] = useState<Set<number>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const [formTarget, setFormTarget] = useState<OfficialFormTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<OfficialTemplateDto | null>(null)
  const [resetTarget, setResetTarget] = useState<OfficialTemplateDto | null>(null)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [confirmBusy, setConfirmBusy] = useState(false)
  const [deletedOpen, setDeletedOpen] = useState(false)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [channelsOpen, setChannelsOpen] = useState(false)

  const active = useMemo(() => templates.filter((t) => !t.isDeleted), [templates])
  const deleted = useMemo(() => templates.filter((t) => t.isDeleted), [templates])

  const baseFiltered = useMemo(
    () =>
      active.filter(
        (t) =>
          matchesSearch(search.trim(), t.title, t.body, t.dayLabel) &&
          (!filterAudience || t.audience === filterAudience) &&
          (filterChannel === '_all' || t.channel === filterChannel),
      ),
    [active, search, filterAudience, filterChannel],
  )
  const daysForChips = useMemo(() => [...new Set(baseFiltered.map((t) => t.intensiveDay))].sort((a, b) => a - b), [baseFiltered])
  const filtered = filterDay === '_all' ? baseFiltered : baseFiltered.filter((t) => String(t.intensiveDay) === filterDay)
  const grouped = useMemo(() => {
    const m = new Map<number, OfficialTemplateDto[]>()
    for (const t of filtered) {
      const arr = m.get(t.intensiveDay) ?? []
      arr.push(t)
      m.set(t.intensiveDay, arr)
    }
    return [...m.entries()].sort((a, b) => a[0] - b[0])
  }, [filtered])
  const channelOptions = useMemo(() => [...new Set(active.map((t) => t.channel).filter(Boolean))].sort(), [active])

  const filtersActive = !!search || filterChannel !== '_all' || filterDay !== '_all' || !!filterAudience
  const resetFilters = () => {
    setSearch('')
    setFilterChannel('_all')
    setFilterDay('_all')
    setFilterAudience('')
  }

  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  const toggleDay = (day: number) =>
    setDayCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })

  const copyText = async (t: OfficialTemplateDto) => {
    if (await copyToClipboard(t.body)) {
      toast.success('Текст скопирован')
      setCopiedId(t.id)
      setTimeout(() => setCopiedId((c) => (c === t.id ? null : c)), 2000)
    } else {
      toast.error('Не удалось скопировать', { description: 'Выделите текст вручную и скопируйте его.' })
    }
  }

  const qs = (t: OfficialTemplateDto) => `${encodeURIComponent(t.id)}?scope=${t.scope}`

  const restore = async (t: OfficialTemplateDto, opts?: { fromToast?: boolean }) => {
    if (restoringId) return
    setRestoringId(t.id)
    try {
      await apiFetch(`/api/templates/official/${encodeURIComponent(t.id)}/restore?scope=${t.scope}`, { method: 'POST' })
      toast.success(`Шаблон «${t.title}» восстановлен`)
      await reload()
    } catch (e) {
      toast.error('Не удалось восстановить шаблон', { description: errText(e) })
      if (!opts?.fromToast) void reload()
    } finally {
      setRestoringId(null)
    }
  }

  const doDelete = async () => {
    const t = deleteTarget
    if (!t || confirmBusy) return
    setConfirmBusy(true)
    setBusyId(t.id)
    try {
      const res = await apiFetch<{ restorable?: boolean }>(`/api/templates/official/${qs(t)}`, { method: 'DELETE' })
      setDeleteTarget(null)
      if (res.restorable) {
        toast.success(`Шаблон «${t.title}» удалён`, {
          description: 'Его можно восстановить в разделе «Удалённые».',
          action: { label: 'Восстановить', onClick: () => void restore(t, { fromToast: true }) },
        })
      } else {
        toast.success(`Шаблон «${t.title}» удалён`)
      }
      await reload()
    } catch (e) {
      toast.error('Не удалось удалить шаблон', { description: errText(e) })
      void reload()
    } finally {
      setConfirmBusy(false)
      setBusyId(null)
    }
  }

  const doReset = async () => {
    const t = resetTarget
    if (!t || confirmBusy) return
    setConfirmBusy(true)
    setBusyId(t.id)
    try {
      // Сброс — POST …/reset (DELETE теперь удаляет шаблон)
      await apiFetch(`/api/templates/official/${encodeURIComponent(t.id)}/reset?scope=${t.scope}`, { method: 'POST' })
      setResetTarget(null)
      toast.success(`Шаблон «${t.title}» сброшен к умолчанию`)
      await reload()
    } catch (e) {
      toast.error('Не удалось сбросить шаблон', { description: errText(e) })
      void reload()
    } finally {
      setConfirmBusy(false)
      setBusyId(null)
    }
  }

  const copyToOther = (t: OfficialTemplateDto) => {
    const target = otherScope(t.scope)
    setFormTarget({
      mode: 'create',
      scope: target,
      prefill: {
        scope: target,
        title: t.title,
        body: t.body,
        channel: t.channel,
        day: String(t.intensiveDay),
        time: t.time,
        audience: t.audience,
        timeNote: t.timeNote ?? '',
        dayLabel: t.dayLabel,
        sourceTitle: t.title,
      },
    })
  }

  const toolbar = (
    <div className="space-y-2">
      <div className="flex flex-col gap-2 lg:flex-row lg:flex-wrap lg:items-center">
        <div className="relative lg:min-w-[220px] lg:flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Поиск по названию и тексту"
            aria-label="Поиск шаблонов"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9"
          />
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
          <Select value={filterChannel} onValueChange={setFilterChannel}>
            <SelectTrigger className="w-full sm:w-[170px]" aria-label="Фильтр по каналу">
              <SelectValue placeholder="Канал" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_all">Все каналы</SelectItem>
              {channelOptions.map((ch) => (
                <SelectItem key={ch} value={ch}>
                  <span className="font-mono">#{ch}</span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Segmented value={filterAudience} options={AUDIENCE_FILTERS} onChange={setFilterAudience} ariaLabel="Аудитория" />
        </div>
        {manage && (
          <div className="flex flex-wrap items-center gap-2 lg:ml-auto">
            <Button variant="outline" size="sm" onClick={() => setChannelsOpen(true)}>
              <Hash aria-hidden />
              Каналы
            </Button>
            <Button variant="outline" size="sm" onClick={() => setDeletedOpen(true)} aria-label={`Удалённые шаблоны: ${deleted.length}`}>
              <ArchiveRestore aria-hidden />
              Удалённые ({deleted.length})
            </Button>
            <Button size="sm" onClick={() => setFormTarget({ mode: 'create', scope })}>
              <Plus aria-hidden />
              Добавить шаблон
            </Button>
          </div>
        )}
      </div>
      <DayChips days={daysForChips} value={filterDay} onChange={setFilterDay} />
      {filtersActive && (
        <div className="flex items-center gap-3 text-[13px] text-muted-foreground" aria-live="polite">
          <span>Найдено: {filtered.length}</span>
          <Button variant="ghost" size="sm" className="h-8 px-2" onClick={resetFilters}>
            Сбросить фильтры
          </Button>
        </div>
      )}
    </div>
  )

  let content
  if (status === 'loading') content = <ListSkeleton />
  else if (status === 'forbidden')
    content = (
      <EmptyState icon={<Lock />} title="Нет доступа к официальным шаблонам" description="Обратитесь к Lead_SUP, если доступ нужен." />
    )
  else if (status === 'error')
    content = <LoadError message={error ?? 'Не удалось загрузить шаблоны.'} onRetry={onRetry} />
  else if (filtered.length === 0)
    content = (
      <ListEmpty
        hasItems={active.length > 0}
        filtersActive={filtersActive}
        onReset={resetFilters}
        emptyTitle="В наборе нет шаблонов"
        emptyDescription={manage ? 'Добавьте первый шаблон или восстановите удалённые.' : 'Здесь пока ничего нет.'}
      >
        {manage && (
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            <Button size="sm" onClick={() => setFormTarget({ mode: 'create', scope })}>
              <Plus aria-hidden />
              Добавить шаблон
            </Button>
            {deleted.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setDeletedOpen(true)}>
                Удалённые ({deleted.length})
              </Button>
            )}
          </div>
        )}
      </ListEmpty>
    )
  else
    content = (
      <div className="space-y-3">
        {grouped.map(([day, items]) => {
          const collapsible = filterDay === '_all'
          return (
            <GroupBlock
              key={day}
              title={dayTitle(day)}
              count={items.length}
              collapsible={collapsible}
              collapsed={collapsible && dayCollapsed.has(day)}
              onToggle={() => toggleDay(day)}
            >
              {items.map((t) => (
                <OfficialTemplateRow
                  key={t.id}
                  t={t}
                  open={openIds.has(t.id)}
                  onToggle={() => toggleOpen(t.id)}
                  justCopied={copiedId === t.id}
                  busy={busyId === t.id}
                  manage={manage}
                  handlers={{
                    onSchedule: () => onSchedule({ body: t.body, channel: t.channel, time: t.time }),
                    onCopyText: () => void copyText(t),
                    onEdit: () => setFormTarget({ mode: 'edit', template: t }),
                    onDelete: () => setDeleteTarget(t),
                    onReset: () => setResetTarget(t),
                    onCopyToOther: () => copyToOther(t),
                  }}
                />
              ))}
            </GroupBlock>
          )
        })}
      </div>
    )

  return (
    <div className="space-y-4">
      {toolbar}
      {content}

      {manage && (
        <>
          <OfficialTemplateFormDialog
            target={formTarget}
            onClose={() => setFormTarget(null)}
            onGone={() => void reload()}
            onSaved={async (saved, info) => {
              setFormTarget(null)
              const where = saved.scope !== scope ? ` в «${SCOPE_TAB_LABELS[saved.scope]}»` : ''
              toast.success(info.created ? `Шаблон «${saved.title}» добавлен${where}` : `Шаблон «${saved.title}» сохранён${where}`, {
                description: info.createdChannel ? `Канал #${info.createdChannel.name} добавлен в список каналов.` : undefined,
                action: saved.scope !== scope ? { label: 'Открыть', onClick: () => onSwitchScope(saved.scope) } : undefined,
              })
              await reload()
            }}
          />
          <ConfirmDialog
            open={!!deleteTarget}
            onOpenChange={(o) => !o && setDeleteTarget(null)}
            title={deleteTarget ? `Удалить шаблон «${deleteTarget.title}»?` : 'Удалить шаблон?'}
            description={
              deleteTarget && (
                <div className="space-y-2">
                  {deleteTarget.source === 'builtin' ? (
                    <p>
                      Встроенный шаблон будет скрыт для всех пользователей набора {deleteTarget.scope}: в списках, при выборе шаблона
                      и при создании планов. Его можно восстановить в разделе «Удалённые» вместе с изменениями.
                    </p>
                  ) : (
                    <p>Шаблон удалится безвозвратно.</p>
                  )}
                  <p>Уже созданные планы и сообщения не изменятся.</p>
                </div>
              )
            }
            confirmLabel="Удалить"
            destructive
            loading={confirmBusy}
            onConfirm={doDelete}
          />
          <ConfirmDialog
            open={!!resetTarget}
            onOpenChange={(o) => !o && setResetTarget(null)}
            title={resetTarget ? `Сбросить «${resetTarget.title}» к умолчанию?` : 'Сбросить шаблон?'}
            description="Все изменения шаблона (название, текст, канал, день, время, аудитория, подсказка) будут удалены — он вернётся к исходному виду для всех пользователей. Уже созданные планы и сообщения не изменятся."
            confirmLabel="Сбросить"
            destructive
            loading={confirmBusy}
            onConfirm={doReset}
          />
          <DeletedTemplatesDialog
            open={deletedOpen}
            onOpenChange={setDeletedOpen}
            scope={scope}
            templates={deleted}
            restoringId={restoringId}
            onRestore={(t) => void restore(t)}
          />
          <ChannelsManagerDialog open={channelsOpen} onOpenChange={setChannelsOpen} />
        </>
      )}
    </div>
  )
}
