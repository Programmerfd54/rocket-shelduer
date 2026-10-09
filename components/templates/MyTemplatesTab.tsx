'use client'

/** Вкладка «Мои шаблоны»: личные шаблоны пользователя (создание, правка, история версий, удаление, «Запланировать»). */
import { useMemo, useState } from 'react'
import { CalendarClock, Check, Copy, History, Pencil, Plus, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { LoadError } from '@/components/intensives/admin/kit'
import { apiFetch } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'
import { MyTemplateFormDialog, type MyTemplateTarget } from './MyTemplateFormDialog'
import { TemplateVersionsDialog } from './TemplateVersionsDialog'
import { copyToClipboard, dayTitle, errText, formatSentAt, matchesSearch, type LoadStatus, type ScheduleSource, type UserTemplate } from './lib'
import { ChannelTag, DayChips, GroupBlock, ListEmpty, ListSkeleton, Segmented } from './shared'

const GROUP_OPTIONS = [
  ['day', 'По дню'],
  ['channel', 'По каналу'],
] as const

export function MyTemplatesTab({
  templates,
  status,
  error,
  onRetry,
  reload,
  canManageChannels,
  onSchedule,
}: {
  templates: UserTemplate[]
  status: LoadStatus
  error: string | null
  onRetry: () => void
  reload: () => Promise<void>
  canManageChannels: boolean
  onSchedule: (src: ScheduleSource) => void
}) {
  const [search, setSearch] = useState('')
  const [filterChannel, setFilterChannel] = useState('_all')
  const [filterTag, setFilterTag] = useState('_all')
  const [filterDay, setFilterDay] = useState('_all')
  const [groupBy, setGroupBy] = useState<'day' | 'channel'>('day')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [formTarget, setFormTarget] = useState<MyTemplateTarget | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<UserTemplate | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [versionsFor, setVersionsFor] = useState<UserTemplate | null>(null)

  const base = useMemo(
    () =>
      templates.filter(
        (t) =>
          matchesSearch(search.trim(), t.title, t.body) &&
          (filterChannel === '_all' || t.channel === filterChannel) &&
          (filterTag === '_all' || (t.tags ?? []).includes(filterTag)),
      ),
    [templates, search, filterChannel, filterTag],
  )
  const days = useMemo(() => [...new Set(base.map((t) => t.intensiveDay ?? 0))].sort((a, b) => a - b), [base])
  const filtered = filterDay === '_all' ? base : base.filter((t) => String(t.intensiveDay ?? 0) === filterDay)
  const groups = useMemo(() => {
    const m = new Map<string, { title: string; mono: boolean; items: UserTemplate[]; sort: string | number }>()
    for (const t of filtered) {
      const key = groupBy === 'day' ? `d${t.intensiveDay ?? 0}` : `c${t.channel || ''}`
      const g =
        m.get(key) ??
        (groupBy === 'day'
          ? { title: dayTitle(t.intensiveDay ?? 0), mono: false, items: [], sort: t.intensiveDay ?? 0 }
          : { title: t.channel ? `#${t.channel}` : 'Без канала', mono: !!t.channel, items: [], sort: t.channel || '' })
      g.items.push(t)
      m.set(key, g)
    }
    const list = [...m.entries()].map(([key, g]) => ({ key, ...g, items: [...g.items].sort((a, b) => (a.time || '').localeCompare(b.time || '')) }))
    return list.sort((a, b) => (typeof a.sort === 'number' && typeof b.sort === 'number' ? a.sort - b.sort : String(a.sort).localeCompare(String(b.sort))))
  }, [filtered, groupBy])
  const channelOptions = useMemo(() => [...new Set(templates.map((t) => t.channel).filter(Boolean))].sort(), [templates])
  const tagOptions = useMemo(() => [...new Set(templates.flatMap((t) => t.tags ?? []).filter(Boolean))].sort(), [templates])

  const filtersActive = !!search || filterChannel !== '_all' || filterDay !== '_all' || filterTag !== '_all'
  const resetFilters = () => {
    setSearch('')
    setFilterChannel('_all')
    setFilterDay('_all')
    setFilterTag('_all')
  }
  const toggleGroup = (key: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })

  const copyText = async (t: UserTemplate) => {
    if (await copyToClipboard(t.body)) {
      toast.success('Текст скопирован')
      setCopiedId(t.id)
      setTimeout(() => setCopiedId((c) => (c === t.id ? null : c)), 2000)
    } else {
      toast.error('Не удалось скопировать', { description: 'Выделите текст вручную и скопируйте его.' })
    }
  }

  const doDelete = async () => {
    const t = deleteTarget
    if (!t || deleting) return
    setDeleting(true)
    try {
      await apiFetch(`/api/templates/mine/${encodeURIComponent(t.id)}`, { method: 'DELETE' })
      toast.success('Шаблон удалён')
      setDeleteTarget(null)
      await reload()
    } catch (e) {
      toast.error('Не удалось удалить шаблон', { description: errText(e, 'Попробуйте ещё раз.') })
    } finally {
      setDeleting(false)
    }
  }

  const createButton = (
    <Button size="sm" onClick={() => setFormTarget({ mode: 'create' })}>
      <Plus aria-hidden />
      Создать шаблон
    </Button>
  )

  let content
  if (status === 'loading') content = <ListSkeleton />
  else if (status === 'error' || status === 'forbidden')
    content = <LoadError message={error ?? 'Не удалось загрузить ваши шаблоны.'} onRetry={onRetry} />
  else if (filtered.length === 0)
    content = (
      <ListEmpty
        hasItems={templates.length > 0}
        filtersActive={filtersActive}
        onReset={resetFilters}
        emptyTitle="Шаблонов пока нет"
        emptyDescription="Создайте первый: укажите канал, день, время и текст."
      >
        <div className="mt-4">{createButton}</div>
      </ListEmpty>
    )
  else
    content = (
      <div className="space-y-3">
        {groups.map((g) => {
          const collapsible = groupBy === 'channel' || filterDay === '_all'
          return (
            <GroupBlock
              key={g.key}
              title={<span className={cn(g.mono && 'font-mono')}>{g.title}</span>}
              count={g.items.length}
              collapsible={collapsible}
              collapsed={collapsible && collapsed.has(g.key)}
              onToggle={() => toggleGroup(g.key)}
            >
              {g.items.map((t) => (
                <MyTemplateRow
                  key={t.id}
                  t={t}
                  showChannel={groupBy === 'day'}
                  justCopied={copiedId === t.id}
                  onSchedule={() => onSchedule({ body: t.body, channel: t.channel, time: t.time, userTemplateId: t.id })}
                  onCopy={() => void copyText(t)}
                  onHistory={() => setVersionsFor(t)}
                  onEdit={() => setFormTarget({ mode: 'edit', template: t })}
                  onDelete={() => setDeleteTarget(t)}
                />
              ))}
            </GroupBlock>
          )
        })}
      </div>
    )

  return (
    <div className="space-y-4">
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
            {tagOptions.length > 0 && (
              <Select value={filterTag} onValueChange={setFilterTag}>
                <SelectTrigger className="w-full sm:w-[150px]" aria-label="Фильтр по тегу">
                  <SelectValue placeholder="Тег" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Все теги</SelectItem>
                  {tagOptions.map((tag) => (
                    <SelectItem key={tag} value={tag}>
                      {tag}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Segmented value={groupBy} options={GROUP_OPTIONS} onChange={setGroupBy} ariaLabel="Группировка шаблонов" />
          </div>
          <div className="lg:ml-auto">{createButton}</div>
        </div>
        <DayChips days={days} value={filterDay} onChange={setFilterDay} />
        {filtersActive && (
          <div className="flex items-center gap-3 text-[13px] text-muted-foreground" aria-live="polite">
            <span>Найдено: {filtered.length}</span>
            <Button variant="ghost" size="sm" className="h-8 px-2" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          </div>
        )}
      </div>

      {content}

      <MyTemplateFormDialog target={formTarget} canManageChannels={canManageChannels} onClose={() => setFormTarget(null)} onSaved={reload} />
      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(o) => !o && setDeleteTarget(null)}
        title={deleteTarget ? `Удалить шаблон «${deleteTarget.title || 'без названия'}»?` : 'Удалить шаблон?'}
        description="Это действие нельзя отменить. Уже запланированные сообщения не изменятся."
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={doDelete}
      />
      {versionsFor && <TemplateVersionsDialog key={versionsFor.id} template={versionsFor} onClose={() => setVersionsFor(null)} onReverted={reload} />}
    </div>
  )
}

function MyTemplateRow({
  t,
  showChannel,
  justCopied,
  onSchedule,
  onCopy,
  onHistory,
  onEdit,
  onDelete,
}: {
  t: UserTemplate
  showChannel: boolean
  justCopied: boolean
  onSchedule: () => void
  onCopy: () => void
  onHistory: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  const name = t.title || 'Без названия'
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 basis-[16rem] flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">~{t.time}</span>
        {showChannel && <ChannelTag channel={t.channel} />}
        <span className={cn('min-w-0 flex-1 basis-32 truncate text-sm font-medium', !t.title && 'text-muted-foreground')}>{name}</span>
        {t.lastSentAt ? <Badge variant="success">Отправлено {formatSentAt(t.lastSentAt)}</Badge> : <Badge variant="muted">Не отправлялся</Badge>}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" className="h-9 sm:h-8" onClick={onSchedule}>
          <CalendarClock aria-hidden />
          Запланировать
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(justCopied && 'text-primary')}
          onClick={onCopy}
          aria-label={justCopied ? 'Скопировано' : `Копировать текст шаблона «${name}»`}
          title="Копировать текст"
        >
          {justCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
        <Button variant="ghost" size="icon" onClick={onHistory} aria-label={`История версий шаблона «${name}»`} title="История версий">
          <History aria-hidden />
        </Button>
        <Button variant="ghost" size="icon" onClick={onEdit} aria-label={`Редактировать шаблон «${name}»`} title="Редактировать">
          <Pencil aria-hidden />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="text-destructive hover:text-destructive"
          onClick={onDelete}
          aria-label={`Удалить шаблон «${name}»`}
          title="Удалить"
        >
          <Trash2 aria-hidden />
        </Button>
      </div>
    </div>
  )
}
