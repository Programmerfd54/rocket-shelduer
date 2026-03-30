'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight, Calendar as CalendarIcon } from 'lucide-react'
import { cn } from '@/lib/utils'
import Link from 'next/link'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

function getDaysInMonth(d: Date) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate()
}

function getFirstDayOfMonth(d: Date) {
  const day = new Date(d.getFullYear(), d.getMonth(), 1).getDay()
  return day === 0 ? 6 : day - 1
}

interface WorkspaceCalendarProps {
  messages: Array<{ id: string; scheduledFor: string; status: string; channelId: string }>
  workspaceId: string
}

export function WorkspaceCalendar({ messages, workspaceId }: WorkspaceCalendarProps) {
  const [currentDate, setCurrentDate] = useState(new Date())

  const daysInMonth = getDaysInMonth(currentDate)
  const firstDay = getFirstDayOfMonth(currentDate)

  const dayStats = useMemo(() => {
    const stats: Record<string, { pending: number; sent: number; failed: number }> = {}
    messages.forEach((msg) => {
      const d = new Date(msg.scheduledFor)
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
      if (!stats[key]) stats[key] = { pending: 0, sent: 0, failed: 0 }
      if (msg.status === 'PENDING') stats[key].pending++
      else if (msg.status === 'SENT') stats[key].sent++
      else if (msg.status === 'FAILED') stats[key].failed++
    })
    return stats
  }, [messages])

  const days: (number | null)[] = []
  for (let i = 0; i < firstDay; i++) days.push(null)
  for (let d = 1; d <= daysInMonth; d++) days.push(d)

  const today = new Date()
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`

  return (
    <Card className="rounded-2xl border-2 border-teal-500/25 bg-gradient-to-b from-teal-500/[0.12] via-teal-500/[0.06] to-card shadow-sm overflow-hidden">
      <div className="px-4 py-3 border-b border-teal-500/20 bg-teal-500/10 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Календарь по статусам</h3>
        <Link href={`/dashboard/calendar?workspaceId=${workspaceId}`} className="text-xs text-primary hover:underline">
          Полный календарь →
        </Link>
      </div>
      <CardContent className="p-4">
        <div className="flex items-center justify-between mb-3">
          <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}>
            <ChevronLeft className="w-4 h-4" />
          </Button>
          <span className="text-sm font-medium">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
          <Button variant="ghost" size="icon" onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}>
            <ChevronRight className="w-4 h-4" />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="text-[10px] font-medium text-muted-foreground py-1">
              {w}
            </div>
          ))}
          {days.map((day, i) => {
            if (day === null) return <div key={`empty-${i}`} />
            const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), day)
            const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
            const stat = dayStats[key]
            const isToday = key === todayKey
            const hasPending = (stat?.pending ?? 0) > 0
            const hasSent = (stat?.sent ?? 0) > 0
            const hasFailed = (stat?.failed ?? 0) > 0
            const total = (stat?.pending ?? 0) + (stat?.sent ?? 0) + (stat?.failed ?? 0)
            // Жёлтый — есть ожидающие; зелёный — только отправленные (без ожидающих); красный — ошибки
            const dayTone =
              hasFailed
                ? 'bg-rose-500/25 text-rose-800 dark:text-rose-200 ring-1 ring-rose-400/40'
                : hasPending
                  ? 'bg-amber-400/35 text-amber-950 dark:text-amber-100 ring-1 ring-amber-400/50'
                  : hasSent
                    ? 'bg-emerald-500/30 text-emerald-900 dark:text-emerald-100 ring-1 ring-emerald-400/40'
                    : 'text-muted-foreground/70'
            return (
              <Link
                key={key}
                href={`/dashboard/calendar?workspaceId=${workspaceId}`}
                className={cn(
                  'min-h-[36px] flex flex-col items-center justify-center rounded-lg text-xs font-medium transition-colors hover:ring-2 hover:ring-teal-500/40',
                  isToday && 'ring-2 ring-teal-600 bg-teal-500/15',
                  total === 0 && 'text-muted-foreground/60',
                  total > 0 && dayTone
                )}
              >
                <span>{day}</span>
                {total > 0 && (
                  <span className="flex gap-0.5 mt-0.5">
                    {hasPending && <span className="w-1.5 h-1.5 rounded-full bg-amber-500" />}
                    {hasSent && <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />}
                    {hasFailed && <span className="w-1.5 h-1.5 rounded-full bg-rose-500" />}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
        <div className="flex flex-wrap gap-3 mt-4 pt-3 border-t border-border/60 text-[10px]">
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-amber-500" /> Ожидает
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" /> Отправлено
          </span>
          <span className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full bg-rose-500" /> Ошибки
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
