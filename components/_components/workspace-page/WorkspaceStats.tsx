"use client"

import { cn } from '@/lib/utils'

type StatKey = 'all' | 'PENDING' | 'SENT' | 'FAILED'

const ITEMS: { key: StatKey; label: string; dot: string }[] = [
  { key: 'all', label: 'Всего сообщений', dot: 'bg-muted-foreground/50' },
  { key: 'PENDING', label: 'Ожидают', dot: 'bg-amber-500' },
  { key: 'SENT', label: 'Отправлено', dot: 'bg-emerald-500' },
  { key: 'FAILED', label: 'Ошибки', dot: 'bg-red-500' },
]

/** Сводка сообщений: плоская полоса из четырёх счётчиков, клик открывает вкладку «Сообщения» с фильтром. */
export function WorkspaceStats({
  total,
  pending,
  sent,
  failed,
  onSelect,
}: {
  total: number
  pending: number
  sent: number
  failed: number
  onSelect: (key: StatKey) => void
}) {
  const values: Record<StatKey, number> = { all: total, PENDING: pending, SENT: sent, FAILED: failed }
  return (
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4" role="group" aria-label="Сводка сообщений">
      {ITEMS.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onSelect(item.key)}
          className="bg-card px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
        >
          <p className="text-xl font-semibold tabular-nums leading-tight">{values[item.key]}</p>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className={cn('size-1.5 rounded-full', item.dot)} aria-hidden />
            {item.label}
          </p>
        </button>
      ))}
    </div>
  )
}
