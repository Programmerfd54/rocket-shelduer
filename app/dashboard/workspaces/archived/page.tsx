"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Archive, Loader2, RefreshCw, Trash2, RotateCcw } from 'lucide-react'
import { toast } from 'sonner'
import { formatLocalDate, formatRelativeTime } from '@/lib/utils'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { EmptyState } from '@/components/common/EmptyState'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'

function pluralDays(n: number) {
  const m10 = n % 10
  const m100 = n % 100
  if (m10 === 1 && m100 !== 11) return 'день'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'дня'
  return 'дней'
}

interface ArchivedWorkspace {
  id: string
  workspaceName: string
  workspaceUrl: string
  archivedAt?: string | null
  archiveDeleteAt: string | null
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback
}

export default function ArchivedWorkspacesPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<ArchivedWorkspace[]>([])
  const [loading, setLoading] = useState(true)
  const [restoringId, setRestoringId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<ArchivedWorkspace | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.blocked) {
          router.replace('/dashboard/blocked')
          return
        }
        loadArchivedWorkspaces()
      })
      .catch(() => loadArchivedWorkspaces())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const loadArchivedWorkspaces = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/workspace?archived=true&today=${formatLocalDate(new Date())}`)
      if (response.ok) {
        const data = await response.json()
        setWorkspaces(data.workspaces || [])
      } else {
        toast.error('Не удалось загрузить архив', { description: 'Обновите страницу или повторите позже.' })
      }
    } catch (error) {
      console.error('Failed to load archived workspaces:', error)
      toast.error('Не удалось загрузить архив', { description: 'Проверьте подключение к сети и повторите.' })
    } finally {
      setLoading(false)
    }
  }

  const handleUnarchive = async (workspace: ArchivedWorkspace) => {
    setRestoringId(workspace.id)
    try {
      const response = await fetch(`/api/workspace/${workspace.id}/archive`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Failed to unarchive')
      }

      toast.success(`Пространство «${workspace.workspaceName}» восстановлено`, {
        description: 'Оно снова доступно в разделе «Пространства».',
      })
      await loadArchivedWorkspaces()
    } catch (error) {
      toast.error('Не удалось восстановить пространство', {
        description: errorMessage(error, 'Повторите попытку позже.'),
      })
    } finally {
      setRestoringId(null)
    }
  }

  const handleDeleteEarly = async () => {
    if (!deleteTarget) return
    const workspaceId = deleteTarget.id
    try {
      setDeletingId(workspaceId)
      const response = await fetch(`/api/workspace/${workspaceId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        throw new Error(data.error || 'Ошибка удаления')
      }

      toast.success('Пространство удалено')
      setDeleteTarget(null)
      loadArchivedWorkspaces()
    } catch (error) {
      toast.error('Не удалось удалить пространство', {
        description: errorMessage(error, 'Повторите попытку позже.'),
      })
    } finally {
      setDeletingId(null)
    }
  }

  const getDaysUntilDeletion = (archiveDeleteAt: string | null) => {
    if (!archiveDeleteAt) return null
    const diff = new Date(archiveDeleteAt).getTime() - Date.now()
    return Math.ceil(diff / (1000 * 60 * 60 * 24))
  }

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Пространства', href: '/dashboard/workspaces' },
              { label: 'Архив', current: true },
            ]}
          />
        }
        title="Архив пространств"
        description="Заархивированные пространства удаляются автоматически через 2 недели. До этого их можно восстановить."
        actions={
          <>
            <Button variant="outline" size="sm" onClick={loadArchivedWorkspaces} disabled={loading}>
              <RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden />
              Обновить
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href="/dashboard/workspaces">К пространствам</Link>
            </Button>
          </>
        }
      />

      {loading && workspaces.length === 0 ? (
        <div
          className="divide-y overflow-hidden rounded-lg border bg-card"
          role="status"
          aria-busy="true"
          aria-label="Загрузка архива"
        >
          {[1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Skeleton className="h-4 w-1/3 max-w-[220px]" />
                <Skeleton className="h-3 w-1/2 max-w-[300px]" />
              </div>
              <Skeleton className="h-8 w-28 shrink-0" />
            </div>
          ))}
        </div>
      ) : workspaces.length === 0 ? (
        <EmptyState
          icon={<Archive />}
          title="В архиве ничего нет"
          description="Сюда попадают пространства, которые вы заархивировали после окончания интенсива."
          action={{ label: 'К пространствам', href: '/dashboard/workspaces' }}
        />
      ) : (
        <div className="divide-y overflow-hidden rounded-lg border bg-card">
          {workspaces.map((workspace) => {
            const daysLeft = getDaysUntilDeletion(workspace.archiveDeleteAt)
            const isUrgent = daysLeft !== null && daysLeft <= 3
            const restoring = restoringId === workspace.id

            return (
              <div
                key={workspace.id}
                className="flex flex-col gap-3 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <p className="truncate text-sm font-medium" title={workspace.workspaceName}>
                      {workspace.workspaceName}
                    </p>
                    {daysLeft !== null && (
                      <Badge variant={isUrgent ? 'danger' : 'muted'}>
                        {daysLeft > 0
                          ? `удаление через ${daysLeft} ${pluralDays(daysLeft)}`
                          : 'будет удалено сегодня'}
                      </Badge>
                    )}
                  </div>
                  <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                    <span className="max-w-full truncate font-mono" title={workspace.workspaceUrl}>
                      {workspace.workspaceUrl.replace(/^https?:\/\//, '')}
                    </span>
                    {workspace.archivedAt && <span>заархивировано {formatRelativeTime(workspace.archivedAt)}</span>}
                  </p>
                </div>

                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleUnarchive(workspace)}
                    disabled={restoring || deletingId === workspace.id}
                  >
                    {restoring ? <Loader2 className="animate-spin" aria-hidden /> : <RotateCcw aria-hidden />}
                    {restoring ? 'Восстановление…' : 'Восстановить'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                    onClick={() => setDeleteTarget(workspace)}
                    disabled={restoring || deletingId === workspace.id}
                  >
                    <Trash2 aria-hidden />
                    Удалить досрочно
                  </Button>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <ConfirmDialog
        open={!!deleteTarget}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
        title="Удалить пространство досрочно?"
        description={
          deleteTarget && (
            <>
              Пространство «{deleteTarget.workspaceName}» и связанные с ним данные будут удалены сразу и безвозвратно.
              Восстановить их после этого не получится.
            </>
          )
        }
        confirmLabel={deletingId ? 'Удаление…' : 'Удалить навсегда'}
        destructive
        loading={!!deletingId}
        onConfirm={handleDeleteEarly}
      />
    </PageContainer>
  )
}
