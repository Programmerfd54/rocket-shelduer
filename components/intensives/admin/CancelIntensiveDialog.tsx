'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import type { CancelResolution, IntensiveDetail } from '@/lib/intensives/types'
import { GuardedDialog, InlineNotice, RadioRow, errText, formatInstant } from './kit'

type PendingMessage = { messageId: string; planItemId: string | null; scheduledFor: string; workspaceId: string; isPlanRepeat: boolean }

/**
 * Отмена интенсива. Если есть ожидающие отправки, сервер блокирует отмену (409) —
 * показываем список и требуем явного решения (по умолчанию ничего не выбрано).
 */
export function CancelIntensiveDialog({
  open,
  onOpenChange,
  intensive,
  onCancelled,
  onVersionConflict,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  intensive: IntensiveDetail
  onCancelled: () => void | Promise<void>
  onVersionConflict: () => void
}) {
  const [reason, setReason] = useState('')
  const [pending, setPending] = useState<PendingMessage[] | null>(null)
  const [resolution, setResolution] = useState<CancelResolution | ''>('')
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [prevOpen, setPrevOpen] = useState(false)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setReason('')
      setPending(null)
      setResolution('')
      setError(null)
      setSubmitting(false)
    }
  }

  const wsName = (id: string) => intensive.workspaces.find((w) => w.id === id)?.workspaceName ?? 'Подключение'
  const tooLong = reason.trim().length > 2000
  const needsChoice = pending !== null && pending.length > 0

  const submit = async () => {
    if (submitting || tooLong || (needsChoice && !resolution)) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await apiFetch<{ affectedMessages?: number }>(`/api/intensives/${intensive.id}/cancel`, {
        method: 'POST',
        json: {
          version: intensive.version,
          ...(reason.trim() ? { reason: reason.trim() } : {}),
          ...(resolution ? { resolution } : {}),
        },
      })
      const n = res.affectedMessages ?? 0
      toast.success('Интенсив отменён', {
        description:
          n > 0
            ? resolution === 'cancel_messages'
              ? `Отменено ожидающих сообщений: ${n}.`
              : `Сообщений отвязано от интенсива: ${n}. Они остаются запланированными.`
            : undefined,
      })
      await onCancelled()
      onOpenChange(false)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'PENDING_MESSAGES_EXIST' && Array.isArray(e.body.pendingMessages)) {
        setPending(e.body.pendingMessages as PendingMessage[])
        setResolution('')
        toast.warning('Есть ожидающие отправки', { description: 'Выберите, что с ними сделать, и подтвердите отмену.' })
      } else if (e instanceof ApiError && e.code === 'VERSION_CONFLICT') {
        toast.error('Интенсив изменён другим пользователем', { description: 'Обновите данные и повторите.' })
        onVersionConflict()
        onOpenChange(false)
      } else {
        setError(errText(e))
        toast.error('Не удалось отменить интенсив', { description: errText(e) })
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GuardedDialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={(reason.trim().length > 0 || resolution !== '') && !submitting}
      busy={submitting}
      title={`Отменить интенсив «${intensive.name}»?`}
      description="Отменённый интенсив нельзя вернуть в работу: его можно только заархивировать. История и сообщения сохраняются."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Не отменять
          </Button>
          <Button type="button" variant="destructive" disabled={submitting || tooLong || (needsChoice && !resolution)} onClick={() => void submit()}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            Отменить интенсив
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && <InlineNotice tone="danger">{error}</InlineNotice>}
        <Field label="Причина" htmlFor="cancel-reason" error={tooLong ? 'Не длиннее 2000 символов' : undefined} hint="Необязательно. Сохранится в истории.">
          <Textarea id="cancel-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} disabled={submitting} aria-invalid={tooLong} />
        </Field>

        {pending && (
          <section className="space-y-3" aria-label="Ожидающие отправки">
            <InlineNotice tone="warning">
              <p className="font-medium">
                Есть ожидающие отправки ({pending.length}). Отмена заблокирована, пока вы не выберете, что с ними делать.
              </p>
            </InlineNotice>
            <ul className="max-h-48 divide-y overflow-y-auto rounded-md border">
              {pending.map((m) => (
                <li key={m.messageId} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-1.5 text-[13px]">
                  <span className="tabular-nums">{formatInstant(m.scheduledFor, intensive.timezone, true)}</span>
                  <span className="min-w-0 flex-1 truncate text-muted-foreground">{wsName(m.workspaceId)}</span>
                  {m.isPlanRepeat && <Badge variant="outline">Повтор</Badge>}
                </li>
              ))}
            </ul>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[13px] font-semibold">Что сделать с этими сообщениями?</legend>
              <RadioRow
                name="cancel-resolution"
                value="cancel_messages"
                checked={resolution === 'cancel_messages'}
                onChange={() => setResolution('cancel_messages')}
                title="Отменить сообщения"
                description="Ожидающие сообщения будут отменены. Сообщение, которое отправщик уже взял в работу, может всё равно уйти."
              />
              <RadioRow
                name="cancel-resolution"
                value="detach_messages"
                checked={resolution === 'detach_messages'}
                onChange={() => setResolution('detach_messages')}
                title="Оставить сообщения запланированными без привязки"
                description="Связь с интенсивом и пунктом снимется, сообщения уйдут в назначенное время как обычные."
              />
            </fieldset>
          </section>
        )}
      </div>
    </GuardedDialog>
  )
}
