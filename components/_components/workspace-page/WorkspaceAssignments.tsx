"use client"

import { useCallback, useEffect, useState } from 'react'
import { ChevronDown, ChevronRight, UserPlus } from 'lucide-react'
import { toast } from 'sonner'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { generateAvatarColor, getInitials } from '@/lib/utils'

type PersonRef = { id: string; name: string | null; email: string; username?: string | null; role: string; avatarUrl?: string | null }
type Assignment = {
  id: string
  userId: string
  user: PersonRef
  assignedBy: { id: string; name: string | null; email: string }
  createdAt: string
}
type Candidate = { id: string; name: string | null; email: string; role: string }

function Person({ user }: { user: PersonRef }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <Avatar className="size-7 shrink-0">
        {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
        <AvatarFallback className={`${generateAvatarColor(user.email)} text-[10px] font-semibold text-white`}>
          {getInitials(user.name || user.email)}
        </AvatarFallback>
      </Avatar>
      <span className="truncate text-sm font-medium">{user.name || user.email || '—'}</span>
    </div>
  )
}

/**
 * Участники пространства: владелец и назначенные пользователи.
 * SUP / Lead_SUP могут назначать и снимать назначение. Блок свёрнут по умолчанию, чтобы не отодвигать вкладки.
 */
export function WorkspaceAssignments({
  workspaceId,
  currentUserRole,
  canSee,
}: {
  workspaceId: string
  currentUserRole: string
  canSee: boolean
}) {
  const roleCanManage = currentUserRole === 'SUP' || currentUserRole === 'LEAD_SUP'
  // Сервер уточняет право: SUP не управляет назначениями в пространствах Lead_SUP и в чужих пространствах
  const [serverCanManage, setServerCanManage] = useState<boolean | null>(null)
  const canManage = roleCanManage && serverCanManage !== false
  const [assignments, setAssignments] = useState<Assignment[]>([])
  const [owner, setOwner] = useState<PersonRef | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [collapsed, setCollapsed] = useState(true)

  const [assignOpen, setAssignOpen] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState('')
  const [candidates, setCandidates] = useState<Candidate[]>([])
  const [candidatesLoading, setCandidatesLoading] = useState(false)
  const [assignLoading, setAssignLoading] = useState(false)
  const [removeTarget, setRemoveTarget] = useState<Assignment | null>(null)

  const load = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/assign-adm`)
      if (!res.ok) return
      const data = await res.json()
      setAssignments(data.assignments ?? [])
      setOwner(data.owner ?? null)
      if (typeof data.canManage === 'boolean') setServerCanManage(data.canManage)
    } catch {
      // фоновая загрузка: блок просто останется пустым
    } finally {
      setLoaded(true)
    }
  }, [workspaceId])

  useEffect(() => {
    if (canSee && workspaceId) load()
  }, [canSee, workspaceId, load])

  useEffect(() => {
    if (!assignOpen || !canManage) return
    setCandidatesLoading(true)
    fetch('/api/admin/users')
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        const users = (d.users || []).filter((u: { role: string }) =>
          currentUserRole === 'LEAD_SUP'
            ? ['ADM', 'SUP', 'MEMBER', 'LEAD_SUP'].includes(u.role)
            : ['ADM', 'MEMBER', 'SUP'].includes(u.role),
        )
        const assignedIds = new Set(assignments.map((a) => a.userId))
        setCandidates(users.filter((u: { id: string }) => !assignedIds.has(u.id)))
      })
      .catch(() => {
        setCandidates([])
        toast.error('Не удалось загрузить список пользователей', { description: 'Проверьте сеть и откройте окно ещё раз.' })
      })
      .finally(() => setCandidatesLoading(false))
    // список назначенных нужен только в момент открытия
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assignOpen, currentUserRole])

  const assign = async () => {
    if (!selectedUserId) return
    setAssignLoading(true)
    const toastId = 'workspace-assign'
    toast.loading('Назначаем пользователя…', { id: toastId })
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/assign-adm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: selectedUserId }),
      })
      if (res.ok) {
        toast.success('Пользователь назначен на пространство', { id: toastId })
        setAssignOpen(false)
        setSelectedUserId('')
        load()
      } else {
        const d = await res.json().catch(() => ({}))
        const msg =
          d.message ||
          (d.error === 'USER_ALREADY_ADDED' ? 'Пользователь уже добавил себе это пространство. Назначение невозможно.' : null) ||
          d.error ||
          'Не удалось назначить пользователя'
        toast.error(msg, { id: toastId })
      }
    } catch {
      toast.error('Не удалось назначить пользователя', { id: toastId, description: 'Проверьте подключение к сети и повторите.' })
    } finally {
      setAssignLoading(false)
    }
  }

  const remove = async () => {
    if (!removeTarget) return
    setAssignLoading(true)
    const toastId = 'workspace-unassign'
    toast.loading('Снимаем назначение…', { id: toastId })
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/assign-adm`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: removeTarget.userId }),
      })
      if (res.ok) {
        toast.success('Назначение снято', { id: toastId })
        setRemoveTarget(null)
        load()
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || 'Не удалось снять назначение', { id: toastId })
      }
    } catch {
      toast.error('Не удалось снять назначение', { id: toastId, description: 'Проверьте подключение к сети и повторите.' })
    } finally {
      setAssignLoading(false)
    }
  }

  if (!canSee) return null
  // Не-SUP видят блок, только если есть кого показывать
  if (loaded && !canManage && !owner && assignments.length === 0) return null

  const total = assignments.length + (owner ? 1 : 0)

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCollapsed((c) => !c)}
          aria-expanded={!collapsed}
          className="flex items-center gap-1.5 rounded-md text-sm font-semibold text-foreground outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
        >
          {collapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
          Участники пространства
          {loaded && <span className="font-normal tabular-nums text-muted-foreground">{total}</span>}
        </button>
        {canManage && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setAssignOpen(true)
              setSelectedUserId('')
            }}
          >
            <UserPlus />
            Назначить
          </Button>
        )}
      </div>

      {!collapsed && (
        <div className="space-y-2">
          {canManage && (
            <p className="text-[13px] text-muted-foreground text-pretty">
              {currentUserRole === 'LEAD_SUP'
                ? 'Назначенные ADM, SUP или волонтёры увидят пространство в своём списке с пометкой «Назначено» и смогут подключиться своими данными Rocket.Chat.'
                : 'Назначенные ADM или волонтёры увидят пространство в своём списке с пометкой «Назначено».'}
            </p>
          )}
          {!loaded ? (
            <div className="space-y-2 rounded-lg border bg-card p-3">
              <Skeleton className="h-6 w-1/2" />
              <Skeleton className="h-6 w-2/5" />
            </div>
          ) : total === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
              Никого не назначено. Нажмите «Назначить», чтобы добавить администратора.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border bg-card">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr className="border-b bg-muted/40 text-left text-xs font-medium text-muted-foreground">
                    <th className="px-3 py-2 font-medium">Имя</th>
                    <th className="px-3 py-2 font-medium">Логин</th>
                    <th className="px-3 py-2 font-medium">Роль</th>
                    <th className="px-3 py-2 font-medium">Назначил</th>
                    {canManage && <th className="w-24 px-3 py-2" aria-label="Действия" />}
                  </tr>
                </thead>
                <tbody>
                  {owner && (
                    <tr className="border-b hover:bg-muted/40">
                      <td className="px-3 py-2"><Person user={owner} /></td>
                      <td className="px-3 py-2 text-muted-foreground">{owner.username || owner.email || '—'}</td>
                      <td className="px-3 py-2">
                        <Badge variant="muted">{owner.role}</Badge>
                        <span className="ml-1.5 text-xs text-muted-foreground">владелец</span>
                      </td>
                      <td className="px-3 py-2 text-muted-foreground">—</td>
                      {canManage && <td />}
                    </tr>
                  )}
                  {assignments.map((a) => (
                    <tr key={a.id} className="border-b last:border-b-0 hover:bg-muted/40">
                      <td className="px-3 py-2"><Person user={a.user} /></td>
                      <td className="px-3 py-2 text-muted-foreground">{a.user.username ?? a.user.email ?? '—'}</td>
                      <td className="px-3 py-2"><Badge variant="muted">{a.user.role}</Badge></td>
                      <td className="px-3 py-2 text-muted-foreground">{a.assignedBy.name || a.assignedBy.email}</td>
                      {canManage && (
                        <td className="px-3 py-2 text-right">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                            disabled={assignLoading}
                            onClick={() => setRemoveTarget(a)}
                            title="Пространство исчезнет из списка этого пользователя"
                          >
                            Снять
                          </Button>
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <Dialog open={assignOpen} onOpenChange={(v) => !assignLoading && setAssignOpen(v)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Назначить на пространство</DialogTitle>
            <DialogDescription>
              Выберите пользователя — он увидит это пространство в списке с пометкой «Назначено» и сможет работать с календарём и сообщениями.
              {currentUserRole === 'LEAD_SUP' ? ' Lead_SUP может назначать ADM и SUP, SUP — только ADM.' : ' SUP может назначать только ADM.'}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            {candidatesLoading ? (
              <div className="flex items-center justify-center py-6">
                <Spinner className="size-5" />
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Нет доступных пользователей: все подходящие по роли уже назначены.
              </p>
            ) : (
              <Field label="Пользователь" htmlFor="assign-user" required>
                <Select value={selectedUserId} onValueChange={setSelectedUserId}>
                  <SelectTrigger id="assign-user" className="w-full">
                    <SelectValue placeholder="Выберите пользователя" />
                  </SelectTrigger>
                  <SelectContent>
                    {candidates.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.email} ({u.role})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssignOpen(false)} disabled={assignLoading}>
              Отмена
            </Button>
            <Button disabled={!selectedUserId || assignLoading} onClick={assign}>
              {assignLoading && <Spinner />}
              Назначить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={!!removeTarget}
        onOpenChange={(v) => !v && setRemoveTarget(null)}
        title="Снять назначение?"
        description={
          <p>
            Пространство исчезнет из списка пользователя{' '}
            <strong>{removeTarget?.user.name || removeTarget?.user.email}</strong>. Назначить его снова можно в любой момент.
          </p>
        }
        confirmLabel="Снять назначение"
        destructive
        loading={assignLoading}
        onConfirm={remove}
      />
    </section>
  )
}
