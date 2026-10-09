'use client'

/**
 * Создание и редактирование официального шаблона (Lead_SUP): все поля, канал из словаря (с добавлением на месте),
 * клиентская валидация как на сервере, ошибки сервера у полей, защита от потери несохранённого и двойной отправки.
 * Контракт — docs/templates-api.md §3.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react'
import { Eye, EyeOff, Loader2, Undo2 } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TimePicker } from '@/components/ui/time-picker'
import { ChannelSelect, upsertTemplateChannel } from '@/components/common/ChannelSelect'
import { GuardedDialog, InlineNotice } from '@/components/intensives/admin/kit'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import {
  TEMPLATE_LIMITS,
  TEMPLATE_SCOPES,
  channelNameError,
  defaultDayLabel,
  normalizeChannelName,
  type CreateOfficialTemplateInput,
  type EffectiveOfficialTemplate,
  type OfficialTemplateDefaults,
  type OfficialTemplateDto,
  type TemplateAudience,
  type TemplateChannelDto,
  type TemplateScope,
  type UpdateOfficialTemplateInput,
} from '@/lib/templates/types'
import { AUDIENCE_OPTIONS, SCOPE_TAB_LABELS, TIME_RE, errText, fieldErrorsOf } from './lib'

type Form = {
  scope: TemplateScope
  title: string
  body: string
  channel: string
  day: string
  time: string
  audience: TemplateAudience
  timeNote: string
}

type FieldKey = keyof Form

/** Предзаполнение формы создания (копия шаблона в другой набор). */
export type OfficialTemplatePrefill = Partial<Form> & {
  /** Подпись дня источника — сохраняется, если день не меняли */
  dayLabel?: string
  sourceTitle?: string
}

export type OfficialFormTarget =
  | { mode: 'create'; scope: TemplateScope; prefill?: OfficialTemplatePrefill }
  | { mode: 'edit'; template: OfficialTemplateDto }

const SERVER_FIELD_MAP: Record<string, FieldKey> = {
  title: 'title',
  body: 'body',
  channel: 'channel',
  intensiveDay: 'day',
  dayLabel: 'day',
  time: 'time',
  audience: 'audience',
  timeNote: 'timeNote',
  scope: 'scope',
}

function formFromTarget(target: OfficialFormTarget): Form {
  if (target.mode === 'edit') {
    const t = target.template
    return {
      scope: t.scope,
      title: t.title,
      body: t.body,
      channel: t.channel,
      day: String(t.intensiveDay),
      time: t.time,
      audience: t.audience,
      timeNote: t.timeNote ?? '',
    }
  }
  const p = target.prefill ?? {}
  return {
    scope: p.scope ?? target.scope,
    title: p.title ?? '',
    body: p.body ?? '',
    channel: p.channel ?? '',
    day: p.day ?? '1',
    time: p.time ?? '10:00',
    audience: p.audience ?? 'all',
    timeNote: p.timeNote ?? '',
  }
}

function parseDay(s: string): number | null {
  const t = s.trim()
  if (!/^\d+$/.test(t)) return null
  return Number(t)
}

function validate(f: Form, initial: Form, isCreate: boolean, defaultChannel?: string): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {}
  const title = f.title.trim()
  if (!title) e.title = 'Укажите название'
  else if (title.length > TEMPLATE_LIMITS.title) e.title = `Не длиннее ${TEMPLATE_LIMITS.title} символов`
  if (!f.body.trim()) e.body = 'Введите текст шаблона'
  else if (f.body.length > TEMPLATE_LIMITS.body) e.body = `Текст — не длиннее ${TEMPLATE_LIMITS.body} символов`
  // Канал проверяем, только если его выбрали заново: у встроенных бывают исторические имена вне правил
  if (isCreate || (f.channel !== initial.channel && f.channel !== defaultChannel)) {
    const err = channelNameError(f.channel)
    if (err) e.channel = err
  }
  const day = parseDay(f.day)
  if (day === null) e.day = 'Укажите номер дня — целое число'
  else if (day < TEMPLATE_LIMITS.minDay || day > TEMPLATE_LIMITS.maxDay) e.day = `День — от ${TEMPLATE_LIMITS.minDay} до ${TEMPLATE_LIMITS.maxDay}`
  if (!f.time) e.time = 'Укажите время'
  else if (!TIME_RE.test(f.time)) e.time = 'Время в формате ЧЧ:ММ, например 09:00'
  if (f.timeNote.trim().length > TEMPLATE_LIMITS.timeNote) e.timeNote = `Не длиннее ${TEMPLATE_LIMITS.timeNote} символов`
  return e
}

