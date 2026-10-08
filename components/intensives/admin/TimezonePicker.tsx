'use client'

import { useMemo, useState } from 'react'
import { Check, ChevronsUpDown, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { IANA_TIMEZONES_COMMON, formatTimezone } from '@/lib/intensives/ui'
import { tzOffsetLabel } from './kit'

function allTimeZones(): string[] {
  try {
    const fn = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf
    const list = fn ? fn('timeZone') : []
    return Array.from(new Set([...IANA_TIMEZONES_COMMON, ...list]))
  } catch {
    return [...IANA_TIMEZONES_COMMON]
  }
}

function isKnownZone(tz: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(tz)) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Выбор IANA-часового пояса: популярные сверху + свободный поиск по всем. */
export function TimezonePicker({
  value,
  onChange,
  id,
  disabled,
  invalid,
  'aria-describedby': describedBy,
}: {
  value: string
  onChange: (tz: string) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  'aria-describedby'?: string
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const zones = useMemo(() => (open ? allTimeZones() : []), [open])

  const q = query.trim().toLowerCase()
  const options = useMemo(() => {
    if (!open) return []
    if (!q) return IANA_TIMEZONES_COMMON
    const needle = q.replace(/\s+/g, '_')
    const matched = zones.filter((z) => z.toLowerCase().includes(needle) || formatTimezone(z).toLowerCase().includes(q))
    return matched.slice(0, 60)
  }, [open, q, zones])

  const exact = q && isKnownZone(query.trim()) && !options.some((o) => o.toLowerCase() === q) ? query.trim() : null

  const pick = (tz: string) => {
    onChange(tz)
    setOpen(false)
    setQuery('')
  }

  return (
    <Popover
      modal
      open={open}
      onOpenChange={(v) => {
        setOpen(v)
        if (!v) setQuery('')
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-describedby={describedBy}
          data-invalid={invalid ? 'true' : undefined}
          className={cn(
            'border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center justify-between gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-xs outline-none transition-[color,box-shadow]',
            'focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]',
            'data-[invalid=true]:border-destructive disabled:cursor-not-allowed disabled:opacity-50',
          )}
        >
          <span className="min-w-0 flex-1 truncate">
            {value ? (
              <>
                <span>{formatTimezone(value)}</span>
                <span className="ml-1.5 text-muted-foreground">{value !== formatTimezone(value) ? value : ''}</span>
              </>
            ) : (
              <span className="text-muted-foreground">Выберите пояс</span>
            )}
          </span>
          <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[min(22rem,calc(100vw-2rem))] p-0">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <Input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                const first = exact ?? options[0]
                if (first) pick(first)
              }
            }}
            placeholder="Поиск: Москва, Europe/Berlin…"
            aria-label="Поиск часового пояса"
            className="h-10 border-0 px-0 shadow-none focus-visible:ring-0"
          />
        </div>
        <ul role="listbox" aria-label="Часовые пояса" className="max-h-64 overflow-y-auto p-1">
          {!q && <li className="px-2 py-1 text-xs text-muted-foreground">Популярные</li>}
          {exact && (
            <li role="option" aria-selected={false}>
              <button type="button" className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent" onClick={() => pick(exact)}>
                Использовать «{exact}»
              </button>
            </li>
          )}
          {options.map((tz) => (
            <li key={tz} role="option" aria-selected={tz === value}>
              <button
                type="button"
                onClick={() => pick(tz)}
                className={cn('flex w-full items-center gap-2 rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent focus-visible:bg-accent focus-visible:outline-none', tz === value && 'font-medium')}
              >
                <Check className={cn('size-3.5 shrink-0', tz === value ? 'opacity-100' : 'opacity-0')} aria-hidden />
                <span className="min-w-0 flex-1 truncate">
                  {tz}
                  {formatTimezone(tz) !== tz && <span className="ml-1.5 text-muted-foreground">{formatTimezone(tz)}</span>}
                </span>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{tzOffsetLabel(tz)}</span>
              </button>
            </li>
          ))}
          {options.length === 0 && !exact && <li className="px-2 py-3 text-center text-sm text-muted-foreground">Ничего не найдено</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}
