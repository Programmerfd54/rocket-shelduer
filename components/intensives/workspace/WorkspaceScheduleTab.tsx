'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import {
  AlertTriangle,
  Archive,
  BellOff,
  CalendarRange,
  ExternalLink,
  FileText,
  Loader2,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Rocket,
  Users,
  XCircle,
} from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'
import { ApiError, apiFetch, formatTimezone, pluralize } from '@/lib/intensives/ui'
import type { IntensiveDetail, IntensiveOverlapRef, IntensiveSummary } from '@/lib/intensives/types'
import { CancelIntensiveDialog } from '@/components/intensives/admin/CancelIntensiveDialog'
import { IntensiveFormDialog } from '@/components/intensives/admin/IntensiveFormDialog'
import {
  IntensiveBadges,
  InlineNotice,
  LoadError,
  ProgressSummary,
  daysLabel,
  errText,
  overlapText,
  periodLabel,
  useDeferredEffect,
  useSeq,
} from '@/components/intensives/admin/kit'
import { ArchivePromptSwitch } from './ArchivePromptSwitch'

export const SCHEDULE_EXPLANATION =
  'Пока в графике есть предстоящий или идущий интенсив, система не предложит архивировать пространство.'

const ACTIVE_STATUSES = 'DRAFT,PUBLISHED'
const ALL_STATUSES = 'DRAFT,PUBLISHED,CANCELLED,ARCHIVED'

export interface ScheduleWorkspace {
  workspaceName?: string
  isArchived?: boolean
  orgSpaceId?: string | null
  suppressArchivePrompt?: boolean
  canEditArchivePrompt?: boolean
}

function RowsSkeleton() {
  return (
    <div className="divide-y rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка графика интенсивов">
      {[0, 1, 2].map((r) => (
        <div key={r} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-48 max-w-full" />
            <Skeleton className="h-3 w-64 max-w-full" />
          </div>
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-8 w-full sm:w-40" />
        </div>
      ))}
    </div>
  )
}

/** Активный (DRAFT/PUBLISHED) интенсив ещё не закончился — его даты держат пространство «нужным». */
function isUpcomingOrRunning(i: IntensiveSummary): boolean {
  if (i.status === 'DRAFT') return i.day.today <= i.endDate
  return i.status === 'PUBLISHED' && i.phase !== 'FINISHED'
}

/**
 * Вкладка «Интенсивы» страницы пространства: график интенсивов этого пространства.
 * Lead_SUP — добавляет, редактирует, публикует, отменяет, архивирует; остальные — видят опубликованные (сервер не
 * отдаёт им черновики). Организационное пространство создаётся сервером при первом интенсиве и в UI не показывается.
 */
