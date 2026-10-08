"use client"

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { useSearchParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageStatusBadge } from '@/components/common/MessageStatusBadge'
import { getMessageStatusView, sanitizeErrorReason } from '@/lib/message-status'
import { safeExternalHref } from '@/lib/sanitize'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  Clock,
  Plus,
  RefreshCw,
  RotateCcw,
  CalendarDays,
  CalendarRange,
  ExternalLink,
  Copy,
  Globe,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatLocalDate, getInitials, generateAvatarColor } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { useCopyToClipboard } from '@/lib/useCopyToClipboard'
import { getTimeZoneLabel } from '@/lib/schedule-datetime'
import { apiFetch, formatRange, formatTimezone } from '@/lib/intensives/ui'
import type { IntensiveDetail } from '@/lib/intensives/types'
import { YearView, type CalendarTarget } from '@/components/intensives/year/year-view'
import { diffYmd, localYmd } from '@/components/intensives/year/year-layout'

const MONTHS = ['Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь', 'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь']
const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс']

type ViewMode = 'year' | 'month' | 'week' | 'day' | 'timeline'
type HourPreset = '8-22' | '6-24' | '9-18'

type CalMessage = {
  id: string
  message?: string
  scheduledFor: string
  status?: string
  channelName?: string
  error?: string | null
  messageId_RC?: string | null
  externalStatus?: string
  workspaceId?: string
  /** Привязка к интенсиву (null — «без привязки») */
  intensiveId?: string | null
  workspace?: { id: string; workspaceName?: string } | null
  user?: {
    id?: string
    name?: string | null
    email?: string
    username?: string | null
    role?: string
    avatarUrl?: string | null
  } | null
  scheduledBy?: { name?: string | null; email?: string } | null
}

/** Интенсив, по которому отфильтрован календарь сообщений (из ?intensive= или из панели годового вида). */
type IntensiveFilter = {
  id: string
  name: string
  timezone: string
  startDate: string
  endDate: string
}

type FeatureState = { enabled: boolean; canManage: boolean }

type CalWorkspace = {
  id: string
  workspaceName: string
  workspaceUrl?: string | null
  color?: string | null
  isArchived?: boolean
  isMultiUser?: boolean
  startDate?: string | null
  endDate?: string | null
}

const STATUS_META: Record<
  string,
  { label: string; dot: string; badge: 'warning' | 'success' | 'danger' | 'muted' }
> = {
  PENDING: { label: 'Ожидает отправки', dot: 'bg-amber-500', badge: 'warning' },
  SENT: { label: 'Отправлено', dot: 'bg-emerald-500', badge: 'success' },
  FAILED: { label: 'Не отправлено', dot: 'bg-red-500', badge: 'danger' },
  CANCELLED: { label: 'Отменено', dot: 'bg-muted-foreground/50', badge: 'muted' },
}

function statusMeta(status?: string) {
  return STATUS_META[status ?? ''] ?? { label: status || '—', dot: 'bg-muted-foreground/50', badge: 'muted' as const }
}

function roleLabel(role?: string) {
  switch (role) {
    case 'LEAD_SUP':
      return 'Lead_SUP'
    case 'SUP':
      return 'SUP'
    case 'ADM':
      return 'ADM'
    case 'MEMBER':
    case 'VOL':
      return 'MEMBER'
    default:
      return role || '—'
  }
}

const authorName = (m: CalMessage) => m.user?.name || m.user?.email || m.user?.username || '—'
const timeOf = (m: CalMessage) =>
  new Date(m.scheduledFor).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
const dayKeyOf = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`
const isSameDay = (a: Date, b: Date) => dayKeyOf(a) === dayKeyOf(b)

function pluralMessages(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'сообщение'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'сообщения'
  return 'сообщений'
}

function StatusDot({ status, className }: { status?: string; className?: string }) {
  return <span aria-hidden className={cn('inline-block size-2 shrink-0 rounded-full', statusMeta(status).dot, className)} />
}

/** Строка-«чип» события в сетке: точка статуса + время + канал. Нейтральный фон. */
function EventChip({ message, onOpen }: { message: CalMessage; onOpen: (m: CalMessage) => void }) {
  const statusLabel = getMessageStatusView(message.status, message.scheduledFor).label
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onOpen(message)
      }}
      className="flex w-full min-w-0 items-center gap-1.5 rounded px-1 py-0.5 text-left text-[11px] leading-4 text-foreground/90 outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring/40"
      title={`${statusLabel} · ${timeOf(message)} · #${message.channelName ?? '?'} · ${authorName(message)}`}
      aria-label={`${timeOf(message)}, канал ${message.channelName ?? '?'}, ${statusLabel}. Открыть детали`}
    >
      <StatusDot status={message.status} className="size-1.5" />
      <span className="shrink-0 tabular-nums text-muted-foreground">{timeOf(message)}</span>
      <span className="truncate">{message.channelName ?? '—'}</span>
    </button>
  )
}

function Summary({ list }: { list: CalMessage[] }) {
  const pending = list.filter((m) => m.status === 'PENDING').length
  const sent = list.filter((m) => m.status === 'SENT').length
  const failed = list.filter((m) => m.status === 'FAILED').length
  return (
    <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted-foreground" aria-live="polite">
      <span>
        <span className="font-medium text-foreground tabular-nums">{list.length}</span> {pluralMessages(list.length)}
      </span>
      {pending > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status="PENDING" /> {pending} ожидает отправки
        </span>
      )}
      {sent > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status="SENT" /> {sent} отправлено
        </span>
      )}
      {failed > 0 && (
        <span className="inline-flex items-center gap-1.5">
          <StatusDot status="FAILED" /> {failed} не отправлено
        </span>
      )}
    </p>
  )
}

