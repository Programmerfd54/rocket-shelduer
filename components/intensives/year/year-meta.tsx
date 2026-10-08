"use client"

import type { LucideIcon } from 'lucide-react'
import { Archive, Ban, CalendarClock, CircleCheck, CircleDot, FilePen } from 'lucide-react'
import type { IntensiveSummary, PlanProgress } from '@/lib/intensives/types'
import { formatRange, formatYmd, pluralize } from '@/lib/intensives/ui'
import { diffYmd } from './year-layout'

export type BarKind = 'draft' | 'upcoming' | 'running' | 'finished' | 'cancelled' | 'archived'

export interface IntensiveView {
  kind: BarKind
  /** Короткая подпись состояния: «Идёт», «Предстоящий», «Черновик»… */
  label: string
  Icon: LucideIcon
}

/** Состояние для отображения: статус + фаза (у опубликованных). Цвет не единственный признак — всегда есть подпись и иконка. */
export function intensiveView(i: Pick<IntensiveSummary, 'status' | 'phase'>): IntensiveView {
  switch (i.status) {
    case 'DRAFT':
      return { kind: 'draft', label: 'Черновик', Icon: FilePen }
    case 'CANCELLED':
      return { kind: 'cancelled', label: 'Отменён', Icon: Ban }
    case 'ARCHIVED':
      return { kind: 'archived', label: 'В архиве', Icon: Archive }
    default:
      if (i.phase === 'RUNNING') return { kind: 'running', label: 'Идёт', Icon: CircleDot }
      if (i.phase === 'FINISHED') return { kind: 'finished', label: 'Завершён', Icon: CircleCheck }
      return { kind: 'upcoming', label: 'Предстоящий', Icon: CalendarClock }
  }
}

/** Период с годом, если он целиком в одном году: «12–25 октября 2026». */
export function formatPeriod(start: string, end: string): string {
  const range = formatRange(start, end)
  return start.slice(0, 4) === end.slice(0, 4) ? `${range} ${start.slice(0, 4)}` : range
}

/** «День 3 из 14» / «Начнётся через 5 дней» / «Завершён 25 октября» / «Не опубликован» … */
export function dayLine(i: IntensiveSummary): string {
  if (i.status === 'DRAFT') return 'Черновик · виден только Lead_SUP'
  if (i.status === 'CANCELLED') return 'Интенсив отменён'
  if (i.status === 'ARCHIVED') return 'Интенсив в архиве'
  if (i.phase === 'RUNNING' && i.day.dayNumber) return `День ${i.day.dayNumber} из ${i.day.totalDays}`
  if (i.phase === 'UPCOMING') {
    const n = diffYmd(i.day.today, i.startDate)
    if (n <= 0) return `Начнётся ${formatYmd(i.startDate)}`
    return `Начнётся через ${n} ${pluralize(n, 'день', 'дня', 'дней')}`
  }
  if (i.phase === 'FINISHED') return `Завершён ${formatYmd(i.endDate)}`
  return `Всего ${i.day.totalDays} ${pluralize(i.day.totalDays, 'день', 'дня', 'дней')}`
}

/** Строка прогресса: «Выполнено 8 из 24 · Запланировано 10 · Требуют внимания 2». */
export function progressLine(p: PlanProgress): string {
  const parts = [`Выполнено ${p.completed} из ${p.total}`]
  if (p.scheduled > 0) parts.push(`Запланировано ${p.scheduled}`)
  if (p.skipped > 0) parts.push(`Пропущено ${p.skipped}`)
  if (p.needsAttention > 0) parts.push(`Требуют внимания ${p.needsAttention}`)
  return parts.join(' · ')
}

/** Короткий прогресс для тесных мест: «8 из 24». */
export function progressShort(p: PlanProgress | null): string | null {
  if (!p || p.total === 0) return null
  return `${p.completed} из ${p.total}`
}

/** Текст для скринридера и подсказки к полосе. */
export function barAriaLabel(i: IntensiveSummary, view: IntensiveView): string {
  const parts = [`${i.name}`, `пространство ${i.orgSpace.name}`, formatPeriod(i.startDate, i.endDate), view.label]
  const short = progressShort(i.progress)
  if (short && i.status === 'PUBLISHED') parts.push(`выполнено ${short}`)
  return parts.join(', ')
}
