'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { apiFetch } from '@/lib/intensives/ui'
import type { IntensiveOverlapRef, IntensiveSummary, OrgSpaceConnection, OrgSpaceDto } from '@/lib/intensives/types'
import { GuardedDialog, InlineNotice, errText, fieldErrorsOf, overlapText, periodLabel } from './kit'
import { TimezonePicker } from './TimezonePicker'

/**
 * «Создать черновик из дат подключения»: старые даты подключения (startDate/endDate) предлагаются как черновик.
 * Не публикует и не меняет даты подключения.
 */
export function DraftFromDatesDialog({
  target,
  onOpenChange,
  onReload,
}: {
  target: { space: OrgSpaceDto; connection: OrgSpaceConnection } | null
  onOpenChange: (o: boolean) => void
  onReload: () => void | Promise<void>
}) {
  const router = useRouter()
  const [name, setName] = useState('')
  const [tz, setTz] = useState('Europe/Moscow')
  const [initialName, setInitialName] = useState('')
  const [serverError, setServerError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [prevKey, setPrevKey] = useState<string | null>(null)

  const key = target ? `${target.space.id}:${target.connection.id}` : null
  if (key !== prevKey) {
    setPrevKey(key)
    if (target && target.connection.startDate && target.connection.endDate) {
      const n = `${target.space.name}: ${periodLabel(target.connection.startDate, target.connection.endDate)}`
      setName(n)
      setInitialName(n)
    }
    setTz('Europe/Moscow')
    setServerError(null)
    setSubmitting(false)
  }

  const trimmed = name.trim()
  const nameError = !trimmed ? 'Укажите название' : trimmed.length > 200 ? 'Не длиннее 200 символов' : undefined
  const dirty = name !== initialName || tz !== 'Europe/Moscow'

  const submit = async () => {
    if (!target || nameError || submitting) return
    setSubmitting(true)
    setServerError(null)
    try {
      const res = await apiFetch<{ intensive: IntensiveSummary; existing: boolean; warnings?: { overlaps?: IntensiveOverlapRef[] } }>(
        `/api/org-spaces/${target.space.id}/draft-from-workspace-dates`,
        { method: 'POST', json: { workspaceId: target.connection.id, name: trimmed, timezone: tz } },
      )
      if (res.existing) {
        toast.info('Интенсив с этими датами уже есть', { description: 'Открываем существующий — дубликат не создан.' })
      } else {
        toast.success('Черновик создан', { description: 'Даты подключения не изменены, интенсив не опубликован.' })
      }
      const overlaps = res.warnings?.overlaps ?? []
      if (overlaps.length > 0) {
        toast.warning('Период пересекается с другим интенсивом', { description: overlaps.map(overlapText).join('; ') })
      }
      onOpenChange(false)
      router.push(`/dashboard/admin/intensives/${res.intensive.id}`)
    } catch (e) {
      const fe = fieldErrorsOf(e)
      setServerError(fe.name ?? fe.timezone ?? errText(e))
      toast.error('Не удалось создать черновик', { description: errText(e) })
      void onReload()
    } finally {
      setSubmitting(false)
    }
  }

  const c = target?.connection

  return (
    <GuardedDialog
      open={!!target}
      onOpenChange={onOpenChange}
      dirty={dirty && !submitting}
      busy={submitting}
      title="Создать черновик из дат подключения"
      description={
        target && c?.startDate && c?.endDate
          ? `Подключение «${c.workspaceName}»: ${periodLabel(c.startDate, c.endDate)}. Интенсив будет создан как черновик в «${target.space.name}».`
          : undefined
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form="draft-dates-form" disabled={!!nameError || submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            Создать черновик
          </Button>
        </>
      }
    >
      <form
        id="draft-dates-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {serverError && <InlineNotice tone="danger">{serverError}</InlineNotice>}
        <InlineNotice tone="info">
          Старые даты подключения не меняются, сообщения не привязываются, интенсив не публикуется. Если черновик или интенсив с такими датами уже есть, откроется он.
        </InlineNotice>
        <Field label="Название" htmlFor="dd-name" required error={name !== initialName || !trimmed ? nameError : undefined}>
          <Input id="dd-name" value={name} maxLength={220} onChange={(e) => setName(e.target.value)} aria-invalid={!!nameError} disabled={submitting} />
        </Field>
        <Field label="Часовой пояс" htmlFor="dd-tz" required hint="В нём считаются дни интенсива.">
          <TimezonePicker id="dd-tz" value={tz} onChange={setTz} disabled={submitting} />
        </Field>
      </form>
    </GuardedDialog>
  )
}
