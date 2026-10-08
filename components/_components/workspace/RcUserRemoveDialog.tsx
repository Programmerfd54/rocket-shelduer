"use client"

import { useState } from 'react'
import {
  AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import {
  REMOVE_CONFIRM_WORD, buildRemoveConfirmation, isRemoveConfirmed, summarizeRemoveResults,
  type UserRemoveMode, type UserRemoveResult,
} from '@/lib/workspace-user-remove'
import type { RemoveProgress } from './useRcUserRemove'

export type RemoveRequest = { mode: UserRemoveMode; logins: string[]; ids?: string[]; usernames?: string[] }

const STATUS_BADGE: Record<UserRemoveResult['status'], { variant: 'success' | 'warning' | 'danger'; label: (mode: UserRemoveMode) => string }> = {
  removed: { variant: 'success', label: mode => (mode === 'delete' ? 'Удалён' : 'Деактивирован') },
  skipped: { variant: 'warning', label: () => 'Пропущен' },
  error: { variant: 'danger', label: () => 'Ошибка' },
}

/** Подтверждение → ход выполнения → итог по каждому пользователю. */
export function RcUserRemoveDialog({
  request, credentialsReady, running, progress, outcome, onConfirm, onClose, onStop,
}: {
  request: RemoveRequest | null
  credentialsReady: boolean
  running: boolean
  progress: RemoveProgress | null
  outcome: { mode: UserRemoveMode; results: UserRemoveResult[]; partial: boolean } | null
  onConfirm: () => void
  onClose: () => void
  onStop: () => void
}) {
  const [typed, setTyped] = useState('')
  const close = () => { setTyped(''); onClose() }

  const text = request ? buildRemoveConfirmation(request.mode, request.logins) : null
  const wordOk = !text?.requiresWord || isRemoveConfirmed(typed)
  const canConfirm = credentialsReady && wordOk && !running
  const percent = progress && progress.total ? Math.round((progress.current / progress.total) * 100) : 0
  const summary = outcome ? summarizeRemoveResults(outcome.mode, outcome.results) : null

  return (
    <AlertDialog open={!!request} onOpenChange={(open) => { if (!open && !running) close() }}>
      <AlertDialogContent>
        {request && text && !running && !outcome && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{text.title}</AlertDialogTitle>
              <AlertDialogDescription>{text.description}</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-3 text-sm">
              <ul className="rounded-md border divide-y max-h-44 overflow-y-auto">
                {text.shown.map(login => <li key={login} className="px-3 py-1.5 font-mono text-[13px]">{login}</li>)}
                {text.more > 0 && <li className="px-3 py-1.5 text-xs text-muted-foreground">и ещё {text.more}</li>}
              </ul>
              <p className="text-xs text-muted-foreground">
                Администраторы Rocket.Chat и учётная запись, под которой выполнен вход, будут пропущены автоматически.
              </p>
              {!credentialsReady && (
                <p className="text-xs text-destructive" role="alert">
                  Заполните данные администратора Rocket.Chat в форме выше — без них действие недоступно.
                </p>
              )}
              {text.requiresWord && (
                <div className="space-y-1.5">
                  <Label htmlFor="remove-confirm-word">Для подтверждения введите «{REMOVE_CONFIRM_WORD}»</Label>
                  <Input id="remove-confirm-word" value={typed} onChange={e => setTyped(e.target.value)}
                    autoComplete="off" placeholder={REMOVE_CONFIRM_WORD} aria-invalid={typed.length > 0 && !wordOk} />
                </div>
              )}
            </div>
            <AlertDialogFooter>
              <Button variant="outline" onClick={close}>Отмена</Button>
              <Button variant={request.mode === 'delete' ? 'destructive' : 'default'} disabled={!canConfirm} onClick={onConfirm}>
                {text.confirmLabel}
              </Button>
            </AlertDialogFooter>
          </>
        )}

        {running && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{request?.mode === 'delete' ? 'Удаление пользователей…' : 'Деактивация пользователей…'}</AlertDialogTitle>
              <AlertDialogDescription>Не закрывайте страницу. Уже обработанные пользователи останутся обработанными, даже если остановить процесс.</AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Progress value={percent} aria-label="Ход выполнения" />
              <p className="text-xs text-muted-foreground tabular-nums">
                {progress ? `${progress.current} / ${progress.total}` : 'Подключение к Rocket.Chat…'}
                {progress && progress.errors > 0 ? ` · ошибок: ${progress.errors}` : ''}
              </p>
            </div>
            <AlertDialogFooter>
              <Button variant="outline" onClick={onStop}><Spinner className="size-4" />Остановить</Button>
            </AlertDialogFooter>
          </>
        )}

        {!running && outcome && summary && (
          <>
            <AlertDialogHeader>
              <AlertDialogTitle>{outcome.partial ? 'Остановлено' : 'Готово'}</AlertDialogTitle>
              <AlertDialogDescription>{summary.text}</AlertDialogDescription>
            </AlertDialogHeader>
            <ul className="rounded-md border divide-y max-h-72 overflow-y-auto text-sm">
              {outcome.results.map((r, i) => {
                const badge = STATUS_BADGE[r.status]
                return (
                  <li key={`${r.username}-${i}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2">
                    <span className="font-mono text-[13px]">{r.username}</span>
                    <Badge variant={badge.variant}>{badge.label(outcome.mode)}</Badge>
                    {r.reason && <span className="text-xs text-muted-foreground break-words">{r.reason}</span>}
                  </li>
                )
              })}
            </ul>
            <AlertDialogFooter>
              <Button onClick={close}>Закрыть</Button>
            </AlertDialogFooter>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  )
}
