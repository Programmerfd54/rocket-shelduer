"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { 
  Server, 
  Archive,
  Loader2,
  RefreshCw,
  Calendar,
  Trash2,
  RotateCcw
} from 'lucide-react'
import { toast } from 'sonner'
import { formatLocalDate, formatRelativeTime } from '@/lib/utils'

export default function ArchivedWorkspacesPage() {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

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
      .catch(() => {})
  }, [])

  const loadArchivedWorkspaces = async () => {
    try {
      setLoading(true)
      const response = await fetch(`/api/workspace?archived=true&today=${formatLocalDate(new Date())}`)
      if (response.ok) {
        const data = await response.json()
        setWorkspaces(data.workspaces || [])
      } else {
        toast.error('Ошибка загрузки архивов')
      }
    } catch (error) {
      console.error('Failed to load archived workspaces:', error)
      toast.error('Ошибка загрузки архивов')
    } finally {
      setLoading(false)
    }
  }

  const handleUnarchive = async (workspaceId: string) => {
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/archive`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to unarchive')
      }

      toast.success('Пространство восстановлено!')
      loadArchivedWorkspaces()
    } catch (error: any) {
      toast.error(error.message || 'Ошибка восстановления')
    }
  }

  const [deletingId, setDeletingId] = useState<string | null>(null)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)

  const handleDeleteEarly = async (workspaceId: string) => {
    try {
      setDeletingId(workspaceId)
      const response = await fetch(`/api/workspace/${workspaceId}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Ошибка удаления')
      }

      toast.success('Пространство удалено')
      setDeleteConfirmId(null)
      loadArchivedWorkspaces()
    } catch (error: any) {
      toast.error(error.message || 'Ошибка удаления')
    } finally {
      setDeletingId(null)
    }
  }

  const getDaysUntilDeletion = (archiveDeleteAt: string | null) => {
    if (!archiveDeleteAt) return null
    const deleteDate = new Date(archiveDeleteAt)
    const now = new Date()
    const diff = deleteDate.getTime() - now.getTime()
    const days = Math.ceil(diff / (1000 * 60 * 60 * 24))
    return days
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
      </div>
    )
  }

  return (
    <div className="p-6 space-y-6 max-w-7xl mx-auto">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-foreground">
            Архив пространств
          </h1>
          <p className="text-muted-foreground mt-1 text-sm sm:text-base">
            Заархивированные пространства будут удалены через 2 недели
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button variant="outline" size="sm" onClick={loadArchivedWorkspaces} disabled={loading}>
            <RefreshCw className={`w-4 h-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
            Перезагрузить
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/dashboard/workspaces">
              Назад к пространствам
            </Link>
          </Button>
        </div>
      </div>

      {/* Workspaces List */}
      {workspaces.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-16">
            <div className="w-16 h-16 bg-muted rounded-2xl flex items-center justify-center mb-4">
              <Archive className="w-8 h-8 text-muted-foreground" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Нет заархивированных пространств</h3>
            <p className="text-sm text-muted-foreground text-center max-w-sm mb-4">
              Здесь будут отображаться пространства, которые вы заархивировали
            </p>
            <Button variant="outline" asChild>
              <Link href="/dashboard/workspaces">
                Вернуться к пространствам
              </Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {workspaces.map((workspace) => {
            const daysLeft = getDaysUntilDeletion(workspace.archiveDeleteAt)
            const isUrgent = daysLeft !== null && daysLeft <= 3

            return (
              <Card 
                key={workspace.id} 
                className={`rounded-xl border ${isUrgent ? 'border-destructive/50 bg-destructive/5' : 'border-border'}`}
              >
                <CardContent className="p-5">
                  <div className="space-y-4">
                    {/* Header */}
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-3 flex-1 min-w-0">
                        <div 
                          className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0"
                          style={{ backgroundColor: workspace.color || '#ef4444' }}
                        >
                          <Server className="w-5 h-5 text-white" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <h3 className="font-semibold truncate" title={workspace.workspaceName}>
                            {workspace.workspaceName}
                          </h3>
                          <p className="text-xs text-muted-foreground truncate" title={workspace.workspaceUrl}>
                            {workspace.workspaceUrl.replace(/^https?:\/\//, '')}
                          </p>
                        </div>
                      </div>
                      <Badge variant="secondary" className="shrink-0 text-xs">
                        <Archive className="w-3 h-3 mr-1" />
                        Архив
                      </Badge>
                    </div>

                    {/* Archive Info */}
                    <div className="rounded-lg bg-muted/40 p-3 space-y-1.5 border border-border/60">
                      {workspace.archivedAt && (
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Calendar className="w-3.5 h-3.5 shrink-0" />
                          <span>Заархивировано: {formatRelativeTime(workspace.archivedAt)}</span>
                        </div>
                      )}
                      {daysLeft !== null && (
                        <div className={`flex items-center gap-2 text-xs font-medium ${
                          isUrgent ? 'text-destructive' : 'text-muted-foreground'
                        }`}>
                          <Trash2 className="w-3.5 h-3.5 shrink-0" />
                          <span>
                            {daysLeft > 0 
                              ? `Удаление через ${daysLeft} ${daysLeft === 1 ? 'день' : daysLeft < 5 ? 'дня' : 'дней'}`
                              : 'Будет удалено сегодня'
                            }
                          </span>
                        </div>
                      )}
                    </div>

                    {/* Actions */}
                    <div className="flex flex-col gap-2">
                      <Button
                        onClick={() => handleUnarchive(workspace.id)}
                        variant="outline"
                        size="sm"
                        className="w-full"
                      >
                        <RotateCcw className="w-4 h-4 mr-2" />
                        Восстановить
                      </Button>
                      {deleteConfirmId === workspace.id ? (
                        <div className="flex gap-2">
                          <Button
                            variant="destructive"
                            size="sm"
                            className="flex-1"
                            disabled={deletingId === workspace.id}
                            onClick={() => handleDeleteEarly(workspace.id)}
                          >
                            {deletingId === workspace.id ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Trash2 className="w-4 h-4 mr-2" />}
                            Подтвердить удаление
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDeleteConfirmId(null)}
                          >
                            Отмена
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full text-destructive hover:text-destructive hover:bg-destructive/10 border-destructive/30"
                          onClick={() => setDeleteConfirmId(workspace.id)}
                        >
                          <Trash2 className="w-4 h-4 mr-2" />
                          Удалить досрочно
                        </Button>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            )
          })}
        </div>
      )}
    </div>
  )
}
