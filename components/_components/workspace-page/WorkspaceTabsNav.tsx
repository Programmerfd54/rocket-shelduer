"use client"

import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

export type WorkspaceTabItem = {
  value: string
  label: string
  icon: ReactNode
  /** Счётчик — обычное приглушённое число справа */
  count?: number
}

/**
 * Навигация по вкладкам пространства: вертикальная на десктопе, горизонтальная с прокруткой на мобильных.
 * Активная вкладка — лёгкий фон и акцентная иконка, без цветных рамок.
 */
export function WorkspaceTabsNav({
  items,
  active,
  onChange,
}: {
  items: WorkspaceTabItem[]
  active: string
  onChange: (value: string) => void
}) {
  return (
    <nav
      aria-label="Разделы пространства"
      className="-mx-4 flex shrink-0 gap-1 overflow-x-auto border-b px-4 pb-2 [scrollbar-width:none] sm:-mx-0 sm:px-0 lg:sticky lg:top-6 lg:mx-0 lg:w-52 lg:flex-col lg:self-start lg:overflow-visible lg:border-b-0 lg:px-0 lg:pb-0 [&::-webkit-scrollbar]:hidden"
    >
      {items.map((item) => {
        const isActive = item.value === active
        return (
          <button
            key={item.value}
            type="button"
            onClick={() => onChange(item.value)}
            aria-current={isActive ? 'page' : undefined}
            className={cn(
              'flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md px-2.5 text-sm font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40 lg:w-full',
              isActive
                ? 'bg-muted text-foreground [&_svg]:text-primary'
                : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
            )}
          >
            <span className="shrink-0 [&_svg]:size-4" aria-hidden>
              {item.icon}
            </span>
            <span className="truncate text-left lg:flex-1">{item.label}</span>
            {item.count !== undefined && (
              <span className="text-xs font-normal tabular-nums text-muted-foreground">{item.count}</span>
            )}
          </button>
        )
      })}
    </nav>
  )
}
