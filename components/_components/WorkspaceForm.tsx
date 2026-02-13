"use client"

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip"
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
  Star,
  Activity,
  Wifi,
  WifiOff,
  TrendingUp,
  Clock,
} from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { formatRelativeTime } from '@/lib/utils'
import { Progress } from '@/components/ui/progress'
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
import { cn } from '@/lib/utils'

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

// Helper functions for workspace status
function getWorkspaceStatus(workspace: Workspace): 'active' | 'expiring' | 'expired' | 'inactive' {
  if (!workspace.endDate) return workspace.isActive ? 'active' : 'inactive'
  const now = new Date()
  const endDate = new Date(workspace.endDate)
  const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
  
  if (endDate < now) return 'expired'
  if (daysUntilEnd <= 7) return 'expiring'
  return 'active'
}

function getConnectionQuality(workspace: Workspace): 'excellent' | 'good' | 'fair' | 'poor' | 'unknown' {
  if (!workspace.lastConnected) return 'unknown'
  const hoursSinceConnection = Math.floor((Date.now() - new Date(workspace.lastConnected).getTime()) / (1000 * 60 * 60))
  
  if (hoursSinceConnection < 1) return 'excellent'
  if (hoursSinceConnection < 24) return 'good'
  if (hoursSinceConnection < 168) return 'fair'
  return 'poor'
}

function getLastActivityText(workspace: Workspace): string {
  if (!workspace.lastConnected) return 'Нет данных'
  const now = Date.now()
  const lastConnected = new Date(workspace.lastConnected).getTime()
  const diff = now - lastConnected
  
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
  return Math.min(100, Math.max(0, (elapsed / total) * 100))
}

function getStatusBorderColor(status: string): string {
  switch (status) {
    case 'active': return 'border-l-green-500'
    case 'expiring': return 'border-l-yellow-500'
    case 'expired': return 'border-l-red-500'
    case 'inactive': return 'border-l-gray-400'
    default: return 'border-l-gray-300'
  }
}

function getConnectionIcon(quality: string) {
  switch (quality) {
    case 'excellent':
    case 'good': return Wifi
    case 'fair':
    case 'poor': return WifiOff
    default: return Activity
  }
}

function getConnectionColor(quality: string): string {
  switch (quality) {
    case 'excellent': return 'text-green-500'
    case 'good': return 'text-blue-500'
    case 'fair': return 'text-yellow-500'
    case 'poor': return 'text-red-500'
    default: return 'text-gray-400'
  }
}

