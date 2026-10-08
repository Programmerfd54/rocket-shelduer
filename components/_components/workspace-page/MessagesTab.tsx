"use client"

import { CalendarRange, Hash, MessageSquare, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import CompactMessages from '@/components/_components/common/CompactMessage'
import { EmptyState } from '@/components/common/EmptyState'
import { VirtualList } from '@/components/_components/VirtualList'
import { cn } from '@/lib/utils'
import type { MessagePeriodFilter, MessagesView } from './useMessagesView'

const ALL_AUTHORS = '__all__'

export interface IntensiveFilterChipProps {
  /** Название выбранного интенсива */
  name: string
  active: boolean
  onChange: (active: boolean) => void
}

/** Чип-фильтр «Только этого интенсива» (сообщения, привязанные к выбранному интенсиву) */
export function IntensiveFilterChip({ name, active, onChange, className }: IntensiveFilterChipProps & { className?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={`Показывать только сообщения интенсива «${name}»`}
      onClick={() => onChange(!active)}
      className={cn(
        'inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-[13px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
        active ? 'border-foreground/30 bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
        className,
      )}
    >
      <CalendarRange className="size-4" aria-hidden />
      Только этого интенсива
    </button>
  )
}

/** Вкладка «Сообщения»: фильтры, каналы с отложенными сообщениями и история выбранного канала. */
export function MessagesTab({
  view,
  totalCount,
  isVolMember,
  hasIntensivePeriod,
  intensivePeriodLabel,
  initialStatusFilter,
  onCreate,
  onEdit,
  onDelete,
  onRetry,
  intensiveFilter,
}: {
  view: MessagesView
  totalCount: number
  isVolMember: boolean
  hasIntensivePeriod: boolean
  intensivePeriodLabel: string
  initialStatusFilter: string | null
  onCreate: () => void
  onEdit: (message: any) => void
  onDelete: (messageId: string) => void
  onRetry: (messageId: string) => void
  /** Выбран интенсив: чип «Только этого интенсива» (по умолчанию выключен) */
  intensiveFilter?: IntensiveFilterChipProps | null
}) {
  const periods: { value: MessagePeriodFilter; label: string; title?: string }[] = [
    { value: 'all', label: 'Все' },
    { value: '2weeks', label: '2 недели', title: 'Ближайшие 2 недели' },
    ...(hasIntensivePeriod ? [{ value: 'intensive' as const, label: 'Интенсив', title: intensivePeriodLabel }] : []),
  ]

  if (totalCount === 0) {
    return (
      <EmptyState
        icon={<MessageSquare />}
        title="Нет запланированных сообщений"
        description="Создайте первое отложенное сообщение — оно уйдёт в Rocket.Chat в выбранное время. Канал можно выбрать прямо в форме."
        action={{ label: 'Создать сообщение', onClick: onCreate }}
      />
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-muted-foreground">Период</span>
            <div className="inline-flex rounded-md border bg-muted/50 p-0.5" role="group" aria-label="Период сообщений">
              {periods.map((p) => (
                <button
                  key={p.value}
                  type="button"
                  title={p.title}
                  aria-pressed={view.periodFilter === p.value}
                  onClick={() => view.setPeriodFilter(p.value)}
                  className={cn(
                    'h-7 rounded-sm px-2.5 text-[13px] font-medium transition-colors',
                    view.periodFilter === p.value ? 'bg-background text-foreground shadow-xs' : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>
          {intensiveFilter && <IntensiveFilterChip {...intensiveFilter} />}
          {view.authors.length >= 2 && (
            <div className="flex items-center gap-2">
              <span className="text-[13px] text-muted-foreground">Автор</span>
              <Select
                value={view.authorFilter ?? ALL_AUTHORS}
                onValueChange={(v) => view.setAuthorFilter(v === ALL_AUTHORS ? null : v)}
              >
                <SelectTrigger className="w-52" aria-label="Фильтр по автору">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL_AUTHORS}>Все авторы</SelectItem>
                  {view.authors.map((u) => (
                    <SelectItem key={u.id} value={u.id}>
                      {u.name || u.email || u.username || u.id}
                      {u.role ? ` (${u.role})` : ''}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <Button onClick={onCreate} className="w-full sm:w-auto">
          <Plus />
          Создать сообщение
        </Button>
      </div>

      {isVolMember && <p className="text-[13px] text-muted-foreground">Показаны только ваши запланированные сообщения.</p>}

      {view.channelsWithMessages.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title="Ничего не найдено"
          description="В выбранном периоде или у выбранного автора нет сообщений. Смените фильтры."
          action={{
            label: 'Сбросить фильтры',
            onClick: () => {
              view.setPeriodFilter('all')
              view.setAuthorFilter(null)
              intensiveFilter?.onChange(false)
            },
          }}
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
          <section className="lg:col-span-2 lg:sticky lg:top-6 lg:self-start" aria-label="Каналы с сообщениями">
            <h3 className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
              Каналы
              <span className="tabular-nums">{view.channelsWithMessages.length}</span>
            </h3>
            <div className="overflow-hidden rounded-lg border bg-card [&_[data-index]:last-child>*]:border-b-0">
              <VirtualList
                items={view.channelsWithMessages}
                height={`min(${view.channelsWithMessages.length * 41}px, 40vh)`}
                estimateSize={41}
                getItemKey={(c: any) => c.channelId}
                renderItem={(channel: any) => {
                  const selected = view.selectedChannelId === channel.channelId
                  return (
                    <button
                      type="button"
                      onClick={() => view.setSelectedChannelId(channel.channelId)}
                      aria-current={selected ? 'true' : undefined}
                      className={cn(
                        'flex h-10 w-full items-center gap-2 border-b px-3 text-left text-sm outline-none transition-colors focus-visible:bg-muted/60',
                        selected ? 'bg-muted font-medium text-foreground' : 'hover:bg-muted/40',
                      )}
                    >
                      <Hash className={cn('size-4 shrink-0', selected ? 'text-primary' : 'text-muted-foreground')} />
                      <span className="min-w-0 flex-1 truncate">{channel.channelName}</span>
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{channel.messageCount}</span>
                    </button>
                  )
                }}
              />
            </div>
          </section>

          <div className="min-w-0 lg:col-span-3">
            {view.selectedChannelId ? (
              <div className="min-h-[min(50vh,420px)] rounded-lg border bg-card p-3">
                <CompactMessages
                  messages={view.messagesOfChannel}
                  onEdit={onEdit}
                  onDelete={onDelete}
                  onRetry={onRetry}
                  initialStatusFilter={initialStatusFilter}
                />
              </div>
            ) : (
              <EmptyState icon={<MessageSquare />} title="Выберите канал" description="История отложенных сообщений появится здесь." />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
