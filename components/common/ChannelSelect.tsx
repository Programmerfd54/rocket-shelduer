'use client'

/**
 * Выбор канала из словаря каналов шаблонов (GET /api/template-channels, docs/templates-api.md §4).
 *
 *  - Список кешируется в модульном сторе (один запрос на всё приложение), обновляется после добавления/удаления.
 *  - Lead_SUP (canManage из ответа API или проп allowCreate) может добавить новый канал прямо из списка:
 *    имя нормализуется как на сервере (normalizeChannelName / channelNameError), дубликат просто выбирается.
 *  - Остальные роли видят словарь только для чтения; при allowCustom можно ввести свой канал («Другой…»),
 *    он не попадает в словарь (например, для «Моих шаблонов» SUP/ADM).
 *  - Текущее значение вне словаря (например, `support(Проверки на 5 этаже)` у встроенных шаблонов) показывается
 *    отдельным пунктом и не теряется.
 *  - Под полем — проверка канала в Rocket.Chat (<ChannelCheck/>), как раньше.
 */
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { AlertCircle, Check, ChevronsUpDown, Loader2, Pencil, Plus, RefreshCw, Search } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import { ChannelCheck } from '@/components/common/ChannelCheck'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import {
  CHANNEL_NAME_RE,
  TEMPLATE_LIMITS,
  channelNameError,
  normalizeChannelName,
  type TemplateChannelDto,
} from '@/lib/templates/types'

/* ───────────── Стор словаря каналов ───────────── */

export type TemplateChannelsStatus = 'idle' | 'loading' | 'ready' | 'error'

export interface TemplateChannelsState {
  status: TemplateChannelsStatus
  channels: TemplateChannelDto[]
  /** Может ли текущий пользователь добавлять/удалять каналы (Lead_SUP) */
  canManage: boolean
  /** Идёт фоновое обновление уже загруженного списка */
  refreshing: boolean
  error: string | null
  loadedAt: number
}

const INITIAL_STATE: TemplateChannelsState = {
  status: 'idle',
  channels: [],
  canManage: false,
  refreshing: false,
  error: null,
  loadedAt: 0,
}
/** Список считается свежим 5 минут; после изменений сбрасывается сразу. */
const STALE_MS = 5 * 60_000

let storeState: TemplateChannelsState = INITIAL_STATE
let inflight: Promise<void> | null = null
const listeners = new Set<() => void>()

function setStore(patch: Partial<TemplateChannelsState>) {
  storeState = { ...storeState, ...patch }
  listeners.forEach((l) => l())
}

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function sortChannels(list: TemplateChannelDto[]): TemplateChannelDto[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name, 'ru'))
}

export function channelErrorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Нет связи с сервером. Проверьте соединение и повторите.'
}

/** Загрузить словарь (повторные вызовы во время запроса получают тот же промис). */
export function loadTemplateChannels(force = false): Promise<void> {
  if (inflight) return inflight
  const fresh = storeState.status === 'ready' && Date.now() - storeState.loadedAt < STALE_MS
  if (!force && fresh) return Promise.resolve()
  const hasData = storeState.status === 'ready'
  setStore(hasData ? { refreshing: true, error: null } : { status: 'loading', error: null })
  inflight = apiFetch<{ channels?: TemplateChannelDto[]; canManage?: boolean }>('/api/template-channels')
    .then((d) => {
      setStore({
        status: 'ready',
        channels: sortChannels(d.channels ?? []),
        canManage: !!d.canManage,
        refreshing: false,
        error: null,
        loadedAt: Date.now(),
      })
    })
    .catch((e: unknown) => {
      // Уже загруженный список не прячем из-за неудачного обновления
      setStore(hasData ? { refreshing: false, error: channelErrorText(e) } : { status: 'error', refreshing: false, error: channelErrorText(e) })
    })
    .finally(() => {
      inflight = null
    })
  return inflight
}

/** Пометить словарь устаревшим; если он сейчас на экране — перезагрузить. */
export function invalidateTemplateChannels() {
  storeState = { ...storeState, loadedAt: 0 }
  if (listeners.size > 0) void loadTemplateChannels(true)
}

/** Добавить/обновить канал в локальном списке (после POST или createdChannel в ответе шаблона). */
export function upsertTemplateChannel(channel: TemplateChannelDto) {
  const rest = storeState.channels.filter((c) => c.id !== channel.id && c.name !== channel.name)
  setStore({ channels: sortChannels([...rest, channel]) })
}

