"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Loader2, FileText } from 'lucide-react'
import { formatRelativeTime, getActivityLabel, formatActivityDetails } from '@/lib/utils'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { toast } from 'sonner'

export default function AdminAuditPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [logs, setLogs] = useState<any[]>([])
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
      const res = await fetch(`/api/admin/audit?page=${page}&limit=${limit}`)
      if (!res.ok) {
        if (res.status === 403) {
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
      toast.error('Ошибка загрузки журнала', {
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
        if (d?.user?.role !== 'SUPPORT' && d?.user?.role !== 'ADMIN') {
          router.push('/dashboard/admin')
        }
      })
      .catch(() => router.push('/login'))
  }, [router])

  if (loading && logs.length === 0) {
    return (
      <div className="w-full container max-w-5xl py-8 px-4 sm:px-6 mx-auto">
        <div className="h-6 w-48 bg-muted animate-pulse rounded mb-6" />
        <Card>
          <CardHeader>
            <div className="h-6 w-64 bg-muted animate-pulse rounded" />
            <div className="h-4 w-96 bg-muted animate-pulse rounded mt-2" />
          </CardHeader>
          <CardContent className="space-y-2">
            {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
              <div key={i} className="h-12 bg-muted animate-pulse rounded" />
            ))}
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="w-full container max-w-5xl py-8 px-4 sm:px-6 mx-auto">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Админ панель', href: '/dashboard/admin' },
          { label: 'Журнал действий', current: true },
        ]}
        className="mb-6"
      />
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Журнал действий администраторов
          </CardTitle>
          <CardDescription>
            Действия SUP и ADMIN: блокировка, разблокировка, смена ролей, создание пользователей, архивация пространств
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <p className="text-center text-muted-foreground py-8">Нет записей</p>
          ) : (
            <ul className="space-y-2">
              {logs.map((log: any) => (
                <li
                  key={log.id}
                  className="flex flex-wrap items-center gap-2 py-3 border-b border-border/50 last:border-0 text-sm"
                >
                  <span className="text-muted-foreground shrink-0 w-36">
                    {formatRelativeTime(log.createdAt)}
                  </span>
                  <span className="font-medium text-muted-foreground shrink-0">
                    {log.user?.name || log.user?.email}
                  </span>
                  <span className="text-primary font-medium">
                    {getActivityLabel(log.action)}
                  </span>
                  {log.details && (
                    <span className="text-muted-foreground truncate max-w-md">
                      {formatActivityDetails(log.details)}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
          {totalPages > 1 && (
            <div className="flex items-center justify-between pt-4 mt-4 border-t">
              <p className="text-sm text-muted-foreground">
                Стр. {page} из {totalPages} ({total} записей)
              </p>
              <div className="flex gap-1">
                <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                  Назад
                </Button>
                <Button variant="outline" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
                  Вперёд
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
