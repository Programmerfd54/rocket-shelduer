"use client"

import { useState, type MouseEvent } from 'react'
import Link from 'next/link'
import { toast } from 'sonner'
import {
  Archive,
  Calendar,
  Copy,
  MoreHorizontal,
  RefreshCw,
  Settings,
  Shield,
  Star,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { formatRelativeTime, cn } from '@/lib/utils'

export interface Workspace {
  id: string
  workspaceName: string
  workspaceUrl: string
  username: string
  has2FA: boolean
  isActive: boolean
  lastConnected?: Date | null
  createdAt?: Date | string
  startDate?: Date | string | null
  endDate?: Date | string | null
  color?: string | null
  messageCountTotal?: number
  messageCountPending?: number
  lastEmojiImport?: { userName: string | null; userEmail: string; at: string } | null
  lastUsersAdd?: { userName: string | null; userEmail: string; at: string } | null
  isArchived?: boolean
  isAssigned?: boolean
  isMultiUser?: boolean
  todayIntensiveDay?: number
  totalIntensiveDays?: number
  messageDueToday?: boolean
  nextAnnouncementDay?: number
  nextAnnouncementChannels?: string[]
}

interface WorkspaceFormProps {
  workspaces: Workspace[]
  onOpenWorkspace: (workspace: Workspace) => void
  onTestConnection: (workspaceId: string) => void
  onArchive?: (workspaceId: string) => Promise<void>
  loading?: boolean
  userRole?: string
  volunteerExpiresAt?: string | null
  volunteerIntensive?: string | null
  /** 'compact' — плотный список (по умолчанию в проводнике), 'grid' — плоские карточки */
  viewMode?: 'grid' | 'compact'
  groupNamesByWorkspaceId?: Record<string, string>
  isFavorite?: (workspaceId: string) => boolean
  onToggleFavorite?: (workspaceId: string) => void
  /** Название, даты интенсива, URL, архив (владелец); у назначенных — открыть пространство для подключения к RC */
  onWorkspaceSettings?: (workspace: Workspace) => void
}

function pluralDays(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
  return 'дней'
}

function formatIntensiveDates(start?: Date | string | null, end?: Date | string | null): string | null {
  if (!start || !end) return null
  const s = new Date(start)
  const e = new Date(end)
  return `${s.toLocaleDateString('ru-RU')} – ${e.toLocaleDateString('ru-RU')}`
}

function getEndDateStatus(endDate?: Date | string | null): { label: string; warning: boolean } | null {
  if (!endDate) return null
  const end = new Date(endDate)
  const now = new Date()
  if (end < now) {
    const days = Math.ceil((now.getTime() - end.getTime()) / (1000 * 60 * 60 * 24))
    return { label: `Завершён ${days} ${pluralDays(days)} назад`, warning: true }
  }
  const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 7) return { label: `Завершится через ${days} ${pluralDays(days)}`, warning: true }
  return { label: `До ${end.toLocaleDateString('ru-RU')}`, warning: false }
}

type WsStatus = 'active' | 'expiring' | 'expired' | 'inactive'

function getWorkspaceStatus(workspace: Workspace): WsStatus {
  if (!workspace.endDate) return workspace.isActive ? 'active' : 'inactive'
  const now = new Date()
  const endDate = new Date(workspace.endDate)
  const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))

  if (endDate < now) return 'expired'
  if (daysUntilEnd <= 7) return 'expiring'
  return 'active'
}

type Quality = 'excellent' | 'good' | 'fair' | 'poor' | 'unknown'

function getConnectionQuality(workspace: Workspace): Quality {
  if (!workspace.lastConnected) return 'unknown'
  const hoursSinceConnection = Math.floor((Date.now() - new Date(workspace.lastConnected).getTime()) / (1000 * 60 * 60))

  if (hoursSinceConnection < 1) return 'excellent'
  if (hoursSinceConnection < 24) return 'good'
  if (hoursSinceConnection < 168) return 'fair'
  return 'poor'
}

