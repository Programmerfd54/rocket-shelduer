"use client"

import { useState } from 'react'
import Link from 'next/link'
import { Archive, BellOff, Calendar, ExternalLink, LogIn, MoreHorizontal, RefreshCw } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Spinner } from '@/components/ui/spinner'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { CopyButton } from '@/components/common/CopyButton'
import { PageHeader } from '@/components/common/PageHeader'
import { WorkspaceEditDialog } from '@/components/common/WorkspaceEditDialog'

function formatDate(value: string) {
  return new Date(value).toLocaleDateString('ru-RU')
}

/**
 * Заголовок страницы пространства: название, URL (с копированием), статусы и даты, действия.
 * Второстепенные действия (календарь, проверка подключения, архив) — в меню «Ещё».
 */
export function WorkspaceHeader({
  workspace,
  workspaceId,
  isVolMember,
  isMyIntensive,
  volunteerExpiresAt,
  refreshing,
  checkingConnection,
  onRefresh,
  onCheckConnection,
  onChanged,
  onArchiveRequest,
}: {
  workspace: any | null
  workspaceId: string
  isVolMember: boolean
  /** Пространство совпадает с интенсивом волонтёра */
  isMyIntensive: boolean
  volunteerExpiresAt: string | null
  refreshing: boolean
  checkingConnection: boolean
  onRefresh: () => void
  onCheckConnection: () => void
  onChanged: () => void
  onArchiveRequest: () => void
}) {
  const [now] = useState(() => Date.now())
  const breadcrumbs = (
    <Breadcrumbs
      className="-ml-1.5"
      items={[
        { label: 'Дашборд', href: '/dashboard' },
        { label: 'Пространства', href: '/dashboard/workspaces' },
        { label: workspace?.workspaceName ?? 'Пространство', current: true },
      ]}
    />
  )

  if (!workspace) return <PageHeader breadcrumbs={breadcrumbs} title="Пространство" />

  const displayUrl = String(workspace.workspaceUrl ?? '').replace(/^https?:\/\//, '')
  const volDaysLeft = volunteerExpiresAt
    ? Math.ceil((new Date(volunteerExpiresAt).getTime() - now) / (1000 * 60 * 60 * 24))
    : null

  const description = (
    <span className="flex flex-col gap-1.5">
      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="max-w-full truncate font-mono text-xs text-foreground/80" title={workspace.workspaceUrl}>
          {displayUrl}
        </span>
        <CopyButton
          text={workspace.workspaceUrl}
          successMessage="URL скопирован"
          aria-label="Копировать URL"
          size="icon-sm"
          className="size-6"
        />
        {workspace.isArchived ? (
          <Badge variant="warning">В архиве</Badge>
        ) : (
          <Badge variant={workspace.isActive ? 'success' : 'muted'} title={workspace.isActive ? 'Подключение активно' : 'Подключение неактивно'}>
            {workspace.isActive ? 'Подключено' : 'Не подключено'}
          </Badge>
        )}
        {isMyIntensive && <Badge variant="info">Ваш интенсив</Badge>}
      </span>
      <span className="flex flex-wrap items-center gap-x-4 gap-y-0.5 text-xs">
        {workspace.startDate && workspace.endDate && (
          <span>
            Интенсив: {formatDate(workspace.startDate)} — {formatDate(workspace.endDate)}
          </span>
        )}
        {isVolMember && volunteerExpiresAt && (
          <span>
            Доступ до {formatDate(volunteerExpiresAt)}
            {volDaysLeft !== null && volDaysLeft > 0 && volDaysLeft <= 7 && (
              <span className="ml-1 text-amber-600 dark:text-amber-400">(осталось {volDaysLeft} дн.)</span>
            )}
            {volDaysLeft !== null && volDaysLeft <= 0 && <span className="ml-1 text-destructive">(истёк)</span>}
          </span>
        )}
        {workspace.lastConnected && (
          <span>Последнее подключение: {new Date(workspace.lastConnected).toLocaleString('ru-RU')}</span>
        )}
      </span>
    </span>
  )

  const actions = (
    <>
      <Button variant="outline" size="sm" asChild>
        <a href={workspace.workspaceUrl} target="_blank" rel="noopener noreferrer">
          <ExternalLink />
          Открыть в Rocket.Chat
        </a>
      </Button>
      <Button variant="outline" size="sm" onClick={onRefresh} disabled={refreshing} title="Обновить данные">
        {refreshing ? <Spinner /> : <RefreshCw />}
        Обновить
      </Button>
      {!isVolMember && <WorkspaceEditDialog workspace={workspace} onSuccess={onChanged} />}
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="icon-sm" aria-label="Другие действия">
            <MoreHorizontal />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="min-w-52">
          <DropdownMenuItem asChild>
            <Link href={`/dashboard/calendar?workspaceId=${workspaceId}`}>
              <Calendar />
              Календарь пространства
            </Link>
          </DropdownMenuItem>
          {!isVolMember && (
            <DropdownMenuItem onSelect={onCheckConnection} disabled={checkingConnection}>
              <LogIn />
              Проверить подключение
            </DropdownMenuItem>
          )}
          {!isVolMember && !workspace.isArchived && (
            <>
              <DropdownMenuSeparator />
              {workspace.suppressArchivePrompt === true && (
                <DropdownMenuItem disabled className="text-xs">
                  <BellOff />
                  Архивирование не предлагается
                </DropdownMenuItem>
              )}
              <DropdownMenuItem variant="destructive" onSelect={onArchiveRequest}>
                <Archive />
                Архивировать
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  )

  return <PageHeader breadcrumbs={breadcrumbs} title={<WorkspaceTitle workspace={workspace} />} description={description} actions={actions} />
}

function WorkspaceTitle({ workspace }: { workspace: any }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2.5">
      <span
        className="size-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: workspace.color || '#ef4444' }}
        aria-hidden
      />
      <span className="truncate">{workspace.workspaceName}</span>
    </span>
  )
}
