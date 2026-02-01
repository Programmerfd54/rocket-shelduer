"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import {
  Hash,
  Clock,
  CheckCircle2,
  XCircle,
  MoreVertical,
  Search,
  Filter,
  Calendar,
  X,
  LayoutList,
  LayoutGrid
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn, getInitials, generateAvatarColor, getChannelTagColors, messageStatusBadgeClasses } from '@/lib/utils'
import { EmptyState } from '@/components/common/EmptyState'
import { VirtualList } from '@/components/_components/VirtualList'

interface CompactMessagesProps {
  messages: any[]
  onEdit?: (message: any) => void
  onDelete?: (messageId: string) => void
  /** Повторить отправку для сообщения со статусом FAILED */
  onRetry?: (messageId: string) => void | Promise<void>
  /** При открытии вкладки «Сообщения» по клику на карточку статистики — начальный фильтр по статусу */
  initialStatusFilter?: string | null
}

export default function CompactMessages({ messages = [], onEdit, onDelete, onRetry, initialStatusFilter }: CompactMessagesProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter && ['all', 'PENDING', 'SENT', 'FAILED'].includes(initialStatusFilter) ? initialStatusFilter : 'all')
  const [dateFilter, setDateFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'compact' | 'expanded'>('expanded')

  useEffect(() => {
    if (initialStatusFilter && ['all', 'PENDING', 'SENT', 'FAILED'].includes(initialStatusFilter)) {
      setStatusFilter(initialStatusFilter)
    }
  }, [initialStatusFilter])

  // Фильтрация
  const filteredMessages = (messages ?? []).filter((msg) => {
    const matchesSearch =
      (msg.message ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (msg.channelName ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  
    const matchesStatus =
      statusFilter === 'all' || msg.status === statusFilter
  
    let matchesDate = true
    if (dateFilter !== 'all') {
      const msgDate = new Date(msg.scheduledFor)
      const now = new Date()
  
      if (dateFilter === 'today') matchesDate = msgDate.toDateString() === now.toDateString()
      if (dateFilter === 'week') matchesDate = msgDate >= now && msgDate <= new Date(now.getTime() + 7 * 86400000)
      if (dateFilter === 'month') matchesDate = msgDate >= now && msgDate <= new Date(now.getTime() + 30 * 86400000)
    }
  
    return matchesSearch && matchesStatus && matchesDate
  })
  
  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'PENDING':
        return <Clock className="w-3.5 h-3.5 text-yellow-600" />
      case 'SENT':
        return <CheckCircle2 className="w-3.5 h-3.5 text-green-600" />
      case 'FAILED':
        return <XCircle className="w-3.5 h-3.5 text-red-600" />
      default:
        return null
    }
  }

  const getStatusBadge = (status: string) => {
    const cls = messageStatusBadgeClasses[status]
    const labels: Record<string, string> = { PENDING: 'Ожидает', SENT: 'Отправлено', FAILED: 'Ошибка', CANCELLED: 'Отменено' }
    if (status === 'FAILED') return <Badge variant="destructive" className="text-xs">Ошибка</Badge>
    if (status === 'CANCELLED') return <Badge variant="outline" className="text-xs">Отменено</Badge>
    if (cls) return <Badge className={cls}>{labels[status] ?? status}</Badge>
    return <Badge className="text-xs">{status}</Badge>
  }

  const getExternalStatusBadge = (externalStatus?: string) => {
    if (!externalStatus || externalStatus === 'SYNCHRONIZED' || externalStatus === 'UNKNOWN') {
      return null
    }

    if (externalStatus === 'DELETED_IN_RC') {
      return (
        <Badge variant="destructive" className="text-xs">
          Удалено в Rocket.Chat
        </Badge>
      )
    }

    if (externalStatus === 'EDITED_IN_RC') {
      return (
        <Badge variant="outline" className="text-xs border-blue-400 text-blue-700 dark:text-blue-200 dark:border-blue-500">
          Изменено в Rocket.Chat
        </Badge>
      )
    }

    return null
  }

  const hasActiveFilters = searchQuery || statusFilter !== 'all' || dateFilter !== 'all'

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setDateFilter('all')
  }

  return (
    <div className="space-y-5">
      {/* Filters block */}
      <Card className="border-border/80 bg-card shadow-sm overflow-hidden rounded-xl">
        <div className="px-4 py-3 border-b border-border/60 bg-muted/30">
          <h3 className="text-sm font-semibold text-foreground flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            Фильтры
          </h3>
        </div>
        <CardContent className="p-4">
          <div className="space-y-4">
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Поиск по сообщениям и каналам..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 h-10 rounded-lg bg-background border-border/80"
              />
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery('')}
                  className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 hover:bg-muted/50 transition-colors"
                >
                  <X className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                </button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs font-medium text-muted-foreground mr-1">Статус:</span>
              {['all', 'PENDING', 'SENT', 'FAILED'].map((status) => (
                <Button
                  key={status}
                  variant={statusFilter === status ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 rounded-md text-xs font-medium"
                  onClick={() => setStatusFilter(status)}
                >
                  {status === 'all' && 'Все'}
                  {status === 'PENDING' && '⏳ Ожидает'}
                  {status === 'SENT' && '✓ Отправлено'}
                  {status === 'FAILED' && '✗ Ошибки'}
                </Button>
              ))}
              <span className="w-px h-4 bg-border mx-1" aria-hidden />
              <Calendar className="w-4 h-4 text-muted-foreground shrink-0" />
              {['all', 'today', 'week', 'month'].map((date) => (
                <Button
                  key={date}
                  variant={dateFilter === date ? 'default' : 'outline'}
                  size="sm"
                  className="h-8 rounded-md text-xs font-medium"
                  onClick={() => setDateFilter(date)}
                >
                  {date === 'all' && 'Все'}
                  {date === 'today' && 'Сегодня'}
                  {date === 'week' && 'Неделя'}
                  {date === 'month' && 'Месяц'}
                </Button>
              ))}
              {hasActiveFilters && (
                <Button variant="ghost" size="sm" className="h-8 rounded-md text-xs" onClick={clearFilters}>
                  <X className="w-3.5 h-3.5 mr-1" />
                  Сбросить
                </Button>
              )}
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-xs text-muted-foreground">
                Показано {filteredMessages.length} из {messages.length} сообщений
              </p>
              <div className="flex gap-1 ml-auto">
                <Button
                  variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setViewMode('compact')}
                  title="Компактный вид (время и канал)"
                  aria-label="Компактный вид"
                >
                  <LayoutList className="w-4 h-4" />
                </Button>
                <Button
                  variant={viewMode === 'expanded' ? 'secondary' : 'ghost'}
                  size="sm"
                  className="h-8 w-8 p-0"
                  onClick={() => setViewMode('expanded')}
                  title="Развёрнутый вид (полная карточка)"
                  aria-label="Развёрнутый вид"
                >
                  <LayoutGrid className="w-4 h-4" />
                </Button>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Message list */}
      <div className={cn(viewMode === 'compact' && "space-y-1")}>
        {filteredMessages.length === 0 ? (
          <EmptyState
            icon={<Search className="w-8 h-8" />}
            title={hasActiveFilters ? 'Сообщения не найдены' : 'Нет сообщений'}
            description={hasActiveFilters ? 'Попробуйте изменить фильтры или поиск' : undefined}
            children={hasActiveFilters ? (
              <Button variant="outline" size="sm" className="mt-4 rounded-lg" onClick={clearFilters}>
                Сбросить фильтры
              </Button>
            ) : null}
          />
        ) : (
          <VirtualList
            items={filteredMessages}
            height="min(60vh, 520px)"
            estimateSize={viewMode === 'compact' ? 48 : 112}
            getItemKey={(m: any) => m.id}
            renderItem={(message: any) => {
              const channelTagColors = getChannelTagColors(message.channelName || '')
              const timeStr = new Date(message.scheduledFor).toLocaleString('ru-RU', {
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit'
              })
              if (viewMode === 'compact') {
                return (
                  <div className="pb-2">
                    <Card className="border-border/80 bg-card rounded-lg shadow-sm hover:shadow-md hover:border-primary/20 transition-all overflow-hidden">
                      <CardContent className="py-2 px-3 flex items-center gap-2 flex-wrap">
                        <div className="shrink-0">{getStatusIcon(message.status)}</div>
                        <span className="text-xs text-muted-foreground tabular-nums shrink-0">{timeStr}</span>
                        <div className={cn(
                          "inline-flex items-center gap-1 rounded pl-1.5 pr-2 py-0.5 text-xs font-medium shrink-0 min-w-0 max-w-[140px]",
                          channelTagColors.bar,
                          channelTagColors.bg,
                          channelTagColors.text
                        )}>
                          <Hash className="w-3 h-3 shrink-0 opacity-80" />
                          <span className="truncate">#{message.channelName}</span>
                        </div>
                        {getStatusBadge(message.status)}
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button variant="ghost" size="sm" className="h-6 w-6 p-0 ml-auto shrink-0" aria-label="Действия">
                              <MoreVertical className="w-3.5 h-3.5" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            {message.status === 'FAILED' && onRetry && (
                              <DropdownMenuItem onClick={() => onRetry(message.id)}>Повторить отправку</DropdownMenuItem>
                            )}
                            {(message.status === 'PENDING' || message.status === 'SENT') && onEdit && (
                              <DropdownMenuItem onClick={() => onEdit(message)}>
                                {message.status === 'SENT' ? 'Редактировать в RC' : 'Изменить'}
                              </DropdownMenuItem>
                            )}
                            {message.status !== 'SENT' && onDelete && (
                              <DropdownMenuItem onClick={() => onDelete(message.id)} className="text-destructive">Удалить</DropdownMenuItem>
                            )}
                            <DropdownMenuItem>Дублировать</DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </CardContent>
                    </Card>
                  </div>
                )
              }
              return (
                <div className="pb-3">
                  <Card className="border-border/80 bg-card rounded-xl shadow-sm hover:shadow-md hover:border-primary/20 transition-all overflow-hidden">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-3">
                        <div className="shrink-0 mt-0.5">{getStatusIcon(message.status)}</div>
                        <div className="flex-1 min-w-0 space-y-2">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-center gap-2 flex-wrap">
                              <div className={cn(
                                "inline-flex items-center gap-1.5 rounded-md border-l-4 pl-2 pr-2 py-0.5 w-fit",
                                channelTagColors.bar,
                                channelTagColors.bg,
                                channelTagColors.text
                              )}>
                                <Hash className="w-3.5 h-3.5 shrink-0 opacity-80" />
                                <span className="text-sm font-semibold truncate max-w-[160px]">#{message.channelName}</span>
                              </div>
                              {getStatusBadge(message.status)}
                              {getExternalStatusBadge(message.externalStatus)}
                            </div>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" aria-label="Действия">
                                  <MoreVertical className="w-4 h-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                {message.status === 'FAILED' && onRetry && (
                                  <DropdownMenuItem onClick={() => onRetry(message.id)}>Повторить отправку</DropdownMenuItem>
                                )}
                                {(message.status === 'PENDING' || message.status === 'SENT') && onEdit && (
                                  <DropdownMenuItem onClick={() => onEdit(message)}>
                                    {message.status === 'SENT' ? 'Редактировать в Rocket.Chat' : 'Изменить'}
                                  </DropdownMenuItem>
                                )}
                                {message.status !== 'SENT' && onDelete && (
                                  <DropdownMenuItem onClick={() => onDelete(message.id)} className="text-destructive">Удалить</DropdownMenuItem>
                                )}
                                <DropdownMenuItem>Дублировать</DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                          <p className="text-sm text-foreground/80 line-clamp-2">{message.message}</p>
                          <div className="flex items-center gap-3 text-xs text-muted-foreground flex-wrap">
                            <div className="flex items-center gap-1.5">
                              <Clock className="w-3 h-3 shrink-0" />
                              <span>{timeStr}</span>
                            </div>
                            {message.user && (message.user.name || message.user.email) && (
                              <>
                                <span className="text-border">•</span>
                                <div className="flex items-center gap-1.5 truncate min-w-0">
                                  <Avatar className="h-5 w-5 shrink-0">
                                    {message.user.avatarUrl && <AvatarImage src={message.user.avatarUrl} alt="" />}
                                    <AvatarFallback className={`text-[8px] font-semibold text-white ${generateAvatarColor(message.user.email)}`}>
                                      {getInitials(message.user.name || message.user.email)}
                                    </AvatarFallback>
                                  </Avatar>
                                  <span className="truncate" title="От имени">От: {message.user.name || message.user.email}</span>
                                </div>
                              </>
                            )}
                            {message.scheduledBy && (message.scheduledBy.name || message.scheduledBy.email) && (
                              <><span className="text-border">•</span><span className="truncate text-amber-600 dark:text-amber-500">Запланировано: {message.scheduledBy.name || message.scheduledBy.email}</span></>
                            )}
                            {message.workspace && (
                              <><span className="text-border">•</span><span className="truncate">{message.workspace.workspaceName}</span>
                                {message.workspace.username && <><span className="text-border">•</span><span className="truncate">@{message.workspace.username}</span></>}
                              </>
                            )}
                          </div>
                          {message.status === 'FAILED' && message.error && (
                            <div className="bg-destructive/10 border border-destructive/20 rounded-md p-2">
                              <p className="text-xs text-destructive">Ошибка: {message.error}</p>
                            </div>
                          )}
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                </div>
              )
            }}
          />
        )}
      </div>
    </div>
  )
}