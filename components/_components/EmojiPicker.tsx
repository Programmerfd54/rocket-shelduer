"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import {
  Clock,
  Hand,
  Hash,
  Lightbulb,
  PawPrint,
  Plane,
  Rocket,
  Search,
  Smile,
  Trophy,
  Utensils,
} from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { cn } from '@/lib/utils'
import {
  EMOJI_CATEGORIES,
  customEmojiImageUrl,
  emojiByShortcode,
  emojisOfCategory,
  searchCustomEmojis,
  searchStandardEmojis,
} from '@/lib/emoji-data'
import type { CustomEmojiLike, EmojiCategoryId } from '@/lib/emoji-data'

export interface EmojiPickerProps {
  /** Кастомные эмодзи воркспейса */
  customEmojis?: CustomEmojiLike[]
  workspaceId?: string
  loading?: boolean
  /** Ошибка загрузки эмодзи пространства (строка — текст для подсказки) */
  error?: string | boolean | null
  onRetry?: () => void
  /** Вызывается с shortcode БЕЗ двоеточий */
  onSelect: (shortcode: string) => void
  className?: string
}

const COLS = 8
const CELL = 36
const RECENT_KEY = 'rc-scheduler:emoji-recent:v1'
const RECENT_MAX = 16

const CATEGORY_ICONS: Record<EmojiCategoryId, typeof Smile> = {
  smileys: Smile,
  people: Hand,
  nature: PawPrint,
  food: Utensils,
  activities: Trophy,
  travel: Plane,
  objects: Lightbulb,
  symbols: Hash,
}

type Cell =
  | { key: string; kind: 'std'; name: string; char: string }
  | { key: string; kind: 'custom'; name: string; emoji: CustomEmojiLike; url: string | null }

interface Section {
  id: string
  label: string
  cells: Cell[]
}

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_MAX) : []
  } catch {
    return []
  }
}

function saveRecent(list: string[]) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(list.slice(0, RECENT_MAX)))
  } catch {
    /* localStorage недоступен (приватный режим и т.п.) */
  }
}

