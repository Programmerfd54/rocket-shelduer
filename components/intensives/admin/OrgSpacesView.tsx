'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarPlus, Layers, Link2, Link2Off, MoreHorizontal, Pencil, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { PageLoading } from '@/components/common/PageLoading'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '@/components/ui/dropdown-menu'
import { Skeleton } from '@/components/ui/skeleton'
import { ApiError, INTENSIVE_STATUS_LABELS, apiFetch } from '@/lib/intensives/ui'
import { INTENSIVE_STATUSES } from '@/lib/intensives/types'
import type { OrgSpaceConnection, OrgSpaceDto } from '@/lib/intensives/types'
import { DraftFromDatesDialog } from './DraftFromDatesDialog'
import { FeatureGate } from './FeatureGate'
import { useOrgSpaces, useSuggestions } from './hooks'
import { LoadError, errText, periodLabel } from './kit'
import { LinkWorkspaceDialog } from './LinkWorkspaceDialog'
import { OrgSpaceFormDialog } from './OrgSpaceFormDialog'
import { SuggestionsPanel } from './SuggestionsPanel'

function countsText(space: OrgSpaceDto): string {
  const parts = INTENSIVE_STATUSES.filter((s) => (space.intensiveCounts[s] ?? 0) > 0).map((s) => `${INTENSIVE_STATUS_LABELS[s].toLowerCase()}: ${space.intensiveCounts[s]}`)
  return parts.length ? `Интенсивы — ${parts.join(', ')}` : 'Интенсивов нет'
}

function totalIntensives(space: OrgSpaceDto): number {
  return INTENSIVE_STATUSES.reduce((sum, s) => sum + (space.intensiveCounts[s] ?? 0), 0)
}

function ListSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Загрузка пространств">
      {[0, 1].map((i) => (
        <div key={i} className="overflow-hidden rounded-lg border bg-card">
          <div className="space-y-2 border-b px-4 py-3">
            <Skeleton className="h-4 w-48" />
            <Skeleton className="h-3 w-72 max-w-full" />
          </div>
          {[0, 1].map((r) => (
            <div key={r} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-64 max-w-full" />
              </div>
              <Skeleton className="size-8" />
            </div>
          ))}
        </div>
      ))}
    </div>
  )
}