export function WorkspaceScheduleTab({
  workspaceId,
  workspace,
  currentUserRole,
  canOpenPlan,
  onOpenPlan,
  onChanged,
  canSeeMembers,
  onShowMembers,
}: {
  workspaceId: string
  workspace: ScheduleWorkspace
  currentUserRole: string
  /** Есть вкладка «Шаблоны» (там план выбранного интенсива) */
  canOpenPlan: boolean
  onOpenPlan: (intensiveId: string) => void
  /** График изменился: обновить выбор интенсива на странице и признак archiveSuggested */
  onChanged: () => void
  canSeeMembers: boolean
  onShowMembers: () => void
}) {
  const isLead = currentUserRole === 'LEAD_SUP'
  const [showAll, setShowAll] = useState(false)
  const [items, setItems] = useState<IntensiveSummary[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fetching, setFetching] = useState(true)
  const seq = useSeq()

  const [createOpen, setCreateOpen] = useState(false)
  const [editTarget, setEditTarget] = useState<IntensiveSummary | null>(null)
  const [publishTarget, setPublishTarget] = useState<IntensiveSummary | null>(null)
  const [archiveTarget, setArchiveTarget] = useState<IntensiveSummary | null>(null)
  const [cancelDetail, setCancelDetail] = useState<IntensiveDetail | null>(null)
  const [conflicts, setConflicts] = useState<{ intensive: IntensiveSummary; list: IntensiveOverlapRef[] } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  const load = useCallback(
    async (all: boolean) => {
      const token = seq.begin()
      setFetching(true)
      try {
        const res = await apiFetch<{ intensives: IntensiveSummary[] }>(
          `/api/intensives?workspaceId=${encodeURIComponent(workspaceId)}&status=${all ? ALL_STATUSES : ACTIVE_STATUSES}`,
        )
        if (!seq.isCurrent(token)) return
        setItems(res.intensives)
        setError(null)
      } catch (e) {
        if (!seq.isCurrent(token)) return
        setError(errText(e))
      } finally {
        if (seq.isCurrent(token)) setFetching(false)
      }
    },
    [workspaceId, seq],
  )

  useDeferredEffect(() => {
    void load(showAll)
  }, [load, showAll])

  const afterChange = useCallback(async () => {
    await load(showAll)
    onChanged()
  }, [load, showAll, onChanged])

  const sorted = useMemo(() => {
    const list = [...(items ?? [])]
    // Сначала то, что держит пространство (идёт/предстоит), затем завершённые и отменённые — по дате начала
    list.sort((a, b) => {
      const ra = isUpcomingOrRunning(a) ? 0 : 1
      const rb = isUpcomingOrRunning(b) ? 0 : 1
      return ra - rb || a.startDate.localeCompare(b.startDate) || a.name.localeCompare(b.name, 'ru')
    })
    return list
  }, [items])
  const upcomingCount = useMemo(() => (items ?? []).filter(isUpcomingOrRunning).length, [items])

  const handleVersionConflict = async () => {
    toast.error('Интенсив изменён другим пользователем', { description: 'Список обновлён — повторите действие.' })
    await load(showAll)
  }

  const publish = async () => {
    const target = publishTarget
    if (!target) return
    setBusy(`publish:${target.id}`)
    try {
      await apiFetch(`/api/intensives/${target.id}/publish`, { method: 'POST', json: { version: target.version } })
      toast.success('Интенсив опубликован', { description: 'Он виден участникам пространства и в календаре. Отправки не запускались.' })
      setPublishTarget(null)
      await afterChange()
    } catch (e) {
      setPublishTarget(null)
      if (e instanceof ApiError && e.code === 'INTENSIVE_OVERLAP') {
        setConflicts({ intensive: target, list: Array.isArray(e.body.conflicts) ? (e.body.conflicts as IntensiveOverlapRef[]) : [] })
      } else if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        await handleVersionConflict()
      } else {
        toast.error('Не удалось опубликовать', { description: errText(e) })
        if (e instanceof ApiError && e.status === 409) await load(showAll)
      }
    } finally {
      setBusy(null)
    }
  }

  const archive = async () => {
    const target = archiveTarget
    if (!target) return
    setBusy(`archive:${target.id}`)
    try {
      const res = await apiFetch<{ pendingMessages?: number }>(`/api/intensives/${target.id}/archive`, {
        method: 'POST',
        json: { version: target.version },
      })
      toast.success('Интенсив в архиве', {
        description: res.pendingMessages
          ? `Запланированные сообщения (${res.pendingMessages}) не изменены.`
          : 'Сообщения и пространство не затронуты.',
      })
      setArchiveTarget(null)
      await afterChange()
    } catch (e) {
      setArchiveTarget(null)
      if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') await handleVersionConflict()
      else {
        toast.error('Не удалось архивировать интенсив', { description: errText(e) })
        if (e instanceof ApiError && e.status === 409) await load(showAll)
      }
    } finally {
      setBusy(null)
    }
  }

  /** Отмена: диалогу нужна карточка (подключения для списка ожидающих отправок). */
  const openCancel = async (i: IntensiveSummary) => {
    setBusy(`cancel:${i.id}`)
    try {
      const res = await apiFetch<{ intensive: IntensiveDetail }>(`/api/intensives/${i.id}`)
      setCancelDetail(res.intensive)
    } catch (e) {
      toast.error('Не удалось открыть отмену', { description: errText(e) })
    } finally {
      setBusy(null)
    }
  }

  const canArchiveIntensive = (i: IntensiveSummary) =>
    i.status === 'DRAFT' || i.status === 'CANCELLED' || (i.status === 'PUBLISHED' && i.phase === 'FINISHED')
  const canCancelIntensive = (i: IntensiveSummary) => i.status === 'DRAFT' || i.status === 'PUBLISHED'

  const header = (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
      <div className="min-w-0 space-y-0.5">
        <h2 className="text-sm font-semibold">График интенсивов</h2>
        <p className="text-[13px] text-muted-foreground text-pretty">{SCHEDULE_EXPLANATION}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Обновить график"
          title="Обновить график"
          disabled={fetching}
          onClick={() => void load(showAll)}
        >
          <RefreshCw className={cn(fetching && 'animate-spin')} aria-hidden />
        </Button>
        {isLead && (
          <Button size="sm" onClick={() => setCreateOpen(true)}>
            <Plus aria-hidden />
            Добавить интенсив
          </Button>
        )}
      </div>
    </div>
  )

  const settings = (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      {isLead && workspace.canEditArchivePrompt !== false && !workspace.isArchived ? (
        <ArchivePromptSwitch
          workspaceId={workspaceId}
          value={workspace.suppressArchivePrompt === true}
          onChanged={() => onChanged()}
          id="schedule-suppress-archive-prompt"
        />
      ) : workspace.suppressArchivePrompt ? (
        <p className="flex items-start gap-2 text-[13px] text-muted-foreground">
          <BellOff className="mt-0.5 size-4 shrink-0" aria-hidden />
          Lead_SUP отключил предложение архивировать это пространство.
        </p>
      ) : null}
      {canSeeMembers && (
        <div
          className={cn(
            'flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between',
            (isLead || workspace.suppressArchivePrompt) && 'border-t pt-3',
          )}
        >
          <div className="flex min-w-0 items-start gap-2">
            <Users className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="text-sm font-medium">Участники пространства</p>
              <p className="text-xs text-muted-foreground">
                Lead_SUP добавляет пользователей в пространство — они видят опубликованные интенсивы этого графика.
              </p>
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={onShowMembers}>
            Открыть участников
          </Button>
        </div>
      )}
    </div>
  )

  const showSettings = isLead || workspace.suppressArchivePrompt || canSeeMembers

  return (
    <div className="space-y-4">
      {header}
      {showSettings && settings}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px] text-muted-foreground" aria-live="polite">
          {items === null
            ? ' '
            : upcomingCount > 0
              ? `Предстоящих и идущих: ${upcomingCount}`
              : 'Предстоящих и идущих интенсивов нет'}
        </p>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-pressed={showAll}
          onClick={() => setShowAll((v) => !v)}
        >
          {showAll ? 'Скрыть отменённые и архивные' : 'Показать отменённые и архивные'}
        </Button>
      </div>

      {items === null && fetching && <RowsSkeleton />}

      {error && (
        <LoadError
          message={items ? `${error} Показаны ранее загруженные данные.` : error}
          onRetry={() => void load(showAll)}
          retrying={fetching}
        />
      )}

      {items !== null &&
        (sorted.length === 0 ? (
          !error && (
            <EmptyState
              icon={<CalendarRange />}
              title={showAll ? 'В графике нет интенсивов' : 'Нет активных интенсивов'}
              description={
                isLead
                  ? 'Добавьте интенсив: название, даты и часовой пояс. Он создаётся черновиком и ничего не отправляет.'
                  : 'График интенсивов этого пространства заполняет Lead_SUP.'
              }
              action={isLead ? { label: 'Добавить интенсив', onClick: () => setCreateOpen(true) } : undefined}
            />
          )
        ) : (
          <ul
            className={cn('divide-y overflow-hidden rounded-lg border bg-card transition-opacity', fetching && 'opacity-60')}
            aria-busy={fetching}
            aria-label="Интенсивы пространства"
          >
            {sorted.map((i) => {
              const overlaps = isLead ? (i.overlaps ?? []) : []
              const rowBusy = busy !== null && busy.endsWith(`:${i.id}`)
              const muted = !isUpcomingOrRunning(i)
              return (
                <li key={i.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
                  <div className={cn('min-w-0 flex-1 space-y-1', muted && 'opacity-80')}>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                      <span className="min-w-0 break-words text-sm font-medium">{i.name}</span>
                      <IntensiveBadges status={i.status} phase={i.phase} />
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {periodLabel(i.startDate, i.endDate)} · {daysLabel(i.day.totalDays)} · {formatTimezone(i.timezone)}
                      {i.status === 'PUBLISHED' && i.phase === 'RUNNING' && i.day.dayNumber
                        ? ` · День ${i.day.dayNumber} из ${i.day.totalDays}`
                        : ''}
                    </p>
                    {overlaps.length > 0 && (
                      <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400">
                        <AlertTriangle className="mt-px size-3.5 shrink-0" aria-hidden />
                        <span>
                          Пересечение периодов: {overlaps.slice(0, 2).map(overlapText).join('; ')}
                          {overlaps.length > 2 ? ` и ещё ${overlaps.length - 2}` : ''}
                          {i.status === 'DRAFT' ? '. Публикация заблокирована.' : ''}
                        </span>
                      </p>
                    )}
                    <div className="max-w-sm pt-0.5">
                      {i.status === 'DRAFT' ? (
                        <p className="text-[13px] text-muted-foreground">
                          {i.progress && i.progress.total > 0
                            ? `В плане ${i.progress.total} ${pluralize(i.progress.total, 'пункт', 'пункта', 'пунктов')}`
                            : 'План не сформирован'}
                        </p>
                      ) : (
                        <ProgressSummary progress={i.progress} partial={i.partial} compact status={i.status} />
                      )}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-wrap items-center gap-2">
                    {canOpenPlan && (
                      <Button type="button" variant="outline" size="sm" onClick={() => onOpenPlan(i.id)}>
                        <FileText aria-hidden />
                        Открыть план
                      </Button>
                    )}
                    {isLead && i.status === 'DRAFT' && (
                      <Button type="button" size="sm" onClick={() => setPublishTarget(i)} disabled={rowBusy}>
                        {busy === `publish:${i.id}` ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
                        Опубликовать
                      </Button>
                    )}
                    {isLead && (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="outline"
                            size="icon-sm"
                            aria-label={`Действия с интенсивом «${i.name}»`}
                            disabled={rowBusy}
                          >
                            {rowBusy ? <Loader2 className="animate-spin" aria-hidden /> : <MoreHorizontal aria-hidden />}
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-64">
                          <DropdownMenuItem disabled={i.status === 'ARCHIVED'} onSelect={() => setEditTarget(i)}>
                            <Pencil aria-hidden />
                            Редактировать
                          </DropdownMenuItem>
                          <DropdownMenuItem asChild>
                            <Link href={`/dashboard/admin/intensives/${i.id}`}>
                              <ExternalLink aria-hidden />
                              Карточка интенсива
                            </Link>
                          </DropdownMenuItem>
                          <DropdownMenuSeparator />
                          <DropdownMenuItem disabled={!canArchiveIntensive(i)} onSelect={() => setArchiveTarget(i)}>
                            <Archive aria-hidden />
                            <span className="flex flex-col">
                              Архивировать
                              {!canArchiveIntensive(i) && (
                                <span className="text-xs font-normal text-muted-foreground">
                                  {i.status === 'ARCHIVED' ? 'Уже в архиве' : 'Доступно после завершения периода'}
                                </span>
                              )}
                            </span>
                          </DropdownMenuItem>
                          <DropdownMenuItem
                            variant="destructive"
                            disabled={!canCancelIntensive(i)}
                            onSelect={() => void openCancel(i)}
                          >
                            <XCircle aria-hidden />
                            Отменить интенсив…
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        ))}

      {isLead && (
        <>
          <IntensiveFormDialog
            open={createOpen}
            onOpenChange={setCreateOpen}
            mode="create"
            workspaceId={workspaceId}
            defaultOrgSpaceId={workspace.orgSpaceId ?? undefined}
            siblings={items ?? []}
            onSaved={() => void afterChange()}
          />
          <IntensiveFormDialog
            open={!!editTarget}
            onOpenChange={(o) => !o && setEditTarget(null)}
            mode="edit"
            intensive={editTarget ?? undefined}
            workspaceId={workspaceId}
            siblings={items ?? []}
            onSaved={() => void afterChange()}
            onStale={() => void load(showAll)}
          />
          <ConfirmDialog
            open={!!publishTarget}
            onOpenChange={(o) => !o && setPublishTarget(null)}
            title={publishTarget ? `Опубликовать «${publishTarget.name}»?` : 'Опубликовать интенсив?'}
            description={
              <div className="space-y-1.5">
                <p>Интенсив станет виден участникам пространства и в календаре. Публикация ничего не отправляет.</p>
                {publishTarget && (publishTarget.progress?.total ?? 0) === 0 && (
                  <p className="text-amber-700 dark:text-amber-400">В плане нет пунктов — соберите план в карточке интенсива.</p>
                )}
                {publishTarget && (publishTarget.overlaps?.length ?? 0) > 0 && (
                  <p className="text-amber-700 dark:text-amber-400">Есть пересечение периодов — сервер может отклонить публикацию.</p>
                )}
              </div>
            }
            confirmLabel="Опубликовать"
            loading={!!publishTarget && busy === `publish:${publishTarget.id}`}
            onConfirm={publish}
          />
          <ConfirmDialog
            open={!!archiveTarget}
            onOpenChange={(o) => !o && setArchiveTarget(null)}
            title={archiveTarget ? `Архивировать «${archiveTarget.name}»?` : 'Архивировать интенсив?'}
            description="Интенсив уйдёт в архив. Сообщения, история и пространство не затрагиваются. Из архива вернуть нельзя."
            confirmLabel="Архивировать"
            loading={!!archiveTarget && busy === `archive:${archiveTarget.id}`}
            onConfirm={archive}
          />
          {cancelDetail && (
            <CancelIntensiveDialog
              open={!!cancelDetail}
              onOpenChange={(o) => !o && setCancelDetail(null)}
              intensive={cancelDetail}
              onCancelled={afterChange}
              onVersionConflict={() => {
                setCancelDetail(null)
                void handleVersionConflict()
              }}
            />
          )}
          <Dialog open={conflicts !== null} onOpenChange={(o) => !o && setConflicts(null)}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Публикация невозможна: пересечение периодов</DialogTitle>
                <DialogDescription>
                  В графике пространства нельзя опубликовать два интенсива с пересекающимися датами. Измените период или
                  отмените конфликтующий интенсив.
                </DialogDescription>
              </DialogHeader>
              {conflicts && conflicts.list.length > 0 ? (
                <ul className="divide-y rounded-md border">
                  {conflicts.list.map((c) => (
                    <li key={c.id} className="px-3 py-2 text-sm">
                      <span className="block truncate font-medium">{c.name}</span>
                      <span className="block text-xs text-muted-foreground">{periodLabel(c.startDate, c.endDate)}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <InlineNotice tone="info">Другой интенсив публикуется прямо сейчас. Подождите немного и повторите.</InlineNotice>
              )}
              <DialogFooter>
                <Button variant="outline" onClick={() => setConflicts(null)}>
                  Закрыть
                </Button>
                <Button
                  onClick={() => {
                    const target = conflicts?.intensive ?? null
                    setConflicts(null)
                    if (target) setEditTarget(target)
                  }}
                >
                  Изменить период
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </>
      )}
    </div>
  )
}
