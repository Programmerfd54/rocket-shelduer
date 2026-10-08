'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import type { OrgSpaceDto } from '@/lib/intensives/types'
import { GuardedDialog, InlineNotice, errText, fieldErrorsOf } from './kit'

/** Создание / переименование организационного пространства. */
export function OrgSpaceFormDialog({
  open,
  onOpenChange,
  space,
  initialName,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  /** Есть — режим правки */
  space?: OrgSpaceDto
  initialName?: string
  onSaved: (space: OrgSpaceDto) => void | Promise<void>
}) {
  const [prevOpen, setPrevOpen] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [touched, setTouched] = useState(false)
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  const initialN = space?.name ?? initialName ?? ''
  const initialD = space?.description ?? ''

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      setName(initialN)
      setDescription(initialD)
      setTouched(false)
      setServerErrors({})
      setFormError(null)
      setSubmitting(false)
    }
  }

  const trimmed = name.trim()
  const nameError = !trimmed ? 'Укажите название' : trimmed.length > 120 ? 'Не длиннее 120 символов' : undefined
  const descError = description.length > 2000 ? 'Не длиннее 2000 символов' : undefined
  const valid = !nameError && !descError
  const dirty = name !== initialN || description !== initialD
  const editMode = !!space

  const submit = async () => {
    setTouched(true)
    if (!valid || submitting) return
    setSubmitting(true)
    setFormError(null)
    setServerErrors({})
    try {
      const body = { name: trimmed, ...(editMode || description.trim() ? { description: description.trim() } : {}) }
      const res = editMode
        ? await apiFetch<{ orgSpace: OrgSpaceDto }>(`/api/org-spaces/${space.id}`, { method: 'PATCH', json: body })
        : await apiFetch<{ orgSpace: OrgSpaceDto }>('/api/org-spaces', { method: 'POST', json: body })
      toast.success(editMode ? 'Пространство обновлено' : 'Пространство создано')
      await onSaved(res.orgSpace)
      onOpenChange(false)
    } catch (e) {
      const fe = fieldErrorsOf(e)
      if (e instanceof ApiError && e.code === 'ORG_SPACE_NAME_TAKEN') fe.name = fe.name ?? e.message
      setServerErrors(fe)
      setFormError(Object.keys(fe).length ? null : errText(e))
      toast.error(editMode ? 'Не удалось сохранить' : 'Не удалось создать пространство', { description: errText(e) })
    } finally {
      setSubmitting(false)
    }
  }

  const err = serverErrors.name || (touched ? nameError : undefined)

  return (
    <GuardedDialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty && !submitting}
      busy={submitting}
      title={editMode ? 'Изменить пространство' : 'Создать пространство'}
      description="Организационное пространство объединяет подключения одного Rocket.Chat-пространства. Секреты подключений не передаются."
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form="org-space-form" disabled={!valid || (editMode && !dirty) || submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {editMode ? 'Сохранить' : 'Создать'}
          </Button>
        </>
      }
    >
      <form
        id="org-space-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {formError && <InlineNotice tone="danger">{formError}</InlineNotice>}
        <Field label="Название" htmlFor="os-name" required error={err} hint="Уникально, без учёта регистра.">
          <Input
            id="os-name"
            value={name}
            maxLength={140}
            autoComplete="off"
            autoFocus
            onChange={(e) => {
              setName(e.target.value)
              setTouched(true)
              setServerErrors((s) => ({ ...s, name: '' }))
            }}
            aria-invalid={!!err}
            disabled={submitting}
          />
        </Field>
        <Field label="Описание" htmlFor="os-desc" error={serverErrors.description || descError} hint={`${description.length} / 2000`}>
          <Textarea id="os-desc" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} disabled={submitting} placeholder="Необязательно" />
        </Field>
      </form>
    </GuardedDialog>
  )
}
