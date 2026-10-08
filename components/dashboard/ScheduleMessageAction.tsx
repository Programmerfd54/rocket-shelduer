"use client"

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { ChevronRight, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'

export interface PickableWorkspace {
  id: string
  workspaceName: string
  workspaceUrl?: string | null
  color?: string | null
  isArchived?: boolean
}

/**
 * Главное действие экрана «Запланировать сообщение».
 * Пространство и отправителя за пользователя не выбираем: существующий поток создаёт сообщение
 * на странице пространства (канал → форма), поэтому пространство выбирается явно в диалоге
 * (так же, как в календаре). Нет пространств — ведём к их подключению.
 */
export function ScheduleMessageAction({
  workspaces,
  loading,
  canConnect,
}: {
  workspaces: PickableWorkspace[]
  loading: boolean
  canConnect: boolean
}) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const available = workspaces.filter((w) => !w.isArchived)

  if (!loading && available.length === 0) {
    return (
      <Button size="sm" asChild>
        <Link href="/dashboard/workspaces">
          <Plus aria-hidden />
          {canConnect ? 'Подключить пространство' : 'К пространствам'}
        </Link>
      </Button>
    )
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)} disabled={loading}>
        <Plus aria-hidden />
        Запланировать сообщение
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>В каком пространстве планируем?</DialogTitle>
            <DialogDescription>
              Выберите пространство — откроется его страница, где нужно выбрать канал и время отправки.
            </DialogDescription>
          </DialogHeader>
          <ul className="-mx-2 max-h-[50vh] divide-y overflow-y-auto">
            {available.map((ws) => (
              <li key={ws.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false)
                    router.push(`/dashboard/workspaces/${ws.id}`)
                  }}
                  className="flex min-h-12 w-full items-center gap-3 rounded-md px-2 py-2.5 text-left outline-none transition-colors hover:bg-muted/50 focus-visible:bg-muted/60 focus-visible:ring-2 focus-visible:ring-ring/40"
                >
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-full bg-muted-foreground/40"
                    style={ws.color ? { backgroundColor: ws.color } : undefined}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{ws.workspaceName}</span>
                    {ws.workspaceUrl && (
                      <span className="block truncate font-mono text-xs text-muted-foreground">
                        {ws.workspaceUrl.replace(/^https?:\/\//, '')}
                      </span>
                    )}
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  )
}
