"use client"

import Link from 'next/link'
import { Calendar, History, MessageSquare, Plus, Server, Settings } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Section } from '@/components/common/Section'
import { formatRelativeTime } from '@/lib/utils'
import { pluralRu } from '@/lib/message-queue'

export interface DashStats {
  workspaces: number
  activeWorkspaces: number
  archivedWorkspaces: number
  totalMessages: number
  pendingMessages: number
  sentMessages: number
  failedMessages: number
  todayMessages: number
}

export interface DashWorkspace {
  id: string
  workspaceName: string
  workspaceUrl: string
  color?: string | null
  endDate?: string | null
  isArchived?: boolean
  isActive?: boolean
  lastConnected?: string | null
}

function ListBox({ children }: { children: React.ReactNode }) {
  return <div className="divide-y overflow-hidden rounded-lg border bg-card">{children}</div>
}

function daysWord(n: number) {
  return pluralRu(n, ['день', 'дня', 'дней'])
}

/**
 * Второстепенное содержимое дашборда: показатели, скоро заканчивающиеся интенсивы, пространства, быстрые ссылки.
 * Живёт в боковой колонке (xl) или под очередью.
 */
export function DashboardSecondary({
  stats,
  statsLoaded,
  loading,
  expiringWorkspaces,
  recentWorkspaces,
  isVolunteer,
  now,
}: {
  stats: DashStats
  /** Показатели загружены успешно (иначе «—», а не нули) */
  statsLoaded: boolean
  loading: boolean
  expiringWorkspaces: DashWorkspace[]
  recentWorkspaces: DashWorkspace[]
  isVolunteer: boolean
  now: Date
}) {
  const successRate =
    stats.totalMessages > 0 ? Math.round((stats.sentMessages / stats.totalMessages) * 100) : null
  const val = (n: number) => (statsLoaded ? String(n) : '—')

  // Подписи без «на сегодня»: todayMessages из API — это все PENDING с начала дня по времени сервера, а не «сегодня».
  const statItems = [
    {
      label: 'Активные пространства',
      value: val(stats.activeWorkspaces),
      hint: statsLoaded ? `из ${stats.workspaces} подключённых` : 'нет данных',
      tone: '',
    },
    { label: 'Ожидают отправки', value: val(stats.pendingMessages), hint: 'за всё время, ещё не отправлены', tone: '' },
    {
      label: 'Отправлено',
      value: val(stats.sentMessages),
      hint: !statsLoaded
        ? 'нет данных'
        : successRate !== null
          ? `${successRate}% от ${stats.totalMessages} всего`
          : 'пока ничего не отправлено',
      tone: '',
    },
    {
      label: 'Не отправлено',
      value: val(stats.failedMessages),
      hint: !statsLoaded ? 'нет данных' : stats.failedMessages > 0 ? 'нужно повторить или удалить' : 'всё в порядке',
      tone: statsLoaded && stats.failedMessages > 0 ? 'text-destructive' : '',
    },
  ]

  const quickLinks = [
    { href: '/dashboard/messages', label: 'Все сообщения', icon: MessageSquare },
    { href: '/dashboard/calendar', label: 'Календарь', icon: Calendar },
    { href: '/dashboard/activity', label: 'История', icon: History },
    { href: '/dashboard/settings', label: 'Настройки', icon: Settings },
  ]

  return (
    <div className="space-y-6">
      <section aria-label="Показатели">
        <h2 className="mb-2 text-sm font-semibold">Показатели</h2>
        <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border sm:grid-cols-4 xl:grid-cols-2">
          {statItems.map((s) => (
            <div key={s.label} className="min-w-0 space-y-0.5 bg-card px-3 py-2.5">
              <dt className="truncate text-xs text-muted-foreground">{s.label}</dt>
              {loading ? (
                <>
                  <Skeleton className="h-6 w-10" />
                  <Skeleton className="h-3 w-20 max-w-full" />
                </>
              ) : (
                <>
                  <dd className={`text-lg font-semibold tabular-nums tracking-tight ${s.tone}`}>{s.value}</dd>
                  <p className="truncate text-xs text-muted-foreground">{s.hint}</p>
                </>
              )}
            </div>
          ))}
        </dl>
      </section>

      {!loading && expiringWorkspaces.length > 0 && (
        <Section
          title="Интенсивы скоро закончатся"
          description={`${expiringWorkspaces.length} ${expiringWorkspaces.length === 1 ? 'интенсив заканчивается' : 'интенсива заканчиваются'} в ближайшие 7 дней. После окончания пространство можно заархивировать.`}
          bare
        >
          <ListBox>
            {expiringWorkspaces.map((ws) => {
              const daysLeft = Math.max(
                0,
                Math.ceil((new Date(ws.endDate ?? now).getTime() - now.getTime()) / (1000 * 60 * 60 * 24)),
              )
              return (
                <div key={ws.id} className="flex items-center gap-3 px-3 py-2.5 hover:bg-muted/40">
                  <span
                    className="size-2 shrink-0 rounded-full bg-muted-foreground/40"
                    style={ws.color ? { backgroundColor: ws.color } : undefined}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{ws.workspaceName}</p>
                    <p className="text-xs text-muted-foreground">
                      Завершится {ws.endDate ? new Date(ws.endDate).toLocaleDateString('ru-RU') : '—'}
                    </p>
                  </div>
                  <Badge variant="warning" className="hidden shrink-0 sm:inline-flex">
                    {daysLeft === 0 ? 'сегодня' : `через ${daysLeft} ${daysWord(daysLeft)}`}
                  </Badge>
                  <Button variant="ghost" size="sm" asChild className="shrink-0">
                    <Link href={`/dashboard/workspaces/${ws.id}`}>Открыть</Link>
                  </Button>
                </div>
              )
            })}
          </ListBox>
        </Section>
      )}

      <Section
        title="Пространства"
        bare
        actions={
          <div className="flex items-center gap-1">
            {!isVolunteer && (
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/workspaces">
                  <Plus aria-hidden />
                  Новое
                </Link>
              </Button>
            )}
            <Button variant="ghost" size="sm" asChild>
              <Link href="/dashboard/workspaces">Все</Link>
            </Button>
          </div>
        }
      >
        {loading ? (
          <ListBox>
            {[1, 2, 3].map((i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-3">
                <Skeleton className="size-2 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))}
          </ListBox>
        ) : recentWorkspaces.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-6 text-center">
            <div className="mx-auto mb-2 flex size-9 items-center justify-center rounded-md bg-muted text-muted-foreground">
              <Server className="size-4" aria-hidden />
            </div>
            <p className="text-sm font-medium">Нет подключённых пространств</p>
            <p className="mx-auto mt-0.5 max-w-xs text-[13px] text-muted-foreground text-balance">
              {isVolunteer
                ? 'Пространство появится здесь, когда SUP или Lead_SUP назначит вас.'
                : 'Подключите пространство Rocket.Chat, чтобы планировать сообщения.'}
            </p>
          </div>
        ) : (
          <ListBox>
            {recentWorkspaces.map((workspace) => (
              <Link
                key={workspace.id}
                href={`/dashboard/workspaces/${workspace.id}`}
                className="flex items-center gap-3 px-3 py-2.5 outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/50"
              >
                <span
                  className="size-2 shrink-0 rounded-full bg-muted-foreground/40"
                  style={workspace.color ? { backgroundColor: workspace.color } : undefined}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium">{workspace.workspaceName}</p>
                  <p className="truncate font-mono text-xs text-muted-foreground">
                    {workspace.workspaceUrl.replace(/^https?:\/\//, '')}
                    {workspace.lastConnected && (
                      <span className="font-sans"> · {formatRelativeTime(workspace.lastConnected)}</span>
                    )}
                  </p>
                </div>
                {workspace.isArchived ? (
                  <Badge variant="muted">Архив</Badge>
                ) : (
                  <Badge variant={workspace.isActive ? 'success' : 'muted'}>
                    {workspace.isActive ? 'Активно' : 'Неактивно'}
                  </Badge>
                )}
              </Link>
            ))}
          </ListBox>
        )}
      </Section>

      <section aria-label="Быстрые действия" className="flex flex-wrap items-center gap-2">
        {quickLinks.map(({ href, label, icon: Icon }) => (
          <Button key={href} variant="outline" size="sm" asChild>
            <Link href={href}>
              <Icon aria-hidden />
              {label}
            </Link>
          </Button>
        ))}
      </section>
    </div>
  )
}
