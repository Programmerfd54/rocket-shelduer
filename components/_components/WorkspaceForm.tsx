"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  RefreshCw,
  Server,
  CheckCircle2,
  XCircle,
  Shield,
  Calendar,
  Copy,
  Archive,
  AlertTriangle,
  MessageSquare,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { formatRelativeTime } from '@/lib/utils'
import Link from 'next/link'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { useState } from 'react'
import { toast } from 'sonner'

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
  /** Назначено ADM SUP/ADMIN (видно только у ADM) */
  isAssigned?: boolean
  /** Многопользовательское (есть назначенные) или индивидуальное */
  isMultiUser?: boolean
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
  viewMode?: 'grid' | 'compact'
  groupNamesByWorkspaceId?: Record<string, string>
  isFavorite?: (workspaceId: string) => boolean
  onToggleFavorite?: (workspaceId: string) => void
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
    return { label: `Завершён ${days} ${days === 1 ? 'день' : 'дней'} назад`, warning: true }
  }
  const days = Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  if (days <= 7) return { label: `Завершится через ${days} ${days === 1 ? 'день' : 'дней'}`, warning: true }
  return { label: `До ${end.toLocaleDateString('ru-RU')}`, warning: false }
}

export default function WorkspaceForm({
  workspaces,
  onOpenWorkspace,
  onTestConnection,
  onArchive,
  loading,
  userRole = 'USER',
  volunteerExpiresAt,
  volunteerIntensive,
  viewMode = 'grid',
  groupNamesByWorkspaceId = {},
  isFavorite,
  onToggleFavorite,
}: WorkspaceFormProps) {
  const [archiveTarget, setArchiveTarget] = useState<Workspace | null>(null)
  const [archiving, setArchiving] = useState(false)

  const handleArchive = async () => {
    if (!archiveTarget || !onArchive) return
    setArchiving(true)
    try {
      await onArchive(archiveTarget.id)
      toast.success(`Пространство «${archiveTarget.workspaceName}» заархивировано`)
      setArchiveTarget(null)
    } catch {
      toast.error('Ошибка архивации')
    } finally {
      setArchiving(false)
    }
  }

  const handleCopyUrl = (e: React.MouseEvent, url: string) => {
    e.preventDefault()
    e.stopPropagation()
    navigator.clipboard.writeText(url)
    toast.success('Ссылка скопирована')
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16">
        <Spinner className="h-8 w-8 text-muted-foreground" />
      </div>
    )
  }

  if (workspaces.length === 0) {
    return (
      <Card className="rounded-xl border-border/80 border-dashed bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="rounded-xl bg-muted/50 p-4 mb-4">
            <Server className="h-8 w-8 text-muted-foreground" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Нет пространств</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
            Добавьте первое Rocket.Chat пространство, чтобы планировать отложенные сообщения
          </p>
        </CardContent>
      </Card>
    )
  }

  const isSup = userRole === 'SUPPORT' || userRole === 'ADMIN'
  const isVol = userRole === 'VOL'
  const canArchive = isSup && !!onArchive

  return (
    <>
      <div className={viewMode === 'compact' ? 'space-y-2' : 'grid gap-4 md:grid-cols-2 lg:grid-cols-3'}>
        {workspaces.map((workspace) => {
          const endStatus = getEndDateStatus(workspace.endDate)
          const intensiveDates = formatIntensiveDates(workspace.startDate, workspace.endDate)
          const isEnded = workspace.endDate && new Date(workspace.endDate) < new Date()
          const showArchive = canArchive && isEnded
          const groupName = groupNamesByWorkspaceId[workspace.id]
          const isMyIntensive = isVol && volunteerIntensive && workspace.workspaceUrl?.toLowerCase().includes(volunteerIntensive.toLowerCase())

          if (viewMode === 'compact') {
            return (
              <Card
                key={workspace.id}
                className="rounded-xl overflow-hidden cursor-pointer hover:bg-muted/50 hover:shadow-md transition-all flex flex-row border-l-4 border-border/80"
                style={{ borderLeftColor: workspace.color || '#ef4444' }}
                onClick={() => onOpenWorkspace(workspace)}
              >
                <CardContent className="flex flex-1 items-center gap-4 py-3 px-4">
                  <div className="w-10 h-10 rounded-lg shrink-0 flex items-center justify-center shadow-sm" style={{ backgroundColor: workspace.color || '#ef4444' }}>
                    <Server className="h-5 w-5 text-white" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 min-w-0 flex-wrap">
                      <p className="font-medium truncate">{workspace.workspaceName}</p>
                      {workspace.isAssigned && (
                        <Badge variant="secondary" className="text-[10px] shrink-0">Назначено</Badge>
                      )}
                      <Badge variant="outline" className="text-[10px] shrink-0" title={workspace.isMultiUser ? 'Есть назначенные участники' : 'Только владелец'}>
                        {workspace.isMultiUser ? 'Многопользовательское' : 'Индивидуальное'}
                      </Badge>
                    </div>
                    <p className="text-xs text-muted-foreground truncate">{workspace.workspaceUrl.replace(/^https?:\/\//, '')}</p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {workspace.messageCountPending !== undefined && workspace.messageCountPending > 0 && (
                      <Badge variant="secondary" className="text-xs" title="Ожидают отправки">
                        <MessageSquare className="h-3 w-3 mr-1" />
                        {workspace.messageCountPending}
                      </Badge>
                    )}
                    <Button size="sm" variant="ghost" onClick={(e) => { e.stopPropagation(); onTestConnection(workspace.id) }} title="Проверить подключение к Rocket.Chat" className="gap-1.5">
                      <RefreshCw className="h-4 w-4 shrink-0" />
                      <span className="hidden sm:inline">Проверить подключение</span>
                    </Button>
                    <Button size="sm" variant="outline" asChild>
                      <Link href={`/dashboard/calendar?workspaceId=${workspace.id}`} onClick={(e) => e.stopPropagation()} title="Календарь">
                        <Calendar className="h-4 w-4 mr-1" />
                        Календарь
                      </Link>
                    </Button>
                    <Button size="sm" onClick={(e) => { e.stopPropagation(); onOpenWorkspace(workspace) }}>Открыть</Button>
                  </div>
                </CardContent>
              </Card>
            )
          }

          return (
            <Card
              key={workspace.id}
              className={`rounded-xl overflow-hidden transition-all hover:shadow-md border-l-4 border-border/80 cursor-pointer ${isMyIntensive ? 'ring-2 ring-primary/30' : ''}`}
              style={{ borderLeftColor: workspace.color || '#ef4444' }}
              onClick={() => onOpenWorkspace(workspace)}
            >
              <div>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1 min-w-0 flex-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base font-semibold line-clamp-1">
                          {workspace.workspaceName}
                        </CardTitle>
                        {groupName && (
                          <Badge variant="outline" className="text-xs shrink-0">{groupName}</Badge>
                        )}
                        {workspace.isAssigned && (
                          <Badge variant="secondary" className="text-xs shrink-0">Назначено</Badge>
                        )}
                        {isMyIntensive && (
                          <Badge variant="default" className="text-xs shrink-0">Ваш интенсив</Badge>
                        )}
                        {isFavorite?.(workspace.id) && (
                          <span className="text-amber-500" title="В избранном">★</span>
                        )}
                      </div>
                      <CardDescription className="text-xs">
                        {workspace.username}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {endStatus?.warning && (
                        <span className="text-amber-600" title={endStatus.label}><AlertTriangle className="h-4 w-4" /></span>
                      )}
                      <div
                        className={`rounded-full p-1.5 ${workspace.isActive ? 'bg-green-100' : 'bg-muted'}`}
                        title={workspace.isActive ? 'Подключение активно' : 'Подключение неактивно'}
                      >
                        <Server className={`h-4 w-4 ${workspace.isActive ? 'text-green-600' : 'text-muted-foreground'}`} />
                      </div>
                    </div>
                  </div>
                </CardHeader>

                <CardContent className="space-y-4" onClick={(e) => e.stopPropagation()}>
                  <div className="rounded-xl bg-muted/30 p-3 border border-border/60">
                    <p className="text-xs text-muted-foreground mb-1">Адрес сервера</p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono truncate flex-1" title={workspace.workspaceUrl}>
                        {workspace.workspaceUrl.replace(/^https?:\/\//, '')}
                      </p>
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0" title="Копировать ссылку" onClick={(e) => { e.stopPropagation(); handleCopyUrl(e, workspace.workspaceUrl) }}>
                        <Copy className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>

                  {intensiveDates && (
                    <p className="text-xs text-muted-foreground">
                      Интенсив: {intensiveDates}
                      {endStatus && <span className={endStatus.warning ? ' text-amber-600 font-medium' : ''}> · {endStatus.label}</span>}
                    </p>
                  )}

                  <div className="flex items-center gap-2 flex-wrap">
                    <Badge variant={workspace.isActive ? 'default' : 'secondary'} className={`text-xs ${workspace.isActive ? 'bg-emerald-600 text-white hover:bg-emerald-600 border-0' : ''}`} title={workspace.isActive ? 'Подключение активно' : 'Подключение неактивно'}>
                      {workspace.isActive ? <><CheckCircle2 className="mr-1 h-3 w-3" aria-hidden />Активно</> : <><XCircle className="mr-1 h-3 w-3" aria-hidden />Неактивно</>}
                    </Badge>
                    <Badge variant="outline" className="text-xs" title={workspace.isMultiUser ? 'Есть назначенные участники' : 'Только владелец'}>
                      {workspace.isMultiUser ? 'Многопользовательское' : 'Индивидуальное'}
                    </Badge>
                    {workspace.has2FA && (
                      <Badge variant="outline" className="text-xs"><Shield className="mr-1 h-3 w-3" />2FA</Badge>
                    )}
                    {workspace.messageCountTotal !== undefined && (
                      <Badge variant="outline" className="text-xs" title="Ожидают отправки / всего сообщений">
                        <MessageSquare className="mr-1 h-3 w-3" />
                        {workspace.messageCountPending ?? 0} / {workspace.messageCountTotal}
                      </Badge>
                    )}
                  </div>

                  {isSup && (workspace.lastEmojiImport || workspace.lastUsersAdd) && (
                    <div className="text-xs text-muted-foreground space-y-0.5">
                      {workspace.lastEmojiImport && (
                        <p>Импорт эмодзи: {workspace.lastEmojiImport.userName || workspace.lastEmojiImport.userEmail} · {formatRelativeTime(workspace.lastEmojiImport.at)}</p>
                      )}
                      {workspace.lastUsersAdd && (
                        <p>Добавление пользователей: {workspace.lastUsersAdd.userName || workspace.lastUsersAdd.userEmail} · {formatRelativeTime(workspace.lastUsersAdd.at)}</p>
                      )}
                    </div>
                  )}

                  {workspace.lastConnected && (
                    <p className="text-xs text-muted-foreground">
                      Последнее подключение: {formatRelativeTime(workspace.lastConnected)}
                    </p>
                  )}

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button onClick={(e) => { e.stopPropagation(); onOpenWorkspace(workspace) }} className="flex-1 min-w-[100px]" size="sm">
                      Открыть
                    </Button>
                    <Button onClick={(e) => { e.stopPropagation(); onTestConnection(workspace.id) }} variant="outline" size="sm" className="px-3 gap-1.5" title="Проверить подключение к Rocket.Chat">
                      <RefreshCw className="h-4 w-4 shrink-0" />
                      Проверить подключение
                    </Button>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/calendar?workspaceId=${workspace.id}`} onClick={(e) => e.stopPropagation()}>
                        <Calendar className="h-4 w-4 mr-1" />
                        Календарь
                      </Link>
                    </Button>
                    {showArchive && (
                      <Button variant="outline" size="sm" className="text-amber-600 border-amber-200 hover:bg-amber-50" onClick={(e) => { e.stopPropagation(); setArchiveTarget(workspace) }}>
                        <Archive className="h-4 w-4 mr-1" />
                        В архив
                      </Button>
                    )}
                    {onToggleFavorite && (
                      <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); onToggleFavorite(workspace.id) }} title={isFavorite?.(workspace.id) ? 'Убрать из избранного' : 'В избранное'}>
                        {isFavorite?.(workspace.id) ? '★' : '☆'}
                      </Button>
                    )}
                  </div>
                </CardContent>
              </div>
            </Card>
          )
        })}
      </div>

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Заархивировать пространство?</AlertDialogTitle>
            <AlertDialogDescription>
              {archiveTarget && (
                <>Пространство «{archiveTarget.workspaceName}» будет перемещено в архивы. Через 2 недели его можно будет удалить.</>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction onClick={handleArchive} disabled={archiving}>
              {archiving ? 'Архивация…' : 'В архив'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
