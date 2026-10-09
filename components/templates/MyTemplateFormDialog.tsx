'use client'

/** Создание/редактирование своего шаблона (POST/PATCH /api/templates/mine). */
import { useMemo, useRef, useState } from 'react'
import { Eye, EyeOff, Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { TimePicker } from '@/components/ui/time-picker'
import { ChannelSelect, freeChannelError, normalizeFreeChannel } from '@/components/common/ChannelSelect'
import { GuardedDialog, InlineNotice } from '@/components/intensives/admin/kit'
import { apiFetch } from '@/lib/intensives/ui'
import { TEMPLATE_LIMITS } from '@/lib/templates/types'
import { TIME_RE, errText, type UserTemplate } from './lib'

type Form = { channel: string; day: string; time: string; title: string; tags: string; body: string }

const MAX_DAY = 14

function formOf(t: UserTemplate | null): Form {
  return {
    channel: t?.channel ?? '',
    day: t?.intensiveDay != null ? String(t.intensiveDay) : '',
    time: t?.time ?? '09:00',
    title: t?.title ?? '',
    tags: (t?.tags ?? []).join(', '),
    body: t?.body ?? '',
  }
}

export type MyTemplateTarget = { mode: 'create' } | { mode: 'edit'; template: UserTemplate }

export function MyTemplateFormDialog({
  target,
  canManageChannels,
  onClose,
  onSaved,
}: {
  target: MyTemplateTarget | null
  /** Lead_SUP: добавляет каналы в общий список; остальные — «Другой…» (свой канал вне списка) */
  canManageChannels: boolean
  onClose: () => void
  onSaved: () => void | Promise<void>
}) {
  const [prevTarget, setPrevTarget] = useState<MyTemplateTarget | null>(null)
  const [initial, setInitial] = useState<Form>(() => formOf(null))
  const [form, setForm] = useState<Form>(initial)
  const [submitted, setSubmitted] = useState(false)
  const [preview, setPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const lock = useRef(false)

  if (target !== prevTarget) {
    setPrevTarget(target)
    if (target) {
      const f = formOf(target.mode === 'edit' ? target.template : null)
      setInitial(f)
      setForm(f)
      setSubmitted(false)
      setPreview(false)
      setSaving(false)
      setFormError(null)
    }
  }

  const errors = useMemo(() => {
    const e: { channel?: string; day?: string; time?: string; body?: string; title?: string } = {}
    // Канал из списка всегда корректен; проверяем свой ввод и исторические значения, если их меняли
    if (!form.channel.trim()) e.channel = 'Укажите канал'
    else if (form.channel !== initial.channel) {
      const err = freeChannelError(form.channel)
      if (err) e.channel = err
    }
    const day = form.day.trim()
    if (day) {
      const n = Number(day)
      if (!Number.isInteger(n) || n < 1 || n > MAX_DAY) e.day = `Введите целое число от 1 до ${MAX_DAY}`
    }
    if (!form.time.trim()) e.time = 'Укажите время'
    else if (!TIME_RE.test(form.time.trim())) e.time = 'Укажите время в формате ЧЧ:ММ, например 09:00'
    if (form.title.trim().length > TEMPLATE_LIMITS.title) e.title = `Не длиннее ${TEMPLATE_LIMITS.title} символов`
    if (!form.body.trim()) e.body = 'Введите текст шаблона'
    else if (form.body.length > TEMPLATE_LIMITS.body) e.body = `Текст — не длиннее ${TEMPLATE_LIMITS.body} символов`
    return e
  }, [form, initial.channel])

  if (!target) return null

  const isCreate = target.mode === 'create'
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k])
  const valid = Object.keys(errors).length === 0
  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }))

  const save = async () => {
    setSubmitted(true)
    if (!valid) {
      toast.error('Проверьте поля формы', { description: 'Исправьте отмеченные ошибки и сохраните ещё раз.' })
      return
    }
    if (lock.current) return
    lock.current = true
    setSaving(true)
    setFormError(null)
    try {
      const channel = form.channel === initial.channel ? form.channel : normalizeFreeChannel(form.channel)
      const payload = {
        channel,
        intensiveDay: form.day.trim() ? Number(form.day) : null,
        time: form.time.trim(),
        title: form.title.trim() || null,
        body: form.body.trim(),
        tags: form.tags
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean),
      }
      if (target.mode === 'create') {
        await apiFetch('/api/templates/mine', { method: 'POST', json: payload })
        toast.success('Шаблон создан')
      } else {
        await apiFetch(`/api/templates/mine/${encodeURIComponent(target.template.id)}`, { method: 'PATCH', json: payload })
        toast.success('Шаблон сохранён')
      }
      onClose()
      await onSaved()
    } catch (e) {
      setFormError(errText(e))
      toast.error(isCreate ? 'Не удалось создать шаблон' : 'Не удалось сохранить шаблон', { description: errText(e) })
    } finally {
      lock.current = false
      setSaving(false)
    }
  }

  const err = (k: keyof typeof errors) => (submitted ? errors[k] : undefined)

  return (
    <GuardedDialog
      open
      onOpenChange={(o) => !o && onClose()}
      dirty={dirty && !saving}
      busy={saving}
      className="sm:max-w-2xl"
      title={isCreate ? 'Создать шаблон' : 'Редактировать шаблон'}
      description="Личный шаблон виден только вам и доступен в пространстве во вкладке «Шаблоны»."
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button type="submit" form="my-template-form" disabled={saving || (!isCreate && !dirty)}>
            {saving && <Loader2 className="animate-spin" aria-hidden />}
            {isCreate ? 'Создать' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <form
        id="my-template-form"
        className="grid gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void save()
        }}
      >
        {formError && <InlineNotice tone="danger">{formError}</InlineNotice>}
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Канал"
            htmlFor="tpl-channel"
            required
            className="sm:col-span-2"
            hint={
              canManageChannels
                ? 'Выберите из списка. Нужного нет — добавьте его здесь же.'
                : 'Выберите из списка или «Другой канал…». Проверка в Rocket.Chat ничего не блокирует.'
            }
            error={err('channel')}
          >
            <ChannelSelect
              id="tpl-channel"
              value={form.channel}
              onChange={(v) => set('channel', v)}
              invalid={!!err('channel')}
              disabled={saving}
              allowCreate={canManageChannels}
              allowCustom={!canManageChannels}
            />
          </Field>
          <Field label="День интенсива" htmlFor="tpl-day" hint={`От 1 до ${MAX_DAY}, необязательно. Для группировки шаблонов в пространстве.`} error={err('day')}>
            <Input
              id="tpl-day"
              type="number"
              inputMode="numeric"
              min={1}
              max={MAX_DAY}
              placeholder="—"
              aria-invalid={!!err('day')}
              value={form.day}
              disabled={saving}
              onChange={(e) => set('day', e.target.value)}
            />
          </Field>
          <Field label="Время (примерное)" htmlFor="tpl-time" required error={err('time')}>
            <TimePicker id="tpl-time" value={form.time} onChange={(v) => set('time', v)} invalid={!!err('time')} disabled={saving} />
          </Field>
        </div>
        <Field label="Название" htmlFor="tpl-title" hint="Необязательно" error={err('title')}>
          <Input
            id="tpl-title"
            placeholder="Краткое название"
            value={form.title}
            aria-invalid={!!err('title')}
            disabled={saving}
            onChange={(e) => set('title', e.target.value)}
          />
        </Field>
        <Field label="Теги" htmlFor="tpl-tags" hint="Через запятую, для фильтра. Необязательно.">
          <Input id="tpl-tags" placeholder="экзамен, групповой проект" value={form.tags} disabled={saving} onChange={(e) => set('tags', e.target.value)} />
        </Field>
        <Field label="Текст шаблона" htmlFor="tpl-body" required error={err('body')}>
          <Textarea
            id="tpl-body"
            className="min-h-[180px] font-mono text-sm"
            placeholder="Введите текст анонса..."
            aria-invalid={!!err('body')}
            value={form.body}
            disabled={saving}
            onChange={(e) => set('body', e.target.value)}
          />
          <Button type="button" variant="outline" size="sm" aria-pressed={preview} onClick={() => setPreview((p) => !p)}>
            {preview ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
            {preview ? 'Скрыть предпросмотр' : 'Предпросмотр'}
          </Button>
          {preview && (
            <div className="rounded-md border bg-muted/40 p-3">
              <pre className="whitespace-pre-wrap font-sans text-sm [word-break:break-word]">{form.body || '—'}</pre>
            </div>
          )}
        </Field>
      </form>
    </GuardedDialog>
  )
}
