"use client"

import { useId, useState } from 'react'
import { ChevronDown, Search } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { resolveUserAssignments, type UserAssignments, type UserChannel } from '@/lib/workspace-user-assignments'

type Option = { id: string; label: string }

export function AssignmentMultiSelect({
  label, options, selected, onChange, disabled, emptyText = 'Нет доступных вариантов. Загрузите список.',
}: {
  label: string
  options: Option[]
  selected: string[]
  onChange: (ids: string[]) => void
  disabled?: boolean
  emptyText?: string
}) {
  const [search, setSearch] = useState('')
  const searchId = useId()
  const names = selected.map(id => options.find(option => option.id === id)?.label || id)
  // Keep selected values removable when a refreshed catalogue no longer contains them.
  const allOptions = [...options, ...selected.filter(id => !options.some(option => option.id === id)).map(id => ({ id, label: id }))]
  const filtered = allOptions.filter(option => option.label.toLocaleLowerCase().includes(search.toLocaleLowerCase()))
  return (
    <Popover onOpenChange={() => setSearch('')}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" disabled={disabled} aria-label={label}
          title={names.join(', ')} className="w-full min-w-0 justify-between gap-2 bg-background font-normal">
          <span className="truncate">{names.length ? names.join(', ') : 'Не выбрано'}</span>
          <span className="flex shrink-0 items-center gap-1 text-muted-foreground">
            {names.length > 0 && <span className="text-xs">{names.length}</span>}
            <ChevronDown className="size-4" aria-hidden />
          </span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 max-w-[calc(100vw-2rem)] p-3">
        <div className="mb-2 flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{label}</p>
          <Button type="button" variant="ghost" size="sm" disabled={disabled || !selected.length}
            onClick={() => onChange([])}>Очистить</Button>
        </div>
        <div className="relative mb-2">
          <Search className="absolute left-2 top-2.5 size-4 text-muted-foreground" aria-hidden />
          <Input id={searchId} aria-label={`Поиск: ${label}`} value={search} placeholder="Поиск…"
            onChange={event => setSearch(event.target.value)} className="pl-8" />
        </div>
        <div className="max-h-60 space-y-1 overflow-y-auto">
          {filtered.map(option => (
            <label key={option.id} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-sm hover:bg-muted">
              <Checkbox checked={selected.includes(option.id)} disabled={disabled}
                onCheckedChange={checked => onChange(checked === true
                  ? [...new Set([...selected, option.id])]
                  : selected.filter(id => id !== option.id))} />
              <span className="break-all">{option.label}</span>
            </label>
          ))}
          {!filtered.length && <p className="p-2 text-sm text-muted-foreground">{allOptions.length ? 'Ничего не найдено' : emptyText}</p>}
        </div>
      </PopoverContent>
    </Popover>
  )
}

export function UserAssignmentsPreview({ logins, channels, roles, defaults, overrides, onChange, disabled }: {
  logins: string[]
  channels: UserChannel[]
  roles: { _id: string; name: string }[]
  defaults: UserAssignments
  overrides: Record<string, Partial<UserAssignments>>
  onChange: (value: Record<string, Partial<UserAssignments>>) => void
  disabled?: boolean
}) {
  return (
    <div className="max-h-[32rem] overflow-y-auto rounded-lg border">
      <div className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] gap-4 border-b bg-muted px-3 py-2 text-xs font-medium text-muted-foreground md:grid" aria-hidden>
        <span>Пользователь</span><span>Каналы и группы</span><span>Роли пространства</span>
      </div>
      {!logins.length && <p className="p-4 text-sm text-muted-foreground">Нет пользователей для назначения.</p>}
      {logins.map(login => {
        const value = resolveUserAssignments(defaults, overrides[login])
        const update = (patch: Partial<UserAssignments>) => onChange({ ...overrides, [login]: { ...overrides[login], ...patch } })
        return (
          <div key={login} className="grid gap-3 border-b p-3 last:border-b-0 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)] md:items-center">
            <div className="min-w-0">
              <p className="break-all font-mono text-sm font-medium">{login}</p>
              <p className="break-all text-xs text-muted-foreground">{login}@student.21-school.ru</p>
              {overrides[login] && <Badge variant="info" className="mt-1">Свои настройки</Badge>}
              {overrides[login] && <Button type="button" variant="ghost" size="sm" disabled={disabled}
                className="mt-1 block h-auto px-0 py-1 text-xs text-muted-foreground" onClick={() => {
                  const next = { ...overrides }
                  delete next[login]
                  onChange(next)
                }}>Вернуть общие настройки</Button>}
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs text-muted-foreground md:hidden">Каналы и группы</p>
              <AssignmentMultiSelect label={`Каналы для ${login}`} disabled={disabled}
                options={channels.map(channel => ({ id: channel.id, label: `${channel.name || channel.id}${channel.type === 'p' ? ' (группа)' : ''}` }))}
                selected={value.channels.map(channel => channel.id)}
                onChange={ids => update({ channels: ids.map(id => channels.find(channel => channel.id === id) || value.channels.find(channel => channel.id === id)!) })} />
            </div>
            <div className="min-w-0">
              <p className="mb-1 text-xs text-muted-foreground md:hidden">Роли пространства</p>
              <AssignmentMultiSelect label={`Роли для ${login}`} disabled={disabled}
                options={roles.map(role => ({ id: role._id, label: role.name || role._id }))}
                selected={value.roleIds} onChange={roleIds => update({ roleIds })} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
