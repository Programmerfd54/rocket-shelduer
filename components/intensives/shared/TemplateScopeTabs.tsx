"use client"

import { useRef, type KeyboardEvent } from 'react'

import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export type TemplateScopeTab = 'SUP' | 'ADM'

const TABS: { value: TemplateScopeTab; label: string }[] = [
  { value: 'SUP', label: 'Шаблоны SUP' },
  { value: 'ADM', label: 'Шаблоны ADM' },
]

/** id вкладки и панели — для связки role="tab" ↔ role="tabpanel" */
export const scopeTabId = (idPrefix: string, scope: TemplateScopeTab) => `${idPrefix}-tab-${scope.toLowerCase()}`
export const scopePanelId = (idPrefix: string) => `${idPrefix}-panel`

/**
 * Переключатель наборов Lead_SUP «Шаблоны SUP» / «Шаблоны ADM» — сегментированный контрол с прокруткой на узких
 * экранах. Доступность: role="tablist", стрелки ←/→, Home/End, активная вкладка в порядке Tab (roving tabindex).
 * Число справа — пунктов/шаблонов в наборе (если известно).
 */
export function TemplateScopeTabs({
  value,
  onChange,
  counts,
  loadingScope,
  idPrefix,
  label = 'Набор шаблонов',
  className,
}: {
  value: TemplateScopeTab
  onChange: (scope: TemplateScopeTab) => void
  counts?: Partial<Record<TemplateScopeTab, number>>
  /** Вкладка, данные которой сейчас загружаются (маленький индикатор) */
  loadingScope?: TemplateScopeTab | null
  idPrefix: string
  label?: string
  className?: string
}) {
  const refs = useRef<Record<string, HTMLButtonElement | null>>({})

  const focusAndSelect = (next: TemplateScopeTab) => {
    onChange(next)
    refs.current[next]?.focus()
  }

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const idx = TABS.findIndex((t) => t.value === value)
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault()
      focusAndSelect(TABS[(idx + 1) % TABS.length].value)
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault()
      focusAndSelect(TABS[(idx - 1 + TABS.length) % TABS.length].value)
    } else if (e.key === 'Home') {
      e.preventDefault()
      focusAndSelect(TABS[0].value)
    } else if (e.key === 'End') {
      e.preventDefault()
      focusAndSelect(TABS[TABS.length - 1].value)
    }
  }

  return (
    <div className={cn('-mx-1 overflow-x-auto px-1 py-0.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden', className)}>
      <div role="tablist" aria-label={label} className="inline-flex min-w-max rounded-md border bg-muted/50 p-0.5">
        {TABS.map((t) => {
          const active = t.value === value
          const count = counts?.[t.value]
          return (
            <button
              key={t.value}
              ref={(el) => {
                refs.current[t.value] = el
              }}
              type="button"
              role="tab"
              id={scopeTabId(idPrefix, t.value)}
              aria-selected={active}
              aria-controls={scopePanelId(idPrefix)}
              aria-label={count !== undefined ? `${t.label}: ${count}` : t.label}
              tabIndex={active ? 0 : -1}
              onClick={() => onChange(t.value)}
              onKeyDown={onKeyDown}
              className={cn(
                'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-sm px-3 sm:h-8 text-[13px] font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40',
                active ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {t.label}
              {loadingScope === t.value ? (
                <Spinner className="size-3 text-muted-foreground" aria-hidden />
              ) : count !== undefined ? (
                <span className="text-xs font-normal tabular-nums text-muted-foreground" aria-hidden>
                  {count}
                </span>
              ) : null}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Подпись набора для SUP / ADM (без переключения): «Шаблоны SUP». */
export function TemplateScopeLabel({ scope, className }: { scope: TemplateScopeTab; className?: string }) {
  return (
    <span className={cn('inline-flex h-6 items-center rounded-md border px-2 text-xs font-medium text-muted-foreground', className)}>
      {scope === 'SUP' ? 'Шаблоны SUP' : 'Шаблоны ADM'}
    </span>
  )
}
