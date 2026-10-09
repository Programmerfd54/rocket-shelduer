"use client"

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import MessageDialog from '@/components/_components/message-dialog'
import { MessageQueue, type QueueFilters } from '@/components/dashboard/MessageQueue'
import { MessageDetailPanel } from '@/components/dashboard/MessageDetailPanel'
import { QueueHeartbeat } from '@/components/dashboard/QueueHeartbeat'
import { ScheduleMessageAction } from '@/components/dashboard/ScheduleMessageAction'
import { DashboardSecondary, type DashStats, type DashWorkspace } from '@/components/dashboard/DashboardSecondary'
import { channelLabel, type QueueMessage, type QueueUser } from '@/components/dashboard/types'
import { formatLocalDate, cn } from '@/lib/utils'
import {
  isIntensiveArchiveToastDismissed,
  setIntensiveArchiveToastDismissed,
} from '@/lib/intensive-archive-toast'
import {
  DEFAULT_QUEUE_VIEW,
  QUEUE_VIEW_STORAGE_KEY,
  formatClock,
  formatUntil,
  formatWeekdayDate,
  parseStoredView,
  pluralRu,
  summarizeQueue,
  type QueueView,
} from '@/lib/message-queue'
import { getTimeZoneLabel } from '@/lib/schedule-datetime'
import { isLegacyPeriodEndingSoon } from '@/lib/intensives/archive-prompt'

interface DashUser extends QueueUser {
  role?: string
  volunteerExpiresAt?: string | null
}

/** Сколько не отправленных сообщений запрашиваем (PENDING запрашиваем без лимита — список полный). */
const FAILED_LIMIT = 100
const SAVED_NOTE_MS = 8000
/** Ширина, с которой панель деталей встаёт справа от списка; уже — полноэкранная шторка. */
const WIDE_QUERY = '(min-width: 1280px)'

function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mql = window.matchMedia(query)
      mql.addEventListener('change', onChange)
      return () => mql.removeEventListener('change', onChange)
    },
    () => window.matchMedia(query).matches,
    () => false,
  )
}

function readStoredView(): QueueView {
  try {
    return parseStoredView(window.localStorage.getItem(QUEUE_VIEW_STORAGE_KEY))
  } catch {
    return DEFAULT_QUEUE_VIEW
  }
}

function writeStoredView(view: QueueView) {
  try {
    window.localStorage.setItem(QUEUE_VIEW_STORAGE_KEY, view)
  } catch {
    /* localStorage может быть недоступен — просто не запоминаем */
  }
}

async function fetchMessages(url: string): Promise<QueueMessage[] | null> {
  try {
    const res = await fetch(url)
    if (!res.ok) return null
    const data = await res.json()
    return Array.isArray(data?.messages) ? (data.messages as QueueMessage[]) : null
  } catch {
    return null
  }
}