export function removeTemplateChannel(id: string) {
  setStore({ channels: storeState.channels.filter((c) => c.id !== id) })
}

/** Словарь каналов + перезагрузка. Первая подписка запускает загрузку. */
export function useTemplateChannels() {
  const snap = useSyncExternalStore(subscribe, () => storeState, () => INITIAL_STATE)
  useEffect(() => {
    void loadTemplateChannels()
  }, [])
  return { ...snap, reload: () => loadTemplateChannels(true) }
}

export function channelDisplay(c: TemplateChannelDto): string {
  return c.label ?? `#${c.name}`
}

/* ───────────── Свободный ввод («Другой…») ───────────── */

/** Нормализация своего канала без словаря — как раньше: без «#», пробелы → «_», регистр сохраняется. */
export function normalizeFreeChannel(v: string): string {
  return v.trim().replace(/^#+/, '').trim().replace(/\s+/g, '_')
}

export function freeChannelError(raw: string): string | null {
  const name = normalizeFreeChannel(raw)
  if (!name) return 'Укажите название канала'
  if (name.length > TEMPLATE_LIMITS.channel) return `Название канала — не длиннее ${TEMPLATE_LIMITS.channel} символов`
  if (!CHANNEL_NAME_RE.test(name)) return 'Название канала может содержать только буквы, цифры, точку, дефис и подчёркивание'
  return null
}

/* ───────────── Форма нового канала (общая для селектора и «Каналов») ───────────── */

export function NewChannelForm({
  initialName = '',
  onDone,
  onCancel,
  autoFocus = true,
  submitLabel = 'Добавить',
  className,
}: {
  initialName?: string
  /** Канал добавлен или уже был в словаре */
  onDone: (channel: TemplateChannelDto, created: boolean) => void
  onCancel?: () => void
  autoFocus?: boolean
  submitLabel?: string
  className?: string
}) {
  const inputId = useId()
  const { channels } = useTemplateChannels()
  const [draft, setDraft] = useState(initialName)
  const [touched, setTouched] = useState(initialName.trim().length > 0)
  const [serverError, setServerError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const lock = useRef(false)

  const normalized = normalizeChannelName(draft)
  const localError = channelNameError(draft)
  const existing = !localError ? channels.find((c) => c.name === normalized) : undefined
  const shownError = serverError ?? (touched ? localError : null)

  const submit = async () => {
    setTouched(true)
    if (localError || lock.current) return
    if (existing) {
      onDone(existing, false)
      return
    }
    lock.current = true
    setSaving(true)
    setServerError(null)
    try {
      const res = await apiFetch<{ channel: TemplateChannelDto; created: boolean }>('/api/template-channels', {
        method: 'POST',
        json: { name: normalized },
      })
      upsertTemplateChannel(res.channel)
      onDone(res.channel, res.created)
    } catch (e) {
      const fe = e instanceof ApiError ? (e.body.fieldErrors as Record<string, string> | undefined) : undefined
      setServerError(fe?.name ?? channelErrorText(e))
    } finally {
      lock.current = false
      setSaving(false)
    }
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      // Форма может быть внутри другой формы (через портал) — не отправляем внешнюю
      e.preventDefault()
      e.stopPropagation()
      void submit()
    }
  }

  return (
    <div className={cn('space-y-2', className)}>
      <Label htmlFor={inputId} className="text-[13px] font-medium">
        Название нового канала
      </Label>
      <Input
        id={inputId}
        value={draft}
        autoFocus={autoFocus}
        autoComplete="off"
        spellCheck={false}
        placeholder="например, support_2"
        maxLength={120}
        aria-invalid={!!shownError}
        aria-describedby={`${inputId}-msg`}
        disabled={saving}
        onChange={(e) => {
          setDraft(e.target.value)
          setServerError(null)
        }}
        onBlur={() => setTouched(true)}
        onKeyDown={onKeyDown}
      />
      <p id={`${inputId}-msg`} className={cn('text-xs', shownError ? 'text-destructive' : 'text-muted-foreground')} role={shownError ? 'alert' : undefined}>
        {shownError ? (
          shownError
        ) : !normalized ? (
          'Без «#». Пробелы заменятся на «_», буквы станут строчными.'
        ) : existing ? (
          <>
            Канал <span className="font-mono">#{existing.name}</span> уже есть в списке — он будет выбран.
          </>
        ) : (
          <>
            Будет сохранён как <span className="font-mono text-foreground">#{normalized}</span>
          </>
        )}
      </p>
      <div className="flex justify-end gap-2">
        {onCancel && (
          <Button type="button" variant="ghost" size="sm" onClick={onCancel} disabled={saving}>
            Назад
          </Button>
        )}
        <Button type="button" size="sm" onClick={() => void submit()} disabled={saving || (touched && !!localError)}>
          {saving && <Loader2 className="animate-spin" aria-hidden />}
          {existing ? 'Выбрать' : submitLabel}
        </Button>
      </div>
    </div>
  )
}

/* ───────────── Селектор ───────────── */

type Item =
  | { kind: 'option'; key: string; name: string; label: string; sub?: string; outside?: boolean }
  | { kind: 'create' }
  | { kind: 'custom' }

export interface ChannelSelectProps {
  /** Имя канала без «#» ('' — не выбран) */
  value: string
  onChange: (name: string) => void
  id?: string
  disabled?: boolean
  invalid?: boolean
  /** Разрешить добавлять каналы в словарь. По умолчанию — canManage из API (Lead_SUP). */
  allowCreate?: boolean
  /** Разрешить ввести свой канал вне словаря («Другой…»), если добавлять в словарь нельзя */
  allowCustom?: boolean
  /** Проверка канала в Rocket.Chat под полем (по умолчанию да) */
  showCheck?: boolean
  placeholder?: string
  className?: string
  'aria-describedby'?: string
}

export function ChannelSelect({
  value,
  onChange,
  id,
  disabled,
  invalid,
  allowCreate,
  allowCustom = false,
  showCheck = true,
  placeholder = 'Выберите канал',
  className,
  'aria-describedby': describedBy,
}: ChannelSelectProps) {
  const autoId = useId()
  const triggerId = id ?? `${autoId}-trigger`
  const listId = `${autoId}-list`
  const { status, channels, canManage, error, refreshing, reload } = useTemplateChannels()
  const canCreate = allowCreate ?? canManage

  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<'list' | 'create' | 'custom'>('list')
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [customDraft, setCustomDraft] = useState('')
  const [customTouched, setCustomTouched] = useState(false)
  const listRef = useRef<HTMLUListElement>(null)

  const valueKey = value.trim().toLowerCase()
  const inDictionary = channels.find((c) => c.name === valueKey)

  const items = useMemo<Item[]>(() => {
    const q = query.trim().replace(/^#+/, '').toLowerCase()
    const opts: Item[] = []
    if (value.trim() && !channels.some((c) => c.name === valueKey)) {
      opts.push({ kind: 'option', key: `cur:${value}`, name: value, label: `#${value}`, outside: true })
    }
    for (const c of channels) {
      opts.push({ kind: 'option', key: c.id, name: c.name, label: channelDisplay(c), sub: c.label ? `#${c.name}` : undefined })
    }
    const filtered = q
      ? opts.filter((o) => o.kind === 'option' && (o.name.toLowerCase().includes(q) || o.label.toLowerCase().includes(q)))
      : opts
    if (canCreate) filtered.push({ kind: 'create' })
    else if (allowCustom) filtered.push({ kind: 'custom' })
    return filtered
  }, [channels, query, value, valueKey, canCreate, allowCustom])

  const optionCount = items.filter((i) => i.kind === 'option').length
  const activeIndex = Math.min(active, Math.max(items.length - 1, 0))

  const reset = () => {
    setMode('list')
    setQuery('')
    setActive(0)
    setCustomDraft('')
    setCustomTouched(false)
  }

  const onOpenChange = (next: boolean) => {
    setOpen(next)
    if (!next) {
      reset()
      return
    }
    // Поиск сброшен при закрытии, поэтому items — полный список: открываемся на выбранном значении
    const idx = items.findIndex((i) => i.kind === 'option' && i.name.toLowerCase() === valueKey)
    setActive(idx >= 0 ? idx : 0)
    if (status === 'error') void reload()
  }

  const choose = (name: string) => {
    onChange(name)
    setOpen(false)
    reset()
  }

  const activate = (item: Item | undefined) => {
    if (!item) return
    if (item.kind === 'option') choose(item.name)
    else if (item.kind === 'create') setMode('create')
    else {
      setCustomDraft(query.trim() ? query : value)
      setMode('custom')
    }
  }

  useEffect(() => {
    if (!open || mode !== 'list') return
    const el = listRef.current?.querySelector<HTMLElement>(`[data-index="${activeIndex}"]`)
    el?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open, mode])

  const onSearchKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((i) => Math.min(Math.min(i, items.length - 1) + 1, items.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((i) => Math.max(Math.min(i, items.length - 1) - 1, 0))
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(items.length - 1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      e.stopPropagation()
      activate(items[activeIndex])
    }
  }

  const customNormalized = normalizeFreeChannel(customDraft)
  const customError = freeChannelError(customDraft)
  const submitCustom = () => {
    setCustomTouched(true)
    if (customError) return
    choose(customNormalized)
  }

  const triggerLabel = value.trim()
    ? inDictionary
      ? channelDisplay(inDictionary)
      : `#${value.trim()}`
    : null

  return (
    <div className={cn('space-y-1.5', className)}>
      <Popover open={open} onOpenChange={onOpenChange}>
        <PopoverTrigger asChild>
          <button
            type="button"
            id={triggerId}
            disabled={disabled}
            role="combobox"
            aria-haspopup="listbox"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-invalid={invalid || undefined}
            aria-describedby={describedBy}
            className={cn(
              'flex h-9 w-full min-w-0 items-center gap-2 rounded-md border border-input bg-background px-3 text-left text-sm transition-[color,box-shadow,border-color] outline-none',
              'hover:border-foreground/25 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/25',
              'disabled:cursor-not-allowed disabled:opacity-50',
              'aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40',
            )}
          >
            <span className={cn('min-w-0 flex-1 truncate', triggerLabel ? 'font-mono' : 'text-muted-foreground')}>
              {triggerLabel ?? placeholder}
            </span>
            {triggerLabel && value.trim() && !inDictionary && status === 'ready' && (
              <span className="shrink-0 text-xs text-muted-foreground">нет в списке</span>
            )}
            <ChevronsUpDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="w-[var(--radix-popover-trigger-width)] min-w-[min(18rem,calc(100vw-2rem))] max-w-[calc(100vw-2rem)] p-0"
          onOpenAutoFocus={(e) => {
            // Фокус ставим сами (поиск или поле формы)
            e.preventDefault()
          }}
        >
          {mode === 'create' ? (
            <NewChannelForm
              className="p-3"
              initialName={query}
              onCancel={() => setMode('list')}
              onDone={(channel, created) => {
                toast.success(created ? `Канал #${channel.name} добавлен` : `Канал #${channel.name} уже был в списке`, {
                  description: created ? 'Теперь он доступен для выбора во всех шаблонах и планах.' : 'Выбран существующий канал.',
                })
                choose(channel.name)
              }}
            />
          ) : mode === 'custom' ? (
            <div className="space-y-2 p-3">
              <Label htmlFor={`${autoId}-custom`} className="text-[13px] font-medium">
                Свой канал
              </Label>
              <Input
                id={`${autoId}-custom`}
                autoFocus
                autoComplete="off"
                spellCheck={false}
                value={customDraft}
                placeholder="Название канала (без #)"
                aria-invalid={customTouched && !!customError}
                aria-describedby={`${autoId}-custom-msg`}
                onChange={(e) => setCustomDraft(e.target.value)}
                onBlur={() => setCustomTouched(true)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    e.stopPropagation()
                    submitCustom()
                  }
                }}
              />
              <p
                id={`${autoId}-custom-msg`}
                className={cn('text-xs', customTouched && customError ? 'text-destructive' : 'text-muted-foreground')}
              >
                {customTouched && customError ? (
                  customError
                ) : customNormalized ? (
                  <>
                    Будет использован <span className="font-mono text-foreground">#{customNormalized}</span>. Канала нет в
                    общем списке — проверьте написание.
                  </>
                ) : (
                  'Канал, которого нет в общем списке. Добавить в список может Lead_SUP.'
                )}
              </p>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="ghost" size="sm" onClick={() => setMode('list')}>
                  Назад
                </Button>
                <Button type="button" size="sm" onClick={submitCustom} disabled={customTouched && !!customError}>
                  Использовать
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col">
              <div className="relative border-b">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <input
                  autoFocus
                  type="text"
                  role="combobox"
                  aria-label="Поиск канала"
                  aria-expanded
                  aria-controls={listId}
                  aria-autocomplete="list"
                  aria-activedescendant={items[activeIndex] ? `${listId}-${activeIndex}` : undefined}
                  value={query}
                  placeholder="Найти канал…"
                  autoComplete="off"
                  spellCheck={false}
                  className="h-10 w-full bg-transparent pl-9 pr-3 text-sm outline-none placeholder:text-muted-foreground"
                  onChange={(e) => {
                    setQuery(e.target.value)
                    setActive(0)
                  }}
                  onKeyDown={onSearchKeyDown}
                />
              </div>

              {status === 'loading' || status === 'idle' ? (
                <div className="space-y-1 p-2" role="status" aria-busy="true" aria-label="Загрузка каналов">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-8 w-full" />
                  ))}
                </div>
              ) : status === 'error' ? (
                <div className="space-y-2 p-3" role="alert">
                  <p className="flex items-start gap-2 text-[13px]">
                    <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                    <span>Не удалось загрузить каналы. {error}</span>
                  </p>
                  <Button type="button" variant="outline" size="sm" onClick={() => void reload()}>
                    <RefreshCw aria-hidden />
                    Повторить
                  </Button>
                </div>
              ) : null}

              {status === 'ready' && (
                <ul ref={listRef} id={listId} role="listbox" aria-label="Каналы" className="max-h-64 overflow-y-auto p-1">
                  {optionCount === 0 && (
                    <li role="presentation" className="px-2 py-2 text-[13px] text-muted-foreground">
                      {channels.length === 0 && !query.trim() ? 'Список каналов пуст.' : 'Ничего не найдено.'}
                    </li>
                  )}
                  {items.map((item, idx) => {
                    const isActive = idx === activeIndex
                    const optionId = `${listId}-${idx}`
                    if (item.kind === 'option') {
                      const selected = item.name.toLowerCase() === valueKey
                      return (
                        <li
                          key={item.key}
                          id={optionId}
                          data-index={idx}
                          role="option"
                          aria-selected={selected}
                          className={cn(
                            'flex min-h-9 cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5 text-sm',
                            isActive && 'bg-accent text-accent-foreground',
                          )}
                          onMouseEnter={() => setActive(idx)}
                          onMouseDown={(e) => e.preventDefault()}
                          onClick={() => activate(item)}
                        >
                          <Check className={cn('size-4 shrink-0', selected ? 'opacity-100' : 'opacity-0')} aria-hidden />
                          <span className="min-w-0 flex-1 truncate font-mono">{item.label}</span>
                          {item.sub && <span className="shrink-0 font-mono text-xs text-muted-foreground">{item.sub}</span>}
                          {item.outside && <span className="shrink-0 text-xs text-muted-foreground">текущий, нет в списке</span>}
                        </li>
                      )
                    }
                    const q = query.trim().replace(/^#+/, '')
                    return (
                      <li
                        key={item.kind}
                        id={optionId}
                        data-index={idx}
                        role="option"
                        aria-selected={false}
                        className={cn(
                          'mt-1 flex min-h-9 cursor-pointer items-center gap-2 rounded-sm border-t px-2 py-1.5 text-sm',
                          isActive && 'bg-accent text-accent-foreground',
                        )}
                        onMouseEnter={() => setActive(idx)}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => activate(item)}
                      >
                        {item.kind === 'create' ? (
                          <>
                            <Plus className="size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate">
                              {q && optionCount === 0 ? (
                                <>
                                  Добавить канал <span className="font-mono">#{normalizeChannelName(q)}</span>…
                                </>
                              ) : (
                                'Добавить новый канал…'
                              )}
                            </span>
                          </>
                        ) : (
                          <>
                            <Pencil className="size-4 shrink-0" aria-hidden />
                            <span className="min-w-0 truncate">
                              {q && optionCount === 0 ? (
                                <>
                                  Использовать <span className="font-mono">#{normalizeFreeChannel(q)}</span>…
                                </>
                              ) : (
                                'Другой канал…'
                              )}
                            </span>
                          </>
                        )}
                      </li>
                    )
                  })}
                </ul>
              )}
              {status === 'ready' && refreshing && (
                <p className="border-t px-3 py-1.5 text-xs text-muted-foreground" aria-live="polite">
                  Обновляем список…
                </p>
              )}
            </div>
          )}
        </PopoverContent>
      </Popover>
      {showCheck && value.trim() && <ChannelCheck channel={value} />}
    </div>
  )
}