/** Значение поля по умолчанию у встроенного шаблона (для «Вернуть исходное»). */
function defaultOf(d: OfficialTemplateDefaults, k: FieldKey): string | null {
  switch (k) {
    case 'title':
      return d.title
    case 'body':
      return d.body
    case 'channel':
      return d.channel
    case 'day':
      return String(d.intensiveDay)
    case 'time':
      return d.time
    case 'audience':
      return d.audience
    case 'timeNote':
      return d.timeNote ?? ''
    default:
      return null
  }
}

export function OfficialTemplateFormDialog({
  target,
  onClose,
  onSaved,
  onGone,
}: {
  /** null — диалог закрыт */
  target: OfficialFormTarget | null
  onClose: () => void
  onSaved: (template: EffectiveOfficialTemplate, info: { created: boolean; createdChannel: TemplateChannelDto | null }) => void | Promise<void>
  /** Шаблон удалён/не найден на сервере — обновить список */
  onGone: () => void
}) {
  const [prevTarget, setPrevTarget] = useState<OfficialFormTarget | null>(null)
  const [initial, setInitial] = useState<Form | null>(null)
  const [form, setForm] = useState<Form | null>(null)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [serverErrors, setServerErrors] = useState<Partial<Record<FieldKey, string>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [missingChannel, setMissingChannel] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const [preview, setPreview] = useState(false)
  const lock = useRef(false)

  // Сброс формы при открытии на новый шаблон (без эффектов: «состояние из пропсов»)
  if (target !== prevTarget) {
    setPrevTarget(target)
    if (target) {
      const f = formFromTarget(target)
      setInitial(f)
      setForm(f)
      setTouched(target.mode === 'create' && target.prefill ? { title: true, channel: true, body: true } : {})
      setServerErrors({})
      setFormError(null)
      setMissingChannel(null)
      setSubmitting(false)
      setPreview(false)
    }
  }

  const isCreate = target?.mode === 'create'
  const template = target?.mode === 'edit' ? target.template : null
  const builtin = template?.source === 'builtin'
  const defaults = template?.defaults

  const errors = useMemo(
    () => (form && initial ? validate(form, initial, isCreate, defaults?.channel) : {}),
    [form, initial, isCreate, defaults?.channel],
  )
  const valid = Object.keys(errors).length === 0
  const dirty = !!form && !!initial && (Object.keys(form) as FieldKey[]).some((k) => form[k] !== initial[k])
  const errorFor = (k: FieldKey) => serverErrors[k] ?? (touched[k] ? errors[k] : undefined)

  if (!target || !form || !initial) {
    return null
  }

  const set = <K extends FieldKey>(k: K, v: Form[K]) => {
    setForm((f) => (f ? { ...f, [k]: v } : f))
    setTouched((t) => ({ ...t, [k]: true }))
    setServerErrors((s) => {
      if (!s[k]) return s
      const rest = { ...s }
      delete rest[k]
      return rest
    })
    if (k === 'channel') setMissingChannel(null)
  }

  const dayNum = parseDay(form.day)
  const dayChanged = form.day !== initial.day
  const dayLabelPreview = (() => {
    if (dayNum === null) return null
    if (template && !dayChanged) return template.dayLabel
    if (isCreate && target.mode === 'create' && target.prefill?.dayLabel && form.day === target.prefill.day) return target.prefill.dayLabel
    if (builtin && defaults && dayNum === defaults.intensiveDay) return defaults.dayLabel
    return defaultDayLabel(dayNum)
  })()

  const buildCreate = (createChannelIfMissing: boolean): CreateOfficialTemplateInput => {
    const day = dayNum ?? 1
    const prefill = target.mode === 'create' ? target.prefill : undefined
    const keepLabel = prefill?.dayLabel && form.day === prefill.day && prefill.dayLabel !== defaultDayLabel(day)
    return {
      scope: form.scope,
      title: form.title.trim(),
      body: form.body,
      channel: normalizeChannelName(form.channel),
      intensiveDay: day,
      time: form.time,
      audience: form.audience,
      timeNote: form.timeNote.trim() || null,
      ...(keepLabel ? { dayLabel: prefill!.dayLabel } : {}),
      ...(createChannelIfMissing ? { createChannelIfMissing: true } : {}),
    }
  }

  const buildUpdate = (createChannelIfMissing: boolean): UpdateOfficialTemplateInput => {
    const p: UpdateOfficialTemplateInput = {}
    if (builtin) p.scope = template!.scope
    else if (form.scope !== initial.scope) p.scope = form.scope
    if (form.title.trim() !== initial.title.trim()) p.title = form.title.trim()
    if (form.body !== initial.body) p.body = form.body
    if (form.channel !== initial.channel) {
      // Возврат к исходному «историческому» имени встроенного — без нормализации (сервер сравнит с умолчанием)
      p.channel = builtin && defaults && form.channel === defaults.channel ? form.channel : normalizeChannelName(form.channel)
    }
    if (dayChanged && dayNum !== null) {
      p.intensiveDay = dayNum
      // Подпись дня: у встроенного на исходном дне — исходная, иначе «День N»
      p.dayLabel = builtin ? (defaults && dayNum === defaults.intensiveDay ? null : '') : null
    }
    if (form.time !== initial.time) p.time = form.time
    if (form.audience !== initial.audience) p.audience = form.audience
    if (form.timeNote.trim() !== initial.timeNote.trim()) {
      const note = form.timeNote.trim()
      p.timeNote = note ? note : builtin ? (defaults?.timeNote ? '' : null) : null
    }
    if (createChannelIfMissing) p.createChannelIfMissing = true
    return p
  }

  const submit = async (createChannelIfMissing = false) => {
    setTouched({ title: true, body: true, channel: true, day: true, time: true, timeNote: true })
    if (!valid || lock.current) return
    if (!isCreate && !dirty) return
    lock.current = true
    setSubmitting(true)
    setFormError(null)
    setServerErrors({})
    try {
      let result: { template: EffectiveOfficialTemplate; createdChannel: TemplateChannelDto | null }
      if (target.mode === 'create') {
        result = await apiFetch('/api/templates/official', { method: 'POST', json: buildCreate(createChannelIfMissing) })
      } else {
        const t = target.template
        result = await apiFetch(`/api/templates/official/${encodeURIComponent(t.id)}?scope=${t.scope}`, {
          method: 'PATCH',
          json: buildUpdate(createChannelIfMissing),
        })
      }
      if (result.createdChannel) upsertTemplateChannel(result.createdChannel)
      setMissingChannel(null)
      await onSaved(result.template, { created: isCreate, createdChannel: result.createdChannel })
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.code === 'CHANNEL_NOT_IN_DICTIONARY') {
          const ch = typeof e.body.channel === 'string' ? e.body.channel : normalizeChannelName(form.channel)
          setMissingChannel(ch)
          setServerErrors({ channel: `Канала #${ch} нет в списке каналов` })
          return
        }
        if (e.code === 'TEMPLATE_DELETED' || e.code === 'TEMPLATE_NOT_FOUND') {
          toast.error(e.code === 'TEMPLATE_DELETED' ? 'Шаблон уже удалён' : 'Шаблон не найден', {
            description:
              e.code === 'TEMPLATE_DELETED'
                ? 'Его удалили, пока вы редактировали. Восстановите его в разделе «Удалённые» и повторите правку.'
                : 'Возможно, его удалили. Список обновлён.',
          })
          onGone()
          onClose()
          return
        }
      }
      const fe = fieldErrorsOf(e)
      const mapped: Partial<Record<FieldKey, string>> = {}
      for (const [k, v] of Object.entries(fe)) {
        const key = SERVER_FIELD_MAP[k]
        if (key && !mapped[key]) mapped[key] = v
      }
      setServerErrors(mapped)
      setFormError(errText(e))
      toast.error(isCreate ? 'Не удалось добавить шаблон' : 'Не удалось сохранить шаблон', { description: errText(e) })
    } finally {
      lock.current = false
      setSubmitting(false)
    }
  }

  /** «Изменено. По умолчанию: … [Вернуть]» под полем встроенного шаблона. */
  const defaultHint = (k: FieldKey, render?: (v: string) => ReactNode): ReactNode => {
    if (!builtin || !defaults) return null
    const def = defaultOf(defaults, k)
    if (def === null || form[k] === def) return null
    const shown = render ? render(def) : def || 'пусто'
    return (
      <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="min-w-0">
          Изменено. По умолчанию: <span className="text-foreground">{shown}</span>
        </span>
        <button
          type="button"
          className="inline-flex items-center gap-1 rounded-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30"
          onClick={() => set(k, def as Form[typeof k])}
          disabled={submitting}
        >
          <Undo2 className="size-3" aria-hidden />
          Вернуть
        </button>
      </span>
    )
  }

  const scopeLocked = !isCreate && builtin
  const title = isCreate
    ? target.mode === 'create' && target.prefill?.sourceTitle
      ? `Копия шаблона в ${SCOPE_TAB_LABELS[form.scope].replace('Шаблоны ', 'набор ')}`
      : 'Добавить шаблон'
    : 'Редактировать шаблон'

  const description = isCreate
    ? target.mode === 'create' && target.prefill?.sourceTitle
      ? `Копия «${target.prefill.sourceTitle}». Проверьте поля и сохраните — оригинал не изменится.`
      : 'Новый официальный шаблон сразу появится у всех пользователей выбранного набора.'
    : builtin
      ? 'Встроенный шаблон. Изменения видны всем пользователям набора; исходный вид можно вернуть. Уже созданные планы и сообщения не изменятся.'
      : 'Изменения видны всем пользователям набора. Уже созданные планы и сообщения не изменятся.'

  const bodyHint = (
    <span className="flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5">
      <span>{defaultHint('body', () => 'исходный текст') ?? 'Текст анонса, как он уйдёт в канал.'}</span>
      <span className="tabular-nums">
        {form.body.length.toLocaleString('ru-RU')} / {TEMPLATE_LIMITS.body.toLocaleString('ru-RU')}
      </span>
    </span>
  )

  return (
    <GuardedDialog
      open
      onOpenChange={(o) => !o && onClose()}
      dirty={dirty && !submitting}
      busy={submitting}
      className="sm:max-w-2xl"
      title={
        <span className="flex flex-wrap items-center gap-2">
          {title}
          {template && (
            <>
              {builtin ? <Badge variant="muted">Встроенный</Badge> : <Badge variant="info">Свой</Badge>}
              {template.isModified && <Badge variant="warning">Изменён</Badge>}
            </>
          )}
        </span>
      }
      description={description}
      footer={
        <>
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form="official-template-form" disabled={submitting || !valid || (!isCreate && !dirty)}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {isCreate ? 'Добавить' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <form
        id="official-template-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {formError && !missingChannel && <InlineNotice tone="danger">{formError}</InlineNotice>}
        {missingChannel && (
          <InlineNotice tone="warning">
            <div className="space-y-2">
              <p>
                Канала <span className="font-mono">#{missingChannel}</span> нет в списке каналов. Добавить его в список и сохранить
                шаблон?
              </p>
              <Button type="button" size="sm" onClick={() => void submit(true)} disabled={submitting}>
                {submitting && <Loader2 className="animate-spin" aria-hidden />}
                Добавить канал #{missingChannel} и сохранить
              </Button>
            </div>
          </InlineNotice>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Набор"
            htmlFor="ot-scope"
            hint={
              scopeLocked
                ? 'Встроенный шаблон нельзя перенести в другой набор — сделайте копию.'
                : isCreate
                  ? 'Кому виден шаблон: сотрудникам SUP или ADM.'
                  : 'Можно перенести шаблон в другой набор.'
            }
            error={errorFor('scope')}
          >
            <Select value={form.scope} onValueChange={(v) => set('scope', v as TemplateScope)} disabled={scopeLocked || submitting}>
              <SelectTrigger id="ot-scope" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {SCOPE_TAB_LABELS[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Аудитория" htmlFor="ot-audience" hint={defaultHint('audience', (v) => AUDIENCE_OPTIONS.find((o) => o.value === v)?.label ?? v) ?? 'Каким кампусам предназначен анонс.'} error={errorFor('audience')}>
            <Select value={form.audience} onValueChange={(v) => set('audience', v as TemplateAudience)} disabled={submitting}>
              <SelectTrigger id="ot-audience" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {AUDIENCE_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>

        <Field label="Название" htmlFor="ot-title" required error={errorFor('title')} hint={defaultHint('title')}>
          <Input
            id="ot-title"
            value={form.title}
            maxLength={TEMPLATE_LIMITS.title + 20}
            placeholder="Например: Приветствие участников"
            aria-invalid={!!errorFor('title')}
            disabled={submitting}
            onChange={(e) => set('title', e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, title: true }))}
          />
        </Field>

        <Field label="Канал" htmlFor="ot-channel" required error={errorFor('channel')} hint={defaultHint('channel', (v) => <span className="font-mono">#{v}</span>) ?? 'Выберите из списка. Нужного нет — добавьте его здесь же.'}>
          <ChannelSelect
            id="ot-channel"
            value={form.channel}
            onChange={(v) => set('channel', v)}
            invalid={!!errorFor('channel')}
            disabled={submitting}
            allowCreate
          />
        </Field>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field
            label="День интенсива"
            htmlFor="ot-day"
            required
            error={errorFor('day')}
            hint={defaultHint('day', (v) => `день ${v}`) ?? (dayLabelPreview ? `Подпись: «${dayLabelPreview}»` : `От ${TEMPLATE_LIMITS.minDay} до ${TEMPLATE_LIMITS.maxDay}`)}
          >
            <Input
              id="ot-day"
              inputMode="numeric"
              value={form.day}
              aria-invalid={!!errorFor('day')}
              disabled={submitting}
              onChange={(e) => set('day', e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return
                e.preventDefault()
                const n = parseDay(form.day) ?? 0
                const next = Math.min(TEMPLATE_LIMITS.maxDay, Math.max(TEMPLATE_LIMITS.minDay, n + (e.key === 'ArrowUp' ? 1 : -1)))
                set('day', String(next))
              }}
            />
          </Field>
          <Field label="Время" htmlFor="ot-time" required error={errorFor('time')} hint={defaultHint('time') ?? 'Рекомендуемое время отправки'}>
            <TimePicker id="ot-time" value={form.time} onChange={(v) => set('time', v)} invalid={!!errorFor('time')} disabled={submitting} />
          </Field>
          <Field label="Подсказка ко времени" htmlFor="ot-note" error={errorFor('timeNote')} hint={defaultHint('timeNote') ?? 'Необязательно, например «после обеда»'}>
            <Input
              id="ot-note"
              value={form.timeNote}
              maxLength={TEMPLATE_LIMITS.timeNote + 20}
              aria-invalid={!!errorFor('timeNote')}
              disabled={submitting}
              onChange={(e) => set('timeNote', e.target.value)}
            />
          </Field>
        </div>

        <Field label="Текст шаблона" htmlFor="ot-body" required error={errorFor('body')} hint={bodyHint}>
          <Textarea
            id="ot-body"
            className="min-h-[200px] font-mono text-sm"
            placeholder="Текст анонса…"
            value={form.body}
            aria-invalid={!!errorFor('body')}
            disabled={submitting}
            onChange={(e) => set('body', e.target.value)}
            onBlur={() => setTouched((t) => ({ ...t, body: true }))}
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
