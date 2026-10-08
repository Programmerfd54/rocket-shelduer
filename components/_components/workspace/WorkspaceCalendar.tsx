'use client'

import { useState, useMemo } from 'react'
import { Button } from '@/components/ui/button'
import { ChevronLeft, ChevronRight } from 'lucide-react'
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
    <div className="rounded-lg border bg-card">
      <div className="flex items-center justify-between gap-2 border-b px-4 py-2.5">
        <h3 className="text-sm font-semibold">Календарь по статусам</h3>
        <Link
          href={`/dashboard/calendar?workspaceId=${workspaceId}`}
          className="text-xs text-primary hover:underline"
        >
          Полный календарь →
        </Link>
      </div>
      <div className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))}
            aria-label="Предыдущий месяц"
          >
            <ChevronLeft />
          </Button>
          <span className="text-sm font-medium">
            {MONTHS[currentDate.getMonth()]} {currentDate.getFullYear()}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))}
            aria-label="Следующий месяц"
          >
            <ChevronRight />
          </Button>
        </div>
        <div className="grid grid-cols-7 gap-0.5 text-center">
          {WEEKDAYS.map((w) => (
            <div key={w} className="py-1 text-[11px] font-medium text-muted-foreground">
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
            const label = `${day} ${MONTHS[currentDate.getMonth()].toLowerCase()}${total > 0 ? `: сообщений — ${total}` : ''}`
            return (
              <Link
                key={key}
                href={`/dashboard/calendar?workspaceId=${workspaceId}`}
                aria-label={label}
                title={label}
                className={cn(
                  'flex min-h-[36px] flex-col items-center justify-center rounded-md text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40',
                  total === 0 ? 'text-muted-foreground' : 'font-medium text-foreground',
                  isToday && 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                <span>{day}</span>
                {total > 0 && (
                  <span className="mt-0.5 flex gap-0.5">
                    {hasPending && <span className="size-1.5 rounded-full bg-amber-500" />}
                    {hasSent && <span className="size-1.5 rounded-full bg-emerald-500" />}
                    {hasFailed && <span className="size-1.5 rounded-full bg-red-500" />}
                  </span>
                )}
              </Link>
            )
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t pt-3 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-amber-500" /> Ожидает
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-emerald-500" /> Отправлено
          </span>
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-red-500" /> Ошибки
          </span>
        </div>
      </div>
    </div>
  )
}
