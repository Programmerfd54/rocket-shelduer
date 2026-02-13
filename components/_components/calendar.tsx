"use client"

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  ChevronLeft,
  ChevronRight,
  Calendar as CalendarIcon,
  Clock,
  Printer,
  Plus,
  LayoutGrid,
  CalendarDays,
  RefreshCw,
  RotateCcw,
  Hash,
  BarChart3,
  Server,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatLocalDate, getInitials, generateAvatarColor, getChannelTagColors } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']

export default function CalendarPage() {
  const [externalStatuses, setExternalStatuses] = useState<Record<string, 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'>>({})

  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaceIdFromUrl = searchParams.get('workspaceId')
  const [currentDate, setCurrentDate] = useState(new Date())
  const [messages, setMessages] = useState<any[]>([])
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [currentUser, setCurrentUser] = useState<any>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [viewMode, setViewMode] = useState<'month' | 'week' | 'timeline'>('month')
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterWorkspaceId, setFilterWorkspaceId] = useState<string>(workspaceIdFromUrl || 'all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'time' | 'user' | 'channel'>('time')
  const [hourRangePreset, setHourRangePreset] = useState<'8-22' | '6-24' | '9-18'>('8-22')
  const [addMessageDialogOpen, setAddMessageDialogOpen] = useState(false)
  const didInitialSelectRef = useRef(false)

  const isSupOrAdm = currentUser?.role === 'SUPPORT' || currentUser?.role === 'ADM' || currentUser?.role === 'ADMIN'
  const hasActiveFilters = filterRole !== 'all' || filterWorkspaceId !== 'all' || filterStatus !== 'all'

  useEffect(() => {
    if (workspaceIdFromUrl) setFilterWorkspaceId(workspaceIdFromUrl)
  }, [workspaceIdFromUrl])

  useEffect(() => {
    loadData()
  }, [currentDate])

  // Автовыбор даты при первой загрузке
  useEffect(() => {
    if (!loading && !didInitialSelectRef.current) {
      setSelectedDate(new Date())
      didInitialSelectRef.current = true
    }
  }, [loading])

  const loadData = async () => {
    try {
      setLoading(true)
      const [userRes, messagesRes, workspacesRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/messages?scope=calendar'),
        fetch(`/api/workspace?today=${formatLocalDate(new Date())}`),
      ])
      if (userRes.ok) {
        const userData = await userRes.json()
        setCurrentUser(userData.user)
      }
      if (messagesRes.ok) {
        const messagesData = await messagesRes.json()
        setMessages(messagesData.messages || [])
      }
      if (workspacesRes.ok) {
        const workspacesData = await workspacesRes.json()
        setWorkspaces(workspacesData.workspaces || [])
      }
    } catch (error) {
      toast.error('Ошибка загрузки данных')
    } finally {
      setLoading(false)
    }
  }

  // Фильтрация сообщений по роли, воркспейсу и статусу
  const filteredMessages = useMemo(() => {
    return messages.filter((msg: any) => {
      if (filterRole !== 'all' && (msg.user?.role || 'USER') !== filterRole) return false
      if (filterWorkspaceId !== 'all' && msg.workspaceId !== filterWorkspaceId) return false
      if (filterStatus !== 'all' && msg.status !== filterStatus) return false
      return true
    })
  }, [messages, filterRole, filterWorkspaceId, filterStatus])



  console.log(filteredMessages) 



  
  const checkExternalMessageStatuses = async (messages: any[]) => {
    // Берём только отправленные сообщения, у которых есть messageId_RC
    const toCheck = messages.filter(
      (m) => m.status === 'SENT' && m.messageId_RC
    ) as { id: string; status: string; messageId_RC?: string | null }[]

    if (toCheck.length === 0) return

    const newStatuses: Record<string, 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'> = {}

    await Promise.all(
      toCheck.map(async (msg) => {
        try {
          const res = await fetch(`/api/messages/${msg.id}`)
          if (!res.ok) {
            newStatuses[msg.id] = 'UNKNOWN'
            return
          }
          const data = await res.json()
          newStatuses[msg.id] = data.externalStatus || 'UNKNOWN'
        } catch {
          newStatuses[msg.id] = 'UNKNOWN'
        }
      })
    )

    setExternalStatuses((prev) => ({ ...prev, ...newStatuses }))
  }


  const getExternalStatusBadge = (messageId: string) => {
    const status = externalStatuses[messageId]
    if (!status) return null

    if (status === 'DELETED_IN_RC') {
      return (
        <Badge variant="destructive" className="text-xs">
          Удалено в Rocket.Chat
        </Badge>
      )
    }

    if (status === 'EDITED_IN_RC') {
      return (
        <Badge variant="outline" className="text-xs border-blue-400 text-blue-700 dark:text-blue-200 dark:border-blue-500">
          Изменено в Rocket.Chat
        </Badge>
      )
    }

    // Для SYNCHRONIZED / UNKNOWN ничего не показываем, чтобы не перегружать UI
    return null
  }
  // Calendar helpers
  const getDaysInMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    return new Date(year, month + 1, 0).getDate()
  }

  const getFirstDayOfMonth = (date: Date) => {
    const year = date.getFullYear()
    const month = date.getMonth()
    const firstDay = new Date(year, month, 1).getDay()
    return firstDay === 0 ? 6 : firstDay - 1 // Convert to Monday = 0
  }

  const getMessagesForDate = (date: Date, source = filteredMessages) => {
    return source.filter((msg: any) => {
      const msgDate = new Date(msg.scheduledFor)
      return (
        msgDate.getDate() === date.getDate() &&
        msgDate.getMonth() === date.getMonth() &&
        msgDate.getFullYear() === date.getFullYear()
      )
    })
  }

  // Сообщения в текущем месяце (для сводки и пустого месяца)
  const messagesInCurrentMonth = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    return filteredMessages.filter((msg: any) => {
      const d = new Date(msg.scheduledFor)
      return d.getFullYear() === year && d.getMonth() === month
    })
  }, [currentDate, filteredMessages])

  const monthStats = useMemo(() => {
    const pending = messagesInCurrentMonth.filter((m: any) => m.status === 'PENDING').length
    const sent = messagesInCurrentMonth.filter((m: any) => m.status === 'SENT').length
    const failed = messagesInCurrentMonth.filter((m: any) => m.status === 'FAILED').length
    return { total: messagesInCurrentMonth.length, pending, sent, failed }
  }, [messagesInCurrentMonth])

  const getIntensivePeriodsForDate = (date: Date) => {
    return workspaces.filter((ws: any) => {
      if (!ws.startDate || !ws.endDate || ws.isArchived) return false
      
      // Normalize dates to start of day for comparison
      const startDate = new Date(ws.startDate)
      startDate.setHours(0, 0, 0, 0)
      
      const endDate = new Date(ws.endDate)
      endDate.setHours(23, 59, 59, 999)
      
      const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      checkDate.setHours(0, 0, 0, 0)
      
      return checkDate >= startDate && checkDate <= endDate
    })
  }

  const isDateInIntensivePeriod = (date: Date) => {
    return getIntensivePeriodsForDate(date).length > 0
  }

  const previousMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1))
  }

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1))
  }

  // В режиме недели — сдвиг ровно на 7 дней, чтобы все даты были видны и не было «перескакивания»
  const previousWeek = () => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() - 7)
    setCurrentDate(d)
  }

  const timelineStart = useMemo(() => {
    const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), 1)
    d.setHours(0, 0, 0, 0)
    return d
  }, [currentDate])
  const timelineDays = useMemo(() => {
    const n = getDaysInMonth(currentDate)
    return Array.from({ length: n }, (_, i) => {
      const d = new Date(currentDate.getFullYear(), currentDate.getMonth(), i + 1)
      d.setHours(0, 0, 0, 0)
      return d
    })
  }, [currentDate])
  const messagesForTimeline = useMemo(() => {
    return filteredMessages
      .filter((msg: any) => {
        const t = new Date(msg.scheduledFor).getTime()
        const start = timelineStart.getTime()
        const end = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 0, 23, 59, 59).getTime()
        return t >= start && t <= end
      })
      .sort((a: any, b: any) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  }, [filteredMessages, timelineStart, currentDate])

  const nextWeek = () => {
    const d = new Date(currentDate)
    d.setDate(d.getDate() + 7)
    setCurrentDate(d)
  }

  const today = () => {
    setCurrentDate(new Date())
  }

  // Generate calendar days
  const daysInMonth = getDaysInMonth(currentDate)
  const firstDay = getFirstDayOfMonth(currentDate)
  const days = []

  // Add empty cells for days before month starts
  for (let i = 0; i < firstDay; i++) {
    days.push(null)
  }

  // Add actual days
  for (let day = 1; day <= daysInMonth; day++) {
    days.push(day)
  }

  const monthName = currentDate.toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' })

  // Понедельник текущей недели
  const getWeekStart = (d: Date) => {
    const date = new Date(d)
    const day = date.getDay()
    const diff = date.getDate() - (day === 0 ? 6 : day - 1)
    return new Date(date.setDate(diff))
  }

  const weekStart = getWeekStart(currentDate)
  const weekDays = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart)
    d.setDate(weekStart.getDate() + i)
    return d
  })

  const weekEnd = useMemo(() => {
    const end = new Date(weekStart)
    end.setDate(weekStart.getDate() + 6)
    end.setHours(23, 59, 59, 999)
    return end
  }, [weekStart])
  const messagesInCurrentWeek = useMemo(() => {
    const start = new Date(weekStart)
    start.setHours(0, 0, 0, 0)
    return filteredMessages.filter((msg: any) => {
      const t = new Date(msg.scheduledFor).getTime()
      return t >= start.getTime() && t <= weekEnd.getTime()
    })
  }, [filteredMessages, weekStart, weekEnd])

  const HOURS = useMemo(() => {
    const [start, end] = hourRangePreset === '8-22' ? [8, 22] : hourRangePreset === '6-24' ? [6, 24] : [9, 18]
    return Array.from({ length: end - start + 1 }, (_, i) => start + i)
  }, [hourRangePreset])
  const getMessagesForWeekSlot = (day: Date, hour: number) => {
    const start = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour, 0, 0)
    const end = new Date(day.getFullYear(), day.getMonth(), day.getDate(), hour + 1, 0, 0)
    return filteredMessages.filter((msg: any) => {
      const t = new Date(msg.scheduledFor).getTime()
      return t >= start.getTime() && t < end.getTime()
    })
  }

  const selectedMessagesRaw = selectedDate ? getMessagesForDate(selectedDate) : []
  const selectedMessages = useMemo(() => {
    const list = [...selectedMessagesRaw]
    if (sortBy === 'time') list.sort((a: any, b: any) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
    if (sortBy === 'user') list.sort((a: any, b: any) => (a.user?.name || a.user?.email || '').localeCompare(b.user?.name || b.user?.email || ''))
    if (sortBy === 'channel') list.sort((a: any, b: any) => (a.channelName || '').localeCompare(b.channelName || ''))
    return list
  }, [selectedMessagesRaw, sortBy])

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'PENDING': return 'bg-yellow-500'
      case 'SENT': return 'bg-green-500'
      case 'FAILED': return 'bg-red-500'
      default: return 'bg-gray-500'
    }
  }

  // Цвета по роли: SUP — синий, ADM — розовый, VOL — фиолетовый
  const getRoleColor = (role: string) => {
    switch (role) {
      case 'SUPPORT': return { bg: 'bg-blue-500', borderL: 'border-l-blue-500', light: 'bg-blue-500/20', text: 'text-blue-700' }
      case 'ADMIN': return { bg: 'bg-gray-500', borderL: 'border-l-gray-500', light: 'bg-gray-500/20', text: 'text-gray-700' }
      case 'ADM': return { bg: 'bg-pink-500', borderL: 'border-l-pink-500', light: 'bg-pink-500/20', text: 'text-pink-700' }
      case 'VOL': return { bg: 'bg-purple-500', borderL: 'border-l-purple-500', light: 'bg-purple-500/20', text: 'text-purple-700' }
      default: return { bg: 'bg-gray-500', borderL: 'border-l-gray-500', light: 'bg-gray-500/20', text: 'text-gray-700' }
    }
  }

  const roleLabel = (role: string) => {
    switch (role) {
      case 'SUPPORT': return 'SUPPORT'
      case 'ADMIN': return 'ADMIN'
      case 'ADM': return 'ADM'
      case 'VOL': return 'VOL'
      default: return role || '—'
    }
  }


  const firstWorkspaceId = workspaces.find((w: any) => !w.isArchived)?.id ?? null
  const activeWorkspaces = workspaces.filter((w: any) => !w.isArchived)

  return (
    <div className="p-6 space-y-6 print:block">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Календарь', current: true },
        ]}
        className="mb-2"
      />
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 print:flex-nowrap">
        <div>
          <h1 className="text-3xl font-bold">Календарь</h1>
          <p className="text-muted-foreground mt-1">
            Визуализация запланированных сообщений
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <Button variant="outline" size="sm" onClick={() => loadData()} className="gap-1.5" title="Обновить данные">
            <RefreshCw className="w-4 h-4" />
            Обновить
          </Button>
      
          {activeWorkspaces.length > 0 && (
            <Button size="sm" className="gap-1.5" onClick={() => setAddMessageDialogOpen(true)}>
              <Plus className="w-4 h-4" />
              Добавить сообщение
            </Button>
          )}
        </div>
      </div>

      {/* Фильтры — только для не-печати */}
      <div className="flex flex-wrap items-center gap-3 no-print">
        {isSupOrAdm && (
          <Select value={filterRole} onValueChange={setFilterRole}>
            <SelectTrigger className="w-[120px]">
              <SelectValue placeholder="Роль" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все роли</SelectItem>
              <SelectItem value="SUPPORT">SUPPORT</SelectItem>
              <SelectItem value="ADMIN">ADMIN</SelectItem>
              <SelectItem value="ADM">ADM</SelectItem>
              <SelectItem value="VOL">VOL</SelectItem>
            </SelectContent>
          </Select>
        )}
        <Select value={filterWorkspaceId} onValueChange={setFilterWorkspaceId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Воркспейс" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все воркспейсы</SelectItem>
            {workspaces.filter((w: any) => !w.isArchived).map((w: any) => (
              <SelectItem key={w.id} value={w.id}>{w.workspaceName}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={setFilterStatus}>
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="PENDING">Ожидает</SelectItem>
            <SelectItem value="SENT">Отправлено</SelectItem>
            <SelectItem value="FAILED">Ошибка</SelectItem>
          </SelectContent>
        </Select>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => {
              setFilterRole('all')
              setFilterWorkspaceId('all')
              setFilterStatus('all')
              if (workspaceIdFromUrl) router.replace('/dashboard/calendar', { scroll: false })
            }}
            className="gap-1.5 text-muted-foreground"
          >
            <RotateCcw className="w-4 h-4" />
            Сбросить фильтры
          </Button>
        )}
      </div>

      {/* Подсказка при фильтре по пространству: в этом пространстве видны сообщения от всех пользователей */}
      {filterWorkspaceId !== 'all' && (
        <p className="text-sm text-muted-foreground no-print">
          Показаны сообщения по пространству «{workspaces.find((w: any) => w.id === filterWorkspaceId)?.workspaceName ?? '…'}».
          {isSupOrAdm && ' В выборке — все пользователи этого пространства.'} Чтобы видеть все пространства, выберите «Все воркспейсы» или нажмите «Сбросить фильтры».
        </p>
      )}

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Calendar */}
        <Card className="lg:col-span-2 rounded-2xl border border-border/80 bg-card shadow-sm print:shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Select
                  value={`month-${currentDate.getMonth()}`}
                  onValueChange={(v) => {
                    const month = parseInt(v.replace('month-', ''), 10)
                    setCurrentDate(new Date(currentDate.getFullYear(), month, 1))
                  }}
                >
                  <SelectTrigger className="w-[130px] no-print">
                    <SelectValue>{MONTHS[currentDate.getMonth()]}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {MONTHS.map((name, i) => (
                      <SelectItem key={i} value={`month-${i}`}>{name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Select
                  value={`year-${currentDate.getFullYear()}`}
                  onValueChange={(v) => {
                    const year = parseInt(v.replace('year-', ''), 10)
                    setCurrentDate(new Date(year, currentDate.getMonth(), 1))
                  }}
                >
                  <SelectTrigger className="w-[90px] no-print">
                    <SelectValue>{currentDate.getFullYear()}</SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - 2 + i).map((y) => (
                      <SelectItem key={y} value={`year-${y}`}>{y}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <CardTitle className="text-xl capitalize hidden sm:block">
                  {viewMode === 'week'
                    ? `${weekStart.toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
                    : viewMode === 'timeline'
                      ? `Таймлайн · ${monthName}`
                      : monthName}
                </CardTitle>
                <div className="flex items-center gap-1 no-print">
                  <Button variant={viewMode === 'month' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('month')} title="Месяц">
                    <LayoutGrid className="w-4 h-4" />
                  </Button>
                  <Button variant={viewMode === 'week' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('week')} title="Неделя">
                    <CalendarDays className="w-4 h-4" />
                  </Button>
                  <Button variant={viewMode === 'timeline' ? 'secondary' : 'ghost'} size="sm" onClick={() => setViewMode('timeline')} title="Таймлайн">
                    <BarChart3 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
              <div className="flex items-center gap-2 no-print">
                <Button variant="outline" size="sm" onClick={today}>
                  Сегодня
                </Button>
                <Button variant="ghost" size="icon" onClick={viewMode === 'week' ? previousWeek : previousMonth} title={viewMode === 'week' ? 'Предыдущая неделя' : 'Предыдущий месяц'}>
                  <ChevronLeft className="w-4 h-4" />
                </Button>
                <Button variant="ghost" size="icon" onClick={viewMode === 'week' ? nextWeek : nextMonth} title={viewMode === 'week' ? 'Следующая неделя' : 'Следующий месяц'}>
                  <ChevronRight className="w-4 h-4" />
                </Button>
              </div>
            </div>
            {/* Сводка: в режиме недели — по неделе, в режиме месяца/таймлайна — по месяцу */}
            <p className="text-sm text-muted-foreground mt-2">
              {viewMode === 'week' ? (
                <>
                  На этой неделе: <span className="font-medium text-foreground">{messagesInCurrentWeek.length}</span> сообщений
                  {messagesInCurrentWeek.filter((m: any) => m.status === 'PENDING').length > 0 && <> · <span className="text-yellow-600">{messagesInCurrentWeek.filter((m: any) => m.status === 'PENDING').length} ожидает</span></>}
                  {messagesInCurrentWeek.filter((m: any) => m.status === 'SENT').length > 0 && <> · <span className="text-green-600">{messagesInCurrentWeek.filter((m: any) => m.status === 'SENT').length} отправлено</span></>}
                  {messagesInCurrentWeek.filter((m: any) => m.status === 'FAILED').length > 0 && <> · <span className="text-red-600">{messagesInCurrentWeek.filter((m: any) => m.status === 'FAILED').length} ошибка</span></>}
                </>
              ) : viewMode === 'timeline' ? (
                <>
                  В этом месяце: <span className="font-medium text-foreground">{messagesForTimeline.length}</span> сообщений
                  {messagesForTimeline.filter((m: any) => m.status === 'PENDING').length > 0 && <> · <span className="text-yellow-600">{messagesForTimeline.filter((m: any) => m.status === 'PENDING').length} ожидает</span></>}
                  {messagesForTimeline.filter((m: any) => m.status === 'SENT').length > 0 && <> · <span className="text-green-600">{messagesForTimeline.filter((m: any) => m.status === 'SENT').length} отправлено</span></>}
                  {messagesForTimeline.filter((m: any) => m.status === 'FAILED').length > 0 && <> · <span className="text-red-600">{messagesForTimeline.filter((m: any) => m.status === 'FAILED').length} ошибка</span></>}
                </>
              ) : (
                <>
                  В этом месяце: <span className="font-medium text-foreground">{monthStats.total}</span> сообщений
                  {monthStats.pending > 0 && <> · <span className="text-yellow-600">{monthStats.pending} ожидает</span></>}
                  {monthStats.sent > 0 && <> · <span className="text-green-600">{monthStats.sent} отправлено</span></>}
                  {monthStats.failed > 0 && <> · <span className="text-red-600">{monthStats.failed} ошибка</span></>}
                </>
              )}
            </p>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-2">
                <div className="grid grid-cols-7 gap-2">
                  {Array.from({ length: 35 }).map((_, i) => (
                    <Skeleton key={i} className="h-[80px] rounded-lg" />
                  ))}
                </div>
              </div>
            ) : viewMode === 'timeline' ? (
              <>
                <div className="flex items-center justify-between gap-2 mb-4 no-print">
                  {activeWorkspaces.length > 0 && (
                    <Button size="sm" className="gap-1.5" onClick={() => setAddMessageDialogOpen(true)}>
                      <Plus className="w-4 h-4" />
                      Новое сообщение
                    </Button>
                  )}
                </div>
                <div className="overflow-x-auto -mx-1 px-1">
                  <div className="min-w-[800px] border border-border/80 rounded-lg overflow-hidden">
                    <div className="grid gap-0 border-b border-border/80 bg-muted/30" style={{ gridTemplateColumns: `80px repeat(${timelineDays.length}, minmax(28px, 1fr))` }}>
                      <div className="p-2 text-xs font-medium text-muted-foreground border-r border-border/80">Дата</div>
                      {timelineDays.map((d) => {
                        const isToday = d.toDateString() === new Date().toDateString()
                        return (
                          <div
                            key={d.toISOString()}
                            className={cn(
                              'p-1 text-center text-xs font-medium border-r border-border/80 last:border-r-0',
                              isToday ? 'bg-primary/15 text-primary border-l-2 border-l-red-500' : 'text-muted-foreground'
                            )}
                          >
                            {d.getDate()}
                          </div>
                        )
                      })}
                    </div>
                    {messagesForTimeline.length === 0 ? (
                      <div className="py-12 text-center text-sm text-muted-foreground">
                        В этом месяце нет запланированных сообщений.
                        {activeWorkspaces.length > 0 && (
                          <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddMessageDialogOpen(true)}>
                            Добавить сообщение
                          </Button>
                        )}
                      </div>
                    ) : (
                      messagesForTimeline.map((msg: any) => {
                        const msgDate = new Date(msg.scheduledFor)
                        const dayIndex = msgDate.getDate() - 1
                        const role = msg.user?.role || 'USER'
                        const roleColors = getRoleColor(role)
                        const workspaceId = msg.workspace?.id
                        const userName = msg.user?.name || msg.user?.email || msg.user?.username || '—'
                        const timeStr = msgDate.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                        const label = `#${msg.channelName ?? '?'} · ${timeStr} · ${userName}`
                        return (
                          <div
                            key={msg.id}
                            className="grid gap-0 border-b border-border/60 last:border-b-0 hover:bg-muted/20 transition-colors"
                            style={{ gridTemplateColumns: `80px repeat(${timelineDays.length}, minmax(28px, 1fr))` }}
                          >
                            <div className="p-2 border-r border-border/80 text-xs text-muted-foreground truncate" title={label}>
                              {msg.channelName ?? '—'} · {timeStr}
                            </div>
                            {timelineDays.map((d, col) => {
                              const isMsgDay = col === dayIndex
                              const isToday = d.toDateString() === new Date().toDateString()
                              return (
                                <div
                                  key={d.toISOString()}
                                  className={cn(
                                    'min-h-[44px] p-1 border-r border-border/80 last:border-r-0',
                                    isToday && 'bg-primary/5 border-l-2 border-l-red-500'
                                  )}
                                >
                                  {isMsgDay ? (
                                    workspaceId ? (
                                      <Link
                                        href={`/dashboard/workspaces/${workspaceId}`}
                                        className={cn(
                                          'block rounded-md px-2 py-1.5 text-xs font-medium truncate border-l-2 shadow-sm',
                                          roleColors.light,
                                          roleColors.borderL,
                                          roleColors.text
                                        )}
                                        title={label}
                                      >
                                        {userName} · {timeStr}
                                      </Link>
                                    ) : (
                                      <div
                                        className={cn(
                                          'rounded-md px-2 py-1.5 text-xs font-medium truncate border-l-2',
                                          roleColors.light,
                                          roleColors.borderL,
                                          roleColors.text
                                        )}
                                        title={label}
                                      >
                                        {userName} · {timeStr}
                                      </div>
                                    )
                                  ) : null}
                                </div>
                              )
                            })}
                          </div>
                        )
                      })
                    )}
                  </div>
                </div>
              </>
            ) : viewMode === 'week' ? (
              <>
              {/* Диапазон часов в недельном виде */}
              <div className="flex items-center gap-2 mb-3 no-print">
                <span className="text-sm text-muted-foreground">Часы:</span>
                <Select value={hourRangePreset} onValueChange={(v: '8-22' | '6-24' | '9-18') => setHourRangePreset(v)}>
                  <SelectTrigger className="w-[140px] h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="8-22">8:00–22:00</SelectItem>
                    <SelectItem value="6-24">6:00–24:00</SelectItem>
                    <SelectItem value="9-18">9:00–18:00 (рабочие)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {/* Недельный вид */}
              <div className="overflow-x-auto -mx-1 px-1">
                <div className="grid gap-1 w-full min-w-[700px]" style={{ gridTemplateColumns: '60px repeat(7, minmax(90px, 1fr))' }}>
                  <div />
                  {weekDays.map((d) => {
                    const isToday = d.toDateString() === new Date().toDateString()
                    return (
                      <div
                        key={d.toISOString()}
                        className={cn(
                          'text-center text-sm font-medium py-1 border-b border-border/80',
                          isToday ? 'bg-primary/10 text-primary border-primary' : 'text-muted-foreground'
                        )}
                      >
                        {d.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'short' })}
                      </div>
                    )
                  })}
                  {HOURS.map((hour) => (
                    <React.Fragment key={hour}>
                      <div className="text-xs text-muted-foreground py-1 pr-1 text-right border-r border-border/80">
                        {hour}:00
                      </div>
                      {weekDays.map((day) => {
                        const slotMessages = getMessagesForWeekSlot(day, hour)
                        const isToday = day.toDateString() === new Date().toDateString()
                        return (
                          <div
                            key={`${day.toISOString()}-${hour}`}
                            role="button"
                            tabIndex={0}
                            onClick={() => setSelectedDate(day)}
                            onKeyDown={(e) => e.key === 'Enter' && setSelectedDate(day)}
                            className={cn(
                              'min-h-[36px] p-1 border-b border-r border-border/80 space-y-1 cursor-pointer hover:bg-muted/50 transition-colors',
                              isToday && 'bg-primary/5 border-r-primary/30'
                            )}
                          >
                            {slotMessages.slice(0, 2).map((msg: any) => {
                              const role = msg.user?.role || 'USER'
                              const roleColors = getRoleColor(role)
                              const userName = msg.user?.name || msg.user?.email || msg.user?.username || '—'
                              const timeStr = new Date(msg.scheduledFor).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                              const label = `${userName} · #${msg.channelName} ${timeStr}`
                              const workspaceId = msg.workspace?.id
                              const content = (
                                <span className={cn('block text-xs rounded px-1 py-0.5 truncate', roleColors.light, roleColors.text)} title={label}>
                                  {label}
                                </span>
                              )
                              return workspaceId ? (
                                <Link
                                  key={msg.id}
                                  href={`/dashboard/workspaces/${workspaceId}`}
                                  onClick={(e) => e.stopPropagation()}
                                  className="block"
                                >
                                  {content}
                                </Link>
                              ) : (
                                <div key={msg.id}>{content}</div>
                              )
                            })}
                            {slotMessages.length > 2 && <span className="text-xs text-muted-foreground">+{slotMessages.length - 2}</span>}
                          </div>
                        )
                      })}
                    </React.Fragment>
                  ))}
                </div>
              </div>
              {/* Легенда ролей в недельном виде */}
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6 text-sm">
                <span className="text-muted-foreground font-medium">Роли:</span>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-blue-500" />
                  <span>SUPPORT</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-gray-500" />
                  <span>ADMIN</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-pink-500" />
                  <span>ADM</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded-full bg-purple-500" />
                  <span>VOL</span>
                </div>
              </div>
              </>
            ) : (
              <>
            {/* Weekday headers */}
            <div className="grid grid-cols-7 gap-2 mb-2">
              {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((day) => (
                <div
                  key={day}
                  className="text-center text-sm font-medium text-muted-foreground py-2"
                >
                  {day}
                </div>
              ))}
            </div>

            {/* Пустой месяц */}
            {monthStats.total === 0 && (
              <div className="text-center py-8 border border-dashed rounded-lg mb-4">
                <CalendarIcon className="w-12 h-12 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">В этом месяце нет запланированных сообщений</p>
                {activeWorkspaces.length > 0 && (
                  <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddMessageDialogOpen(true)}>
                    Перейти к расписанию
                  </Button>
                )}
              </div>
            )}

            {/* Calendar grid */}
            <div className="grid grid-cols-7 gap-2">
              {days.map((day, index) => {
                if (day === null) {
                  return <div key={`empty-${index}`} />
                }

                const date = new Date(
                  currentDate.getFullYear(),
                  currentDate.getMonth(),
                  day
                )
                const dayMessages = getMessagesForDate(date)
                const intensivePeriods = getIntensivePeriodsForDate(date)
                const isToday =
                  date.toDateString() === new Date().toDateString()
                const isSelected =
                  selectedDate?.toDateString() === date.toDateString()
                const isInIntensive = intensivePeriods.length > 0

                // Get the first intensive period color (or use primary if multiple)
                const intensiveColor = isInIntensive 
                  ? (intensivePeriods[0]?.color || '#ef4444')
                  : null

                return (
                  <button
                    key={day}
                    onClick={() => setSelectedDate(date)}
                    className={cn(
                      "relative p-2 rounded-lg border text-center hover:bg-muted/50 transition-colors min-h-[80px]",
                      isToday && "border-primary bg-primary/5",
                      isSelected && "bg-primary/10 border-primary",
                      !isToday && !isSelected && "border-border/80"
                    )}
                    style={isInIntensive && !isToday && !isSelected ? {
                      borderLeft: `4px solid ${intensiveColor}`,
                      backgroundColor: `${intensiveColor}15`,
                    } : isInIntensive && (isToday || isSelected) ? {
                      borderLeft: `4px solid ${intensiveColor}`,
                    } : undefined}
                  >
                    <span
                      className={cn(
                        "text-sm font-medium",
                        isToday && "text-primary"
                      )}
                    >
                      {day}
                    </span>

                    {/* Intensive period indicator */}
                    {isInIntensive && (
                      <div 
                        className="absolute top-1 right-1 w-2 h-2 rounded-full"
                        style={{ backgroundColor: intensiveColor }}
                        title={intensivePeriods.map((ws: any) => ws.workspaceName).join(', ')}
                      />
                    )}

                    {/* Message indicators — цвет по роли автора */}
                    {dayMessages.length > 0 && (
                      <div className="mt-1 space-y-1">
                        {dayMessages.slice(0, 3).map((msg: any) => {
                          const role = msg.user?.role || 'USER'
                          const roleColors = getRoleColor(role)
                          const userName = msg.user?.name || msg.user?.email || msg.user?.username || '—'
                          const timeStr = new Date(msg.scheduledFor).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
                          const msgPreview = (msg.message || '').slice(0, 60) + ((msg.message || '').length > 60 ? '…' : '')
                          const tooltip = msgPreview
                            ? `${userName} · #${msg.channelName} · ${timeStr}\nТекст: ${msgPreview}`
                            : `${userName} · #${msg.channelName} · ${timeStr}`
                          return (
                            <div
                              key={msg.id}
                              className={cn("h-1.5 rounded-full mx-auto", roleColors.bg)}
                              style={{ width: '80%' }}
                              title={tooltip}
                            />
                          )
                        })}
                        {dayMessages.length > 3 && (
                          <span className="text-xs text-muted-foreground">
                            +{dayMessages.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </button>
                )
              })}
            </div>

            {/* Legend: роли и статусы */}
            <div className="flex flex-wrap items-center gap-x-6 gap-y-3 mt-6 text-sm">
              <span className="text-muted-foreground font-medium">Роли:</span>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-blue-500" />
                <span>SUPPORT</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-gray-500" />
                <span>ADMIN</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-pink-500" />
                <span>ADM</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-purple-500" />
                <span>VOL</span>
              </div>
              <div className="h-4 w-px bg-border" />
              <span className="text-muted-foreground font-medium">Статус:</span>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-yellow-500" />
                <span>Ожидает</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-green-500" />
                <span>Отправлено</span>
              </div>
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500" />
                <span>Ошибка</span>
              </div>
              {workspaces.some((ws: any) => ws.startDate && ws.endDate && !ws.isArchived) && (
                <>
                  <div className="h-4 w-px bg-border" />
                  <div className="flex items-center gap-2">
                    <div className="w-3 h-3 rounded-full border-2 border-foreground/20" style={{ backgroundColor: '#ef444410' }} />
                    <span>Период интенсива</span>
                  </div>
                </>
              )}
            </div>
              </>
            )}
          </CardContent>
        </Card>

        {/* Selected date details */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-sm print:shadow-none">
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2">
                <CalendarIcon className="w-5 h-5" />
                {selectedDate
                  ? selectedDate.toLocaleDateString('ru-RU', {
                      day: 'numeric',
                      month: 'long',
                    })
                  : 'Выберите дату'}
              </CardTitle>
              {selectedMessages.length > 1 && (
                <Select value={sortBy} onValueChange={(v: 'time' | 'user' | 'channel') => setSortBy(v)}>
                  <SelectTrigger className="w-[140px] h-8 text-xs no-print">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="time">По времени</SelectItem>
                    <SelectItem value="user">По пользователю</SelectItem>
                    <SelectItem value="channel">По каналу</SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="space-y-3">
                {[1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-32 rounded-lg" />
                ))}
              </div>
            ) : !selectedDate ? (
              <div className="text-center py-8">
                <CalendarIcon className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground">
                  Выберите дату для просмотра сообщений
                </p>
              </div>
            ) : selectedMessages.length === 0 ? (
              <div className="text-center py-8">
                <Clock className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                <p className="text-sm text-muted-foreground mb-3">
                  Нет сообщений на эту дату
                </p>
                {activeWorkspaces.length > 0 && (
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setAddMessageDialogOpen(true)}>
                    <Plus className="w-4 h-4" />
                    Запланировать
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-3 max-h-[60vh] overflow-y-auto">
                {selectedMessages.map((message: any) => {
                  const role = message.user?.role || 'USER'
                  const roleColors = getRoleColor(role)
                  const channelColors = getChannelTagColors(message.channelName || '')
                  const userName = message.user?.name || message.user?.email || message.user?.username || '—'
                  const dateTimeStr = new Date(message.scheduledFor).toLocaleString('ru-RU', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                  const workspaceId = message.workspace?.id
                  const cardContent = (
                    <>
                      <div className="flex items-start justify-between gap-2 mb-3">
                        <div className="flex-1 min-w-0 flex flex-col gap-2">
                          <div className={cn(
                            "inline-flex items-center gap-2 rounded-lg border-l-4 pl-3 pr-3 py-1.5 w-fit",
                            channelColors.bar,
                            channelColors.bg,
                            channelColors.text
                          )}>
                            <Hash className="w-3.5 h-3.5 shrink-0 opacity-80" />
                            <span className="text-sm font-semibold truncate max-w-[180px]">#{message.channelName}</span>
                          </div>
                          <p className="text-xs text-muted-foreground truncate">
                            {message.workspace?.workspaceName ?? '—'}
                          </p>
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
                          <Badge variant="outline" className={cn("text-xs", roleColors.text, roleColors.light)}>
                            {roleLabel(role)}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={cn(
                              message.status === 'PENDING' && "bg-yellow-50 text-yellow-700 dark:bg-yellow-950/50 dark:text-yellow-300",
                              message.status === 'SENT' && "bg-green-50 text-green-700 dark:bg-green-950/50 dark:text-green-300",
                              message.status === 'FAILED' && "bg-red-50 text-red-700 dark:bg-red-950/50 dark:text-red-300"
                            )}
                          >
                            {message.status === 'PENDING' && 'Ожидает'}
                            {message.status === 'SENT' && 'Отправлено'}
                            {message.status === 'FAILED' && 'Ошибка'}
                          </Badge>
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground mb-1 flex items-center gap-2">
                        <Avatar className="h-6 w-6 shrink-0">
                          {message.user?.avatarUrl && <AvatarImage src={message.user.avatarUrl} alt="" />}
                          <AvatarFallback className={cn("text-[10px] font-semibold text-white", generateAvatarColor(message.user?.email))}>
                            {getInitials(message.user?.name || message.user?.email)}
                          </AvatarFallback>
                        </Avatar>
                        <span>Запланировал: <span className="font-medium text-foreground">{userName}</span></span>
                      </p>
                      {message.scheduledBy && (message.scheduledBy.name || message.scheduledBy.email) && (
                        <p className="text-xs text-amber-600 dark:text-amber-500 mb-1">
                          Запланировано от имени: {message.scheduledBy.name || message.scheduledBy.email}
                        </p>
                      )}
                      <p className="text-xs text-muted-foreground mb-2">
                        Дата и время: {dateTimeStr}
                      </p>
                      <p className="text-sm line-clamp-2">{message.message}</p>
                    </>
                  )
                  return workspaceId ? (
                    <Link
                      key={message.id}
                      href={`/dashboard/workspaces/${workspaceId}`}
                      className={cn(
                        "block p-4 border rounded-xl border-l-4 shadow-sm hover:shadow-md hover:bg-muted/30 transition-all overflow-hidden",
                        roleColors.borderL
                      )}
                    >
                      {cardContent}
                    </Link>
                  ) : (
                    <div
                      key={message.id}
                      className={cn("p-4 border rounded-xl border-l-4 shadow-sm overflow-hidden", roleColors.borderL)}
                    >
                      {cardContent}
                    </div>
                  )
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Диалог выбора пространства для добавления сообщения */}
      <Dialog open={addMessageDialogOpen} onOpenChange={setAddMessageDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить запланированное сообщение</DialogTitle>
          </DialogHeader>
          <p className="text-sm text-muted-foreground mb-4">
            Выберите пространство, в которое хотите добавить сообщение
          </p>
          <div className="space-y-2 max-h-[50vh] overflow-y-auto">
            {activeWorkspaces.map((ws: any) => (
              <Button
                key={ws.id}
                variant="outline"
                className="w-full justify-start gap-3 h-auto py-3"
                onClick={() => {
                  setAddMessageDialogOpen(false)
                  router.push(`/dashboard/workspaces/${ws.id}`)
                }}
              >
                <div
                  className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center"
                  style={{ backgroundColor: ws.color || '#ef4444' }}
                >
                  <Server className="w-5 h-5 text-white" />
                </div>
                <div className="text-left min-w-0">
                  <p className="font-medium truncate">{ws.workspaceName}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {ws.workspaceUrl?.replace(/^https?:\/\//, '') ?? ''}
                  </p>
                </div>
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}