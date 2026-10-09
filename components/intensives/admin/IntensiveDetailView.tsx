'use client'

import { useCallback, useMemo, useState } from 'react'
import Link from 'next/link'
import { useParams } from 'next/navigation'
import { Archive, CalendarOff, ExternalLink, Loader2, MoreHorizontal, Pencil, RefreshCw, Rocket, XCircle } from 'lucide-react'
import { toast } from 'sonner'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { PageLoading } from '@/components/common/PageLoading'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ApiError, apiFetch, formatTimezone } from '@/lib/intensives/ui'
import type { IntensiveDetail, IntensiveOverlapRef, PlanResponse } from '@/lib/intensives/types'
import { CancelIntensiveDialog } from './CancelIntensiveDialog'
import { FeatureGate } from './FeatureGate'
import { HistoryTab } from './HistoryTab'
import { IntensiveFormDialog } from './IntensiveFormDialog'
import { IntensiveBadges, InlineNotice, LoadError, daysLabel, errText, formatInstant, overlapText, periodLabel, useDeferredEffect, useSeq } from './kit'
import { LinkMessagesTab } from './LinkMessagesTab'
import { PlanTab, type PlanData } from './PlanTab'
import { useOrgSpaces } from './hooks'

/** Загрузка карточки и плана; поздние ответы не затирают новые; при обновлении старые данные остаются. */
function useIntensiveData(id: string) {
  const [detail, setDetail] = useState<IntensiveDetail | null>(null)
  const [detailError, setDetailError] = useState<{ message: string; notFound: boolean } | null>(null)
  const [detailLoading, setDetailLoading] = useState(true)
  const [plan, setPlan] = useState<PlanResponse | null>(null)
  const [planError, setPlanError] = useState<string | null>(null)
  const [planFetching, setPlanFetching] = useState(true)
  const detailSeq = useSeq()
  const planSeq = useSeq()

  const reloadDetail = useCallback(async () => {
    const token = detailSeq.begin()
    setDetailLoading(true)
    try {
      const res = await apiFetch<{ intensive: IntensiveDetail }>(`/api/intensives/${id}`)
      if (!detailSeq.isCurrent(token)) return
      setDetail(res.intensive)
      setDetailError(null)
    } catch (e) {
      if (!detailSeq.isCurrent(token)) return
      setDetailError({ message: errText(e), notFound: e instanceof ApiError && e.status === 404 })
    } finally {
      if (detailSeq.isCurrent(token)) setDetailLoading(false)
    }
  }, [id, detailSeq])

  const reloadPlan = useCallback(async () => {
    const token = planSeq.begin()
    setPlanFetching(true)
    try {
      const res = await apiFetch<PlanResponse>(`/api/intensives/${id}/plan`)
      if (!planSeq.isCurrent(token)) return
      setPlan(res)
      setPlanError(null)
    } catch (e) {
      if (planSeq.isCurrent(token)) setPlanError(errText(e))
    } finally {
      if (planSeq.isCurrent(token)) setPlanFetching(false)
    }
  }, [id, planSeq])

  useDeferredEffect(() => {
    setDetail(null)
    setPlan(null)
    setDetailError(null)
    void reloadDetail()
    void reloadPlan()
  }, [reloadDetail, reloadPlan])

  const refreshAll = useCallback(async () => {
    await Promise.all([reloadDetail(), reloadPlan()])
  }, [reloadDetail, reloadPlan])

  return { detail, detailError, detailLoading, plan, planError, planFetching, reloadDetail, reloadPlan, refreshAll }
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-x-3 gap-y-0.5 py-1.5 text-[13px] sm:grid-cols-[10rem_1fr]">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </div>
  )
}