/** Строка сообщения в списке дня / повестке. */
function MessageRow({
  message,
  onOpen,
  showDate = false,
}: {
  message: CalMessage
  onOpen: (m: CalMessage) => void
  showDate?: boolean
}) {
  return (
    <button
      type="button"
      onClick={() => onOpen(message)}
      className="block w-full px-3 py-2.5 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
    >
      <div className="flex items-center gap-2">
        <StatusDot status={message.status} />
        <span className="shrink-0 text-xs font-medium tabular-nums">
          {showDate
            ? new Date(message.scheduledFor).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
            : timeOf(message)}
        </span>
        <span className="min-w-0 truncate text-sm font-medium">#{message.channelName ?? '—'}</span>
        <MessageStatusBadge status={message.status} scheduledFor={message.scheduledFor} compact className="ml-auto" />
      </div>
      <div className="mt-1 flex items-center gap-1.5 pl-4 text-xs text-muted-foreground">
        <Avatar className="size-4 shrink-0">
          {message.user?.avatarUrl && <AvatarImage src={message.user.avatarUrl} alt="" />}
          <AvatarFallback className={cn('text-[8px] font-semibold text-white', generateAvatarColor(message.user?.email ?? ''))}>
            {getInitials(message.user?.name || message.user?.email)}
          </AvatarFallback>
        </Avatar>
        <span className="truncate">
          {authorName(message)}
          {message.workspace?.workspaceName ? ` · ${message.workspace.workspaceName}` : ''}
        </span>
      </div>
      {message.message && <p className="mt-1 line-clamp-2 pl-4 text-[13px] text-foreground/80">{message.message}</p>}
    </button>
  )
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[110px_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function MessageDetailSheet({
  message,
  open,
  onOpenChange,
}: {
  message: CalMessage | null
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  const copy = useCopyToClipboard()
  const workspaceId = message?.workspace?.id
  // Ссылка на сообщение в Rocket.Chat приходит с сервера (он определяет тип комнаты); нет ответа → ссылки нет
  const wantsLink = !!message && message.status === 'SENT' && !!message.messageId_RC
  const linkKey = wantsLink && message ? message.id : null
  const [permalink, setPermalink] = useState<{ id: string; href: string | null } | null>(null)
  useEffect(() => {
    if (!linkKey) return
    const ctrl = new AbortController()
    fetch(`/api/messages/${encodeURIComponent(linkKey)}`, { signal: ctrl.signal })
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { rcPermalink?: unknown } | null) => {
        const raw = data && typeof data.rcPermalink === 'string' ? data.rcPermalink : null
        setPermalink({ id: linkKey, href: safeExternalHref(raw) })
      })
      .catch(() => {
        /* ссылка необязательна: при ошибке просто не показываем */
      })
    return () => ctrl.abort()
  }, [linkKey])
  const rcHref = linkKey && permalink?.id === linkKey ? permalink.href : null
  const when = message
    ? new Date(message.scheduledFor).toLocaleString('ru-RU', {
        weekday: 'short',
        day: 'numeric',
        month: 'long',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : ''

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {message && (
          <>
            <SheetHeader className="border-b p-4 pr-12">
              <SheetTitle className="truncate text-base">#{message.channelName ?? '—'}</SheetTitle>
              <SheetDescription className="truncate">
                {message.workspace?.workspaceName ?? 'Пространство не указано'} · {when}
              </SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">
              <dl className="divide-y">
                <DetailRow label="Статус">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <MessageStatusBadge status={message.status} scheduledFor={message.scheduledFor} />
                    {message.externalStatus === 'DELETED_IN_RC' && <Badge variant="danger">Удалено в Rocket.Chat</Badge>}
                    {message.externalStatus === 'EDITED_IN_RC' && <Badge variant="info">Изменено в Rocket.Chat</Badge>}
                  </div>
                </DetailRow>
                <DetailRow label="Автор">
                  <div className="flex items-center gap-2">
                    <Avatar className="size-5 shrink-0">
                      {message.user?.avatarUrl && <AvatarImage src={message.user.avatarUrl} alt="" />}
                      <AvatarFallback className={cn('text-[9px] font-semibold text-white', generateAvatarColor(message.user?.email ?? ''))}>
                        {getInitials(message.user?.name || message.user?.email)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="truncate">{authorName(message)}</span>
                    {message.user?.role && <span className="text-xs text-muted-foreground">{roleLabel(message.user.role)}</span>}
                  </div>
                </DetailRow>
                {message.scheduledBy && (message.scheduledBy.name || message.scheduledBy.email) && (
                  <DetailRow label="Запланировал">{message.scheduledBy.name || message.scheduledBy.email}</DetailRow>
                )}
              </dl>
              {message.status === 'FAILED' && sanitizeErrorReason(message.error) && (
                <div role="alert" className="mt-3 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm">
                  <p className="font-medium text-destructive">Не отправлено</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">{sanitizeErrorReason(message.error)}</p>
                  <p className="mt-2 text-xs text-muted-foreground">
                    Откройте пространство, чтобы повторить отправку или изменить сообщение.
                  </p>
                </div>
              )}
              <div className="mt-4 space-y-1.5">
                <p className="text-[13px] font-medium">Текст сообщения</p>
                <div className="max-h-[40vh] overflow-y-auto whitespace-pre-wrap break-words rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
                  {message.message || <span className="text-muted-foreground">Пусто</span>}
                </div>
              </div>
            </div>
            <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
              <Button
                variant="outline"
                size="sm"
                disabled={!message.message}
                onClick={() => void copy(message.message || '', 'Текст скопирован')}
              >
                <Copy /> Копировать текст
              </Button>
              {rcHref && (
                <Button asChild variant="outline" size="sm">
                  <a href={rcHref} target="_blank" rel="noopener noreferrer">
                    <ExternalLink /> Открыть в Rocket.Chat
                    <span className="sr-only"> (откроется в новой вкладке)</span>
                  </a>
                </Button>
              )}
              {workspaceId && (
                <Button asChild size="sm">
                  <Link href={`/dashboard/workspaces/${workspaceId}`}>
                    <ExternalLink /> Открыть в пространстве
                  </Link>
                </Button>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}

export default function CalendarPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const workspaceIdFromUrl = searchParams.get('workspaceId')
  const intensiveIdFromUrl = searchParams.get('intensive')

  const [currentDate, setCurrentDate] = useState(new Date())
  const [messages, setMessages] = useState<CalMessage[]>([])
  const [workspaces, setWorkspaces] = useState<CalWorkspace[]>([])
  const [currentUser, setCurrentUser] = useState<{ role?: string } | null>(null)
  const [selectedDate, setSelectedDate] = useState<Date | null>(null)
  const [loading, setLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [viewModeState, setViewMode] = useState<ViewMode>('month')
  const [filterRole, setFilterRole] = useState<string>('all')
  const [filterWorkspaceId, setFilterWorkspaceId] = useState<string>(workspaceIdFromUrl || 'all')
  const [filterStatus, setFilterStatus] = useState<string>('all')
  const [filterAuthorId, setFilterAuthorId] = useState<string>('all')
  const [sortBy, setSortBy] = useState<'time' | 'user' | 'channel'>('time')
  const [hourRangePreset, setHourRangePreset] = useState<HourPreset>('8-22')
  const [addMessageDialogOpen, setAddMessageDialogOpen] = useState(false)
  const [activeMessageId, setActiveMessageId] = useState<string | null>(null)
  const [jumpOpen, setJumpOpen] = useState(false)
  const [jumpYear, setJumpYear] = useState(new Date().getFullYear())
  const [feature, setFeature] = useState<FeatureState | null>(null)
  // Вид «Год» недоступен при выключенной функции «Интенсивы»
  const viewMode: ViewMode = viewModeState === 'year' && feature && !feature.enabled ? 'month' : viewModeState
  const [yearRefreshKey, setYearRefreshKey] = useState(0)
  const [intensiveFilter, setIntensiveFilter] = useState<IntensiveFilter | null>(null)
  const didInitialSelectRef = useRef(false)
  const hasLoadedRef = useRef(false)
  const appliedIntensiveRef = useRef<string | null>(null)

  const isSupOrAdm =
    currentUser?.role === 'SUP' ||
    currentUser?.role === 'ADM' ||
    currentUser?.role === 'LEAD_SUP'

  const hasActiveFilters =
    filterRole !== 'all' ||
    filterWorkspaceId !== 'all' ||
    filterStatus !== 'all' ||
    filterAuthorId !== 'all' ||
    intensiveFilter !== null

  const intensivesEnabled = feature?.enabled === true
  const isYear = viewMode === 'year'

  const activeWorkspaceList = useMemo(
    () => workspaces.filter((w: CalWorkspace) => !w.isArchived),
    [workspaces]
  )

  const selectedWorkspace = activeWorkspaceList.find((w: CalWorkspace) => w.id === filterWorkspaceId)
  const isSharedCalendar = filterWorkspaceId === 'all' || selectedWorkspace?.isMultiUser === true

  useEffect(() => {
    if (workspaceIdFromUrl) setFilterWorkspaceId(workspaceIdFromUrl)
  }, [workspaceIdFromUrl])

  // Флаг «Интенсивы»: определяет, показывать ли вид «Год» и привязку к интенсивам. Ошибка = функция скрыта.
  useEffect(() => {
    let cancelled = false
    apiFetch<{ enabled: boolean; canManage: boolean }>('/api/intensives/feature')
      .then((f) => {
        if (!cancelled) setFeature({ enabled: f.enabled === true, canManage: f.canManage === true })
      })
      .catch(() => {
        if (!cancelled) setFeature({ enabled: false, canManage: false })
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Данные не зависят от месяца, но обновляются при смене месяца, как и раньше (без мигания скелетона).
  // В годовом виде сообщения не загружаются вообще: он показывает только интенсивы.
  const monthKey = `${currentDate.getFullYear()}-${currentDate.getMonth()}`
  useEffect(() => {
    if (isYear) return
    void loadData()
  }, [monthKey, isYear])

  useEffect(() => {
    if (loading || filterWorkspaceId === 'all') return
    if (!activeWorkspaceList.some((w: CalWorkspace) => w.id === filterWorkspaceId)) setFilterWorkspaceId('all')
  }, [activeWorkspaceList, filterWorkspaceId, loading])

  // Параметр ?intensive= убрали из адреса (например, кнопкой «Назад») — снимаем и фильтр
  const [prevIntensiveParam, setPrevIntensiveParam] = useState(intensiveIdFromUrl)
  if (prevIntensiveParam !== intensiveIdFromUrl) {
    setPrevIntensiveParam(intensiveIdFromUrl)
    if (!intensiveIdFromUrl) setIntensiveFilter(null)
  }

  // Глубокая ссылка ?intensive=<id>: открыть месяц начала интенсива и отфильтровать сообщения по нему.
  useEffect(() => {
    if (!intensiveIdFromUrl) {
      appliedIntensiveRef.current = null
      return
    }
    if (appliedIntensiveRef.current === intensiveIdFromUrl) return
    appliedIntensiveRef.current = intensiveIdFromUrl
    const ctrl = new AbortController()
    apiFetch<{ intensive: IntensiveDetail }>(`/api/intensives/${encodeURIComponent(intensiveIdFromUrl)}`, { signal: ctrl.signal })
      .then(({ intensive }) => {
        setIntensiveFilter({
          id: intensive.id,
          name: intensive.name,
          timezone: intensive.timezone,
          startDate: intensive.startDate,
          endDate: intensive.endDate,
        })
        const [y, m, d] = intensive.startDate.split('-').map(Number)
        setCurrentDate(new Date(y, m - 1, 1))
        setSelectedDate(new Date(y, m - 1, d))
        setViewMode((v) => (v === 'year' ? 'month' : v))
      })
      .catch(() => {
        if (ctrl.signal.aborted) return
        appliedIntensiveRef.current = null
        toast.error('Интенсив недоступен: возможно, он удалён или у вас нет к нему доступа.')
        router.replace(workspaceIdFromUrl ? `/dashboard/calendar?workspaceId=${encodeURIComponent(workspaceIdFromUrl)}` : '/dashboard/calendar', {
          scroll: false,
        })
      })
    return () => ctrl.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [intensiveIdFromUrl])

  // Автовыбор даты при первой загрузке
  useEffect(() => {
    if (!loading && !didInitialSelectRef.current) {
      setSelectedDate(new Date())
      didInitialSelectRef.current = true
    }
  }, [loading])

  useEffect(() => {
    if (filterRole === 'MEMBER') setFilterRole('all')
  }, [filterRole])

  const loadData = async (manual = false) => {
    try {
      if (!hasLoadedRef.current) setLoading(true)
      if (manual) setRefreshing(true)

      const userRes = await fetch('/api/auth/me')
      const userData = userRes.ok ? await userRes.json().catch(() => ({})) : {}
      const me = userData.user
      if (me) setCurrentUser(me)

      const [messagesRes, workspacesRes] = await Promise.all([
        fetch('/api/messages?scope=calendar'),
        fetch(`/api/workspace?today=${formatLocalDate(new Date())}`),
      ])

      if (messagesRes.ok) {
        const messagesData = await messagesRes.json()
        setMessages(messagesData.messages || [])
      } else {
        toast.error('Не удалось загрузить сообщения. Нажмите «Обновить», чтобы повторить.')
      }
      if (workspacesRes.ok) {
        const workspacesData = await workspacesRes.json()
        setWorkspaces(workspacesData.workspaces || [])
      }
      if (manual && messagesRes.ok) toast.success('Календарь обновлён')
      hasLoadedRef.current = true
    } catch {
      toast.error('Ошибка загрузки данных. Проверьте соединение и нажмите «Обновить».')
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }

  // Авторы для фильтра (из загруженных сообщений)
  const authors = useMemo(() => {
    const map = new Map<string, string>()
    messages.forEach((m) => {
      const id = m.user?.id
      if (id && !map.has(id)) map.set(id, authorName(m))
    })
    return Array.from(map, ([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, 'ru'))
  }, [messages])

  useEffect(() => {
    if (filterAuthorId !== 'all' && authors.length > 0 && !authors.some((a) => a.id === filterAuthorId)) {
      setFilterAuthorId('all')
    }
  }, [authors, filterAuthorId])

  // Фильтрация сообщений по роли, пространству, статусу и автору
  const filteredMessages = useMemo(() => {
    return messages.filter((msg) => {
      if (filterRole !== 'all') {
        const r = msg.user?.role || 'USER'
        const roleOk = r === filterRole || (filterRole === 'MEMBER' && r === 'VOL')
        if (!roleOk) return false
      }
      if (filterWorkspaceId !== 'all' && msg.workspaceId !== filterWorkspaceId) return false
      if (filterStatus !== 'all' && msg.status !== filterStatus) return false
      if (filterAuthorId !== 'all' && msg.user?.id !== filterAuthorId) return false
      if (intensiveFilter && msg.intensiveId !== intensiveFilter.id) return false
      return true
    })
  }, [messages, filterRole, filterWorkspaceId, filterStatus, filterAuthorId, intensiveFilter])

  // Сообщения по дням, внутри дня — по времени
  const byDay = useMemo(() => {
    const map = new Map<string, CalMessage[]>()
    filteredMessages.forEach((msg) => {
      const key = dayKeyOf(new Date(msg.scheduledFor))
      const arr = map.get(key)
      if (arr) arr.push(msg)
      else map.set(key, [msg])
    })
    map.forEach((arr) => arr.sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime()))
    return map
  }, [filteredMessages])

  const getMessagesForDate = (date: Date) => byDay.get(dayKeyOf(date)) ?? []

  const messagesInCurrentMonth = useMemo(() => {
    const year = currentDate.getFullYear()
    const month = currentDate.getMonth()
    return filteredMessages
      .filter((msg) => {
        const d = new Date(msg.scheduledFor)
        return d.getFullYear() === year && d.getMonth() === month
      })
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  }, [currentDate, filteredMessages])

  const getIntensivePeriodsForDate = (date: Date) => {
    return activeWorkspaceList.filter((ws: CalWorkspace) => {
      if (!ws.startDate || !ws.endDate || ws.isArchived) return false
      if (filterWorkspaceId !== 'all' && ws.id !== filterWorkspaceId) return false

      const startDate = new Date(ws.startDate)
      startDate.setHours(0, 0, 0, 0)
      const endDate = new Date(ws.endDate)
      endDate.setHours(23, 59, 59, 999)
      const checkDate = new Date(date.getFullYear(), date.getMonth(), date.getDate())
      return checkDate >= startDate && checkDate <= endDate
    })
  }
  const hasIntensivePeriods = activeWorkspaceList.some((ws: CalWorkspace) => ws.startDate && ws.endDate)

  // Навигация: год — на год, неделя — ровно на 7 дней, день — на день, иначе — на месяц.
  const step = (dir: -1 | 1) => {
    if (viewMode === 'year') {
      setCurrentDate(new Date(currentDate.getFullYear() + dir, currentDate.getMonth(), 1))
    } else if (viewMode === 'week' || viewMode === 'day') {
      const d = new Date(currentDate)
      d.setDate(d.getDate() + dir * (viewMode === 'week' ? 7 : 1))
      setCurrentDate(d)
      if (viewMode === 'day') setSelectedDate(d)
    } else {
      setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + dir))
    }
  }
  const changeView = (next: ViewMode) => {
    // В «День» переходим на выбранный в календаре день
    if (next === 'day' && viewMode !== 'day' && selectedDate) setCurrentDate(selectedDate)
    setViewMode(next)
  }
  const goToday = () => {
    const now = new Date()
    setCurrentDate(now)
    setSelectedDate(now)
  }

  // Ячейки месяца (пн — первый день недели), дополняем до полных недель
  const monthCells = useMemo(() => {
    const y = currentDate.getFullYear()
    const m = currentDate.getMonth()
    const daysInMonth = new Date(y, m + 1, 0).getDate()
    const first = new Date(y, m, 1).getDay()
    const offset = first === 0 ? 6 : first - 1
    const cells: (Date | null)[] = []
    for (let i = 0; i < offset; i++) cells.push(null)
    for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(y, m, d))
    while (cells.length % 7 !== 0) cells.push(null)
    return cells
  }, [currentDate])

  // Неделя
  const weekStart = useMemo(() => {
    const date = new Date(currentDate)
    const day = date.getDay()
    date.setDate(date.getDate() - (day === 0 ? 6 : day - 1))
    date.setHours(0, 0, 0, 0)
    return date
  }, [currentDate])
  const weekDays = useMemo(
    () =>
      Array.from({ length: 7 }, (_, i) => {
        const d = new Date(weekStart)
        d.setDate(weekStart.getDate() + i)
        return d
      }),
    [weekStart]
  )
  const messagesInCurrentWeek = useMemo(
    () => weekDays.flatMap((d) => byDay.get(dayKeyOf(d)) ?? []),
    [weekDays, byDay]
  )
  const messagesOnCurrentDay = useMemo(() => byDay.get(dayKeyOf(currentDate)) ?? [], [byDay, currentDate])

  const [hourStart, hourEnd] = hourRangePreset === '8-22' ? [8, 22] : hourRangePreset === '6-24' ? [6, 24] : [9, 18]
  const HOURS = useMemo(
    () => Array.from({ length: hourEnd - hourStart + 1 }, (_, i) => hourStart + i),
    [hourStart, hourEnd]
  )
  const hiddenByHours = useMemo(
    () =>
      messagesInCurrentWeek.filter((m) => {
        const h = new Date(m.scheduledFor).getHours()
        return h < hourStart || h > hourEnd
      }).length,
    [messagesInCurrentWeek, hourStart, hourEnd]
  )
  const getMessagesForWeekSlot = (day: Date, hour: number) =>
    getMessagesForDate(day).filter((m) => new Date(m.scheduledFor).getHours() === hour)

  // Повестка: сообщения месяца, сгруппированные по дням
  const agendaGroups = useMemo(() => {
    const groups: { date: Date; items: CalMessage[] }[] = []
    messagesInCurrentMonth.forEach((m) => {
      const d = new Date(m.scheduledFor)
      const last = groups[groups.length - 1]
      if (last && isSameDay(last.date, d)) last.items.push(m)
      else groups.push({ date: d, items: [m] })
    })
    return groups
  }, [messagesInCurrentMonth])

  const selectedMessages = useMemo(() => {
    const list = selectedDate ? [...getMessagesForDate(selectedDate)] : []
    if (sortBy === 'user') list.sort((a, b) => authorName(a).localeCompare(authorName(b), 'ru'))
    if (sortBy === 'channel') list.sort((a, b) => (a.channelName || '').localeCompare(b.channelName || '', 'ru'))
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDate, byDay, sortBy])

  const activeWorkspaces = activeWorkspaceList
  const activeMessage = activeMessageId ? messages.find((m) => m.id === activeMessageId) ?? null : null

  const openMessage = (m: CalMessage) => {
    setSelectedDate(new Date(m.scheduledFor))
    setActiveMessageId(m.id)
  }

  const monthTitle = `${MONTHS[currentDate.getMonth()]} ${currentDate.getFullYear()}`
  const periodTitle =
    viewMode === 'week'
      ? `${weekDays[0].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' })} – ${weekDays[6].toLocaleDateString('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' })}`
      : viewMode === 'day'
        ? currentDate.toLocaleDateString('ru-RU', { weekday: 'short', day: 'numeric', month: 'long', year: 'numeric' })
        : monthTitle

  const stepNoun = viewMode === 'year' ? 'год' : viewMode === 'day' ? 'день' : 'месяц'
  const prevLabel = viewMode === 'week' ? 'Предыдущая неделя' : `Предыдущий ${stepNoun}`
  const nextLabel = viewMode === 'week' ? 'Следующая неделя' : `Следующий ${stepNoun}`
  const yearOptions = (() => {
    const sel = currentDate.getFullYear()
    const thisYear = new Date().getFullYear()
    const from = Math.min(sel, thisYear) - 3
    const to = Math.max(sel, thisYear) + 3
    return Array.from({ length: to - from + 1 }, (_, i) => from + i)
  })()

  const resetFilters = () => {
    setFilterRole('all')
    setFilterWorkspaceId('all')
    setFilterStatus('all')
    setFilterAuthorId('all')
    setIntensiveFilter(null)
    appliedIntensiveRef.current = null
    if (workspaceIdFromUrl || intensiveIdFromUrl) router.replace('/dashboard/calendar', { scroll: false })
  }

  /** Снять фильтр по интенсиву, оставив фильтр по пространству. */
  const clearIntensiveFilter = () => {
    setIntensiveFilter(null)
    appliedIntensiveRef.current = null
    const ws = filterWorkspaceId !== 'all' ? filterWorkspaceId : workspaceIdFromUrl
    router.replace(ws ? `/dashboard/calendar?workspaceId=${encodeURIComponent(ws)}` : '/dashboard/calendar', { scroll: false })
  }

  /** «Открыть календарь сообщений» из панели годового вида: месяц начала интенсива, фильтры по интенсиву и подключению. */
  const openIntensiveInCalendar = ({ intensive, workspaceId }: CalendarTarget) => {
    setIntensiveFilter({
      id: intensive.id,
      name: intensive.name,
      timezone: intensive.timezone,
      startDate: intensive.startDate,
      endDate: intensive.endDate,
    })
    appliedIntensiveRef.current = intensive.id
    const [y, m, d] = intensive.startDate.split('-').map(Number)
    setCurrentDate(new Date(y, m - 1, 1))
    setSelectedDate(new Date(y, m - 1, d))
    setFilterWorkspaceId(workspaceId ?? 'all')
    setFilterStatus('all')
    setFilterAuthorId('all')
    setFilterRole('all')
    setViewMode('month')
    const qs = new URLSearchParams({ intensive: intensive.id })
    if (workspaceId) qs.set('workspaceId', workspaceId)
    router.replace(`/dashboard/calendar?${qs.toString()}`, { scroll: false })
  }

  const now = new Date()
  // Пояс, в котором показаны часы календаря (пояс браузера), и пояс выбранного интенсива
  const browserZone = useMemo(() => getTimeZoneLabel(currentDate), [currentDate])
  const intensiveZone = useMemo(
    () => (intensiveFilter ? getTimeZoneLabel(currentDate, intensiveFilter.timezone) : null),
    [intensiveFilter, currentDate]
  )
  const zonesDiffer = !!intensiveZone && intensiveZone.offset !== browserZone.offset
  const summaryList =
    viewMode === 'week' ? messagesInCurrentWeek : viewMode === 'day' ? messagesOnCurrentDay : messagesInCurrentMonth
  const filteredWorkspaceName =
    activeWorkspaceList.find((w: CalWorkspace) => w.id === filterWorkspaceId)?.workspaceName ??
    workspaces.find((w: CalWorkspace) => w.id === filterWorkspaceId)?.workspaceName ??
    '…'

  const addMessageButton = activeWorkspaces.length > 0 && (
    <Button size="sm" onClick={() => setAddMessageDialogOpen(true)}>
      <Plus /> Добавить сообщение
    </Button>
  )

  /* ───────────── Представления ───────────── */

  const monthView = (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((d, i) => (
          <div key={d} className={cn('px-2 py-2 text-center text-xs font-medium text-muted-foreground', i > 4 && 'text-muted-foreground/70')}>
            {d}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
        {monthCells.map((date, index) => {
          if (!date) return <div key={`empty-${index}`} className="min-h-[72px] border-b border-r bg-muted/20 sm:min-h-[112px]" />
          const dayMessages = getMessagesForDate(date)
          const periods = getIntensivePeriodsForDate(date)
          const isToday = isSameDay(date, now)
          const isSelected = selectedDate ? isSameDay(date, selectedDate) : false
          const cellYmd = intensiveFilter ? localYmd(date) : ''
          const intensiveDayNo =
            intensiveFilter && cellYmd >= intensiveFilter.startDate && cellYmd <= intensiveFilter.endDate
              ? diffYmd(intensiveFilter.startDate, cellYmd) + 1
              : null
          return (
            <div
              key={date.getDate()}
              onClick={() => setSelectedDate(date)}
              className={cn(
                'group relative min-h-[72px] cursor-pointer border-b border-r p-1 transition-colors hover:bg-muted/30 sm:min-h-[112px] sm:p-1.5',
                isSelected && 'bg-muted/60 hover:bg-muted/60'
              )}
            >
              <div className="flex items-center justify-between gap-1">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    setSelectedDate(date)
                  }}
                  aria-pressed={isSelected}
                  aria-label={`${date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long' })}${dayMessages.length ? `, ${dayMessages.length} ${pluralMessages(dayMessages.length)}` : ''}`}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
                    isToday ? 'bg-primary text-primary-foreground' : 'text-foreground hover:bg-muted',
                    isSelected && !isToday && 'ring-1 ring-foreground/30'
                  )}
                >
                  {date.getDate()}
                </button>
                {intensiveDayNo !== null && (
                  <span className="min-w-0 truncate text-[11px] text-muted-foreground" title={`День ${intensiveDayNo} интенсива`}>
                    <span className="hidden sm:inline">День {intensiveDayNo}</span>
                    <span className="sm:hidden">Д{intensiveDayNo}</span>
                  </span>
                )}
                {periods.length > 0 && (
                  <span
                    className="size-1.5 shrink-0 rounded-full bg-teal-500"
                    title={`Период пространства: ${periods.map((ws: CalWorkspace) => ws.workspaceName).join(', ')}`}
                  />
                )}
              </div>

              {dayMessages.length > 0 && (
                <>
                  {/* Телефон: только точки статусов */}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1 px-0.5 sm:hidden">
                    {dayMessages.slice(0, 4).map((m) => (
                      <StatusDot key={m.id} status={m.status} className="size-1.5" />
                    ))}
                    {dayMessages.length > 4 && <span className="text-[10px] text-muted-foreground">+{dayMessages.length - 4}</span>}
                  </div>
                  {/* Планшет/десктоп: чипы событий */}
                  <div className="mt-1 hidden space-y-0.5 sm:block">
                    {dayMessages.slice(0, 3).map((m) => (
                      <EventChip key={m.id} message={m} onOpen={openMessage} />
                    ))}
                    {dayMessages.length > 3 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedDate(date)
                        }}
                        className="w-full rounded px-1 py-0.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        Ещё {dayMessages.length - 3}
                      </button>
                    )}
                  </div>
                </>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )

  const weekView = (
    <div className="space-y-2">
      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="grid min-w-[760px]" style={{ gridTemplateColumns: '52px repeat(7, minmax(100px, 1fr))' }}>
          <div className="border-b bg-muted/40" />
          {weekDays.map((d) => {
            const isToday = isSameDay(d, now)
            const isSelected = selectedDate ? isSameDay(d, selectedDate) : false
            return (
              <button
                type="button"
                key={d.toISOString()}
                onClick={() => setSelectedDate(d)}
                aria-pressed={isSelected}
                className={cn(
                  'flex items-center justify-center gap-1.5 border-b border-l bg-muted/40 px-1 py-2 text-xs outline-none transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40',
                  isSelected && 'bg-muted'
                )}
              >
                <span className="text-muted-foreground">{d.toLocaleDateString('ru-RU', { weekday: 'short' })}</span>
                <span
                  className={cn(
                    'flex size-6 items-center justify-center rounded-md font-medium',
                    isToday && 'bg-primary text-primary-foreground'
                  )}
                >
                  {d.getDate()}
                </span>
              </button>
            )
          })}
          {HOURS.map((hour) => (
            <React.Fragment key={hour}>
              <div className="border-b px-1.5 py-1 text-right text-[11px] tabular-nums text-muted-foreground">{hour}:00</div>
              {weekDays.map((day) => {
                const slot = getMessagesForWeekSlot(day, hour)
                return (
                  <div
                    key={`${day.toISOString()}-${hour}`}
                    onClick={() => setSelectedDate(day)}
                    className={cn(
                      'min-h-[40px] cursor-pointer space-y-0.5 border-b border-l p-0.5 transition-colors hover:bg-muted/30',
                      isSameDay(day, now) && 'bg-muted/20'
                    )}
                  >
                    {slot.slice(0, 2).map((m) => (
                      <EventChip key={m.id} message={m} onOpen={openMessage} />
                    ))}
                    {slot.length > 2 && (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation()
                          setSelectedDate(day)
                        }}
                        className="w-full rounded px-1 text-left text-[11px] text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
                      >
                        Ещё {slot.length - 2}
                      </button>
                    )}
                  </div>
                )
              })}
            </React.Fragment>
          ))}
        </div>
      </div>
      {hiddenByHours > 0 && (
        <p className="text-xs text-muted-foreground">
          Ещё {hiddenByHours} {pluralMessages(hiddenByHours)} вне выбранных часов — они видны в списке выбранного дня или при диапазоне 6:00–24:00.
        </p>
      )}
    </div>
  )

  const agendaView =
    agendaGroups.length === 0 ? (
      <EmptyState
        icon={<CalendarDays />}
        title="В этом месяце нет сообщений"
        description={
          hasActiveFilters
            ? 'Возможно, их скрывают фильтры. Сбросьте фильтры или выберите другой месяц.'
            : 'Запланируйте сообщение в одном из пространств — оно появится здесь.'
        }
      >
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          )}
          {addMessageButton}
        </div>
      </EmptyState>
    ) : (
      <div className="overflow-hidden rounded-lg border bg-card">
        {agendaGroups.map((g) => {
          const isToday = isSameDay(g.date, now)
          return (
            <section key={dayKeyOf(g.date)} className="border-b last:border-b-0">
              <h3 className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium">
                <span className="capitalize">
                  {g.date.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'long' })}
                </span>
                {isToday && <Badge variant="info">Сегодня</Badge>}
                <span className="ml-auto font-normal text-muted-foreground">{g.items.length}</span>
              </h3>
              <div className="divide-y">
                {g.items.map((m) => (
                  <MessageRow key={m.id} message={m} onOpen={openMessage} />
                ))}
              </div>
            </section>
          )
        })}
      </div>
    )

  const dayLastHour = Math.min(hourEnd, 23)
  const dayHours = Array.from({ length: Math.max(0, dayLastHour - hourStart + 1) }, (_, i) => hourStart + i)
  const dayBefore = messagesOnCurrentDay.filter((m) => new Date(m.scheduledFor).getHours() < hourStart)
  const dayAfter = messagesOnCurrentDay.filter((m) => new Date(m.scheduledFor).getHours() > dayLastHour)
  const isCurrentDayToday = isSameDay(currentDate, now)

  const dayRow = (key: string, label: React.ReactNode, items: CalMessage[], highlight = false) => (
    <div key={key} className={cn('grid grid-cols-[64px_minmax(0,1fr)] border-b last:border-b-0', highlight && 'bg-muted/30')}>
      <div className={cn('border-r px-2 py-2 text-right text-[11px] tabular-nums text-muted-foreground', highlight && 'font-medium text-foreground')}>
        {label}
      </div>
      <div className="min-h-10 min-w-0 divide-y">
        {items.map((m) => (
          <MessageRow key={m.id} message={m} onOpen={openMessage} />
        ))}
      </div>
    </div>
  )

  const dayView =
    messagesOnCurrentDay.length === 0 ? (
      <EmptyState
        icon={<Clock />}
        title="На этот день сообщений нет"
        description={
          hasActiveFilters
            ? 'Возможно, их скрывают фильтры. Сбросьте фильтры или выберите другой день.'
            : 'Запланируйте сообщение в одном из пространств — оно появится здесь.'
        }
      >
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          {hasActiveFilters && (
            <Button variant="outline" size="sm" onClick={resetFilters}>
              Сбросить фильтры
            </Button>
          )}
          {addMessageButton}
        </div>
      </EmptyState>
    ) : (
      <div className="overflow-hidden rounded-lg border bg-card" role="group" aria-label="Сообщения дня по часам">
        {dayBefore.length > 0 && dayRow('before', `до ${hourStart}:00`, dayBefore)}
        {dayHours.map((h) =>
          dayRow(
            `h${h}`,
            `${h}:00`,
            messagesOnCurrentDay.filter((m) => new Date(m.scheduledFor).getHours() === h),
            isCurrentDayToday && now.getHours() === h
          )
        )}
        {dayAfter.length > 0 && dayRow('after', `после ${dayLastHour}:59`, dayAfter)}
      </div>
    )

  const dayPanel = (
    <aside className="rounded-lg border bg-card lg:sticky lg:top-4 lg:self-start" aria-label="Сообщения выбранного дня">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2.5">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold capitalize">
            {selectedDate
              ? selectedDate.toLocaleDateString('ru-RU', { day: 'numeric', month: 'long', weekday: 'short' })
              : 'Выберите день'}
          </h2>
          {selectedDate && (
            <p className="text-xs text-muted-foreground">
              {selectedMessages.length} {pluralMessages(selectedMessages.length)}
            </p>
          )}
        </div>
        {selectedMessages.length > 1 && (
          <Select value={sortBy} onValueChange={(v: 'time' | 'user' | 'channel') => setSortBy(v)}>
            <SelectTrigger size="sm" className="w-[130px] text-xs no-print" aria-label="Сортировка">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="time">По времени</SelectItem>
              <SelectItem value="user">По автору</SelectItem>
              <SelectItem value="channel">По каналу</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      {loading ? (
        <div className="divide-y">
          {[1, 2, 3].map((i) => (
            <div key={i} className="space-y-2 px-3 py-3">
              <Skeleton className="h-4 w-2/3" />
              <Skeleton className="h-3 w-1/2" />
              <Skeleton className="h-3 w-full" />
            </div>
          ))}
        </div>
      ) : !selectedDate ? (
        <p className="px-3 py-8 text-center text-sm text-muted-foreground">Выберите день в календаре, чтобы увидеть сообщения.</p>
      ) : selectedMessages.length === 0 ? (
        <div className="px-4 py-8 text-center">
          <Clock className="mx-auto mb-2 size-5 text-muted-foreground" aria-hidden />
          <p className="text-sm font-medium">Нет сообщений на этот день</p>
          {activeWorkspaces.length > 0 && (
            <Button variant="outline" size="sm" className="mt-3" onClick={() => setAddMessageDialogOpen(true)}>
              <Plus /> Запланировать
            </Button>
          )}
        </div>
      ) : (
        <div className="max-h-[calc(100vh-14rem)] divide-y overflow-y-auto">
          {selectedMessages.map((m) => (
            <MessageRow key={m.id} message={m} onOpen={openMessage} />
          ))}
        </div>
      )}
    </aside>
  )

  const loadingView = (
    <div className="overflow-hidden rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка календаря">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {WEEKDAYS.map((d) => (
          <div key={d} className="flex justify-center px-2 py-2.5">
            <Skeleton className="h-3 w-5" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 [&>*:nth-child(7n)]:border-r-0">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="min-h-[72px] space-y-2 border-b border-r p-2 sm:min-h-[112px]">
            <Skeleton className="size-5" />
            {i % 4 === 1 && <Skeleton className="hidden h-3 w-4/5 sm:block" />}
          </div>
        ))}
      </div>
    </div>
  )

  return (
    <PageContainer size="wide" className="print:block">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Календарь', current: true },
            ]}
          />
        }
        title="Календарь"
        description={
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            {isYear ? 'Интенсивы по пространствам за год' : 'Запланированные сообщения по пространствам'}
            {!isYear && <Badge variant="muted">{isSharedCalendar ? 'Общий календарь' : 'Индивидуальный'}</Badge>}
          </span>
        }
        actions={
          <div className="no-print flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => (isYear ? setYearRefreshKey((k) => k + 1) : void loadData(true))}
              disabled={refreshing}
              aria-label="Обновить данные календаря"
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} /> Обновить
            </Button>
            {addMessageButton}
          </div>
        }
      />

      <div className="space-y-4">
        {/* Тулбар: навигация + переключатель вида */}
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" size="sm" onClick={goToday}>
              Сегодня
            </Button>
            <div className="flex items-center">
              <Button variant="ghost" size="icon-sm" onClick={() => step(-1)} aria-label={prevLabel}>
                <ChevronLeft />
              </Button>
              <Button variant="ghost" size="icon-sm" onClick={() => step(1)} aria-label={nextLabel}>
                <ChevronRight />
              </Button>
            </div>
            {isYear ? (
              <Select
                value={String(currentDate.getFullYear())}
                onValueChange={(v) => setCurrentDate(new Date(Number(v), currentDate.getMonth(), 1))}
              >
                <SelectTrigger size="sm" className="w-[96px] font-semibold" aria-label="Год">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {yearOptions.map((y) => (
                    <SelectItem key={y} value={String(y)}>
                      {y}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            ) : (
            <Popover
              open={jumpOpen}
              onOpenChange={(o) => {
                setJumpOpen(o)
                if (o) setJumpYear(currentDate.getFullYear())
              }}
            >
              <PopoverTrigger asChild>
                <Button variant="ghost" size="sm" className="gap-1 text-sm font-semibold" aria-label="Перейти к месяцу">
                  <span className="capitalize">{periodTitle}</span>
                  <ChevronDown className="text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent align="start" className="w-64 p-3">
                <div className="mb-2 flex items-center justify-between">
                  <Button variant="ghost" size="icon-sm" onClick={() => setJumpYear((y) => y - 1)} aria-label="Предыдущий год">
                    <ChevronLeft />
                  </Button>
                  <span className="text-sm font-medium tabular-nums">{jumpYear}</span>
                  <Button variant="ghost" size="icon-sm" onClick={() => setJumpYear((y) => y + 1)} aria-label="Следующий год">
                    <ChevronRight />
                  </Button>
                </div>
                <div className="grid grid-cols-3 gap-1">
                  {MONTHS.map((name, i) => {
                    const active = i === currentDate.getMonth() && jumpYear === currentDate.getFullYear()
                    return (
                      <Button
                        key={name}
                        variant={active ? 'secondary' : 'ghost'}
                        size="sm"
                        className="justify-center"
                        onClick={() => {
                          setCurrentDate(new Date(jumpYear, i, 1))
                          setJumpOpen(false)
                        }}
                      >
                        {name.slice(0, 3)}
                      </Button>
                    )
                  })}
                </div>
              </PopoverContent>
            </Popover>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(viewMode === 'week' || viewMode === 'day') && (
              <Select value={hourRangePreset} onValueChange={(v: HourPreset) => setHourRangePreset(v)}>
                <SelectTrigger size="sm" className="w-[150px]" aria-label="Диапазон часов">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="8-22">8:00–22:00</SelectItem>
                  <SelectItem value="6-24">6:00–24:00</SelectItem>
                  <SelectItem value="9-18">9:00–18:00</SelectItem>
                </SelectContent>
              </Select>
            )}
            <Tabs value={viewMode} onValueChange={(v) => changeView(v as ViewMode)}>
              <TabsList className="!h-8" aria-label="Вид календаря">
                {intensivesEnabled && <TabsTrigger value="year" className="text-[13px]">Год</TabsTrigger>}
                <TabsTrigger value="month" className="text-[13px]">Месяц</TabsTrigger>
                <TabsTrigger value="week" className="text-[13px]">Неделя</TabsTrigger>
                <TabsTrigger value="day" className="text-[13px]">День</TabsTrigger>
                <TabsTrigger value="timeline" className="text-[13px]">Список</TabsTrigger>
              </TabsList>
            </Tabs>
          </div>
        </div>

        {!isYear && (
        <>
        {/* Фильтры */}
        <div className="no-print flex flex-wrap items-center gap-2">
          <Select value={filterWorkspaceId} onValueChange={setFilterWorkspaceId}>
            <SelectTrigger size="sm" className="w-[170px]" aria-label="Пространство">
              <SelectValue placeholder="Пространство" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все пространства</SelectItem>
              {activeWorkspaceList.map((w: CalWorkspace) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.workspaceName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={filterStatus} onValueChange={setFilterStatus}>
            <SelectTrigger size="sm" className="w-[140px]" aria-label="Статус">
              <SelectValue placeholder="Статус" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="PENDING">Ожидает отправки</SelectItem>
              <SelectItem value="SENT">Отправлено</SelectItem>
              <SelectItem value="FAILED">Не отправлено</SelectItem>
              <SelectItem value="CANCELLED">Отменено</SelectItem>
            </SelectContent>
          </Select>
          {isSupOrAdm && authors.length > 1 && (
            <Select value={filterAuthorId} onValueChange={setFilterAuthorId}>
              <SelectTrigger size="sm" className="w-[170px]" aria-label="Автор">
                <SelectValue placeholder="Автор" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все авторы</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {isSupOrAdm && (
            <Select value={filterRole} onValueChange={setFilterRole}>
              <SelectTrigger size="sm" className="w-[130px]" aria-label="Роль автора">
                <SelectValue placeholder="Роль" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Все роли</SelectItem>
                <SelectItem value="SUP">SUP</SelectItem>
                <SelectItem value="LEAD_SUP">Lead_SUP</SelectItem>
                <SelectItem value="ADM">ADM</SelectItem>
              </SelectContent>
            </Select>
          )}
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" onClick={resetFilters} className="text-muted-foreground">
              <RotateCcw /> Сбросить
            </Button>
          )}
        </div>

        {filterWorkspaceId !== 'all' && (
          <p className="no-print text-[13px] text-muted-foreground">
            Показано пространство «{filteredWorkspaceName}».
            {isSupOrAdm && ' В выборке — все пользователи этого пространства.'}
          </p>
        )}

        {intensiveFilter && (
          <div className="no-print flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
            <span className="inline-flex min-h-9 max-w-full items-center gap-2 rounded-md border bg-card py-0.5 pl-2.5 pr-1">
              <CalendarRange className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="min-w-0 truncate">
                Интенсив «{intensiveFilter.name}» · {formatRange(intensiveFilter.startDate, intensiveFilter.endDate)} ·{' '}
                {formatTimezone(intensiveFilter.timezone)}
              </span>
              <Button variant="ghost" size="icon-sm" className="size-8 shrink-0" onClick={clearIntensiveFilter} aria-label="Снять фильтр по интенсиву">
                <X />
              </Button>
            </span>
            <span className="text-muted-foreground">Показаны только сообщения, привязанные к этому интенсиву.</span>
          </div>
        )}

        {!loading && (
          <div className="no-print space-y-0.5 text-xs text-muted-foreground">
            <p className="flex items-center gap-1.5">
              <Globe className="size-3.5 shrink-0" aria-hidden />
              <span>Время в календаре показано в вашем часовом поясе: {browserZone.label}.</span>
            </p>
            {intensiveFilter && zonesDiffer && intensiveZone && (
              <p className="pl-5">
                Пояс интенсива другой: {intensiveZone.label}. Время сообщений пересчитано в ваш пояс, даты интенсива — по его поясу.
              </p>
            )}
          </div>
        )}

        {!loading && <Summary list={summaryList} />}
        </>
        )}

        {isYear ? (
          <YearView
            year={currentDate.getFullYear()}
            canManage={feature?.canManage === true}
            onOpenCalendar={openIntensiveInCalendar}
            refreshKey={yearRefreshKey}
          />
        ) : loading ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            {loadingView}
            {dayPanel}
          </div>
        ) : viewMode === 'timeline' ? (
          agendaView
        ) : viewMode === 'day' ? (
          dayView
        ) : (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
            <div className="min-w-0 space-y-3">
              {viewMode === 'month' ? monthView : weekView}
              <div className="no-print flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><StatusDot status="PENDING" /> Ожидает отправки</span>
                <span className="inline-flex items-center gap-1.5"><StatusDot status="SENT" /> Отправлено</span>
                <span className="inline-flex items-center gap-1.5"><StatusDot status="FAILED" /> Не отправлено</span>
                {hasIntensivePeriods && viewMode === 'month' && (
                  <span className="inline-flex items-center gap-1.5">
                    <span aria-hidden className="inline-block size-1.5 rounded-full bg-teal-500" /> Период пространства
                  </span>
                )}
              </div>
            </div>
            {dayPanel}
          </div>
        )}
      </div>

      {/* Детали сообщения */}
      <MessageDetailSheet
        message={activeMessage}
        open={activeMessage !== null}
        onOpenChange={(o) => {
          if (!o) setActiveMessageId(null)
        }}
      />

      {/* Диалог выбора пространства для добавления сообщения */}
      <Dialog open={addMessageDialogOpen} onOpenChange={setAddMessageDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Добавить сообщение</DialogTitle>
            <DialogDescription>Выберите пространство — откроется его страница, где можно запланировать сообщение.</DialogDescription>
          </DialogHeader>
          <div className="-mx-2 max-h-[50vh] divide-y overflow-y-auto">
            {activeWorkspaces.map((ws: CalWorkspace) => (
              <button
                type="button"
                key={ws.id}
                onClick={() => {
                  setAddMessageDialogOpen(false)
                  router.push(`/dashboard/workspaces/${ws.id}`)
                }}
                className="flex w-full items-center gap-3 rounded-md px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <span
                  aria-hidden
                  className="size-2.5 shrink-0 rounded-full"
                  style={{ backgroundColor: ws.color || 'var(--muted-foreground)' }}
                />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">{ws.workspaceName}</span>
                  <span className="block truncate font-mono text-xs text-muted-foreground">
                    {ws.workspaceUrl?.replace(/^https?:\/\//, '') ?? ''}
                  </span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
              </button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}
