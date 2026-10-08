"use client"

import type { ElementType } from 'react'
import {
  History,
  User,
  Server,
  Settings,
  Shield,
  LogIn,
  LogOut,
  Plus,
  Edit,
  Trash2,
  Send,
  XCircle,
  Ban,
  UserCheck,
  UserPlus,
  Archive,
  ArchiveRestore,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { cn, formatRelativeTime } from '@/lib/utils'

/** Запись журнала активности, как её отдаёт /api/activity. */
export type ActivityLogEntry = {
  id: string
  action: string
  entityType?: string | null
  entityId?: string | null
  details?: string | null
  ipAddress?: string | null
  createdAt: string
  user?: { id: string; name?: string | null; email: string; role?: string } | null
}

export const ACTIVITY_ICONS: Record<string, ElementType> = {
  USER_LOGIN: LogIn,
  USER_LOGOUT: LogOut,
  USER_REGISTER: User,
  USER_BLOCKED: Ban,
  USER_UNBLOCKED: UserCheck,
  USER_ROLE_CHANGED: Shield,
  USER_CREATED_BY_ADMIN: UserPlus,
  WORKSPACE_CREATED: Plus,
  WORKSPACE_UPDATED: Edit,
  WORKSPACE_DELETED: Trash2,
  WORKSPACE_CONNECTED: Server,
  WORKSPACE_ARCHIVED: Archive,
  WORKSPACE_UNARCHIVED: ArchiveRestore,
  MESSAGE_CREATED: Plus,
  MESSAGE_UPDATED: Edit,
  MESSAGE_DELETED: Trash2,
  MESSAGE_SENT: Send,
  MESSAGE_FAILED: XCircle,
  SETTINGS_UPDATED: Settings,
  PASSWORD_CHANGED: Shield,
  ADMIN_ACTION: Shield,
}

export const ACTIVITY_LABELS: Record<string, string> = {
  USER_LOGIN: 'Вход в систему',
  USER_LOGOUT: 'Выход из системы',
  USER_REGISTER: 'Регистрация',
  USER_BLOCKED: 'Пользователь заблокирован',
  USER_UNBLOCKED: 'Пользователь разблокирован',
  USER_ROLE_CHANGED: 'Изменена роль',
  USER_CREATED_BY_ADMIN: 'Пользователь создан администратором',
  WORKSPACE_CREATED: 'Создано пространство',
  WORKSPACE_UPDATED: 'Обновлено пространство',
  WORKSPACE_DELETED: 'Удалено пространство',
  WORKSPACE_CONNECTED: 'Подключение к пространству',
  WORKSPACE_ARCHIVED: 'Пространство в архиве',
  WORKSPACE_UNARCHIVED: 'Пространство возвращено из архива',
  MESSAGE_CREATED: 'Создано сообщение',
  MESSAGE_UPDATED: 'Обновлено сообщение',
  MESSAGE_DELETED: 'Удалено сообщение',
  MESSAGE_SENT: 'Отправлено сообщение',
  MESSAGE_FAILED: 'Ошибка отправки',
  SETTINGS_UPDATED: 'Обновлены настройки',
  PASSWORD_CHANGED: 'Изменён пароль',
  ADMIN_ACTION: 'Действие администратора',
}

/** Группы для фильтра по типу события (значение — конкретный action, как ждёт API). */
export const ACTIVITY_FILTER_GROUPS: { label: string; actions: string[] }[] = [
  { label: 'Аккаунт', actions: ['USER_LOGIN', 'USER_LOGOUT', 'USER_REGISTER', 'PASSWORD_CHANGED', 'SETTINGS_UPDATED'] },
  { label: 'Пространства', actions: ['WORKSPACE_CREATED', 'WORKSPACE_UPDATED', 'WORKSPACE_DELETED', 'WORKSPACE_CONNECTED', 'WORKSPACE_ARCHIVED', 'WORKSPACE_UNARCHIVED'] },
  { label: 'Сообщения', actions: ['MESSAGE_CREATED', 'MESSAGE_UPDATED', 'MESSAGE_DELETED', 'MESSAGE_SENT', 'MESSAGE_FAILED'] },
  { label: 'Администрирование', actions: ['USER_BLOCKED', 'USER_UNBLOCKED', 'USER_ROLE_CHANGED', 'USER_CREATED_BY_ADMIN', 'ADMIN_ACTION'] },
]

const ROLE_BADGE_LABELS: Record<string, string> = {
  LEAD_SUP: 'Lead_SUP',
  SUP: 'SUP',
  ADM: 'ADM',
  MEMBER: 'Волонтёр',
}

function parseMessage(details?: string | null): string | null {
  if (!details) return null
  try {
    const parsed = JSON.parse(details)
    if (parsed && typeof parsed === 'object' && typeof parsed.message === 'string') return parsed.message
    return null
  } catch {
    return details
  }
}

function dayHeading(iso: string): string {
  const d = new Date(iso)
  const today = new Date()
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime()
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86400000)
  if (diffDays === 0) return 'Сегодня'
  if (diffDays === 1) return 'Вчера'
  return d.toLocaleDateString('ru-RU', {
    day: 'numeric',
    month: 'long',
    ...(d.getFullYear() !== today.getFullYear() ? { year: 'numeric' as const } : {}),
  })
}

