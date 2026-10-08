"use client"

import { useMemo, useState } from 'react'
import { toast } from 'sonner'
import { ChevronDown, ChevronRight, ListMinus, Trash2, UserX } from 'lucide-react'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import type { RcAdminCredentials } from '@/lib/rc-admin-credentials'
import {
  CONFIRM_PREVIEW_LIMIT, MAX_REMOVE_TARGETS, parseLoginList, summarizeRemoveResults, type UserRemoveMode, type UserRemoveResult,
} from '@/lib/workspace-user-remove'
import { RcUsersTable, type AddedUser, type RowAction } from './RcUsersTable'
import { RcUserRemoveDialog, type RemoveRequest } from './RcUserRemoveDialog'
import { useRcUserRemove } from './useRcUserRemove'

type Outcome = { mode: UserRemoveMode; results: UserRemoveResult[]; partial: boolean }

/** Таблица «Добавленные пользователи» с выбором строк, удалением / деактивацией в Rocket.Chat и удалением по списку логинов. */
export function RcAddedUsersPanel({ workspaceId, users, credentials, credentialsReady, onChanged }: {
  workspaceId: string
  /** Уже отфильтрованный и отсортированный список. */
  users: AddedUser[]
  credentials: RcAdminCredentials
  credentialsReady: boolean
  onChanged: () => void | Promise<void>
}) {
  const { run, cancel, running, progress } = useRcUserRemove(workspaceId, credentials)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [request, setRequest] = useState<RemoveRequest | null>(null)
  const [outcome, setOutcome] = useState<Outcome | null>(null)
  const [unlist, setUnlist] = useState<AddedUser[] | null>(null)
  const [unlisting, setUnlisting] = useState(false)
  const [toolOpen, setToolOpen] = useState(false)
  const [loginsText, setLoginsText] = useState('')

  // Действия применяются только к видимым (отфильтрованным) строкам: скрытые выбранные игнорируются.
  const selectedUsers = useMemo(() => users.filter(u => selected.has(u.id)), [users, selected])
  const parsed = useMemo(() => parseLoginList(loginsText), [loginsText])
  const busy = running || unlisting

  const toggle = (id: string, checked: boolean) =>
    setSelected(prev => { const next = new Set(prev); if (checked) next.add(id); else next.delete(id); return next })
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(users.map(u => u.id)) : new Set())

  const openRemove = (mode: UserRemoveMode, list: AddedUser[]) => {
    if (!list.length) return
    setOutcome(null)
    setRequest({ mode, logins: list.map(u => u.username), ids: list.map(u => u.id) })
  }
  const onRowAction = (action: RowAction, user: AddedUser) => {
    if (action === 'unlist') setUnlist([user])
    else openRemove(action, [user])
  }

  const confirmRemove = async () => {
    if (!request) return
    try {
      const result = await run(request.mode, { ids: request.ids, usernames: request.usernames })
      const summary = summarizeRemoveResults(result.mode, result.results)
      setOutcome(result)
      const text = result.partial ? `Остановлено. ${summary.text}` : summary.text
      if (summary.level === 'success') toast.success(text)
      else if (summary.level === 'warning') toast.warning(text)
      else toast.error(text, { description: 'Подробности — в окне с результатами.' })
      if (request.ids && summary.errors === 0) setSelected(new Set())
      if (request.usernames && summary.errors === 0) setLoginsText('')
      await onChanged()
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось выполнить операцию', { description: 'Проверьте данные администратора и повторите.' })
    }
  }

  const closeDialog = () => { setRequest(null); setOutcome(null) }

  const confirmUnlist = async () => {
    if (!unlist) return
    setUnlisting(true)
    let failed = 0
    for (const u of unlist) {
      try {
        const res = await fetch(`/api/workspace/${workspaceId}/users/${u.id}`, { method: 'DELETE', headers: { 'X-Error-Handling': 'local' } })
        if (!res.ok) failed++
      } catch { failed++ }
    }
    const done = unlist.length - failed
    setUnlisting(false)
    setUnlist(null)
    setSelected(new Set())
    if (failed) toast.warning(`Убрано из списка: ${done}, не удалось: ${failed}`)
    else toast.success(done === 1 ? 'Запись убрана из списка' : `Убрано из списка: ${done}`)
    await onChanged()
  }

  const loginsProblem = parsed.invalid.length
    ? `Недопустимые логины: ${parsed.invalid.slice(0, 5).map(i => i.login).join(', ')}${parsed.invalid.length > 5 ? ` и ещё ${parsed.invalid.length - 5}` : ''}. Допустимы буквы, цифры, точка, дефис и подчёркивание.`
    : parsed.tooMany ? `Максимум ${MAX_REMOVE_TARGETS} логинов за раз — сейчас ${parsed.logins.length}.` : null
  const startByLogins = () => {
    if (!parsed.logins.length || loginsProblem) return
    setOutcome(null)
    setRequest({ mode: 'delete', logins: parsed.logins, usernames: parsed.logins })
  }

  return (
    <div className="space-y-3">
      {selectedUsers.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-md border bg-muted/50 px-3 py-2" role="toolbar" aria-label="Действия с выбранными пользователями">
          <span className="text-sm font-medium mr-1">Выбрано: {selectedUsers.length}</span>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => openRemove('deactivate', selectedUsers)}>
            <UserX /> Деактивировать
          </Button>
          <Button size="sm" variant="destructive" disabled={busy} onClick={() => openRemove('delete', selectedUsers)}>
            <Trash2 /> Удалить из Rocket.Chat
          </Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={() => setUnlist(selectedUsers)}>
            <ListMinus /> Убрать из списка
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" disabled={busy} onClick={() => setSelected(new Set())}>Снять выбор</Button>
        </div>
      )}

      <RcUsersTable users={users} selected={selected} disabled={busy} onToggle={toggle} onToggleAll={toggleAll} onAction={onRowAction} />

      <div className="rounded-lg border">
        <button type="button" className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm font-medium hover:bg-muted/40"
          aria-expanded={toolOpen} onClick={() => setToolOpen(v => !v)}>
          {toolOpen ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
          Удалить по списку логинов
        </button>
        {toolOpen && (
          <div className="space-y-2 border-t p-3">
            <Label htmlFor="remove-by-logins">Логины (по одному на строку)</Label>
            <Textarea id="remove-by-logins" value={loginsText} onChange={e => setLoginsText(e.target.value)} disabled={busy}
              rows={5} className="font-mono text-[13px]" placeholder={'login1\nlogin2'} aria-invalid={!!loginsProblem} />
            {loginsProblem
              ? <p className="text-xs text-destructive" role="alert">{loginsProblem}</p>
              : <p className="text-xs text-muted-foreground">
                  {parsed.logins.length
                    ? `Будет обработано: ${parsed.logins.length}${parsed.duplicates ? ` (повторов убрано: ${parsed.duplicates})` : ''}. Удаляются аккаунты в Rocket.Chat, даже если их нет в списке выше.`
                    : `Допустимы @, запятые и точки с запятой. Максимум ${MAX_REMOVE_TARGETS} логинов.`}
                </p>}
            <Button size="sm" variant="destructive" disabled={busy || !parsed.logins.length || !!loginsProblem} onClick={startByLogins}>
              <Trash2 /> Удалить из Rocket.Chat…
            </Button>
          </div>
        )}
      </div>

      <RcUserRemoveDialog request={request} credentialsReady={credentialsReady} running={running} progress={progress}
        outcome={outcome} onConfirm={confirmRemove} onClose={closeDialog} onStop={cancel} />

      <AlertDialog open={!!unlist} onOpenChange={open => { if (!open && !unlisting) setUnlist(null) }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Убрать из списка: {unlist?.length}</AlertDialogTitle>
            <AlertDialogDescription>
              Записи исчезнут только из этого списка. Пользователи в Rocket.Chat останутся без изменений.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {unlist && (
            <ul className="rounded-md border divide-y max-h-40 overflow-y-auto">
              {unlist.slice(0, CONFIRM_PREVIEW_LIMIT).map(u => <li key={u.id} className="px-3 py-1.5 font-mono text-[13px]">{u.username}</li>)}
              {unlist.length > CONFIRM_PREVIEW_LIMIT && <li className="px-3 py-1.5 text-xs text-muted-foreground">и ещё {unlist.length - CONFIRM_PREVIEW_LIMIT}</li>}
            </ul>
          )}
          <AlertDialogFooter>
            <Button variant="outline" disabled={unlisting} onClick={() => setUnlist(null)}>Отмена</Button>
            <Button disabled={unlisting} onClick={confirmUnlist}>{unlisting && <Spinner className="size-4" />}Убрать из списка</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