export default function EmojiPicker({
  customEmojis = [],
  workspaceId,
  loading = false,
  error = null,
  onRetry,
  onSelect,
  className,
}: EmojiPickerProps) {
  const [query, setQuery] = useState('')
  const [recent, setRecent] = useState<string[]>(loadRecent)
  const [hovered, setHovered] = useState<Cell | null>(null)
  const [failed, setFailed] = useState<Set<string>>(() => new Set())
  const [activeCat, setActiveCat] = useState<string>('')
  const [focusKey, setFocusKey] = useState<string | null>(null)

  const searchRef = useRef<HTMLInputElement>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const cellRefs = useRef<Map<string, HTMLButtonElement>>(new Map())

  const customByName = useMemo(() => {
    const m = new Map<string, CustomEmojiLike>()
    for (const e of customEmojis) m.set(e.name, e)
    return m
  }, [customEmojis])

  const makeCustomCell = useCallback(
    (e: CustomEmojiLike, prefix: string): Cell => ({
      key: `${prefix}:c:${e._id || e.name}`,
      kind: 'custom',
      name: e.name,
      emoji: e,
      url: workspaceId ? customEmojiImageUrl(workspaceId, e) : null,
    }),
    [workspaceId]
  )

  const sections: Section[] = useMemo(() => {
    const q = query.trim()
    if (q) {
      const custom = searchCustomEmojis(customEmojis, q, 120).map((e) => makeCustomCell(e, 'search'))
      const std = searchStandardEmojis(q, 160).map<Cell>((e) => ({
        key: `search:s:${e.name}`,
        kind: 'std',
        name: e.name,
        char: e.char,
      }))
      return [{ id: 'search', label: 'Результаты', cells: [...custom, ...std] }]
    }

    const result: Section[] = []

    const recentCells: Cell[] = []
    for (const name of recent) {
      const std = emojiByShortcode(name)
      if (std) {
        recentCells.push({ key: `recent:s:${std.name}`, kind: 'std', name: std.name, char: std.char })
        continue
      }
      const custom = customByName.get(name)
      if (custom) recentCells.push(makeCustomCell(custom, 'recent'))
    }
    if (recentCells.length) result.push({ id: 'recent', label: 'Недавние', cells: recentCells })

    if (customEmojis.length) {
      result.push({
        id: 'custom',
        label: `Эмодзи пространства (${customEmojis.length})`,
        cells: customEmojis.map((e) => makeCustomCell(e, 'custom')),
      })
    }

    for (const cat of EMOJI_CATEGORIES) {
      result.push({
        id: cat.id,
        label: cat.label,
        cells: emojisOfCategory(cat.id).map<Cell>((e) => ({
          key: `${cat.id}:s:${e.name}`,
          kind: 'std',
          name: e.name,
          char: e.char,
        })),
      })
    }
    return result
  }, [query, recent, customEmojis, customByName, makeCustomCell])

  const showStatus = !!error || (loading && customEmojis.length === 0)
  const navSections = useMemo(() => sections.filter((s) => s.cells.length > 0), [sections])
  const firstKey = navSections[0]?.cells[0]?.key ?? null

  // Если выбранная для фокуса ячейка исчезла (поиск, смена списка) — вернуться к первой.
  useEffect(() => {
    if (focusKey && !navSections.some((s) => s.cells.some((c) => c.key === focusKey))) setFocusKey(null)
  }, [navSections, focusKey])

  // Новый запрос — к началу списка
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0
  }, [query])

  const handleSelect = useCallback(
    (name: string) => {
      setRecent((prev) => {
        const next = [name, ...prev.filter((n) => n !== name)].slice(0, RECENT_MAX)
        saveRecent(next)
        return next
      })
      onSelect(name)
    },
    [onSelect]
  )

  const scrollToSection = (id: string) => {
    const root = scrollRef.current
    const el =
      root?.querySelector<HTMLElement>(`[data-sec="${id}"]`) ??
      (id === 'custom' ? root?.querySelector<HTMLElement>('[data-sec="custom-status"]') : null)
    if (root && el) {
      root.scrollTo({ top: el.offsetTop - 2 })
      setActiveCat(id)
    }
  }

  const onScroll = () => {
    const root = scrollRef.current
    if (!root || query.trim()) return
    const top = root.scrollTop + 8
    let current = ''
    root.querySelectorAll<HTMLElement>('[data-sec]').forEach((el) => {
      if (el.offsetTop <= top) current = el.dataset.sec === 'custom-status' ? 'custom' : el.dataset.sec || current
    })
    if (current && current !== activeCat) setActiveCat(current)
  }

  const focusCell = (key: string) => {
    setFocusKey(key)
    const el = cellRefs.current.get(key)
    if (el) {
      el.focus()
      el.scrollIntoView({ block: 'nearest' })
    }
  }

  const onGridKeyDown = (e: React.KeyboardEvent, si: number, i: number) => {
    const sec = navSections[si]
    if (!sec) return
    let ns = si
    let ni = i
    switch (e.key) {
      case 'ArrowRight':
        ni = i + 1
        if (ni >= sec.cells.length) {
          if (si + 1 >= navSections.length) return e.preventDefault()
          ns = si + 1
          ni = 0
        }
        break
      case 'ArrowLeft':
        ni = i - 1
        if (ni < 0) {
          if (si === 0) return e.preventDefault()
          ns = si - 1
          ni = navSections[ns].cells.length - 1
        }
        break
      case 'ArrowDown':
        ni = i + COLS
        if (ni >= sec.cells.length) {
          if (si + 1 >= navSections.length) {
            ni = sec.cells.length - 1
          } else {
            ns = si + 1
            ni = Math.min(i % COLS, navSections[ns].cells.length - 1)
          }
        }
        break
      case 'ArrowUp':
        ni = i - COLS
        if (ni < 0) {
          if (si === 0) {
            e.preventDefault()
            searchRef.current?.focus()
            return
          }
          ns = si - 1
          const prev = navSections[ns]
          const lastRowStart = Math.floor((prev.cells.length - 1) / COLS) * COLS
          ni = Math.min(lastRowStart + (i % COLS), prev.cells.length - 1)
        }
        break
      default:
        return
    }
    e.preventDefault()
    const target = navSections[ns]?.cells[ni]
    if (target) focusCell(target.key)
  }

  const onSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      const first = navSections[0]?.cells[0]
      if (first) handleSelect(first.name)
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (firstKey) focusCell(firstKey)
    }
  }

  const visibleTabs = useMemo(() => {
    const tabs: Array<{ id: string; label: string; icon: typeof Smile }> = []
    if (sections.some((s) => s.id === 'recent')) tabs.push({ id: 'recent', label: 'Недавние', icon: Clock })
    if (customEmojis.length || showStatus) tabs.push({ id: 'custom', label: 'Эмодзи пространства', icon: Rocket })
    for (const c of EMOJI_CATEGORIES) tabs.push({ id: c.id, label: c.label, icon: CATEGORY_ICONS[c.id] })
    return tabs
  }, [sections, customEmojis.length, showStatus])

  const searching = query.trim().length > 0
  const currentTab = activeCat || visibleTabs[0]?.id

  const renderCell = (cell: Cell, si: number, i: number): ReactNode => {
    const isFailed = failed.has(cell.key)
    const tabbable = focusKey ? focusKey === cell.key : cell.key === firstKey
    return (
      <button
        key={cell.key}
        ref={(el) => {
          if (el) cellRefs.current.set(cell.key, el)
          else cellRefs.current.delete(cell.key)
        }}
        type="button"
        tabIndex={tabbable ? 0 : -1}
        title={`:${cell.name}:`}
        aria-label={`:${cell.name}:`}
        onClick={() => handleSelect(cell.name)}
        onMouseEnter={() => setHovered(cell)}
        onFocus={() => {
          setHovered(cell)
          setFocusKey(cell.key)
        }}
        onKeyDown={(e) => onGridKeyDown(e, si, i)}
        className="flex size-9 scroll-mt-8 items-center justify-center overflow-hidden rounded-md outline-none transition-colors hover:bg-muted focus-visible:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
      >
        {cell.kind === 'std' ? (
          <span className="text-[22px] leading-none" aria-hidden>
            {cell.char}
          </span>
        ) : cell.url && !isFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={cell.url}
            alt={`:${cell.name}:`}
            loading="lazy"
            decoding="async"
            referrerPolicy="no-referrer"
            className="size-6 object-contain"
            onError={() =>
              setFailed((prev) => {
                if (prev.has(cell.key)) return prev
                const next = new Set(prev)
                next.add(cell.key)
                return next
              })
            }
          />
        ) : (
          <span className="line-clamp-3 break-all px-0.5 text-center text-[9px] leading-tight text-muted-foreground">
            :{cell.name}:
          </span>
        )}
      </button>
    )
  }

  const statusRow = showStatus ? (
    <div className="px-1 pb-2">
      {error ? (
        <div
          role="alert"
          className="flex items-center gap-1.5 rounded-md border bg-muted/50 px-2 py-1.5 text-xs text-muted-foreground"
          title={typeof error === 'string' ? error : undefined}
        >
          <span className="min-w-0 flex-1">Не удалось загрузить эмодзи пространства</span>
          {onRetry && (
            <>
              <span aria-hidden>·</span>
              <button
                type="button"
                onClick={onRetry}
                className="shrink-0 font-medium text-primary hover:underline focus-visible:underline focus-visible:outline-none"
              >
                Повторить
              </button>
            </>
          )}
        </div>
      ) : (
        <div aria-busy="true" aria-label="Загрузка эмодзи пространства">
          <div className="py-1.5 text-xs font-medium text-muted-foreground">Эмодзи пространства</div>
          <div className="grid justify-center gap-0" style={{ gridTemplateColumns: `repeat(${COLS}, ${CELL}px)` }}>
            {Array.from({ length: COLS * 2 }).map((_, i) => (
              <div key={i} className="flex size-9 items-center justify-center">
                <Skeleton className="size-6" />
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  ) : null

  return (
    <div className={cn('flex w-full flex-col', className)}>
      <div className="relative border-b p-2">
        <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          ref={searchRef}
          autoFocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onSearchKeyDown}
          placeholder="Поиск эмодзи"
          aria-label="Поиск эмодзи"
          className="h-8 pl-8 text-sm"
        />
      </div>

      {!searching && (
        <div className="flex items-center justify-between border-b px-2 py-1" role="tablist" aria-label="Категории эмодзи">
          {visibleTabs.map((t) => {
            const Icon = t.icon
            const active = currentTab === t.id
            return (
              <button
                key={t.id}
                type="button"
                role="tab"
                aria-selected={active}
                aria-label={t.label}
                title={t.label}
                tabIndex={-1}
                onClick={() => scrollToSection(t.id)}
                className={cn(
                  'flex size-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none',
                  active && 'bg-muted text-foreground'
                )}
              >
                <Icon className="size-4" />
              </button>
            )
          })}
        </div>
      )}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative h-[264px] overflow-y-auto px-2 pb-2 [scrollbar-gutter:stable]"
      >
        {/* Статус загрузки / ошибки: на месте секции «Эмодзи пространства» */}
        {!searching && showStatus && <div data-sec="custom-status">{statusRow}</div>}
        {searching && statusRow}

        {searching && navSections.length === 0 && !showStatus && (
          <p className="px-1 py-8 text-center text-sm text-muted-foreground">Ничего не найдено</p>
        )}

        {sections.map((section) => {
          if (section.cells.length === 0) return null
          const si = navSections.indexOf(section)
          return (
            <div key={section.id} data-sec={section.id}>
              <div className="sticky top-0 z-10 bg-popover px-1 py-1.5 text-xs font-medium text-muted-foreground">
                {section.label}
                {searching ? ` (${section.cells.length})` : ''}
              </div>
              <div
                className="grid justify-center"
                style={{ gridTemplateColumns: `repeat(${COLS}, ${CELL}px)` }}
                role="group"
                aria-label={section.label}
              >
                {section.cells.map((cell, i) => renderCell(cell, si, i))}
              </div>
            </div>
          )
        })}
      </div>

      <div className="flex h-9 items-center gap-2 border-t px-3 text-xs text-muted-foreground">
        {hovered ? (
          <>
            <span className="flex size-5 shrink-0 items-center justify-center text-base leading-none">
              {hovered.kind === 'std' ? (
                hovered.char
              ) : hovered.url && !failed.has(hovered.key) ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={hovered.url} alt="" className="size-5 object-contain" />
              ) : null}
            </span>
            <span className="min-w-0 truncate font-mono text-foreground">:{hovered.name}:</span>
          </>
        ) : (
          <span>Выберите эмодзи · вставится :код:</span>
        )}
      </div>
    </div>
  )
}