function groupByDay(logs: ActivityLogEntry[]): { heading: string; items: ActivityLogEntry[] }[] {
  const groups: { heading: string; items: ActivityLogEntry[] }[] = []
  for (const log of logs) {
    const heading = dayHeading(log.createdAt)
    const last = groups[groups.length - 1]
    if (last && last.heading === heading) last.items.push(log)
    else groups.push({ heading, items: [log] })
  }
  return groups
}

/** Компактный журнал событий: заголовок дня → строки по 48px, без карточек у каждой строки. */
export function ActivityFeed({ logs, className }: { logs: ActivityLogEntry[]; className?: string }) {
  const groups = groupByDay(logs)
  return (
    <div className={cn('overflow-hidden rounded-lg border bg-card', className)}>
      {groups.map((group) => (
        <section key={group.heading} aria-label={group.heading}>
          <h3 className="border-b bg-muted/40 px-4 py-1.5 text-xs font-medium text-muted-foreground">
            {group.heading}
          </h3>
          <ul className="divide-y">
            {group.items.map((log) => {
              const Icon = ACTIVITY_ICONS[log.action] || History
              const failed = log.action === 'MESSAGE_FAILED'
              const message = parseMessage(log.details)
              const created = new Date(log.createdAt)
              return (
                <li
                  key={log.id}
                  className="flex items-start gap-3 px-4 py-2.5 transition-colors hover:bg-muted/40"
                >
                  <Icon
                    className={cn('mt-0.5 size-4 shrink-0', failed ? 'text-destructive' : 'text-muted-foreground')}
                    aria-hidden
                  />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className={cn('text-sm font-medium', failed && 'text-destructive')}>
                        {ACTIVITY_LABELS[log.action] || log.action}
                      </span>
                      {log.entityType && (
                        <Badge variant="muted" className="font-normal">
                          {log.entityType}
                        </Badge>
                      )}
                    </div>
                    {(log.user || message) && (
                      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                        {log.user && (
                          <span className="inline-flex items-center gap-1.5">
                            {log.user.name || log.user.email}
                            {log.user.role && (
                              <Badge variant="outline" className="font-normal">
                                {ROLE_BADGE_LABELS[log.user.role] ?? log.user.role}
                              </Badge>
                            )}
                          </span>
                        )}
                        {message && <span className="break-words">{message}</span>}
                      </p>
                    )}
                  </div>
                  <div className="shrink-0 text-right">
                    <time
                      dateTime={log.createdAt}
                      title={created.toLocaleString('ru-RU')}
                      className="block text-xs text-muted-foreground"
                    >
                      {formatRelativeTime(log.createdAt)}
                    </time>
                    <span className="block text-[11px] tabular-nums text-muted-foreground/70">
                      {created.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                      {log.ipAddress && log.ipAddress !== 'unknown' && (
                        <span className="ml-1.5 hidden font-mono sm:inline">{log.ipAddress}</span>
                      )}
                    </span>
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}
    </div>
  )
}

export function ActivityFeedSkeleton({ rows = 8 }: { rows?: number }) {
  return (
    <div className="overflow-hidden rounded-lg border bg-card" aria-busy="true" aria-label="Загрузка событий">
      <div className="border-b bg-muted/40 px-4 py-2">
        <Skeleton className="h-3 w-20" />
      </div>
      <div className="divide-y">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex items-start gap-3 px-4 py-3">
            <Skeleton className="mt-0.5 size-4 shrink-0" />
            <div className="flex-1 space-y-1.5">
              <Skeleton className="h-4 w-48 max-w-full" />
              <Skeleton className="h-3 w-64 max-w-full" />
            </div>
            <Skeleton className="h-3 w-16 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}