function ConnectionRow({
  conn,
  onDraft,
  onUnlink,
}: {
  conn: OrgSpaceConnection
  onDraft: () => void
  onUnlink: () => void
}) {
  const hasDates = !!conn.startDate && !!conn.endDate
  return (
    <li className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center sm:gap-4">
      <div className="min-w-0 flex-1 space-y-0.5">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm font-medium">
          {conn.workspaceName}
          {conn.isArchived && <Badge variant="muted">Архив</Badge>}
          {!conn.isActive && <Badge variant="muted">Неактивно</Badge>}
        </p>
        <p className="break-all font-mono text-xs text-muted-foreground">{conn.workspaceUrl}</p>
        <p className="text-xs text-muted-foreground">
          Владелец: {conn.owner.name ?? 'неизвестно'} · логин {conn.username}
          {hasDates ? ` · даты подключения: ${periodLabel(conn.startDate!, conn.endDate!)}` : ' · дат нет'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button type="button" size="sm" variant="outline" disabled={!hasDates} onClick={onDraft} title={hasDates ? undefined : 'У подключения не заданы даты'}>
          <CalendarPlus aria-hidden />
          Черновик по датам
        </Button>
        <Button type="button" size="icon-sm" variant="ghost" aria-label={`Отвязать подключение «${conn.workspaceName}»`} title="Отвязать" onClick={onUnlink}>
          <Link2Off aria-hidden />
        </Button>
      </div>
    </li>
  )
}

function Content() {
  const { orgSpaces, error, loading, reload } = useOrgSpaces()
  const sugg = useSuggestions()

  const [formState, setFormState] = useState<{ open: boolean; space?: OrgSpaceDto }>({ open: false })
  const [linkFor, setLinkFor] = useState<OrgSpaceDto | null>(null)
  const [draftFor, setDraftFor] = useState<{ space: OrgSpaceDto; connection: OrgSpaceConnection } | null>(null)
  const [deleteFor, setDeleteFor] = useState<OrgSpaceDto | null>(null)
  const [unlinkFor, setUnlinkFor] = useState<{ space: OrgSpaceDto; connection: OrgSpaceConnection } | null>(null)
  const [busy, setBusy] = useState(false)

  const refreshAll = async () => {
    await Promise.all([reload(), sugg.reload()])
  }

  const doDelete = async () => {
    if (!deleteFor) return
    setBusy(true)
    try {
      await apiFetch(`/api/org-spaces/${deleteFor.id}`, { method: 'DELETE' })
      toast.success('Пространство удалено', { description: 'Подключения отвязаны, сами подключения не затронуты.' })
      setDeleteFor(null)
      await refreshAll()
    } catch (e) {
      if (e instanceof ApiError && e.code === 'ORG_SPACE_HAS_INTENSIVES') {
        toast.error('Нельзя удалить пространство с интенсивами', { description: e.message })
        setDeleteFor(null)
      } else {
        toast.error('Не удалось удалить пространство', { description: errText(e) })
      }
      await refreshAll()
    } finally {
      setBusy(false)
    }
  }

  const doUnlink = async () => {
    if (!unlinkFor) return
    setBusy(true)
    try {
      await apiFetch(`/api/org-spaces/${unlinkFor.space.id}/link?workspaceId=${encodeURIComponent(unlinkFor.connection.id)}`, { method: 'DELETE' })
      toast.success('Подключение отвязано', { description: 'Сообщения, уже связанные с интенсивами, остаются связанными.' })
      setUnlinkFor(null)
      await refreshAll()
    } catch (e) {
      toast.error('Не удалось отвязать подключение', { description: errText(e) })
      if (e instanceof ApiError && e.status === 409) {
        setUnlinkFor(null)
        await refreshAll()
      }
    } finally {
      setBusy(false)
    }
  }

  const spaces = orgSpaces ?? []

  return (
    <PageContainer size="default" className="px-4 sm:px-6">
      <PageHeader
        title="Организационные пространства"
        description="Дополнительная настройка: обычно не нужна — график интенсивов создаётся автоматически при добавлении интенсива в пространство (вкладка «Интенсивы» на странице пространства). Здесь можно вручную объединить несколько подключений в один график."
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Интенсивы', href: '/dashboard/admin/intensives' },
              { label: 'Организационные пространства', current: true },
            ]}
          />
        }
        actions={
          <>
            <Button type="button" variant="ghost" size="icon-sm" aria-label="Обновить" title="Обновить" onClick={() => void refreshAll()} disabled={loading || sugg.loading}>
              <RefreshCw className={loading || sugg.loading ? 'animate-spin' : undefined} aria-hidden />
            </Button>
            <Button size="sm" variant="outline" onClick={() => setFormState({ open: true })}>
              <Plus aria-hidden />
              Создать пространство
            </Button>
          </>
        }
      />

      <div className="space-y-8">
        <section aria-label="Организационные пространства" className="space-y-3">
          {orgSpaces === null && loading && <ListSkeleton />}
          {error && <LoadError message={orgSpaces ? `${error} Показаны ранее загруженные данные.` : error} onRetry={() => void reload()} retrying={loading} />}
          {orgSpaces !== null && spaces.length === 0 && !error && (
            <EmptyState
              icon={<Layers />}
              title="Пространств пока нет"
              description="Создайте пространство и привяжите к нему подключения — затем в нём можно создавать интенсивы."
              action={{ label: 'Создать пространство', onClick: () => setFormState({ open: true }) }}
            />
          )}
          {spaces.map((space) => (
            <article key={space.id} className="overflow-hidden rounded-lg border bg-card" aria-labelledby={`os-${space.id}`}>
              <header className="flex flex-col gap-2 border-b px-4 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0 space-y-0.5">
                  <h2 id={`os-${space.id}`} className="break-words text-sm font-semibold">
                    {space.name}
                  </h2>
                  {space.description && <p className="text-[13px] text-muted-foreground text-pretty">{space.description}</p>}
                  <p className="text-xs text-muted-foreground">
                    {countsText(space)} · подключений: {space.connections.length}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button asChild size="sm" variant="outline">
                    <Link href={`/dashboard/admin/intensives?orgSpace=${space.id}`}>Интенсивы</Link>
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={() => setLinkFor(space)}>
                    <Link2 aria-hidden />
                    Привязать подключение
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button type="button" size="icon-sm" variant="ghost" aria-label={`Действия с пространством «${space.name}»`}>
                        <MoreHorizontal aria-hidden />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-60">
                      <DropdownMenuItem onSelect={() => setFormState({ open: true, space })}>
                        <Pencil aria-hidden />
                        Изменить
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => setDeleteFor(space)}>
                        <Trash2 aria-hidden />
                        Удалить…
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </header>
              {space.connections.length === 0 ? (
                <p className="px-4 py-4 text-[13px] text-muted-foreground">К пространству не привязано ни одного подключения.</p>
              ) : (
                <ul className="divide-y">
                  {space.connections.map((c) => (
                    <ConnectionRow key={c.id} conn={c} onDraft={() => setDraftFor({ space, connection: c })} onUnlink={() => setUnlinkFor({ space, connection: c })} />
                  ))}
                </ul>
              )}
            </article>
          ))}
        </section>

        <SuggestionsPanel groups={sugg.groups} loading={sugg.loading} error={sugg.error} onRetry={() => void sugg.reload()} spaces={spaces} onChanged={refreshAll} />
      </div>

      <OrgSpaceFormDialog
        open={formState.open}
        onOpenChange={(o) => setFormState((s) => ({ ...s, open: o }))}
        space={formState.space}
        onSaved={refreshAll}
      />
      <LinkWorkspaceDialog
        space={linkFor}
        allSpaces={spaces}
        groups={sugg.groups}
        loading={sugg.loading}
        error={sugg.error}
        onRetry={() => void sugg.reload()}
        onOpenChange={(o) => !o && setLinkFor(null)}
        onLinked={refreshAll}
      />
      <DraftFromDatesDialog target={draftFor} onOpenChange={(o) => !o && setDraftFor(null)} onReload={refreshAll} />

      <ConfirmDialog
        open={!!deleteFor}
        onOpenChange={(o) => !o && !busy && setDeleteFor(null)}
        title={deleteFor ? `Удалить пространство «${deleteFor.name}»?` : 'Удалить пространство?'}
        description={
          deleteFor && totalIntensives(deleteFor) > 0 ? (
            <p>
              В пространстве есть интенсивы ({totalIntensives(deleteFor)}). Удалить его нельзя, пока они существуют: сначала отмените и заархивируйте их или перенесите.
            </p>
          ) : (
            <p>Подключения будут отвязаны от пространства, сами подключения и сообщения не изменятся. Действие нельзя отменить.</p>
          )
        }
        confirmLabel="Удалить"
        destructive
        disabled={!!deleteFor && totalIntensives(deleteFor) > 0}
        loading={busy}
        onConfirm={doDelete}
      />
      <ConfirmDialog
        open={!!unlinkFor}
        onOpenChange={(o) => !o && !busy && setUnlinkFor(null)}
        title="Отвязать подключение?"
        description={
          unlinkFor && (
            <p>
              «{unlinkFor.connection.workspaceName}» перестанет относиться к «{unlinkFor.space.name}». Сообщения, уже связанные с интенсивами, остаются связанными; новые сообщения из этого подключения нельзя будет планировать в интенсивах пространства.
            </p>
          )
        }
        confirmLabel="Отвязать"
        destructive
        loading={busy}
        onConfirm={doUnlink}
      />
    </PageContainer>
  )
}

export function OrgSpacesView() {
  return (
    <FeatureGate fallback={<PageLoading variant="list" />}>
      {() => <Content />}
    </FeatureGate>
  )
}
