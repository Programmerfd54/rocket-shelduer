"use client"

import { CircleHelp } from 'lucide-react'

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import type { PlanProgress } from '@/lib/intensives/types'
import { cn } from '@/lib/utils'

/** Подсказка «Как считается прогресс» — вместо длинного абзаца над списком. */
export function ProgressHelp({ partial, scopeNote, className }: { partial?: boolean; scopeNote?: string; className?: string }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex h-8 items-center gap-1 rounded-md px-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50',
            className,
          )}
        >
          <CircleHelp className="size-4" aria-hidden />
          Как считается прогресс
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3 text-[13px] leading-relaxed">
        <p className="font-medium text-foreground">Как считается прогресс</p>
        <ul className="space-y-1.5 text-muted-foreground">
          <li>
            <span className="text-foreground">Выполнено</span> — по пункту есть хотя бы одна успешная отправка. Несколько
            отправок одного пункта считаются один раз.
          </li>
          <li>
            <span className="text-foreground">Запланировано</span> — есть ожидающая отправка, в том числе если время уже
            наступило, а отправка ещё в очереди.
          </li>
          <li>
            <span className="text-foreground">Требуют внимания</span> — ошибка отправки, ожидание после назначенного времени
            или ошибка повторной отправки.
          </li>
          <li>
            <span className="text-foreground">Пропущено</span> — решение руководителя, такие пункты не считаются
            отправленными.
          </li>
          <li>Копирование текста прогресс не меняет — учитываются только сообщения, запланированные из плана.</li>
          <li>Прогресс считает сервер по всем отправкам этого интенсива во всех подключениях пространства.</li>
          {partial && <li>Вы видите только доступные вам анонсы — прогресс посчитан по ним.</li>}
          {scopeNote && <li>{scopeNote}</li>}
        </ul>
      </PopoverContent>
    </Popover>
  )
}

/**
 * Сводка прогресса плана: «Выполнено 8 из 24 · Запланировано 10 · Требуют внимания 2».
 * partial → подпись «Доступные вам анонсы». Цифры приходят с сервера (полная выборка, не страница).
 */
export function PlanProgressSummary({
  progress,
  partial,
  scopeNote,
  showHelp = true,
  className,
}: {
  progress: PlanProgress
  partial: boolean
  /** Пояснение в подсказке: по какому набору посчитан прогресс (вкладки Lead_SUP) */
  scopeNote?: string
  showHelp?: boolean
  className?: string
}) {
  const parts: { key: string; label: string; value: string; attention?: boolean }[] = [
    { key: 'done', label: 'Выполнено', value: `${progress.completed} из ${progress.total}` },
    { key: 'scheduled', label: 'Запланировано', value: String(progress.scheduled) },
  ]
  if (progress.needsAttention > 0) {
    parts.push({ key: 'attention', label: 'Требуют внимания', value: String(progress.needsAttention), attention: true })
  }
  if (progress.skipped > 0) parts.push({ key: 'skipped', label: 'Пропущено', value: String(progress.skipped) })
  if (progress.remaining > 0 && progress.remaining !== progress.total) {
    parts.push({ key: 'remaining', label: 'Осталось', value: String(progress.remaining) })
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {partial && <span className="text-[13px] font-medium text-foreground">Доступные вам анонсы</span>}
      <p className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px] text-muted-foreground" aria-label="Прогресс плана">
        {parts.map((p, i) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            {i > 0 && <span aria-hidden>·</span>}
            <span>
              {p.label}{' '}
              <span className={cn('font-medium tabular-nums text-foreground', p.attention && 'text-amber-700 dark:text-amber-300')}>
                {p.value}
              </span>
            </span>
          </span>
        ))}
      </p>
      {showHelp && <ProgressHelp partial={partial} scopeNote={scopeNote} />}
    </div>
  )
}