const QUALITY_TEXT: Record<Quality, string> = {
  excellent: 'Отлично',
  good: 'Хорошо',
  fair: 'Средне',
  poor: 'Плохо',
  unknown: 'Нет данных',
}

const QUALITY_DOT: Record<Quality, string> = {
  excellent: 'bg-emerald-500',
  good: 'bg-emerald-500/70',
  fair: 'bg-amber-500',
  poor: 'bg-red-500',
  unknown: 'bg-muted-foreground/40',
}

function getLastActivityText(workspace: Workspace): string {
  if (!workspace.lastConnected) return 'Нет данных'
  const diff = Date.now() - new Date(workspace.lastConnected).getTime()

  const minutes = Math.floor(diff / (1000 * 60))
  const hours = Math.floor(diff / (1000 * 60 * 60))
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))

  if (minutes < 5) return 'Только что'
  if (minutes < 60) return `${minutes} мин. назад`
  if (hours < 24) return `${hours} ч. назад`
  if (days < 7) return `${days} дн. назад`
  return new Date(workspace.lastConnected).toLocaleDateString('ru-RU')
}

function getIntensiveProgress(workspace: Workspace): number | null {
  if (!workspace.endDate) return null
  const now = new Date().getTime()
  const start = workspace.createdAt ? new Date(workspace.createdAt).getTime() : now
  const end = new Date(workspace.endDate).getTime()
  const total = end - start
  const elapsed = now - start
  if (total <= 0) return 100
  return Math.min(100, Math.max(0, (elapsed / total) * 100))
}

function shortUrl(url: string) {
  return url.replace(/^https?:\/\//, '')
}

/** Индикатор «последняя активность» — точка качества подключения + относительное время. */
function ActivityInfo({ workspace, isSup }: { workspace: Workspace; isSup: boolean }) {
  const quality = getConnectionQuality(workspace)
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="inline-flex items-center gap-1.5">
          <span className={cn('size-1.5 shrink-0 rounded-full', QUALITY_DOT[quality])} aria-hidden />
          <span>{getLastActivityText(workspace)}</span>
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs">
        <div className="space-y-0.5">
          <p>Последняя активность · подключение: {QUALITY_TEXT[quality].toLowerCase()}</p>
          {isSup && workspace.lastEmojiImport && (
            <p className="opacity-80">
              Импорт эмодзи: {workspace.lastEmojiImport.userName || workspace.lastEmojiImport.userEmail} ·{' '}
              {formatRelativeTime(workspace.lastEmojiImport.at)}
            </p>
          )}
          {isSup && workspace.lastUsersAdd && (
            <p className="opacity-80">
              Добавление пользователей: {workspace.lastUsersAdd.userName || workspace.lastUsersAdd.userEmail} ·{' '}
              {formatRelativeTime(workspace.lastUsersAdd.at)}
            </p>
          )}
        </div>
      </TooltipContent>
    </Tooltip>
  )
}

/** Бейджи состояния: показываем только то, что требует внимания или объясняет роль пространства. */
function WorkspaceBadges({
  workspace,
  status,
  groupName,
  isMyIntensive,
}: {
  workspace: Workspace
  status: WsStatus
  groupName?: string
  isMyIntensive: boolean
}) {
  return (
    <>
      {status === 'expiring' && <Badge variant="warning">Скоро истекает</Badge>}
      {status === 'expired' && <Badge variant="danger">Истёк</Badge>}
      {status === 'inactive' && <Badge variant="muted">Неактивен</Badge>}
      {isMyIntensive && <Badge variant="info">Ваш интенсив</Badge>}
      {workspace.isAssigned && <Badge variant="muted">Назначено</Badge>}
      {groupName && <Badge variant="outline">{groupName}</Badge>}
      {workspace.has2FA && (
        <Badge variant="outline" title="Включена двухфакторная аутентификация">
          <Shield aria-hidden />
          2FA
        </Badge>
      )}
      <Badge
        variant="outline"
        className="hidden sm:inline-flex"
        title={workspace.isMultiUser ? 'Есть назначенные участники' : 'Только владелец'}
      >
        {workspace.isMultiUser ? 'Многопользовательское' : 'Индивидуальное'}
      </Badge>
    </>
  )
}

