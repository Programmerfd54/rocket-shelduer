'use client'

import { useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { TimePicker } from '@/components/ui/time-picker'
import { ChannelSelect } from '@/components/common/ChannelSelect'
import { dayDate } from '@/lib/intensives/dates'
import { ApiError, AUDIENCE_LABELS, apiFetch, formatDayHeading } from '@/lib/intensives/ui'
import type { PlanItemAudience, PlanItemDto } from '@/lib/intensives/types'
import { PLAN_ITEM_AUDIENCES } from '@/lib/intensives/types'
import { channelNameError, normalizeChannelName } from '@/lib/templates/types'
import { GuardedDialog, InlineNotice, errText, fieldErrorsOf } from './kit'

/** Область пункта: SUP / ADM / ALL — для всех (в API — scope: 'SUP' | 'ADM' | null). */
type ScopeChoice = 'ALL' | 'SUP' | 'ADM'

type Form = {
  title: string
  body: string
  channel: string
  day: string
  time: string
  audience: PlanItemAudience
  scope: ScopeChoice
  categories: string
}

const MAX_BODY = 20_000

const SCOPE_OPTIONS: { value: ScopeChoice; label: string }[] = [
  { value: 'ALL', label: 'Для всех' },
  { value: 'SUP', label: 'Только SUP' },
  { value: 'ADM', label: 'Только ADM' },
]

function parseCategories(s: string): string[] {
  return Array.from(new Set(s.split(',').map((x) => x.trim()).filter(Boolean)))
}

function formFrom(item?: PlanItemDto): Form {
  return {
    title: item?.title ?? '',
    body: item?.body ?? '',
    // Канал как есть: исторические имена (вне словаря) показываются в селекторе и не меняются без выбора
    channel: item?.channel ?? '',
    day: item?.dayNumber ? String(item.dayNumber) : '',
    time: item?.time ?? '',
    audience: item?.audience ?? 'ALL',
    scope: item?.scope ?? 'ALL',
    categories: item?.categories.join(', ') ?? '',
  }
}

function validate(f: Form, mode: 'create' | 'edit', initialChannel: string): Record<string, string> {
  const e: Record<string, string> = {}
  if (mode === 'edit' && !f.title.trim()) e.title = 'Укажите название'
  if (f.title.trim().length > 200) e.title = 'Не длиннее 200 символов'
  if (!f.body.trim()) e.body = 'Введите текст анонса'
  else if (f.body.length > MAX_BODY) e.body = `Текст не длиннее ${MAX_BODY} символов`
  if (!f.channel.trim()) e.channel = 'Укажите канал'
  else if (mode === 'create' || f.channel !== initialChannel) {
    const err = channelNameError(f.channel)
    if (err) e.channel = err
  }
  if (f.day.trim()) {
    const n = Number(f.day)
    if (!Number.isInteger(n) || n < 1) e.day = 'День — целое число от 1'
    else if (n > 366) e.day = 'Не больше 366'
  }
  const cats = parseCategories(f.categories)
  if (cats.length > 10) e.categories = 'Не больше 10 категорий'
  else if (cats.some((c) => c.length > 40)) e.categories = 'Категория не длиннее 40 символов'
  return e
}

/** Создание своего пункта плана или правка снимка (только пока нет отправок). */
export function PlanItemFormDialog({
  open,
  onOpenChange,
  mode,
  item,
  intensiveId,
  startDate,
  totalDays,
  onSaved,
}: {
  open: boolean
  onOpenChange: (o: boolean) => void
  mode: 'create' | 'edit'
  item?: PlanItemDto
  intensiveId: string
  startDate: string
  totalDays: number
  onSaved: () => void | Promise<void>
}) {
  const [prevOpen, setPrevOpen] = useState(false)
  const [initial, setInitial] = useState<Form>(() => formFrom(item))
  const [form, setForm] = useState<Form>(initial)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      const f = formFrom(item)
      setInitial(f)
      setForm(f)
      setTouched({})
      setServerErrors({})
      setFormError(null)
      setSubmitting(false)
    }
  }

  const errors = useMemo(() => validate(form, mode, initial.channel), [form, mode, initial.channel])
  /** Область задаёт шаблон у OFFICIAL; у своих пунктов (CUSTOM / USER_TEMPLATE) её выбирает Lead_SUP */
  const scopeEditable = mode === 'create' || (!!item && item.sourceType !== 'OFFICIAL')
  const valid = Object.keys(errors).length === 0
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k])
  const errorFor = (k: string) => serverErrors[k] ?? (touched[k] ? errors[k] : undefined)

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTouched((t) => ({ ...t, [k]: true }))
    setServerErrors((s) => {
      const key = k === 'day' ? 'dayNumber' : k
      if (!s[key]) return s
      const rest = { ...s }
      delete rest[key]
      return rest
    })
  }

  const dayNum = form.day.trim() ? Number(form.day) : null
  const dayPreview =
    dayNum && Number.isInteger(dayNum) && dayNum >= 1
      ? dayNum <= totalDays
        ? formatDayHeading(dayDate(startDate, dayNum))
        : null
      : null
  const dayOutside = !!dayNum && Number.isInteger(dayNum) && dayNum > totalDays

  const submit = async () => {
    setTouched({ title: true, body: true, channel: true, day: true, categories: true })
    if (!valid || submitting) return
    setSubmitting(true)
    setFormError(null)
    setServerErrors({})
    try {
      const day = form.day.trim() ? Number(form.day) : null
      if (mode === 'create') {
        await apiFetch(`/api/intensives/${intensiveId}/plan/items`, {
          method: 'POST',
          json: {
            ...(form.title.trim() ? { title: form.title.trim() } : {}),
            body: form.body,
            channel: normalizeChannelName(form.channel),
            dayNumber: day,
            time: form.time || null,
            scope: form.scope === 'ALL' ? null : form.scope,
            categories: parseCategories(form.categories),
          },
        })
        toast.success('Пункт добавлен в план')
      } else if (item) {
        const body: Record<string, unknown> = {}
        if (form.title.trim() !== initial.title.trim()) body.title = form.title.trim()
        if (form.body !== initial.body) body.body = form.body
        if (form.channel !== initial.channel) body.channel = normalizeChannelName(form.channel)
        if (form.day !== initial.day) body.dayNumber = day
        if (form.time !== initial.time) body.time = form.time || null
        if (scopeEditable) {
          if (form.scope !== initial.scope) body.scope = form.scope === 'ALL' ? null : form.scope
        } else if (form.audience !== initial.audience) body.audience = form.audience
        if (form.categories !== initial.categories) body.categories = parseCategories(form.categories)
        await apiFetch(`/api/intensives/${intensiveId}/plan/items/${item.id}`, { method: 'PATCH', json: body })
        toast.success('Пункт обновлён')
      }
      await onSaved()
      onOpenChange(false)
    } catch (e) {
      const fe = fieldErrorsOf(e)
      const keys = Object.keys(fe)
      if (keys.length > 0) {
        setServerErrors(fe)
        setTouched((t) => ({ ...t, ...Object.fromEntries(keys.map((k) => [k, true])) }))
      }
      setFormError(errText(e))
      toast.error('Не удалось сохранить пункт', { description: errText(e) })
      // Пункт мог измениться/получить отправку — синхронизируем план, не трогая форму
      if (e instanceof ApiError && e.status === 409) void onSaved()
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <GuardedDialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty && !submitting}
      busy={submitting}
      title={mode === 'create' ? 'Добавить пункт плана' : 'Редактировать пункт'}
      description={
        mode === 'create'
          ? 'Свой анонс, не привязанный к шаблону. Позже его можно будет запланировать как обычный пункт.'
          : 'Меняется только снимок в плане этого интенсива. Исходный шаблон и созданные сообщения не затрагиваются.'
      }
      footer={
        <>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
            Отмена
          </Button>
          <Button type="submit" form="plan-item-form" disabled={!valid || !dirty || submitting}>
            {submitting && <Loader2 className="animate-spin" aria-hidden />}
            {mode === 'create' ? 'Добавить' : 'Сохранить'}
          </Button>
        </>
      }
    >
      <form
        id="plan-item-form"
        className="space-y-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        {formError && <InlineNotice tone="danger">{formError}</InlineNotice>}
        <Field label="Название" htmlFor="pi-title" required={mode === 'edit'} error={errorFor('title')} hint={mode === 'create' ? 'Если пусто — возьмём начало текста.' : undefined}>
          <Input id="pi-title" value={form.title} maxLength={220} onChange={(e) => set('title', e.target.value)} aria-invalid={!!errorFor('title')} disabled={submitting} />
        </Field>
        <Field label="Текст анонса" htmlFor="pi-body" required error={errorFor('body')} hint={`${form.body.length} / ${MAX_BODY}`}>
          <Textarea id="pi-body" rows={7} value={form.body} onChange={(e) => set('body', e.target.value)} aria-invalid={!!errorFor('body')} disabled={submitting} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Канал" htmlFor="pi-channel" required error={errorFor('channel')} hint="Выберите из списка. Нужного нет — добавьте его здесь же." className="sm:col-span-2">
            <ChannelSelect id="pi-channel" value={form.channel} onChange={(v) => set('channel', v)} invalid={!!errorFor('channel')} disabled={submitting} />
          </Field>
          {scopeEditable ? (
            <Field label="Кто видит пункт" htmlFor="pi-scope" className="sm:col-span-2" error={errorFor('scope')} hint="SUP и ADM видят свои пункты и общие; волонтёры — только общие">
              <Select value={form.scope} onValueChange={(v) => set('scope', v as ScopeChoice)} disabled={submitting}>
                <SelectTrigger id="pi-scope" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {SCOPE_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      {o.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          ) : (
            <Field
              label="Аудитория"
              htmlFor="pi-audience"
              className="sm:col-span-2"
              error={errorFor('audience')}
              hint={item?.scope ? `Область — ${item.scope}: задаётся шаблоном` : 'Кто видит пункт в плане'}
            >
              <Select value={form.audience} onValueChange={(v) => set('audience', v as PlanItemAudience)} disabled={submitting}>
                <SelectTrigger id="pi-audience" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PLAN_ITEM_AUDIENCES.map((a) => (
                    <SelectItem key={a} value={a}>
                      {AUDIENCE_LABELS[a]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
          )}
          <Field label="День интенсива" htmlFor="pi-day" error={errorFor('dayNumber') ?? errorFor('day')} hint={dayPreview ?? `Номер от 1 до ${totalDays}. Пусто — сотрудник выберет сам.`}>
            <Input
              id="pi-day"
              inputMode="numeric"
              value={form.day}
              onChange={(e) => set('day', e.target.value.replace(/[^\d]/g, '').slice(0, 3))}
              aria-invalid={!!(errorFor('dayNumber') ?? errorFor('day'))}
              disabled={submitting}
            />
          </Field>
          <Field label="Время (по поясу интенсива)" htmlFor="pi-time" error={errorFor('time')}>
            <TimePicker id="pi-time" value={form.time} onChange={(v) => set('time', v)} disabled={submitting} invalid={!!errorFor('time')} />
          </Field>
        </div>
        {dayOutside && (
          <InlineNotice tone="warning">День {dayNum} выходит за пределы интенсива ({totalDays} дн.): пункт будет отмечен «Требует настройки».</InlineNotice>
        )}
        <Field label="Категории" htmlFor="pi-cats" error={errorFor('categories')} hint="Через запятую, необязательно">
          <Input id="pi-cats" value={form.categories} onChange={(e) => set('categories', e.target.value)} aria-invalid={!!errorFor('categories')} disabled={submitting} />
        </Field>
      </form>
    </GuardedDialog>
  )
}
