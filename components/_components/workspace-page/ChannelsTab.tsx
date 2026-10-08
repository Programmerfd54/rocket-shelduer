"use client"

import { useMemo, useState } from 'react'
import { Hash, Lock, MessageSquarePlus, RefreshCw, Search, Star, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { EmptyState } from '@/components/common/EmptyState'
import { VirtualList } from '@/components/_components/VirtualList'
import { cn } from '@/lib/utils'

type ChannelSort = 'name' | 'messages' | 'public_first'

const favoritesKey = (workspaceId: string) => `favoriteChannels_${workspaceId}`

/**
 * Вкладка «Каналы»: компактный список с поиском, избранным и числом запланированных сообщений.
 * Действия появляются при наведении (на сенсорных экранах всегда видны).
 */
export function ChannelsTab({
  workspaceId,
  channels,
  messages,
  reloading,
  onReload,
  onSelectChannel,
}: {
  workspaceId: string
  channels: any[]
  messages: any[]
  reloading: boolean
  onReload: () => void
  onSelectChannel: (channel: any) => void
}) {
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'all' | 'favorites'>('all')
  const [sort, setSort] = useState<ChannelSort>('name')
  const [favorites, setFavorites] = useState<Set<string>>(() => {
    try {
      const saved = typeof window !== 'undefined' ? localStorage.getItem(favoritesKey(workspaceId)) : null
      return saved ? new Set<string>(JSON.parse(saved)) : new Set<string>()
    } catch (e) {
      console.error('Failed to load favorite channels:', e)
      return new Set<string>()
    }
  })

  const toggleFavorite = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation()
    const next = new Set(favorites)
    if (next.has(channelId)) next.delete(channelId)
    else next.add(channelId)
    setFavorites(next)
    try {
      localStorage.setItem(favoritesKey(workspaceId), JSON.stringify(Array.from(next)))
    } catch {}
  }

  const scheduledByChannel = useMemo(() => {
    const map = new Map<string, number>()
    for (const m of messages) map.set(m.channelId, (map.get(m.channelId) ?? 0) + 1)
    return map
  }, [messages])

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const filtered = channels
      .filter((ch) => (ch.name || '').toLowerCase().includes(q) && (view === 'all' || favorites.has(ch.id)))
      .map((ch) => ({ ...ch, scheduledCount: scheduledByChannel.get(ch.id) ?? 0 }))
    if (sort === 'name') filtered.sort((a, b) => (a.name || '').localeCompare(b.name || ''))
    else if (sort === 'messages') filtered.sort((a, b) => (b.messageCount ?? 0) - (a.messageCount ?? 0))
    else
      filtered.sort((a, b) => {
        const ap = a.type === 'c' ? 1 : 0
        const bp = b.type === 'c' ? 1 : 0
        if (bp !== ap) return bp - ap
        return (a.name || '').localeCompare(b.name || '')
      })
    return filtered
  }, [channels, query, view, sort, favorites, scheduledByChannel])

  const renderRow = (channel: any) => {
    const isFavorite = favorites.has(channel.id)
    const scheduled = channel.scheduledCount ?? 0
    return (
      <div
        key={channel.id}
        role="button"
        tabIndex={0}
        onClick={() => onSelectChannel(channel)}
        onKeyDown={(e) => {
          if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault()
            onSelectChannel(channel)
          }
        }}
        className="group flex min-h-12 cursor-pointer items-center gap-3 border-b px-3 py-2 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40"
      >
        {channel.type === 'p' ? (
          <Lock className="size-4 shrink-0 text-muted-foreground" aria-label="Приватный канал" />
        ) : (
          <Hash className="size-4 shrink-0 text-muted-foreground" aria-label="Публичный канал" />
        )}
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{channel.name}</p>
          {channel.displayName && channel.displayName !== channel.name && (
            <p className="truncate text-xs text-muted-foreground">{channel.displayName}</p>
          )}
        </div>
        {scheduled > 0 && (
          <Badge variant="info" className="shrink-0" title="Запланированных сообщений в этом канале">
            {scheduled} заплан.
          </Badge>
        )}
        <span className="hidden shrink-0 text-xs tabular-nums text-muted-foreground sm:inline" title="Сообщений в канале Rocket.Chat">
          {channel.messageCount ?? 0} сообщ.
        </span>
        <div className="flex shrink-0 items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="hidden transition-opacity sm:inline-flex sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
            onClick={(e) => {
              e.stopPropagation()
              onSelectChannel(channel)
            }}
          >
            <MessageSquarePlus />
            Запланировать
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            onClick={(e) => toggleFavorite(channel.id, e)}
            aria-label={isFavorite ? `Убрать «${channel.name}» из избранного` : `Добавить «${channel.name}» в избранное`}
            aria-pressed={isFavorite}
            className={cn(!isFavorite && 'sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100')}
          >
            <Star className={cn(isFavorite ? 'fill-amber-400 text-amber-500' : 'text-muted-foreground')} />
          </Button>
        </div>
      </div>
    )
  }

  const publicChannels = list.filter((ch) => ch.type === 'c')
  const privateChannels = list.filter((ch) => ch.type === 'p')
  const grouped = sort === 'public_first' && publicChannels.length > 0 && privateChannels.length > 0

  const renderList = (items: any[], cap: string) => (
    <div className="overflow-hidden rounded-lg border bg-card [&>div]:rounded-none [&_[data-index]:last-child>*]:border-b-0">
      <VirtualList
        items={items}
        height={`min(${items.length * 49}px, ${cap})`}
        estimateSize={49}
        getItemKey={(c: any) => c.id}
        renderItem={(channel: any) => renderRow(channel)}
      />
    </div>
  )

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            placeholder="Поиск каналов…"
            aria-label="Поиск каналов"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-8 pr-8"
          />
          {query && (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Очистить поиск"
              className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>
        <div className="flex items-center gap-2">
          {favorites.size > 0 && (
            <div className="inline-flex rounded-md border bg-muted/50 p-0.5" role="group" aria-label="Показывать каналы">
              {(['all', 'favorites'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  aria-pressed={view === v}
                  onClick={() => setView(v)}
                  className={cn(
                    'inline-flex h-7 items-center gap-1 rounded-sm px-2.5 text-[13px] font-medium transition-colors',
                    view === v ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {v === 'favorites' && <Star className="size-3.5" />}
                  {v === 'all' ? 'Все' : 'Избранное'}
                </button>
              ))}
            </div>
          )}
          <Select value={sort} onValueChange={(v: ChannelSort) => setSort(v)}>
            <SelectTrigger className="w-44" aria-label="Сортировка каналов">
              <SelectValue placeholder="Сортировка" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="name">По имени</SelectItem>
              <SelectItem value="messages">По числу сообщений</SelectItem>
              <SelectItem value="public_first">Публичные сначала</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" size="icon" onClick={onReload} disabled={reloading} aria-label="Перезагрузить список каналов" title="Перезагрузить список каналов">
            {reloading ? <Spinner /> : <RefreshCw />}
          </Button>
        </div>
      </div>

      {list.length === 0 ? (
        <EmptyState
          icon={<Hash />}
          title={query ? 'Каналы не найдены' : view === 'favorites' ? 'В избранном пока пусто' : 'Нет доступных каналов'}
          description={
            query
              ? `По запросу «${query}» ничего нет. Проверьте написание.`
              : view === 'favorites'
                ? 'Отметьте канал звёздочкой, чтобы он появился здесь.'
                : 'Каналы появятся после подключения к Rocket.Chat. Попробуйте обновить список.'
          }
          action={query ? { label: 'Сбросить поиск', onClick: () => setQuery('') } : view === 'favorites' ? { label: 'Показать все', onClick: () => setView('all') } : undefined}
        />
      ) : grouped ? (
        <div className="space-y-4">
          {[
            { title: 'Публичные', items: publicChannels },
            { title: 'Приватные', items: privateChannels },
          ].map((g) => (
            <section key={g.title} className="space-y-1.5">
              <h3 className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                {g.title}
                <span className="tabular-nums">{g.items.length}</span>
              </h3>
              {renderList(g.items, '40vh')}
            </section>
          ))}
        </div>
      ) : (
        renderList(list, '65vh')
      )}

      {list.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Показано {list.length} из {channels.length}
        </p>
      )}
    </div>
  )
}
