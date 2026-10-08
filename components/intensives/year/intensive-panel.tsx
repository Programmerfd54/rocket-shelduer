"use client"

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { CalendarDays, ClipboardList, Settings2, TriangleAlert, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Skeleton } from '@/components/ui/skeleton'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import type { IntensiveDetail, IntensiveSummary } from '@/lib/intensives/types'
import { ApiError, apiFetch, formatTimezone } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'
import { dayLine, formatPeriod, intensiveView, progressLine } from './year-meta'

export interface CalendarTarget {
  intensive: IntensiveSummary
  /** Подключение пользователя в этом пространстве; null — календарь отфильтруется только по интенсиву */
  workspaceId: string | null
}

type DetailState =
  | { status: 'loading' }
  | { status: 'ready'; workspaces: IntensiveDetail['workspaces'] }
  | { status: 'error'; message: string }

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[104px_minmax(0,1fr)] items-start gap-3 py-2 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

/** Содержимое панели интенсива: сводка, прогресс, переходы. Подключения пользователя подгружаются из GET /api/intensives/[id]. */
export function IntensivePanelBody({
  intensive,
  canManage,
  onOpenCalendar,
}: {
  intensive: IntensiveSummary
  canManage: boolean
  onOpenCalendar: (target: CalendarTarget) => void
}) {
  const view = intensiveView(intensive)
  const [result, setResult] = useState<{ key: string; state: DetailState } | null>(null)
  const [reload, setReload] = useState(0)
  const [wsChoice, setWsChoice] = useState<string | null>(null)
  const detailKey = `${intensive.id}:${reload}`
  const detail = useMemo<DetailState>(
    () => (result?.key === detailKey ? result.state : { status: 'loading' }),
    [result, detailKey]
  )

  useEffect(() => {
    const ctrl = new AbortController()
    apiFetch<{ intensive: IntensiveDetail }>(`/api/intensives/${encodeURIComponent(intensive.id)}`, { signal: ctrl.signal })
      .then((res) => {
        setResult({ key: detailKey, state: { status: 'ready', workspaces: res.intensive.workspaces ?? [] } })
      })
      .catch((e: unknown) => {
        if (ctrl.signal.aborted) return
        setResult({
          key: detailKey,
          state: {
            status: 'error',
            message: e instanceof ApiError && e.status !== 500 ? e.message : 'Не удалось загрузить подключения этого пространства.',
          },
        })
      })
    // Устаревший ответ отбрасывается: cleanup прерывает запрос, а ключ сверяется при чтении
    return () => ctrl.abort()
  }, [intensive.id, detailKey])

  const workspaces = useMemo(() => (detail.status === 'ready' ? detail.workspaces : []), [detail])
  const activeWs = useMemo(() => {
    if (workspaces.length === 0) return null
    return (
      workspaces.find((w) => w.id === wsChoice) ??
      workspaces.find((w) => !w.isArchived) ??
      workspaces[0]
    )
  }, [workspaces, wsChoice])

  const progress = intensive.progress
  const isDraft = intensive.status === 'DRAFT'
  const planHref = activeWs
    ? `/dashboard/workspaces/${encodeURIComponent(activeWs.id)}?intensive=${encodeURIComponent(intensive.id)}&tab=templates`
    : null

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        <Badge
          variant={view.kind === 'running' ? 'info' : 'muted'}
          className={cn(
            view.kind === 'draft' && 'border-dashed border-foreground/40',
            view.kind === 'running' && 'ring-1 ring-sky-500/40'
          )}
        >
          <view.Icon aria-hidden /> {view.label}
        </Badge>
        {intensive.partial && <Badge variant="outline">Доступные вам анонсы</Badge>}
      </div>

      <dl className="divide-y">
        <Row label="Пространство">{intensive.orgSpace.name}</Row>
        <Row label="Период">{formatPeriod(intensive.startDate, intensive.endDate)}</Row>
        <Row label="Часовой пояс">
          <span>{formatTimezone(intensive.timezone)}</span>{' '}
          <span className="font-mono text-xs text-muted-foreground">{intensive.timezone}</span>
          <p className="mt-0.5 text-xs text-muted-foreground">Даты интенсива указаны в этом поясе, а не в вашем.</p>
        </Row>
        <Row label="Состояние">{dayLine(intensive)}</Row>
      </dl>

      {intensive.description && <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{intensive.description}</p>}

      <section aria-label="Прогресс анонсов" className="space-y-2">
        <h3 className="text-sm font-semibold">{intensive.partial ? 'Доступные вам анонсы' : 'Прогресс анонсов'}</h3>
        {isDraft ? (
          <p className="text-sm text-muted-foreground">Черновик: анонсы не отправляются, пока интенсив не опубликован.</p>
        ) : !progress ? (
          <p className="text-sm text-muted-foreground">Прогресс недоступен.</p>
        ) : progress.total === 0 ? (
          <p className="text-sm text-muted-foreground">
            {intensive.partial ? 'Нет анонсов, доступных вам.' : 'В плане пока нет анонсов.'}
          </p>
        ) : (
          <>
            <Progress
              value={Math.round((progress.completed / progress.total) * 100)}
              className="h-1.5 rounded-sm bg-muted [&_[data-slot=progress-indicator]]:bg-foreground/70"
              aria-label={`Выполнено ${progress.completed} из ${progress.total}`}
            />
            <p className="text-sm">{progressLine(progress)}</p>
            {intensive.partial && (
              <p className="text-xs text-muted-foreground">Учитываются только анонсы, которые доступны вашей роли.</p>
            )}
          </>
        )}
      </section>

      {intensive.overlaps && intensive.overlaps.length > 0 && (
        <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
          <TriangleAlert className="mt-0.5 size-3.5 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <span>
            Пересекается с: {intensive.overlaps.map((o) => `«${o.name}»`).join(', ')}. Опубликовать пересекающиеся интенсивы нельзя.
          </span>
        </p>
      )}

      <div className="space-y-2 border-t pt-4">
        {detail.status === 'loading' && (
          <div className="space-y-2" role="status" aria-label="Загрузка доступных подключений">
            <Skeleton className="h-8 w-full" />
            <Skeleton className="h-8 w-full" />
          </div>
        )}
        {detail.status === 'error' && (
          <div role="alert" className="rounded-md border border-destructive/30 p-3 text-sm">
            <p className="text-destructive">{detail.message}</p>
            <Button variant="outline" size="sm" className="mt-2" onClick={() => setReload((n) => n + 1)}>
              Повторить
            </Button>
          </div>
        )}
        {detail.status === 'ready' && workspaces.length > 1 && !isDraft && (
          <div className="space-y-1.5">
            <label htmlFor="intensive-ws" className="text-sm font-medium">
              Подключение
            </label>
            <Select value={activeWs?.id ?? ''} onValueChange={setWsChoice}>
              <SelectTrigger id="intensive-ws" size="sm" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {workspaces.map((w) => (
                  <SelectItem key={w.id} value={w.id}>
                    {w.workspaceName}
                    {w.isArchived ? ' (архив)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {!isDraft && (
          <>
            {planHref ? (
              <Button asChild size="sm" className="w-full justify-start">
                <Link href={planHref}>
                  <ClipboardList /> Открыть план
                </Link>
              </Button>
            ) : (
              <Button size="sm" className="w-full justify-start" disabled>
                <ClipboardList /> Открыть план
              </Button>
            )}
            {detail.status === 'ready' && !planHref && (
              <p className="text-xs text-muted-foreground">
                У вас нет подключений в этом пространстве, поэтому открыть план анонсов нельзя.
              </p>
            )}
            <Button
              variant="outline"
              size="sm"
              className="w-full justify-start"
              disabled={detail.status === 'loading'}
              onClick={() => onOpenCalendar({ intensive, workspaceId: activeWs?.id ?? null })}
            >
              <CalendarDays /> Открыть календарь сообщений
            </Button>
          </>
        )}
        {canManage && (
          <Button asChild variant="outline" size="sm" className="w-full justify-start">
            <Link href={`/dashboard/admin/intensives/${encodeURIComponent(intensive.id)}`}>
              <Settings2 /> Управление интенсивом
            </Link>
          </Button>
        )}
      </div>
    </div>
  )
}

/** Панель справа от шкалы (десктоп). */
export function IntensivePanelDocked({
  intensive,
  canManage,
  onOpenCalendar,
  onClose,
}: {
  intensive: IntensiveSummary
  canManage: boolean
  onOpenCalendar: (t: CalendarTarget) => void
  onClose: () => void
}) {
  return (
    <aside
      className="rounded-lg border bg-card lg:sticky lg:top-4 lg:self-start"
      aria-label={`Интенсив «${intensive.name}»`}
      onKeyDown={(e) => {
        // Escape из выпадающего списка (он в портале) панель не закрывает
        if (e.key === 'Escape' && e.currentTarget.contains(e.target as Node)) onClose()
      }}
    >
      <div className="flex items-start justify-between gap-2 border-b px-4 py-3">
        <h2 className="min-w-0 break-words text-sm font-semibold leading-snug">{intensive.name}</h2>
        <Button variant="ghost" size="icon-sm" className="-mr-2 -mt-1 shrink-0" onClick={onClose} aria-label="Закрыть панель">
          <X />
        </Button>
      </div>
      <div className="max-h-[calc(100vh-10rem)] overflow-y-auto p-4">
        <IntensivePanelBody key={intensive.id} intensive={intensive} canManage={canManage} onOpenCalendar={onOpenCalendar} />
      </div>
    </aside>
  )
}

/** Панель-шторка на узких экранах. */
export function IntensivePanelSheet({
  intensive,
  canManage,
  onOpenCalendar,
  onClose,
}: {
  intensive: IntensiveSummary | null
  canManage: boolean
  onOpenCalendar: (t: CalendarTarget) => void
  onClose: () => void
}) {
  return (
    <Sheet open={intensive !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        {intensive && (
          <>
            <SheetHeader className="border-b p-4 pr-12">
              <SheetTitle className="break-words text-base">{intensive.name}</SheetTitle>
              <SheetDescription>{intensive.orgSpace.name}</SheetDescription>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto p-4">
              <IntensivePanelBody key={intensive.id} intensive={intensive} canManage={canManage} onOpenCalendar={onOpenCalendar} />
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