/** Строка про сегодняшний день интенсива и ближайший анонс. */
function IntensiveLine({ workspace }: { workspace: Workspace }) {
  if (workspace.todayIntensiveDay == null || workspace.totalIntensiveDays == null) return null
  const channels = workspace.nextAnnouncementChannels ?? []
  return (
    <p className="text-xs text-muted-foreground">
      <span>
        День {workspace.todayIntensiveDay} из {workspace.totalIntensiveDays}
      </span>
      {workspace.messageDueToday !== undefined && (
        <span className={workspace.messageDueToday ? 'font-medium text-foreground' : undefined}>
          {' · '}
          {workspace.messageDueToday ? 'по шаблонам: отправить сегодня' : 'по шаблонам сегодня отправки нет'}
        </span>
      )}
      {workspace.nextAnnouncementDay != null && channels.length > 0 && (
        <span>
          {' · '}след. анонс: день {workspace.nextAnnouncementDay} · {channels.map((c) => `#${c.replace(/^#/, '')}`).join(', ')}
        </span>
      )}
    </p>
  )
}

export default function WorkspaceForm({
  workspaces,
  onOpenWorkspace,
  onTestConnection,
  onArchive,
  loading,
  userRole = 'MEMBER',
  volunteerExpiresAt,
  volunteerIntensive,
  viewMode = 'grid',
  groupNamesByWorkspaceId = {},
  isFavorite,
  onToggleFavorite,
  onWorkspaceSettings,
}: WorkspaceFormProps) {
  const [archiveTarget, setArchiveTarget] = useState<Workspace | null>(null)
  const [archiving, setArchiving] = useState(false)

  const handleArchive = async () => {
    if (!archiveTarget || !onArchive) return
    setArchiving(true)
    try {
      await onArchive(archiveTarget.id)
      toast.success(`Пространство «${archiveTarget.workspaceName}» заархивировано`, {
        description: 'Восстановить его можно в разделе «Архивы».',
      })
      setArchiveTarget(null)
    } catch (e) {
      toast.error('Не удалось заархивировать пространство', {
        description: e instanceof Error && e.message ? e.message : 'Повторите попытку позже.',
      })
    } finally {
      setArchiving(false)
    }
  }

  const handleCopyUrl = async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      toast.success('Ссылка скопирована')
    } catch {
      toast.error('Не удалось скопировать ссылку', { description: 'Выделите адрес и скопируйте вручную.' })
    }
  }

  if (loading) {
    return (
      <div className="divide-y overflow-hidden rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка">
        {[1, 2, 3, 4, 5].map((i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 shrink-0" />
            <div className="min-w-0 flex-1 space-y-1.5">
              <Skeleton className="h-4 w-1/3 max-w-[220px]" />
              <Skeleton className="h-3 w-1/2 max-w-[320px]" />
            </div>
            <Skeleton className="h-8 w-20 shrink-0" />
          </div>
        ))}
      </div>
    )
  }

  // Пустое состояние показывает родитель (с учётом поиска и прав на добавление)
  if (workspaces.length === 0) return null

  const isSup = userRole === 'SUP' || userRole === 'LEAD_SUP' || userRole === 'ADM'
  const isVol = userRole === 'MEMBER' && !!volunteerExpiresAt
  const canArchive = isSup && !!onArchive

  /** Меню действий: копирование, проверка, календарь, настройки, архив. */
  const renderActions = (workspace: Workspace, showArchive: boolean) => (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={`Действия: ${workspace.workspaceName}`}
          className="text-muted-foreground data-[state=open]:bg-accent data-[state=open]:opacity-100 [@media(hover:hover)]:opacity-0 [@media(hover:hover)]:group-hover:opacity-100 [@media(hover:hover)]:group-focus-within:opacity-100 [@media(hover:hover)]:focus-visible:opacity-100"
        >
          <MoreHorizontal aria-hidden />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-56">
        <DropdownMenuItem onSelect={() => onTestConnection(workspace.id)}>
          <RefreshCw aria-hidden />
          Проверить подключение
        </DropdownMenuItem>
        <DropdownMenuItem asChild>
          <Link href={`/dashboard/calendar?workspaceId=${workspace.id}`}>
            <Calendar aria-hidden />
            Календарь
          </Link>
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => void handleCopyUrl(workspace.workspaceUrl)}>
          <Copy aria-hidden />
          Копировать адрес
        </DropdownMenuItem>
        {onWorkspaceSettings && (
          <DropdownMenuItem onSelect={() => onWorkspaceSettings(workspace)}>
            <Settings aria-hidden />
            {workspace.isAssigned ? 'Подключение к Rocket.Chat' : 'Настройки пространства'}
          </DropdownMenuItem>
        )}
        {showArchive && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={() => setArchiveTarget(workspace)}>
              <Archive aria-hidden />
              В архив
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )

  const renderFavorite = (workspace: Workspace, favorite: boolean) =>
    onToggleFavorite ? (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            className="size-7 shrink-0"
            onClick={() => onToggleFavorite(workspace.id)}
            aria-label={favorite ? 'Убрать из избранного' : 'Добавить в избранное'}
            aria-pressed={favorite}
          >
            <Star
              className={cn(
                'size-4',
                favorite ? 'fill-amber-400 text-amber-400' : 'text-muted-foreground/60 hover:text-foreground',
              )}
              aria-hidden
            />
          </Button>
        </TooltipTrigger>
        <TooltipContent>{favorite ? 'Убрать из избранного' : 'В избранное'}</TooltipContent>
      </Tooltip>
    ) : null

  /** Клик по строке/карточке открывает пространство, кроме кликов по кнопкам, ссылкам и пунктам меню. */
  const handleRowClick = (e: MouseEvent<HTMLElement>, workspace: Workspace) => {
    if (!e.currentTarget.contains(e.target as Node)) return // событие из портала (меню)
    if ((e.target as HTMLElement).closest('button, a, [role="menuitem"]')) return
    onOpenWorkspace(workspace)
  }

  return (
    <>
      {viewMode === 'compact' ? (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {workspaces.map((workspace) => {
            const endStatus = getEndDateStatus(workspace.endDate)
            const isEnded = !!workspace.endDate && new Date(workspace.endDate) < new Date()
            const showArchive = canArchive && isEnded
            const groupName = groupNamesByWorkspaceId[workspace.id]
            const isMyIntensive =
              !!(isVol && volunteerIntensive && workspace.workspaceUrl?.toLowerCase().includes(volunteerIntensive.toLowerCase()))
            const status = getWorkspaceStatus(workspace)
            const favorite = isFavorite?.(workspace.id) ?? false
            const pending = workspace.messageCountPending ?? 0

            return (
              <div
                key={workspace.id}
                data-workspace-id={workspace.id}
                className="group flex cursor-pointer items-start gap-2 px-3 py-2.5 transition-colors hover:bg-muted/40 sm:items-center sm:gap-3 sm:px-4"
                onClick={(e) => handleRowClick(e, workspace)}
              >
                {renderFavorite(workspace, favorite)}

                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                    <button
                      type="button"
                      onClick={() => onOpenWorkspace(workspace)}
                      className="max-w-full truncate rounded-sm text-left text-sm font-medium outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      title={workspace.workspaceName}
                    >
                      {workspace.workspaceName}
                    </button>
                    <WorkspaceBadges workspace={workspace} status={status} groupName={groupName} isMyIntensive={isMyIntensive} />
                  </div>
                  <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
                    <span className="max-w-full truncate font-mono" title={workspace.workspaceUrl}>
                      {shortUrl(workspace.workspaceUrl)}
                    </span>
                    {workspace.username && <span className="truncate font-mono">{workspace.username}</span>}
                    <ActivityInfo workspace={workspace} isSup={isSup} />
                  </p>
                  <IntensiveLine workspace={workspace} />
                </div>

                <div className="hidden shrink-0 flex-col items-end gap-0.5 text-right text-xs md:flex">
                  {endStatus && (
                    <span className={endStatus.warning ? 'font-medium text-amber-700 dark:text-amber-300' : 'text-muted-foreground'}>
                      {endStatus.label}
                    </span>
                  )}
                  {workspace.messageCountTotal !== undefined && (
                    <span className="text-muted-foreground" title="Ожидают отправки / всего сообщений">
                      {pending > 0 ? `${pending} в очереди` : 'очередь пуста'}
                    </span>
                  )}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(workspace)}>
                    Открыть
                  </Button>
                  {renderActions(workspace, showArchive)}
                </div>
              </div>
            )
          })}
        </div>
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {workspaces.map((workspace) => {
            const endStatus = getEndDateStatus(workspace.endDate)
            const intensiveDates = formatIntensiveDates(workspace.startDate, workspace.endDate)
            const isEnded = !!workspace.endDate && new Date(workspace.endDate) < new Date()
            const showArchive = canArchive && isEnded
            const groupName = groupNamesByWorkspaceId[workspace.id]
            const isMyIntensive =
              !!(isVol && volunteerIntensive && workspace.workspaceUrl?.toLowerCase().includes(volunteerIntensive.toLowerCase()))
            const status = getWorkspaceStatus(workspace)
            const progress = getIntensiveProgress(workspace)
            const favorite = isFavorite?.(workspace.id) ?? false

            return (
              <div
                key={workspace.id}
                data-workspace-id={workspace.id}
                className={cn(
                  'group flex cursor-pointer flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-muted/30',
                  isMyIntensive && 'border-primary/40',
                )}
                onClick={(e) => handleRowClick(e, workspace)}
              >
                <div className="flex items-start gap-1">
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <button
                      type="button"
                      onClick={() => onOpenWorkspace(workspace)}
                      className="block max-w-full truncate rounded-sm text-left text-sm font-semibold outline-none hover:underline focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      title={workspace.workspaceName}
                    >
                      {workspace.workspaceName}
                    </button>
                    <p className="truncate font-mono text-xs text-muted-foreground" title={workspace.workspaceUrl}>
                      {shortUrl(workspace.workspaceUrl)}
                    </p>
                  </div>
                  {renderFavorite(workspace, favorite)}
                  {renderActions(workspace, showArchive)}
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  <WorkspaceBadges workspace={workspace} status={status} groupName={groupName} isMyIntensive={isMyIntensive} />
                </div>

                {progress !== null && (
                  <div className="space-y-1.5">
                    <Progress value={progress} className="h-1" />
                    <p className="text-xs text-muted-foreground">
                      {intensiveDates}
                      {endStatus && (
                        <span className={endStatus.warning ? 'font-medium text-amber-700 dark:text-amber-300' : undefined}>
                          {intensiveDates ? ' · ' : ''}
                          {endStatus.label}
                        </span>
                      )}
                    </p>
                  </div>
                )}

                <IntensiveLine workspace={workspace} />

                <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                  <p className="min-w-0 truncate text-xs text-muted-foreground">
                    <ActivityInfo workspace={workspace} isSup={isSup} />
                    {workspace.messageCountTotal !== undefined && (workspace.messageCountPending ?? 0) > 0 && (
                      <span> · {workspace.messageCountPending} в очереди</span>
                    )}
                  </p>
                  <Button size="sm" variant="outline" onClick={() => onOpenWorkspace(workspace)}>
                    Открыть
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!archiveTarget}
        onOpenChange={(open) => !open && setArchiveTarget(null)}
        title="Заархивировать пространство?"
        description={
          archiveTarget && (
            <>
              Пространство «{archiveTarget.workspaceName}» будет перемещено в архив. Все запланированные сообщения
              будут отменены. Через 2 недели пространство удаляется безвозвратно; до этого его можно восстановить в
              разделе «Архивы».
            </>
          )
        }
        confirmLabel={archiving ? 'Архивация…' : 'В архив'}
        destructive
        loading={archiving}
        onConfirm={handleArchive}
      />
    </>
  )
}
