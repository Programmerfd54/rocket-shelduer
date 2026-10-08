"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { ChevronLeft, ChevronRight, FileText, RefreshCw } from 'lucide-react'
import { formatRelativeTime, getActivityLabel, formatActivityDetails } from '@/lib/utils'
import { ROLE_LABELS } from '@/lib/roles'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { EmptyState } from '@/components/common/EmptyState'
import { toast } from 'sonner'

type AuditLog = {
  id: string
  action: string
  details?: string | null
  createdAt: string
  user?: { name?: string | null; email?: string | null } | null
}

export default function AdminAuditPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const [logs, setLogs] = useState<AuditLog[]>([])
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const limit = 30

  useEffect(() => {
    loadAudit()
  }, [page])

  const loadAudit = async () => {
    try {
      setLoading(true)
      setLoadError(false)
      const res = await fetch(`/api/admin/audit?page=${page}&limit=${limit}`)
      if (!res.ok) {
        if (res.status === 403) {
          toast.error('Нет доступа к журналу действий')
          router.push('/dashboard/admin')
          return
        }
        throw new Error('Failed to load audit')
      }
      const data = await res.json()
      setLogs(data.logs)
      setTotal(data.total)
      setTotalPages(data.totalPages)
    } catch (e) {
      console.error(e)
      setLoadError(true)
      toast.error('Не удалось загрузить журнал. Проверьте соединение и повторите.', {
        action: { label: 'Повторить', onClick: () => loadAudit() },
      })
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        if (d?.user?.role !== 'SUP' && d?.user?.role !== 'LEAD_SUP') {
          router.push('/dashboard/admin')
        }
      })
      .catch(() => router.push('/login'))
  }, [router])

  const firstLoad = loading && logs.length === 0

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Журнал действий', current: true },
            ]}
          />
        }
        title="Журнал действий"
        description={`Действия ${ROLE_LABELS.SUP} и ${ROLE_LABELS.LEAD_SUP}: блокировка и разблокировка, смена ролей, создание пользователей, архивация пространств.`}
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadAudit()}
            disabled={loading}
            aria-label="Обновить журнал"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        }
      />

      {firstLoad ? (
        <div
          className="divide-y rounded-lg border bg-card"
          role="status"
          aria-busy="true"
          aria-label="Загрузка журнала"
        >
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="h-4 w-24 shrink-0" />
              <Skeleton className="h-4 w-28 shrink-0" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="ml-auto hidden h-4 w-48 sm:block" />
            </div>
          ))}
        </div>
      ) : logs.length === 0 ? (
        <EmptyState
          icon={<FileText />}
          title={loadError ? 'Не удалось загрузить журнал' : 'Записей пока нет'}
          description={
            loadError
              ? 'Проверьте соединение и попробуйте ещё раз.'
              : 'Действия администраторов появятся здесь сразу после выполнения.'
          }
          action={loadError ? { label: 'Повторить', onClick: () => loadAudit() } : undefined}
        />
      ) : (
        <div
          className={`overflow-hidden rounded-lg border bg-card transition-opacity ${loading ? 'opacity-60' : ''}`}
          aria-busy={loading}
        >
          <ul className="divide-y">
            {logs.map((log) => (
              <li
                key={log.id}
                className="flex flex-col gap-0.5 px-4 py-2.5 text-sm hover:bg-muted/40 sm:flex-row sm:items-baseline sm:gap-4"
              >
                <span className="shrink-0 text-xs text-muted-foreground sm:w-32">
                  {formatRelativeTime(log.createdAt)}
                </span>
                <span className="shrink-0 text-muted-foreground sm:w-40 sm:truncate" title={log.user?.name || log.user?.email || undefined}>
                  {log.user?.name || log.user?.email}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-foreground">{getActivityLabel(log.action)}</span>
                  {log.details && (
                    <span className="ml-2 break-words text-muted-foreground">
                      {formatActivityDetails(log.details)}
                    </span>
                  )}
                </span>
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="flex flex-col gap-2 border-t px-4 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                Страница {page} из {totalPages} · всего записей: {total.toLocaleString('ru-RU')}
              </p>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page <= 1 || loading}
                  onClick={() => setPage((p) => p - 1)}
                >
                  <ChevronLeft className="size-4" />
                  Назад
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={page >= totalPages || loading}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Вперёд
                  <ChevronRight className="size-4" />
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </PageContainer>
  )
}