function DetailContent({ id }: { id: string }) {
  const data = useIntensiveData(id)
  const { detail, detailError, detailLoading, plan, planError, planFetching, reloadDetail, reloadPlan, refreshAll } = data
  const { orgSpaces } = useOrgSpaces()

  const [tab, setTab] = useState('plan')
  const [historyFilter, setHistoryFilter] = useState<{ id: string; title: string } | null>(null)
  const [editOpen, setEditOpen] = useState(false)
  const [publishOpen, setPublishOpen] = useState(false)
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [cancelOpen, setCancelOpen] = useState(false)
  const [acting, setActing] = useState<'publish' | 'archive' | null>(null)
  const [conflicts, setConflicts] = useState<IntensiveOverlapRef[] | null>(null)
  const [stale, setStale] = useState(false)

  const planData: PlanData = useMemo(
    () => ({ plan, loading: planFetching && !plan, fetching: planFetching, error: planError, reload: () => void reloadPlan() }),
    [plan, planFetching, planError, reloadPlan],
  )
  const titles = useMemo(() => new Map((plan?.items ?? []).map((i) => [i.id, i.title])), [plan])

  const spaceRefs = useMemo(() => (orgSpaces ?? []).map((o) => ({ id: o.id, name: o.name })), [orgSpaces])

  if (detailError && !detail) {
    if (detailError.notFound) {
      return (
        <PageContainer size="default" className="px-4 sm:px-6">
          <EmptyState
            icon={<CalendarOff />}
            title="Интенсив не найден"
            description="Возможно, он был удалён или у вас нет к нему доступа."
            action={{ label: 'К списку интенсивов', href: '/dashboard/admin/intensives' }}
          />
        </PageContainer>
      )
    }
    return (
      <PageContainer size="default" className="px-4 sm:px-6">
        <LoadError message={detailError.message} onRetry={() => void reloadDetail()} retrying={detailLoading} />
      </PageContainer>
    )
  }
  if (!detail) return <PageLoading variant="detail" />

  const phase = detail.phase
  const finished = detail.status === 'PUBLISHED' && phase === 'FINISHED'
  const canArchive = detail.status === 'DRAFT' || detail.status === 'CANCELLED' || finished
  const canCancel = detail.status === 'DRAFT' || detail.status === 'PUBLISHED'
  const canEdit = detail.status !== 'ARCHIVED'
  const overlaps = detail.overlaps ?? []

  const dayText =
    detail.status === 'PUBLISHED' && phase === 'RUNNING' && detail.day.dayNumber
      ? `День ${detail.day.dayNumber} из ${detail.day.totalDays}`
      : daysLabel(detail.day.totalDays)

  const handleActionError = async (e: unknown, title: string) => {
    if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
      setStale(true)
      toast.error('Интенсив изменён другим пользователем', { description: 'Обновите страницу и повторите действие.' })
      return
    }
    toast.error(title, { description: errText(e) })
    if (e instanceof ApiError && e.status === 409) await refreshAll()
  }

  const publish = async () => {
    setActing('publish')
    try {
      await apiFetch(`/api/intensives/${id}/publish`, { method: 'POST', json: { version: detail.version } })
      toast.success('Интенсив опубликован', { description: 'Теперь он виден сотрудникам и в календаре. Отправки не запускались.' })
      setPublishOpen(false)
      setStale(false)
      await refreshAll()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'INTENSIVE_OVERLAP') {
        setPublishOpen(false)
        setConflicts(Array.isArray(e.body.conflicts) ? (e.body.conflicts as IntensiveOverlapRef[]) : [])
      } else {
        setPublishOpen(false)
        await handleActionError(e, 'Не удалось опубликовать')
      }
    } finally {
      setActing(null)
    }
  }

  const archive = async () => {
    setActing('archive')
    try {
      const res = await apiFetch<{ pendingMessages?: number }>(`/api/intensives/${id}/archive`, { method: 'POST', json: { version: detail.version } })
      toast.success('Интенсив в архиве', {
        description: res.pendingMessages ? `Запланированные сообщения (${res.pendingMessages}) не изменены.` : 'Сообщения и пространство не затронуты.',
      })
      setArchiveOpen(false)
      setStale(false)
      await refreshAll()
    } catch (e) {
      setArchiveOpen(false)
      await handleActionError(e, 'Не удалось архивировать')
    } finally {
      setActing(null)
    }
  }

  const planEmpty = detail.planItemCount === 0

  return (
    <PageContainer size="default" className="px-4 sm:px-6">
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Интенсивы', href: '/dashboard/admin/intensives' },
              { label: detail.name, current: true },
            ]}
          />
        }
        title={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            <span className="min-w-0 break-words">{detail.name}</span>
            <span className="flex flex-wrap items-center gap-1.5">
              <IntensiveBadges status={detail.status} phase={detail.phase} />
            </span>
          </span>
        }
        description={
          <>
            {detail.orgSpace.name} · {periodLabel(detail.startDate, detail.endDate)} · {dayText} · {formatTimezone(detail.timezone)}
            {formatTimezone(detail.timezone) !== detail.timezone && <span className="text-muted-foreground/80"> ({detail.timezone})</span>}
          </>
        }
        actions={
          <>
            {detail.status === 'DRAFT' && (
              <Button size="sm" onClick={() => setPublishOpen(true)} disabled={acting !== null}>
                {acting === 'publish' ? <Loader2 className="animate-spin" aria-hidden /> : <Rocket aria-hidden />}
                Опубликовать
              </Button>
            )}
            {canEdit && (
              <Button size="sm" variant="outline" onClick={() => setEditOpen(true)}>
                <Pencil aria-hidden />
                Редактировать
              </Button>
            )}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="icon-sm" variant="outline" aria-label="Другие действия с интенсивом" disabled={acting !== null}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-72">
                <DropdownMenuItem disabled={!canArchive} onSelect={() => setArchiveOpen(true)}>
                  <Archive aria-hidden />
                  <span className="flex flex-col">
                    Архивировать
                    {!canArchive && (
                      <span className="text-xs font-normal text-muted-foreground">
                        {detail.status === 'ARCHIVED' ? 'Уже в архиве' : 'Доступно после завершения периода'}
                      </span>
                    )}
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" disabled={!canCancel} onSelect={() => setCancelOpen(true)}>
                  <XCircle aria-hidden />
                  <span className="flex flex-col">
                    Отменить интенсив…
                    {!canCancel && <span className="text-xs font-normal text-muted-foreground">Отменить можно черновик или опубликованный</span>}
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </>
        }
      />

      <div className="mb-5 space-y-3">
        {stale && (
          <InlineNotice tone="warning">
            <p className="font-medium">Интенсив изменён другим пользователем. Обновите страницу.</p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={async () => {
                await refreshAll()
                setStale(false)
              }}
              disabled={detailLoading}
            >
              {detailLoading ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              Обновить данные
            </Button>
          </InlineNotice>
        )}
        {detailError && detail && <LoadError message={`${detailError.message} Показаны ранее загруженные данные.`} onRetry={() => void reloadDetail()} retrying={detailLoading} />}
        {detail.status === 'CANCELLED' && (
          <InlineNotice tone="danger">
            Интенсив отменён{detail.cancelledAt ? ` ${formatInstant(detail.cancelledAt, detail.timezone, true)}` : ''}.
            {detail.cancelReason ? ` Причина: ${detail.cancelReason}` : ''}
          </InlineNotice>
        )}
        {overlaps.length > 0 && (detail.status === 'DRAFT' || detail.status === 'PUBLISHED') && (
          <InlineNotice tone="warning">
            <p className="font-medium">Период пересекается с другим интенсивом этого пространства</p>
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {overlaps.map((o) => (
                <li key={o.id}>
                  <Link href={`/dashboard/admin/intensives/${o.id}`} className="underline-offset-2 hover:underline focus-visible:underline">
                    {overlapText(o)}
                  </Link>
                </li>
              ))}
            </ul>
            {detail.status === 'DRAFT' && <p className="mt-1">Пока пересечение не устранено, публикация заблокирована.</p>}
          </InlineNotice>
        )}
        {detail.status === 'DRAFT' && planEmpty && (
          <InlineNotice tone="info">План пуст. Соберите план анонсов на вкладке «План» — публиковать пустой интенсив можно, но сотрудникам нечего будет планировать.</InlineNotice>
        )}
      </div>

      <section className="mb-6 rounded-lg border bg-card px-4 py-2 sm:px-5" aria-label="Сведения об интенсиве">
        <dl className="divide-y">
          <Fact label="Пространство">
            {detail.workspaces.length > 0 ? (
              <span className="flex flex-wrap gap-x-3 gap-y-1">
                {detail.workspaces.map((w) => (
                  <Link
                    key={w.id}
                    href={`/dashboard/workspaces/${w.id}#intensives`}
                    className="inline-flex items-center gap-1 underline-offset-2 hover:underline focus-visible:underline"
                  >
                    {w.workspaceName}
                    {w.isArchived ? ' (архив)' : ''}
                    <ExternalLink className="size-3 text-muted-foreground" aria-hidden />
                  </Link>
                ))}
              </span>
            ) : (
              <span className="text-muted-foreground">
                {detail.orgSpace.name} — нет привязанных пространств, планировать сообщения будет некому
              </span>
            )}
          </Fact>
          <Fact label="План">
            Пунктов: {detail.planItemCount} · связанных сообщений: {detail.linkedMessageCount}
          </Fact>
          {detail.description && <Fact label="Описание"><span className="whitespace-pre-wrap">{detail.description}</span></Fact>}
          <Fact label="Создан">
            {detail.createdBy?.name ?? 'неизвестно'}, {formatInstant(detail.createdAt, detail.timezone, true)}
          </Fact>
          <Fact label="Изменён">
            {detail.updatedBy?.name ?? 'неизвестно'}, {formatInstant(detail.updatedAt, detail.timezone, true)}
          </Fact>
        </dl>
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList variant="line" className="mb-4 h-10 w-full justify-start overflow-x-auto border-b">
          <TabsTrigger value="plan">План</TabsTrigger>
          <TabsTrigger value="history">История</TabsTrigger>
          <TabsTrigger value="link">Привязка старых сообщений</TabsTrigger>
        </TabsList>
        <TabsContent value="plan">
          <PlanTab
            intensive={detail}
            data={planData}
            onChanged={refreshAll}
            onShowHistory={(itemId, title) => {
              setHistoryFilter({ id: itemId, title })
              setTab('history')
            }}
          />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab
            intensiveId={detail.id}
            timezone={detail.timezone}
            titles={titles}
            itemFilter={historyFilter}
            onClearFilter={() => setHistoryFilter(null)}
          />
        </TabsContent>
        <TabsContent value="link">
          <LinkMessagesTab intensiveId={detail.id} timezone={detail.timezone} status={detail.status} onLinked={refreshAll} />
        </TabsContent>
      </Tabs>

      <IntensiveFormDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        mode="edit"
        intensive={detail}
        orgSpaces={spaceRefs}
        onSaved={() => {
          setStale(false)
          void refreshAll()
        }}
        onStale={() => void refreshAll()}
      />

      <ConfirmDialog
        open={publishOpen}
        onOpenChange={setPublishOpen}
        title={`Опубликовать «${detail.name}»?`}
        description={
          <div className="space-y-1.5">
            <p>Интенсив станет виден сотрудникам пространства и в календаре. Публикация ничего не отправляет.</p>
            {planEmpty && <p className="text-amber-700 dark:text-amber-400">В плане нет пунктов.</p>}
            {overlaps.length > 0 && <p className="text-amber-700 dark:text-amber-400">Есть пересечение периодов — сервер может отклонить публикацию.</p>}
          </div>
        }
        confirmLabel="Опубликовать"
        loading={acting === 'publish'}
        onConfirm={publish}
      />
      <ConfirmDialog
        open={archiveOpen}
        onOpenChange={setArchiveOpen}
        title={`Архивировать «${detail.name}»?`}
        description="Интенсив уйдёт в архив. Сообщения, история и пространство не затрагиваются. Из архива вернуть нельзя."
        confirmLabel="Архивировать"
        loading={acting === 'archive'}
        onConfirm={archive}
      />
      <CancelIntensiveDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        intensive={detail}
        onCancelled={refreshAll}
        onVersionConflict={() => setStale(true)}
      />

      <Dialog open={conflicts !== null} onOpenChange={(o) => !o && setConflicts(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Публикация невозможна: пересечение периодов</DialogTitle>
            <DialogDescription>
              В одном пространстве нельзя опубликовать два интенсива с пересекающимися датами. Измените период этого интенсива или отмените/заархивируйте конфликтующий.
            </DialogDescription>
          </DialogHeader>
          {conflicts && conflicts.length > 0 ? (
            <ul className="divide-y rounded-md border">
              {conflicts.map((c) => (
                <li key={c.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{c.name}</span>
                    <span className="block text-xs text-muted-foreground">{periodLabel(c.startDate, c.endDate)}</span>
                  </span>
                  <Button asChild variant="outline" size="sm">
                    <Link href={`/dashboard/admin/intensives/${c.id}`}>Открыть</Link>
                  </Button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-muted-foreground">Другой интенсив публикуется прямо сейчас. Подождите немного и повторите попытку.</p>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setConflicts(null)}>
              Закрыть
            </Button>
            <Button
              onClick={() => {
                setConflicts(null)
                setEditOpen(true)
              }}
            >
              Изменить период
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

export function IntensiveDetailView() {
  const params = useParams<{ id: string }>()
  const id = Array.isArray(params?.id) ? params.id[0] : params?.id
  return (
    <FeatureGate fallback={<PageLoading variant="detail" />}>
      {() => (id ? <DetailContent key={id} id={id} /> : <PageLoading variant="detail" />)}
    </FeatureGate>
  )
}