function getConnectionQualityText(quality: string): string {
  switch (quality) {
    case 'excellent': return 'Отлично'
    case 'good': return 'Хорошо'
    case 'fair': return 'Средне'
    case 'poor': return 'Плохо'
    default: return 'Неизвестно'
  }
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
      <Card className="rounded-xl border-border/80 border-dashed bg-muted/20 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_120%,rgba(120,119,198,0.1),rgba(255,255,255,0))]" />
        <CardContent className="relative flex flex-col items-center justify-center py-16">
          <div className="p-6 rounded-full bg-gradient-to-br from-blue-500/10 to-purple-500/10 mb-6">
            <Server className="h-12 w-12 text-primary" />
          </div>
          <h3 className="text-xl font-semibold mb-2">Пока нет пространств</h3>
          <p className="text-sm text-muted-foreground text-center max-w-md">
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
      <style jsx global>{`
        @keyframes fadeInUp {
          from {
            opacity: 0;
            transform: translateY(20px);
          }
          to {
            opacity: 1;
            transform: translateY(0);
          }
        }

        .workspace-card-animate {
          animation: fadeInUp 0.5s ease-out;
        }

        @keyframes pulse-ring {
          0% {
            transform: scale(0.95);
            opacity: 1;
          }
          50% {
            transform: scale(1.05);
            opacity: 0.7;
          }
          100% {
            transform: scale(0.95);
            opacity: 1;
          }
        }

        .pulse-ring {
          animation: pulse-ring 2s ease-in-out infinite;
        }
      `}</style>

      <div className={viewMode === 'compact' ? 'space-y-2' : 'grid gap-4 md:grid-cols-2 lg:grid-cols-3'}>
        {workspaces.map((workspace, index) => {
          const endStatus = getEndDateStatus(workspace.endDate)
          const intensiveDates = formatIntensiveDates(workspace.startDate, workspace.endDate)
          const isEnded = workspace.endDate && new Date(workspace.endDate) < new Date()
          const showArchive = canArchive && isEnded
          const groupName = groupNamesByWorkspaceId[workspace.id]
          const isMyIntensive = isVol && volunteerIntensive && workspace.workspaceUrl?.toLowerCase().includes(volunteerIntensive.toLowerCase())
          const status = getWorkspaceStatus(workspace)
          const connectionQuality = getConnectionQuality(workspace)
          const progress = getIntensiveProgress(workspace)
          const ConnectionIcon = getConnectionIcon(connectionQuality)
          const favorite = isFavorite?.(workspace.id) ?? false

          if (viewMode === 'compact') {
            return (
              <div
                key={workspace.id}
                className="workspace-card-animate opacity-0"
                style={{
                  animationDelay: `${index * 30}ms`,
                  animationFillMode: 'forwards'
                }}
              >
                
                <Card
                  className={cn(
                    "rounded-xl overflow-hidden cursor-pointer transition-all duration-300 flex flex-row border-l-4",
                    "hover:shadow-lg hover:-translate-y-0.5",
                    getStatusBorderColor(status),
                    favorite && "ring-2 ring-yellow-400/50 shadow-md"
                  )}
                  onClick={() => onOpenWorkspace(workspace)}
                >
                  <CardContent className="flex flex-1 items-center gap-4 py-3 px-4">
                    
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <div className="relative">
                            <div 
                              className={cn(
                                "w-10 h-10 rounded-lg shrink-0 flex items-center justify-center shadow-sm transition-all duration-300",
                                status === 'active' && "bg-green-100 dark:bg-green-950",
                                status === 'expiring' && "bg-yellow-100 dark:bg-yellow-950",
                                status === 'expired' && "bg-red-100 dark:bg-red-950",
                                status === 'inactive' && "bg-gray-100 dark:bg-gray-950"
                              )}
                            >
                              <Server className={cn(
                                "h-5 w-5",
                                status === 'active' && "text-green-600 dark:text-green-400",
                                status === 'expiring' && "text-yellow-600 dark:text-yellow-400",
                                status === 'expired' && "text-red-600 dark:text-red-400",
                                status === 'inactive' && "text-gray-600 dark:text-gray-400"
                              )} />
                            </div>
                            {connectionQuality !== 'unknown' && (
                              <div className="absolute -bottom-1 -right-1">
                                <div className={cn(
                                  "h-3 w-3 rounded-full border-2 border-background",
                                  connectionQuality === 'excellent' && "bg-green-500 pulse-ring",
                                  connectionQuality === 'good' && "bg-blue-500",
                                  connectionQuality === 'fair' && "bg-yellow-500",
                                  connectionQuality === 'poor' && "bg-red-500"
                                )} />
                              </div>
                            )}
                          </div>
                        </TooltipTrigger>
                        <TooltipContent>
                          <div className="text-xs space-y-1">
                            <p className="font-medium">Статус: {status === 'active' ? 'Активен' : status === 'expiring' ? 'Скоро истекает' : status === 'expired' ? 'Истёк' : 'Неактивен'}</p>
                            <p className="text-muted-foreground">Подключение: {getConnectionQualityText(connectionQuality)}</p>
                          </div>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

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
                      <div className="flex items-center gap-2 mt-1">
                        <p className="text-xs text-muted-foreground truncate">{workspace.workspaceUrl.replace(/^https?:\/\//, '')}</p>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="flex items-center gap-1 text-xs text-muted-foreground shrink-0">
                                <Activity className="h-3 w-3" />
                                <span>{getLastActivityText(workspace)}</span>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <p className="text-xs">Последняя активность</p>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      {(workspace.todayIntensiveDay != null && workspace.totalIntensiveDays != null) && (
                        <div className="mt-1 space-y-0.5 text-[11px] text-muted-foreground">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                            <span>День {workspace.todayIntensiveDay} из {workspace.totalIntensiveDays}</span>
                            {workspace.messageDueToday !== undefined && (
                              <span className={workspace.messageDueToday ? 'text-primary font-medium' : ''}>
                                {workspace.messageDueToday ? 'Отправить по шаблонам' : 'По шаблонам нет'}
                              </span>
                            )}
                          </div>
                          {workspace.nextAnnouncementDay != null && workspace.nextAnnouncementChannels && workspace.nextAnnouncementChannels.length > 0 && (
                            <span>
                              След. анонс: День {workspace.nextAnnouncementDay} · {workspace.nextAnnouncementChannels.map((c) => `#${c.replace(/^#/, '')}`).join(', ')}
                            </span>
                          )}
                        </div>
                      )}
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      {workspace.messageCountPending !== undefined && workspace.messageCountPending > 0 && (
                        <Badge variant="secondary" className="text-xs" title="Ожидают отправки">
                          <MessageSquare className="h-3 w-3 mr-1" />
                          {workspace.messageCountPending}
                        </Badge>
                      )}
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              size="sm" 
                              variant="ghost" 
                              onClick={(e) => { e.stopPropagation(); onTestConnection(workspace.id) }}
                              className="gap-1.5"
                            >
                              <RefreshCw className="h-4 w-4 shrink-0" />
                              <span className="hidden sm:inline">Проверить</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Проверить подключение к Rocket.Chat</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                      <Button size="sm" onClick={(e) => { e.stopPropagation(); onOpenWorkspace(workspace) }}>Открыть</Button>
                    </div>
                  </CardContent>
                </Card>
              </div>
            )
          }

          return (
            <div
              key={workspace.id}
              className="workspace-card-animate opacity-0"
              style={{
                animationDelay: `${index * 50}ms`,
                animationFillMode: 'forwards'
              }}
            >
              <Card
                className={cn(
                  "rounded-xl overflow-hidden transition-all duration-300 border-l-4 cursor-pointer h-full",
                  "hover:shadow-lg hover:-translate-y-1",
                  getStatusBorderColor(status),
                  favorite && "ring-2 ring-yellow-400/50 shadow-md",
                  isMyIntensive && "ring-2 ring-primary/30"
                )}
                onClick={() => onOpenWorkspace(workspace)}
              >
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-3 flex-1 min-w-0">
                      <div className="relative">
                        <div className={cn(
                          "p-2.5 rounded-lg transition-all duration-300",
                          status === 'active' && "bg-green-100 dark:bg-green-950",
                          status === 'expiring' && "bg-yellow-100 dark:bg-yellow-950",
                          status === 'expired' && "bg-red-100 dark:bg-red-950",
                          status === 'inactive' && "bg-gray-100 dark:bg-gray-950"
                        )}>
                          <Server className={cn(
                            "h-5 w-5",
                            status === 'active' && "text-green-600 dark:text-green-400",
                            status === 'expiring' && "text-yellow-600 dark:text-yellow-400",
                            status === 'expired' && "text-red-600 dark:text-red-400",
                            status === 'inactive' && "text-gray-600 dark:text-gray-400"
                          )} />
                        </div>
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="absolute -bottom-1 -right-1">
                                {connectionQuality !== 'unknown' && (
                                  <div className={cn(
                                    "h-3 w-3 rounded-full border-2 border-background",
                                    connectionQuality === 'excellent' && "bg-green-500 pulse-ring",
                                    connectionQuality === 'good' && "bg-blue-500",
                                    connectionQuality === 'fair' && "bg-yellow-500",
                                    connectionQuality === 'poor' && "bg-red-500"
                                  )} />
                                )}
                              </div>
                            </TooltipTrigger>
                            <TooltipContent>
                              <div className="text-xs">
                                <p className="font-medium">Качество подключения</p>
                                <p className="text-muted-foreground">{getConnectionQualityText(connectionQuality)}</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>
                      </div>
                      
                      <div className="flex-1 min-w-0">
                        <TooltipProvider>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <div className="space-y-1">
                                <div className="flex items-center gap-2 flex-wrap">
                                  <CardTitle className="text-base font-semibold line-clamp-1 cursor-help">
                                    {workspace.workspaceName}
                                  </CardTitle>
                                  {groupName && (
                                    <Badge variant="outline" className="text-xs shrink-0">{groupName}</Badge>
                                  )}
                                </div>
                                <CardDescription className="text-xs">
                                  {workspace.username}
                                </CardDescription>
                              </div>
                            </TooltipTrigger>
                            <TooltipContent className="max-w-xs">
                              <div className="space-y-1 text-xs">
                                <p className="font-medium">{workspace.workspaceName}</p>
                                <p className="text-muted-foreground">{workspace.workspaceUrl}</p>
                                {groupName && <p className="text-primary">Группа: {groupName}</p>}
                                <p className="text-muted-foreground">Логин: {workspace.username}</p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </TooltipProvider>

                        <div className="flex items-center gap-2 mt-1.5">
                          <TooltipProvider>
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <div className="flex items-center gap-1 text-xs text-muted-foreground">
                                  <Activity className="h-3 w-3" />
                                  <span>{getLastActivityText(workspace)}</span>
                                </div>
                              </TooltipTrigger>
                              <TooltipContent>
                                <p className="text-xs">Последняя активность</p>
                               
                              </TooltipContent>
                            </Tooltip>
                          </TooltipProvider>
                        </div>
                      </div>
                    </div>

                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 shrink-0 hover:bg-transparent"
                      onClick={(e) => {
                        e.stopPropagation()
                        onToggleFavorite?.(workspace.id)
                      }}
                    >
                      <Star className={cn(
                        "h-5 w-5 transition-all duration-300",
                        favorite ? "fill-yellow-400 text-yellow-400 scale-110" : "text-muted-foreground hover:text-yellow-400"
                      )} />
                    </Button>
                  </div>
                </CardHeader>

                <CardContent className="space-y-3" onClick={(e) => e.stopPropagation()}>
                  {/* Progress bar for intensives */}
                  {progress !== null && (
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between text-xs">
                        <span className="text-muted-foreground flex items-center gap-1">
                          <TrendingUp className="h-3 w-3" />
                          Прогресс интенсива
                        </span>
                        <span className="font-medium">{Math.round(progress)}%</span>
                      </div>
                      <Progress value={progress} className={cn(
                        "h-2 transition-all",
                        status === 'expiring' && "[&>div]:bg-yellow-500",
                        status === 'expired' && "[&>div]:bg-red-500"
                      )} />
                      {intensiveDates && (
                        <p className="text-xs text-muted-foreground">
                          {intensiveDates}
                          {endStatus && <span className={endStatus.warning ? ' text-amber-600 font-medium' : ''}> · {endStatus.label}</span>}
                        </p>
                      )}
                    </div>
                  )}

                  <div className="rounded-xl bg-muted/30 p-3 border border-border/60 hover:bg-muted/50 transition-colors">
                    <p className="text-xs text-muted-foreground mb-1.5 flex items-center gap-1">
                      <Server className="h-3 w-3" />
                      Адрес сервера
                    </p>
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-mono truncate flex-1" title={workspace.workspaceUrl}>
                        {workspace.workspaceUrl.replace(/^https?:\/\//, '')}
                      </p>
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8 shrink-0" 
                              onClick={(e) => handleCopyUrl(e, workspace.workspaceUrl)}
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Копировать ссылку</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    </div>
                  </div>

                  {/* Status badges */}
                  <div className="flex items-center gap-2 flex-wrap">
                    {status === 'active' && (
                      <Badge variant="secondary" className="text-xs bg-green-100 text-green-700 dark:bg-green-950 dark:text-green-400">
                        <CheckCircle2 className="mr-1 h-3 w-3" />
                        Активен
                      </Badge>
                    )}
                    {status === 'expiring' && (
                      <Badge variant="secondary" className="text-xs bg-yellow-100 text-yellow-700 dark:bg-yellow-950 dark:text-yellow-400">
                        <Clock className="h-3 w-3 mr-1" />
                        Скоро истекает
                      </Badge>
                    )}
                    {status === 'expired' && (
                      <Badge variant="secondary" className="text-xs bg-red-100 text-red-700 dark:bg-red-950 dark:text-red-400">
                        <XCircle className="mr-1 h-3 w-3" />
                        Истёк
                      </Badge>
                    )}
                    {status === 'inactive' && (
                      <Badge variant="secondary" className="text-xs">
                        <XCircle className="mr-1 h-3 w-3" />
                        Неактивен
                      </Badge>
                    )}
                    
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Badge variant="outline" className="text-xs">
                            <ConnectionIcon className={cn("mr-1 h-3 w-3", getConnectionColor(connectionQuality))} />
                            {getConnectionQualityText(connectionQuality)}
                          </Badge>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Качество подключения</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    {workspace.isAssigned && (
                      <Badge variant="secondary" className="text-xs">Назначено</Badge>
                    )}
                    {isMyIntensive && (
                      <Badge variant="default" className="text-xs">Ваш интенсив</Badge>
                    )}
                    {workspace.has2FA && (
                      <Badge variant="outline" className="text-xs">
                        <Shield className="mr-1 h-3 w-3" />
                        2FA
                      </Badge>
                    )}
                    {workspace.messageCountTotal !== undefined && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Badge variant="outline" className="text-xs">
                              <MessageSquare className="mr-1 h-3 w-3" />
                              {workspace.messageCountPending ?? 0} / {workspace.messageCountTotal}
                            </Badge>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Ожидают отправки / всего сообщений</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                    <Badge variant="outline" className="text-[10px] shrink-0" title={workspace.isMultiUser ? 'Есть назначенные участники' : 'Только владелец'}>
                      {workspace.isMultiUser ? 'Многопользовательское' : 'Индивидуальное'}
                    </Badge>
                  </div>

                  {(workspace.todayIntensiveDay != null && workspace.totalIntensiveDays != null) && (
                    <div className="flex flex-col gap-1 text-xs text-muted-foreground">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <span className="font-medium">Сегодня: День {workspace.todayIntensiveDay} из {workspace.totalIntensiveDays}</span>
                        {workspace.messageDueToday !== undefined && (
                          <span className={workspace.messageDueToday ? 'text-primary font-medium' : ''}>
                            По шаблонам: {workspace.messageDueToday ? 'отправить сегодня' : 'отправки нет'}
                          </span>
                        )}
                      </div>
                      {workspace.nextAnnouncementDay != null && workspace.nextAnnouncementChannels && workspace.nextAnnouncementChannels.length > 0 && (
                        <p className="text-[11px]">
                          След. анонс: День {workspace.nextAnnouncementDay}
                          {workspace.nextAnnouncementChannels.length > 0 && (
                            <span className="ml-1">
                              · {workspace.nextAnnouncementChannels.map((c) => `#${c.replace(/^#/, '')}`).join(', ')}
                            </span>
                          )}
                        </p>
                      )}
                    </div>
                  )}

                  {isSup && (workspace.lastEmojiImport || workspace.lastUsersAdd) && (
                    <div className="text-xs text-muted-foreground space-y-0.5 pt-1">
                      {workspace.lastEmojiImport && (
                        <p>Импорт эмодзи: {workspace.lastEmojiImport.userName || workspace.lastEmojiImport.userEmail} · {formatRelativeTime(workspace.lastEmojiImport.at)}</p>
                      )}
                      {workspace.lastUsersAdd && (
                        <p>Добавление пользователей: {workspace.lastUsersAdd.userName || workspace.lastUsersAdd.userEmail} · {formatRelativeTime(workspace.lastUsersAdd.at)}</p>
                      )}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-2 pt-2">
                    <Button 
                      onClick={(e) => { e.stopPropagation(); onOpenWorkspace(workspace) }} 
                      className="flex-1 min-w-[100px]" 
                      size="sm"
                    >
                      Открыть
                    </Button>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button 
                            onClick={(e) => { e.stopPropagation(); onTestConnection(workspace.id) }} 
                            variant="outline" 
                            size="sm" 
                            className="px-3 gap-1.5"
                          >
                            <RefreshCw className="h-4 w-4 shrink-0" />
                            <span className="hidden sm:inline">Проверить</span>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>
                          <p className="text-xs">Проверить подключение к Rocket.Chat</p>
                        </TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                    <Button variant="outline" size="sm" asChild>
                      <Link href={`/dashboard/calendar?workspaceId=${workspace.id}`} onClick={(e) => e.stopPropagation()}>
                        <Calendar className="h-4 w-4 mr-1" />
                        <span className="hidden sm:inline">Календарь</span>
                      </Link>
                    </Button>
                    {showArchive && (
                      <TooltipProvider>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Button 
                              variant="outline" 
                              size="sm" 
                              className="text-amber-600 border-amber-200 hover:bg-amber-50 dark:hover:bg-amber-950/20" 
                              onClick={(e) => { e.stopPropagation(); setArchiveTarget(workspace) }}
                            >
                              <Archive className="h-4 w-4 mr-1" />
                              <span className="hidden sm:inline">В архив</span>
                            </Button>
                          </TooltipTrigger>
                          <TooltipContent>
                            <p className="text-xs">Заархивировать пространство</p>
                          </TooltipContent>
                        </Tooltip>
                      </TooltipProvider>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
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