export default function DashboardPage() {
  const router = useRouter()
  const isWide = useMediaQuery(WIDE_QUERY)

  // Данные
  const [currentUser, setCurrentUser] = useState<DashUser | null>(null)
  const [allUsers, setAllUsers] = useState<DashUser[]>([])
  const [stats, setStats] = useState<DashStats>({
    workspaces: 0,
    activeWorkspaces: 0,
    archivedWorkspaces: 0,
    totalMessages: 0,
    pendingMessages: 0,
    sentMessages: 0,
    failedMessages: 0,
    todayMessages: 0,
  })
  const [statsLoaded, setStatsLoaded] = useState(false)
  const [workspaces, setWorkspaces] = useState<DashWorkspace[]>([])
  const [expiringWorkspaces, setExpiringWorkspaces] = useState<DashWorkspace[]>([])
  const [pending, setPending] = useState<QueueMessage[]>([])
  const [failed, setFailed] = useState<QueueMessage[]>([])
  const [pendingError, setPendingError] = useState(false)
  const [failedError, setFailedError] = useState(false)
  const [now, setNow] = useState(() => new Date())

  // Загрузка
  const [staticLoading, setStaticLoading] = useState(true)
  const [queueLoading, setQueueLoading] = useState(true)
  const [refreshing, setRefreshing] = useState(false)
  const [loadError, setLoadError] = useState(false)

  // Интерфейс
  const [view, setView] = useState<QueueView>(DEFAULT_QUEUE_VIEW)
  const [filters, setFilters] = useState<QueueFilters>({ workspaceId: 'all', userId: null })
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [lastKnown, setLastKnown] = useState<QueueMessage | null>(null)
  const [editing, setEditing] = useState<QueueMessage | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<QueueMessage | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [savedId, setSavedId] = useState<string | null>(null)

  const viewTouchedRef = useRef(false)
  const queueReqRef = useRef(0)
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const viewer = useMemo(
    () => (currentUser?.id ? { id: currentUser.id, role: currentUser.role ?? null } : null),
    [currentUser],
  )
  const isVolunteer = currentUser?.role === 'MEMBER' && !!currentUser?.volunteerExpiresAt
  const isStaff =
    currentUser?.role === 'SUP' || currentUser?.role === 'ADM' || currentUser?.role === 'LEAD_SUP'

  /* ───────────── Загрузка данных ───────────── */

  /** Очередь: PENDING целиком (без limit) + FAILED (до FAILED_LIMIT). Фильтр по пользователю — существующий параметр userId. */
  const loadQueue = useCallback(async (userId: string | null) => {
    const req = ++queueReqRef.current
    const userParam = userId ? `&userId=${encodeURIComponent(userId)}` : ''
    const [p, f] = await Promise.all([
      fetchMessages(`/api/messages?status=PENDING&sort=asc${userParam}`),
      fetchMessages(`/api/messages?status=FAILED&sort=desc&limit=${FAILED_LIMIT}${userParam}`),
    ])
    if (req !== queueReqRef.current) return // пришёл устаревший ответ (фильтр уже сменили)
    setPending(p ?? [])
    setPendingError(p === null)
    setFailed(f ?? [])
    setFailedError(f === null)
    setNow(new Date())
    setQueueLoading(false)
  }, [])

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch('/api/dashboard/stats')
      if (!res.ok) return
      setStats(await res.json())
      setStatsLoaded(true)
    } catch {
      /* показатели второстепенны: останутся прежние */
    }
  }, [])

  const loadStatic = useCallback(async () => {
    try {
      setLoadError(false)
      const userResponse = await fetch('/api/auth/me')
      if (userResponse.ok) {
        const userData = await userResponse.json()
        setCurrentUser(userData.user)
        if (
          userData.user &&
          (userData.user.role === 'SUP' || userData.user.role === 'ADM' || userData.user.role === 'LEAD_SUP')
        ) {
          const usersResponse = await fetch('/api/admin/users?scope=message-authors')
          if (usersResponse.ok) {
            const usersData = await usersResponse.json()
            setAllUsers(usersData.users || [])
          }
        }
      }

      await loadStats()

      const workspacesResponse = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      if (workspacesResponse.ok) {
        const workspacesData = await workspacesResponse.json()
        const list: DashWorkspace[] = workspacesData.workspaces ?? []
        setWorkspaces(list)

        // Период пространства заканчивается в ближайшие 7 дней (не показываем, если в графике есть
        // предстоящий/идущий интенсив или Lead_SUP отключил предложение архивировать)
        setExpiringWorkspaces(list.filter((ws) => isLegacyPeriodEndingSoon(ws, 7)))

        // Напоминание об архиве — только по серверному признаку archiveSuggested
        const ended = list.filter((ws) => ws.archiveSuggested === true)
        if (ended.length > 0 && !isIntensiveArchiveToastDismissed()) {
          const id = toast.warning('Интенсивы завершены', {
            description: `${ended.length} ${ended.length === 1 ? 'интенсив завершен' : 'интенсива завершены'}. Рекомендуется заархивировать их.`,
            duration: 12000,
            action: {
              label: 'Перейти в архивы',
              onClick: () => router.push('/dashboard/workspaces/archived'),
            },
            cancel: {
              label: 'Больше не уведомлять',
              onClick: () => {
                setIntensiveArchiveToastDismissed()
                toast.dismiss(id)
              },
            },
          })
        }

        // Интенсивы, заканчивающиеся в течение 3 дней
        const endingSoon = list.filter((ws) => isLegacyPeriodEndingSoon(ws, 3))
        if (endingSoon.length > 0 && ended.length === 0) {
          toast.info('Интенсивы скоро завершатся', {
            description: `${endingSoon.length} ${endingSoon.length === 1 ? 'интенсив завершится' : 'интенсива завершатся'} в ближайшие 3 дня.`,
            duration: 8000,
          })
        }
      }
    } catch (error) {
      console.error('Failed to load dashboard data:', error)
      setLoadError(true)
      toast.error('Не удалось загрузить данные', {
        description: 'Проверьте подключение к интернету и нажмите «Повторить».',
      })
    } finally {
      // Запомненное представление применяем один раз, когда данные уже готовы (без расхождения с SSR)
      if (!viewTouchedRef.current) {
        viewTouchedRef.current = true
        setView(readStoredView())
      }
      setStaticLoading(false)
    }
  }, [loadStats, router])

  useEffect(() => {
    void loadStatic()
  }, [loadStatic])

  useEffect(() => {
    void loadQueue(filters.userId)
  }, [loadQueue, filters.userId])

  /** Обновить всё без «мигания»: список остаётся на месте, пока приходят новые данные */
  const reloadAll = useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadStatic(), loadQueue(filters.userId)])
    } finally {
      setRefreshing(false)
    }
  }, [loadStatic, loadQueue, filters.userId])

  /** Перезагрузка после изменения сообщения — тем же загрузчиком, что и страница */
  const refreshAfterChange = useCallback(async () => {
    await Promise.all([loadQueue(filters.userId), loadStats()])
  }, [loadQueue, loadStats, filters.userId])

  // «Сейчас» обновляем при возврате на вкладку (без таймеров/поллинга): статусы «время прошло» остаются точными
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === 'visible') setNow(new Date())
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('focus', onVisible)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('focus', onVisible)
    }
  }, [])

  useEffect(
    () => () => {
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
    },
    [],
  )

  /* ───────────── Выбор и панель ───────────── */

  const messages = useMemo(() => [...pending, ...failed], [pending, failed])
  const byId = useMemo(() => new Map(messages.map((m) => [m.id, m])), [messages])
  const selectedMessage: QueueMessage | null = selectedId
    ? (byId.get(selectedId) ?? (lastKnown?.id === selectedId ? lastKnown : null))
    : null
  const selectedInList = selectedId ? byId.has(selectedId) : false

  const focusRow = useCallback((id: string | null) => {
    if (!id) return
    requestAnimationFrame(() => {
      document.querySelector<HTMLElement>(`[data-row-button="${CSS.escape(id)}"]`)?.focus()
    })
  }, [])

  const selectMessage = useCallback((m: QueueMessage) => {
    setSelectedId(m.id)
    setLastKnown(m)
    setSavedId(null)
  }, [])

  const closePanel = useCallback(() => {
    focusRow(selectedId)
    setSelectedId(null)
  }, [focusRow, selectedId])

  // Escape закрывает панель справа (шторка закрывается сама). Не мешаем открытым диалогам/меню/спискам.
  useEffect(() => {
    if (!selectedId || !isWide || editing || deleteTarget) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented) return
      if (document.querySelector('[role="dialog"],[role="alertdialog"],[role="menu"],[role="listbox"]')) return
      closePanel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [selectedId, isWide, editing, deleteTarget, closePanel])

  const handleViewChange = useCallback((v: QueueView) => {
    viewTouchedRef.current = true
    setView(v)
    writeStoredView(v)
  }, [])

  const handleFiltersChange = useCallback(
    (next: QueueFilters) => {
      if (next.userId !== filters.userId) {
        // Другой пользователь — другой набор данных: не показываем прежний, панель закрываем
        setQueueLoading(true)
        setPending([])
        setFailed([])
        setSelectedId(null)
      }
      setFilters(next)
    },
    [filters.userId],
  )

  /* ───────────── Действия (существующие эндпоинты и диалог) ───────────── */

  const startEdit = useCallback((m: QueueMessage) => {
    if (!(m.workspaceId ?? m.workspace?.id) || !m.channelId) {
      toast.error('Не удалось открыть редактирование', {
        description: 'У сообщения нет данных о канале или пространстве. Откройте его на странице пространства.',
      })
      return
    }
    setEditing(m)
  }, [])

  const handleSaved = useCallback(
    (id: string) => {
      setSavedId(id)
      if (savedTimerRef.current) clearTimeout(savedTimerRef.current)
      savedTimerRef.current = setTimeout(() => setSavedId(null), SAVED_NOTE_MS)
      void refreshAfterChange()
    },
    [refreshAfterChange],
  )

  const retryMessage = useCallback(
    async (m: QueueMessage) => {
      const toastId = `message-retry-${m.id}`
      setBusyId(m.id)
      toast.loading('Ставим сообщение в очередь…', { id: toastId })
      try {
        const res = await fetch(`/api/messages/${m.id}/retry`, { method: 'POST' })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Не удалось повторить отправку')
        await refreshAfterChange()
        toast.success('Сообщение в очереди — отправка через минуту', { id: toastId })
      } catch (error) {
        toast.error(error instanceof Error ? error.message : 'Не удалось повторить отправку', {
          id: toastId,
          description: 'Проверьте подключение к Rocket.Chat и права в канале.',
          action: { label: 'Повторить', onClick: () => void retryMessage(m) },
        })
      } finally {
        setBusyId(null)
      }
    },
    [refreshAfterChange],
  )

  const handleRetry = useCallback((m: QueueMessage) => void retryMessage(m), [retryMessage])

  const confirmDelete = async () => {
    if (!deleteTarget) return
    const target = deleteTarget
    setDeleting(true)
    const toastId = 'message-delete'
    toast.loading('Удаляем сообщение…', { id: toastId })
    try {
      const res = await fetch(`/api/messages/${target.id}`, { method: 'DELETE' })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Не удалось удалить сообщение')
      }
      setDeleteTarget(null)
      if (selectedId === target.id) setSelectedId(null)
      await refreshAfterChange()
      toast.success('Сообщение удалено', { id: toastId })
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить сообщение', {
        id: toastId,
        description: 'Повторите попытку.',
      })
    } finally {
      setDeleting(false)
    }
  }

  /* ───────────── Сводка ───────────── */

  const summary = useMemo(() => summarizeQueue(messages, now), [messages, now])
  const tz = useMemo(() => getTimeZoneLabel(now).label, [now])
  const dateLine = `${formatWeekdayDate(now).replace(/^./, (c) => c.toUpperCase())} · часовой пояс: ${tz}`
  const attentionCount = summary.overdueCount + summary.failedCount
  const nextMsg = summary.next as QueueMessage | null
  const num = (n: number) => (pendingError ? '—' : String(n))
  const initialLoading = queueLoading || staticLoading

  const inlinePanel = !!selectedMessage && isWide
  const sheetPanel = !!selectedMessage && !isWide

  const panelProps = selectedMessage
    ? {
        message: selectedMessage,
        inList: selectedInList,
        viewer,
        now,
        busy: busyId === selectedMessage.id,
        justSaved: savedId === selectedMessage.id,
        onClose: closePanel,
        onEdit: startEdit,
        onRetry: handleRetry,
        onDelete: setDeleteTarget,
      }
    : null

  return (
    <PageContainer size="wide">
      <PageHeader
        title="Расписание"
        description={
          initialLoading ? (
            <span className="inline-block h-4 w-64 max-w-full animate-pulse rounded-md bg-muted align-middle" />
          ) : (
            <>
              {dateLine}
              <QueueHeartbeat
                enabled={currentUser?.role === 'LEAD_SUP' || currentUser?.role === 'SUP'}
                className="mt-1 flex"
              />
            </>
          )
        }
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => void reloadAll()} disabled={refreshing || initialLoading}>
              <RefreshCw className={refreshing ? 'animate-spin' : ''} aria-hidden />
              Обновить
            </Button>
            <ScheduleMessageAction workspaces={workspaces} loading={staticLoading} canConnect={!isVolunteer} />
          </>
        }
      />

      {loadError && !staticLoading && (
        <div
          role="alert"
          className="mb-4 flex flex-col gap-2 rounded-lg border border-destructive/30 px-4 py-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="flex items-start gap-2.5 text-sm">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
            <div>
              <p className="font-medium">Не удалось загрузить часть данных</p>
              <p className="text-[13px] text-muted-foreground">Проверьте подключение к интернету и повторите попытку.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => void reloadAll()} className="shrink-0">
            Повторить
          </Button>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_26rem]">
        <div className="min-w-0 space-y-4">
          {/* Компактная сводка: считается по полному списку PENDING, поэтому цифры честные */}
          <section aria-label="Сводка">
            <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-3">
              <div className="min-w-0 bg-card px-3 py-2">
                <dt className="truncate text-xs text-muted-foreground">В очереди</dt>
                <dd className="text-base font-semibold tabular-nums">
                  {queueLoading ? <Skeleton className="mt-1 h-5 w-8" /> : num(summary.pendingTotal)}
                </dd>
              </div>
              <div className="min-w-0 bg-card px-3 py-2">
                <dt className="truncate text-xs text-muted-foreground">Запланировано на сегодня</dt>
                <dd className="text-base font-semibold tabular-nums">
                  {queueLoading ? <Skeleton className="mt-1 h-5 w-8" /> : num(summary.todayCount)}
                </dd>
              </div>
              <div className="col-span-2 min-w-0 bg-card px-3 py-2 sm:col-span-1">
                <dt className="truncate text-xs text-muted-foreground">Следующая отправка</dt>
                <dd className="min-w-0">
                  {queueLoading ? (
                    <Skeleton className="mt-1 h-5 w-32" />
                  ) : pendingError ? (
                    <span className="text-base font-semibold">—</span>
                  ) : nextMsg ? (
                    <>
                      <span className="text-base font-semibold tabular-nums">{formatClock(nextMsg.scheduledFor)}</span>
                      <span className="ml-2 truncate text-xs text-muted-foreground">
                        {channelLabel(nextMsg)} · {formatUntil(nextMsg.scheduledFor, now)}
                      </span>
                    </>
                  ) : (
                    <span className="text-[13px] text-muted-foreground">Нет запланированных</span>
                  )}
                </dd>
              </div>
            </dl>
          </section>

          {/* Требуют внимания: короткая полоса со ссылкой на представление (список — в очереди) */}
          {!queueLoading && attentionCount > 0 && view !== 'attention' && (
            <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex min-w-0 items-start gap-2 text-sm">
                <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
                <p className="min-w-0">
                  <span className="font-medium">Требуют внимания: </span>
                  {[
                    summary.failedCount > 0 &&
                      `${summary.failedCount}${failed.length >= FAILED_LIMIT ? '+' : ''} не отправлено`,
                    summary.overdueCount > 0 &&
                      `${summary.overdueCount} ${pluralRu(summary.overdueCount, ['ожидает', 'ожидают', 'ожидают'])} отправки с прошедшим временем`,
                  ]
                    .filter(Boolean)
                    .join(', ')}
                </p>
              </div>
              <Button variant="outline" size="sm" className="shrink-0 self-start sm:self-auto" onClick={() => handleViewChange('attention')}>
                Показать
              </Button>
            </div>
          )}

          <MessageQueue
            messages={messages}
            loading={queueLoading}
            pendingError={pendingError}
            failedError={failedError}
            failedLimit={FAILED_LIMIT}
            failedLimited={failed.length >= FAILED_LIMIT}
            now={now}
            viewer={viewer}
            view={view}
            onViewChange={handleViewChange}
            filters={filters}
            onFiltersChange={handleFiltersChange}
            users={isStaff ? allUsers.filter((u) => u.id && u.id !== currentUser?.id) : []}
            selectedId={selectedId}
            busyId={busyId}
            onSelect={selectMessage}
            onEdit={startEdit}
            onRetryMessage={handleRetry}
            onDelete={setDeleteTarget}
            onReload={() => void reloadAll()}
          />
        </div>

        <div className={cn('min-w-0', inlinePanel && 'xl:sticky xl:top-4 xl:self-start')}>
          {inlinePanel && panelProps ? (
            <aside
              aria-label="Детали сообщения"
              className="flex max-h-[calc(100dvh-2rem)] min-h-0 flex-col overflow-hidden rounded-lg border bg-card"
            >
              <MessageDetailPanel key={panelProps.message.id} layout="inline" {...panelProps} />
            </aside>
          ) : (
            <DashboardSecondary
              stats={stats}
              statsLoaded={statsLoaded}
              loading={staticLoading}
              expiringWorkspaces={expiringWorkspaces}
              recentWorkspaces={workspaces.slice(0, 3)}
              isVolunteer={isVolunteer}
              now={now}
            />
          )}
        </div>
      </div>

      {/* Узкие экраны: полноэкранная шторка */}
      {sheetPanel && panelProps && (
        <Sheet
          open
          onOpenChange={(open) => {
            if (!open) closePanel()
          }}
        >
          <SheetContent
            side="right"
            className="w-full gap-0 p-0 sm:max-w-md"
            onCloseAutoFocus={(e) => e.preventDefault()}
          >
            <SheetTitle className="sr-only">Детали сообщения</SheetTitle>
            <SheetDescription className="sr-only">Время, статус, текст и действия с сообщением.</SheetDescription>
            <MessageDetailPanel key={panelProps.message.id} layout="sheet" {...panelProps} />
          </SheetContent>
        </Sheet>
      )}

      {/* Изменение времени — существующий диалог редактирования */}
      {editing && (
        <MessageDialog
          open
          onOpenChange={(open) => {
            if (!open) {
              focusRow(editing.id)
              setEditing(null)
            }
          }}
          workspaceId={(editing.workspaceId ?? editing.workspace?.id) as string}
          channelId={editing.channelId as string}
          channelName={editing.channelName ?? ''}
          editingMessage={editing}
          onSuccess={() => handleSaved(editing.id)}
          currentUserRole={currentUser?.role}
        />
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        onOpenChange={(open) => {
          if (!open) setDeleteTarget(null)
        }}
        title="Удалить сообщение?"
        description={
          deleteTarget && (
            <div className="space-y-2 text-sm">
              <p className="font-medium text-foreground">
                {channelLabel(deleteTarget)} · {formatClock(deleteTarget.scheduledFor)}
              </p>
              <p className="line-clamp-3 break-words text-muted-foreground">
                {(deleteTarget.message ?? '').trim() || 'Без текста'}
              </p>
              <p className="text-muted-foreground">
                {deleteTarget.status === 'SENT'
                  ? 'Это действие нельзя отменить.'
                  : 'Сообщение не будет отправлено. Это действие нельзя отменить.'}
              </p>
            </div>
          )
        }
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={confirmDelete}
      />
    </PageContainer>
  )
}
