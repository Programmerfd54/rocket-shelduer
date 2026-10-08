"use client"

import { useState, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { MessageStatusBadge } from '@/components/common/MessageStatusBadge'
import { sanitizeErrorReason } from '@/lib/message-status'
import { Input } from '@/components/ui/input'
import { MoreVertical, Search, X, LayoutList, Rows3 } from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn, getInitials, generateAvatarColor } from '@/lib/utils'
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

const STATUS_FILTERS = ['all', 'PENDING', 'SENT', 'FAILED']
const STATUS_FILTER_LABELS: Record<string, string> = { all: 'Все', PENDING: 'Ожидают отправки', SENT: 'Отправлено', FAILED: 'Не отправлено' }
const DATE_FILTERS = ['all', 'today', 'week', 'month']
const DATE_FILTER_LABELS: Record<string, string> = { all: 'Любая дата', today: 'Сегодня', week: 'Неделя', month: 'Месяц' }

/** Цвет точки — лишь дополнение к тексту статуса (сам статус — MessageStatusBadge) */
const STATUS_DOT: Record<string, string> = {
  PENDING: 'bg-amber-500',
  SENT: 'bg-emerald-500',
  FAILED: 'bg-red-500',
  CANCELLED: 'bg-muted-foreground/50',
}

export default function CompactMessages({ messages = [], onEdit, onDelete, onRetry, initialStatusFilter }: CompactMessagesProps) {
  const [searchQuery, setSearchQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState(initialStatusFilter && STATUS_FILTERS.includes(initialStatusFilter) ? initialStatusFilter : 'all')
  const [dateFilter, setDateFilter] = useState('all')
  const [viewMode, setViewMode] = useState<'compact' | 'expanded'>('expanded')

  useEffect(() => {
    if (initialStatusFilter && STATUS_FILTERS.includes(initialStatusFilter)) {
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
  
  const getStatusBadge = (message: any, compact = false) => (
    <MessageStatusBadge status={message.status} scheduledFor={message.scheduledFor} compact={compact} />
  )

  const getExternalStatusBadge = (externalStatus?: string) => {
    if (externalStatus === 'DELETED_IN_RC') return <Badge variant="danger">Удалено в Rocket.Chat</Badge>
    if (externalStatus === 'EDITED_IN_RC') return <Badge variant="info">Изменено в Rocket.Chat</Badge>
    return null
  }

  const hasActiveFilters = searchQuery || statusFilter !== 'all' || dateFilter !== 'all'

  const clearFilters = () => {
    setSearchQuery('')
    setStatusFilter('all')
    setDateFilter('all')
  }

  const renderActions = (message: any) => {
    const canRetry = message.status === 'FAILED' && onRetry
    const canEdit = (message.status === 'PENDING' || message.status === 'SENT') && onEdit
    const canDelete = message.status !== 'SENT' && onDelete
    if (!canRetry && !canEdit && !canDelete) return null
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="ghost" size="icon-sm" className="shrink-0" aria-label="Действия с сообщением">
            <MoreVertical />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canRetry && <DropdownMenuItem onClick={() => onRetry?.(message.id)}>Повторить отправку</DropdownMenuItem>}
          {canEdit && (
            <DropdownMenuItem onClick={() => onEdit?.(message)}>
              {message.status === 'SENT' ? 'Редактировать в Rocket.Chat' : 'Изменить'}
            </DropdownMenuItem>
          )}
          {canDelete && (
            <DropdownMenuItem onClick={() => onDelete?.(message.id)} className="text-destructive focus:text-destructive">
              Удалить
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    )
  }

  const segmentClass = (active: boolean) =>
    cn(
      'rounded-md px-2.5 py-1 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40',
      active ? 'bg-secondary text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
    )

  return (
    <div className="space-y-3">
      {/* Фильтры */}
      <div className="space-y-2">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Поиск по тексту и каналу…"
            aria-label="Поиск по сообщениям и каналам"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-8 pr-8"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery('')}
              aria-label="Очистить поиск"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
            >
              <X className="size-4" />
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Фильтр по статусу">
            {STATUS_FILTERS.map((status) => (
              <button
                type="button"
                key={status}
                aria-pressed={statusFilter === status}
                className={segmentClass(statusFilter === status)}
                onClick={() => setStatusFilter(status)}
              >
                {STATUS_FILTER_LABELS[status]}
              </button>
            ))}
          </div>
          <span className="hidden h-4 w-px bg-border sm:block" aria-hidden />
          <div className="flex flex-wrap items-center gap-0.5" role="group" aria-label="Фильтр по дате">
            {DATE_FILTERS.map((date) => (
              <button
                type="button"
                key={date}
                aria-pressed={dateFilter === date}
                className={segmentClass(dateFilter === date)}
                onClick={() => setDateFilter(date)}
              >
                {DATE_FILTER_LABELS[date]}
              </button>
            ))}
          </div>
          {hasActiveFilters && (
            <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={clearFilters}>
              <X /> Сбросить
            </Button>
          )}
          <div className="ml-auto flex items-center gap-2">
            <p className="text-xs text-muted-foreground tabular-nums">
              {filteredMessages.length} из {messages.length}
            </p>
            <div className="flex gap-0.5" role="group" aria-label="Вид списка">
              <Button
                variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
                size="icon-sm"
                onClick={() => setViewMode('compact')}
                title="Компактный вид"
                aria-label="Компактный вид"
                aria-pressed={viewMode === 'compact'}
              >
                <LayoutList />
              </Button>
              <Button
                variant={viewMode === 'expanded' ? 'secondary' : 'ghost'}
                size="icon-sm"
                onClick={() => setViewMode('expanded')}
                title="Подробный вид"
                aria-label="Подробный вид"
                aria-pressed={viewMode === 'expanded'}
              >
                <Rows3 />
              </Button>
            </div>
          </div>
        </div>
      </div>

      {/* Список */}
      {filteredMessages.length === 0 ? (
        <EmptyState
          icon={<Search />}
          title={hasActiveFilters ? 'Сообщения не найдены' : 'Нет сообщений'}
          description={hasActiveFilters ? 'Попробуйте изменить фильтры или поисковый запрос.' : undefined}
        >
          {hasActiveFilters ? (
            <Button variant="outline" size="sm" className="mt-4" onClick={clearFilters}>
              Сбросить фильтры
            </Button>
          ) : null}
        </EmptyState>
      ) : (
        <VirtualList
          items={filteredMessages}
          height="min(60vh, 520px)"
          estimateSize={viewMode === 'compact' ? 44 : 104}
          className="rounded-lg border bg-card"
          getItemKey={(m: any) => m.id}
          renderItem={(message: any) => {
            const timeStr = new Date(message.scheduledFor).toLocaleString('ru-RU', {
              day: 'numeric',
              month: 'short',
              hour: '2-digit',
              minute: '2-digit',
            })
            if (viewMode === 'compact') {
              return (
                <div className="flex items-center gap-2 border-b px-3 py-2 transition-colors hover:bg-muted/40">
                  <span aria-hidden className={cn('size-2 shrink-0 rounded-full', STATUS_DOT[message.status] ?? 'bg-muted-foreground/50')} />
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeStr}</span>
                  <span className="min-w-0 max-w-[160px] truncate text-sm font-medium">#{message.channelName}</span>
                  <span className="hidden min-w-0 flex-1 truncate text-sm text-muted-foreground sm:block">{message.message}</span>
                  <span className="ml-auto shrink-0 sm:ml-0">{getStatusBadge(message, true)}</span>
                  {renderActions(message)}
                </div>
              )
            }
            return (
              <div className="space-y-1.5 border-b px-3 py-3 transition-colors hover:bg-muted/40">
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className="max-w-[200px] truncate text-sm font-medium">#{message.channelName}</span>
                    {getStatusBadge(message)}
                    {getExternalStatusBadge(message.externalStatus)}
                    <span className="text-xs tabular-nums text-muted-foreground">{timeStr}</span>
                  </div>
                  {renderActions(message)}
                </div>
                <p className="line-clamp-2 text-sm text-foreground/85">{message.message}</p>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                  {message.user && (message.user.name || message.user.email) && (
                    <span className="flex min-w-0 items-center gap-1.5" title="От имени">
                      <Avatar className="size-4 shrink-0">
                        {message.user.avatarUrl && <AvatarImage src={message.user.avatarUrl} alt="" />}
                        <AvatarFallback className={`text-[8px] font-semibold text-white ${generateAvatarColor(message.user.email)}`}>
                          {getInitials(message.user.name || message.user.email)}
                        </AvatarFallback>
                      </Avatar>
                      <span className="truncate">{message.user.name || message.user.email}</span>
                    </span>
                  )}
                  {message.scheduledBy && (message.scheduledBy.name || message.scheduledBy.email) && (
                    <span className="truncate">· запланировал(а): {message.scheduledBy.name || message.scheduledBy.email}</span>
                  )}
                  {message.workspace && (
                    <span className="truncate">
                      · {message.workspace.workspaceName}
                      {message.workspace.username ? ` · @${message.workspace.username}` : ''}
                    </span>
                  )}
                </div>
                {message.status === 'FAILED' && sanitizeErrorReason(message.error) && (
                  <p role="alert" className="break-words rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
                    Причина: {sanitizeErrorReason(message.error)}
                  </p>
                )}
              </div>
            )
          }}
        />
      )}
    </div>
  )
}
