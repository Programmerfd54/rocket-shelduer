'use client'

import { useMemo, useState } from 'react'
import { ArrowLeft, Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { DatePicker } from '@/components/ui/date-picker'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { MAX_INTENSIVE_DAYS, intensiveLengthDays, periodsOverlap } from '@/lib/intensives/dates'
import { ApiError, apiFetch, formatTimezone, formatYmd } from '@/lib/intensives/ui'
import type {
  DateChangeImpact,
  IntensiveDetail,
  IntensiveOverlapRef,
  IntensiveSummary,
  OrgSpaceRef,
  OutOfRangeResolution,
} from '@/lib/intensives/types'
import {
  GuardedDialog,
  InlineNotice,
  MESSAGE_STATUS_LABELS,
  MESSAGE_STATUS_VARIANT,
  RadioRow,
  errText,
  fieldErrorsOf,
  formatInstant,
  overlapText,
  periodLabel,
} from './kit'
import { TimezonePicker } from './TimezonePicker'

type Form = {
  orgSpaceId: string
  /** Пространство (подключение) — OrgSpace создаётся сервером автоматически */
  workspaceId: string
  name: string
  startDate: string
  endDate: string
  timezone: string
  description: string
}

export type IntensiveSavedResult = { intensive: IntensiveSummary; overlaps: IntensiveOverlapRef[]; created: boolean }

/** Пространство (подключение) для выбора при создании: OrgSpace подбирается/создаётся сервером. */
export type WorkspaceTargetRef = { id: string; name: string; orgSpaceId: string | null }

type Target = 'orgSpace' | 'workspace' | 'fixedWorkspace'

function formFrom(
  i: IntensiveSummary | undefined,
  defaultOrgSpaceId: string | undefined,
  orgSpaces: OrgSpaceRef[],
  defaultWorkspaceId: string | undefined,
  workspaces: WorkspaceTargetRef[] | undefined,
): Form {
  if (i) {
    return {
      orgSpaceId: i.orgSpace.id,
      workspaceId: defaultWorkspaceId ?? '',
      name: i.name,
      startDate: i.startDate,
      endDate: i.endDate,
      timezone: i.timezone,
      description: i.description ?? '',
    }
  }
  return {
    orgSpaceId: defaultOrgSpaceId ?? (orgSpaces.length === 1 ? orgSpaces[0].id : ''),
    workspaceId: defaultWorkspaceId ?? (workspaces && workspaces.length === 1 ? workspaces[0].id : ''),
    name: '',
    startDate: '',
    endDate: '',
    timezone: 'Europe/Moscow',
    description: '',
  }
}

function validate(f: Form, mode: 'create' | 'edit', target: Target): Record<string, string> {
  const e: Record<string, string> = {}
  if (mode === 'create' && target === 'orgSpace' && !f.orgSpaceId) e.orgSpaceId = 'Выберите пространство'
  if (mode === 'create' && target !== 'orgSpace' && !f.workspaceId) e.workspaceId = 'Выберите пространство'
  const name = f.name.trim()
  if (!name) e.name = 'Укажите название'
  else if (name.length > 200) e.name = 'Не длиннее 200 символов'
  if (!f.startDate) e.startDate = 'Укажите дату начала'
  if (!f.endDate) e.endDate = 'Укажите дату окончания'
  if (f.startDate && f.endDate) {
    if (f.endDate < f.startDate) e.endDate = 'Дата окончания раньше даты начала'
    else if (intensiveLengthDays(f.startDate, f.endDate) > MAX_INTENSIVE_DAYS) e.endDate = `Интенсив не длиннее ${MAX_INTENSIVE_DAYS} дней`
  }
  if (!f.timezone) e.timezone = 'Выберите часовой пояс'
  if (f.description.length > 5000) e.description = 'Не длиннее 5000 символов'
  return e
}

type ImpactState = { impact: DateChangeImpact; code: 'IMPACT_CONFIRMATION_REQUIRED' | 'OUT_OF_RANGE_DECISION_REQUIRED' }

export function IntensiveFormDialog({
  open,
  onOpenChange,
  mode,
  intensive,
  orgSpaces = [],
  defaultOrgSpaceId,
  workspaceId: fixedWorkspaceId,
  workspaces,
  siblings = [],
  onSaved,
  onStale,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  mode: 'create' | 'edit'
  intensive?: IntensiveSummary
  /** Старый способ: выбор организационного пространства */
  orgSpaces?: OrgSpaceRef[]
  /** Для фиксированного пространства (workspaceId) — его OrgSpace, если уже есть (для мгновенной проверки пересечений) */
  defaultOrgSpaceId?: string
  /** Интенсив создаётся в этом пространстве (подключении); поле выбора скрыто */
  workspaceId?: string
  /** Выбор пространства (подключения) вместо организационного пространства */
  workspaces?: WorkspaceTargetRef[]
  /** Уже известные интенсивы (для мгновенного предупреждения о пересечении; сервер проверяет окончательно) */
  siblings?: IntensiveSummary[]
  onSaved: (res: IntensiveSavedResult) => void
  /** Версия на сервере изменилась — родитель может обновить свои данные */
  onStale?: (latest: IntensiveDetail) => void
}) {
  const target: Target = fixedWorkspaceId ? 'fixedWorkspace' : workspaces ? 'workspace' : 'orgSpace'
  const [prevOpen, setPrevOpen] = useState(false)
  const [initial, setInitial] = useState<Form>(() => formFrom(intensive, defaultOrgSpaceId, orgSpaces, fixedWorkspaceId, workspaces))
  const [form, setForm] = useState<Form>(initial)
  const [baseVersion, setBaseVersion] = useState(intensive?.version ?? 0)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [serverErrors, setServerErrors] = useState<Record<string, string>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [conflicts, setConflicts] = useState<IntensiveOverlapRef[] | null>(null)
  const [stale, setStale] = useState<{ latest: IntensiveDetail | null; loading: boolean; failed: boolean } | null>(null)
  const [impactState, setImpactState] = useState<ImpactState | null>(null)
  const [ack, setAck] = useState(false)
  const [resolution, setResolution] = useState<OutOfRangeResolution | ''>('')
  const [submitting, setSubmitting] = useState(false)

  if (open !== prevOpen) {
    setPrevOpen(open)
    if (open) {
      const f = formFrom(intensive, defaultOrgSpaceId, orgSpaces, fixedWorkspaceId, workspaces)
      setInitial(f)
      setForm(f)
      setBaseVersion(intensive?.version ?? 0)
      setTouched({})
      setServerErrors({})
      setFormError(null)
      setConflicts(null)
      setStale(null)
      setImpactState(null)
      setAck(false)
      setResolution('')
      setSubmitting(false)
    }
  }

  const readOnly = mode === 'edit' && (intensive?.status === 'CANCELLED' || intensive?.status === 'ARCHIVED')
  const clientErrors = useMemo(() => validate(form, mode, target), [form, mode, target])
  const valid = Object.keys(clientErrors).length === 0
  const dirty = (Object.keys(form) as (keyof Form)[]).some((k) => form[k] !== initial[k])

  const errorFor = (k: keyof Form): string | undefined => {
    if (serverErrors[k]) return serverErrors[k]
    return touched[k] ? clientErrors[k] : undefined
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setForm((f) => ({ ...f, [k]: v }))
    setTouched((t) => ({ ...t, [k]: true }))
    setServerErrors((s) => {
      if (!s[k]) return s
      const rest = { ...s }
      delete rest[k]
      return rest
    })
    setConflicts(null)
  }

  const liveOverlaps = useMemo(() => {
    if (!form.startDate || !form.endDate || form.endDate < form.startDate) return []
    const spaceId =
      mode === 'edit'
        ? intensive?.orgSpace.id
        : target === 'orgSpace'
          ? form.orgSpaceId
          : target === 'workspace'
            ? workspaces?.find((w) => w.id === form.workspaceId)?.orgSpaceId
            : defaultOrgSpaceId
    if (!spaceId) return []
    return siblings.filter(
      (s) =>
        s.id !== intensive?.id &&
        s.orgSpace.id === spaceId &&
        (s.status === 'DRAFT' || s.status === 'PUBLISHED') &&
        periodsOverlap(form.startDate, form.endDate, s.startDate, s.endDate),
    )
  }, [form.startDate, form.endDate, form.orgSpaceId, form.workspaceId, siblings, mode, intensive, target, workspaces, defaultOrgSpaceId])

  const pendingOutside = impactState?.impact.messagesOutsideNewRange.filter((m) => m.status === 'PENDING') ?? []
  const impactReady = !!impactState && ack && (pendingOutside.length === 0 || resolution !== '')

  const buildBody = (extra: { confirmImpact?: boolean; outOfRangeResolution?: OutOfRangeResolution }) => {
    const body: Record<string, unknown> = { version: baseVersion }
    if (form.name.trim() !== initial.name.trim()) body.name = form.name.trim()
    if (form.description.trim() !== initial.description.trim()) body.description = form.description.trim() || null
    if (!readOnly) {
      if (form.startDate !== initial.startDate) body.startDate = form.startDate
      if (form.endDate !== initial.endDate) body.endDate = form.endDate
      if (form.timezone !== initial.timezone) body.timezone = form.timezone
    }
    return { ...body, ...extra }
  }

  const finish = (res: IntensiveSavedResult) => {
    if (res.created) {
      toast.success('Черновик создан', { description: 'Отправки не запускались. Соберите план и опубликуйте интенсив.' })
    } else {
      toast.success('Изменения сохранены')
    }
    if (res.overlaps.length > 0) {
      toast.warning('Период пересекается с другим интенсивом', {
        description: `${res.overlaps.map(overlapText).join('; ')}. Опубликовать нельзя, пока пересечение не устранено.`,
      })
    }
    onSaved(res)
    onOpenChange(false)
  }

  const handleError = (e: unknown) => {
    const fe = fieldErrorsOf(e)
    if (e instanceof ApiError) {
      if (e.code === 'IMPACT_CONFIRMATION_REQUIRED' || e.code === 'OUT_OF_RANGE_DECISION_REQUIRED') {
        const impact = e.body.impact as DateChangeImpact | undefined
        if (impact) {
          setImpactState({ impact, code: e.code })
          return
        }
      }
      if (e.code === 'VERSION_CONFLICT') {
        setStale({ latest: null, loading: false, failed: false })
        setImpactState(null)
        toast.error('Интенсив изменён другим пользователем', { description: 'Ваш текст сохранён в форме. Загрузите актуальную версию.' })
        return
      }
      if (e.code === 'INTENSIVE_OVERLAP') {
        const list = Array.isArray(e.body.conflicts) ? (e.body.conflicts as IntensiveOverlapRef[]) : []
        setConflicts(list)
        setImpactState(null)
        toast.error('Период пересекается с опубликованным интенсивом', { description: e.message })
        return
      }
    }
    setImpactState(null)
    if (Object.keys(fe).length > 0) {
      setServerErrors(fe)
      setTouched((t) => ({ ...t, ...Object.fromEntries(Object.keys(fe).map((k) => [k, true])) }))
      setFormError(e instanceof ApiError ? e.message : null)
    } else {
      setFormError(errText(e))
    }
    toast.error('Не удалось сохранить', { description: errText(e) })
  }

  const submit = async (extra: { confirmImpact?: boolean; outOfRangeResolution?: OutOfRangeResolution } = {}) => {
    setTouched({ orgSpaceId: true, workspaceId: true, name: true, startDate: true, endDate: true, timezone: true, description: true })
    if (!valid || submitting) return
    setSubmitting(true)
    setFormError(null)
    setServerErrors({})
    setConflicts(null)
    try {
      if (mode === 'create') {
        const res = await apiFetch<{ intensive: IntensiveSummary; warnings?: { overlaps?: IntensiveOverlapRef[] } }>('/api/intensives', {
          method: 'POST',
          json: {
            ...(target === 'orgSpace' ? { orgSpaceId: form.orgSpaceId } : { workspaceId: form.workspaceId }),
            name: form.name.trim(),
            startDate: form.startDate,
            endDate: form.endDate,
            timezone: form.timezone,
            ...(form.description.trim() ? { description: form.description.trim() } : {}),
          },
        })
        finish({ intensive: res.intensive, overlaps: res.warnings?.overlaps ?? res.intensive.overlaps ?? [], created: true })
      } else if (intensive) {
        const res = await apiFetch<{ intensive: IntensiveDetail }>(`/api/intensives/${intensive.id}`, {
          method: 'PATCH',
          json: buildBody(extra),
        })
        finish({ intensive: res.intensive, overlaps: res.intensive.overlaps ?? [], created: false })
      }
    } catch (e) {
      handleError(e)
    } finally {
      setSubmitting(false)
    }
  }

  const loadLatest = async () => {
    if (!intensive) return
    setStale((s) => ({ latest: s?.latest ?? null, loading: true, failed: false }))
    try {
      const res = await apiFetch<{ intensive: IntensiveDetail }>(`/api/intensives/${intensive.id}`)
      setBaseVersion(res.intensive.version)
      setInitial((i) => ({
        ...i,
        // «Исходные» значения теперь серверные — изменения пользователя считаются относительно них
        name: res.intensive.name,
        description: res.intensive.description ?? '',
        startDate: res.intensive.startDate,
        endDate: res.intensive.endDate,
        timezone: res.intensive.timezone,
      }))
      setStale({ latest: res.intensive, loading: false, failed: false })
      onStale?.(res.intensive)
      toast.info('Загружена актуальная версия', { description: 'Проверьте поля и сохраните ещё раз.' })
    } catch (e) {
      setStale({ latest: null, loading: false, failed: true })
      toast.error('Не удалось загрузить актуальную версию', { description: errText(e) })
    }
  }

  const title = impactState ? 'Подтвердите изменение дат' : mode === 'create' ? 'Создать интенсив' : 'Редактировать интенсив'

  /* ───────────── Шаг: влияние на связанные сообщения ───────────── */
  const impactBody = impactState && (
    <div className="space-y-4 text-sm">
      <InlineNotice tone="warning">
        У интенсива есть связанные сообщения ({impactState.impact.linkedMessageCount}). Время уже созданных сообщений
        автоматически не меняется, отправленные сообщения не затрагиваются.
      </InlineNotice>

      {impactState.impact.affectedItems.length > 0 && (
        <section aria-label="Пункты без отправок">
          <h3 className="mb-1 text-[13px] font-semibold">
            Рекомендуемая дата изменится у пунктов без отправок ({impactState.impact.affectedItems.length})
          </h3>
          <ul className="divide-y rounded-md border">
            {impactState.impact.affectedItems.slice(0, 10).map((it) => (
              <li key={it.planItemId} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                <span className="min-w-0 truncate">{it.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">
                  {it.dayNumber ? `День ${it.dayNumber}: ` : ''}
                  {it.fromDate ? formatYmd(it.fromDate, false) : '—'} → {it.toDate ? formatYmd(it.toDate, false) : 'вне периода'}
                </span>
              </li>
            ))}
          </ul>
          {impactState.impact.affectedItems.length > 10 && (
            <p className="mt-1 text-xs text-muted-foreground">и ещё {impactState.impact.affectedItems.length - 10}</p>
          )}
        </section>
      )}

      {impactState.impact.itemsWithSends.length > 0 && (
        <section aria-label="Пункты с отправками">
          <h3 className="mb-1 text-[13px] font-semibold">
            Пункты с отправками ({impactState.impact.itemsWithSends.length}) — сообщения не меняются
          </h3>
          <ul className="divide-y rounded-md border">
            {impactState.impact.itemsWithSends.slice(0, 10).map((it) => (
              <li key={it.planItemId} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                <span className="min-w-0 truncate">{it.title}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">отправок: {it.sendCount}</span>
              </li>
            ))}
          </ul>
          {impactState.impact.itemsWithSends.length > 10 && (
            <p className="mt-1 text-xs text-muted-foreground">и ещё {impactState.impact.itemsWithSends.length - 10}</p>
          )}
        </section>
      )}

      {impactState.impact.messagesOutsideNewRange.length > 0 && (
        <section aria-label="Сообщения вне нового периода">
          <h3 className="mb-1 text-[13px] font-semibold">
            Сообщения окажутся вне нового периода ({impactState.impact.messagesOutsideNewRange.length})
          </h3>
          <ul className="divide-y rounded-md border">
            {impactState.impact.messagesOutsideNewRange.slice(0, 10).map((m) => (
              <li key={m.messageId} className="flex items-center justify-between gap-3 px-3 py-1.5 text-[13px]">
                <span className="tabular-nums">{formatInstant(m.scheduledFor, form.timezone, true)}</span>
                <Badge variant={MESSAGE_STATUS_VARIANT[m.status]}>{MESSAGE_STATUS_LABELS[m.status]}</Badge>
              </li>
            ))}
          </ul>
          {impactState.impact.messagesOutsideNewRange.length > 10 && (
            <p className="mt-1 text-xs text-muted-foreground">и ещё {impactState.impact.messagesOutsideNewRange.length - 10}</p>
          )}
        </section>
      )}

      {pendingOutside.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="mb-1 text-[13px] font-semibold">
            Что сделать с запланированными сообщениями вне периода ({pendingOutside.length})?
          </legend>
          <RadioRow
            name="out-of-range"
            value="keep_linked"
            checked={resolution === 'keep_linked'}
            onChange={() => setResolution('keep_linked')}
            title="Оставить как есть"
            description="Сообщения останутся запланированными и связанными с интенсивом."
          />
          <RadioRow
            name="out-of-range"
            value="detach"
            checked={resolution === 'detach'}
            onChange={() => setResolution('detach')}
            title="Снять привязку к интенсиву"
            description="Сообщения останутся запланированными, но уйдут из плана интенсива."
          />
          <RadioRow
            name="out-of-range"
            value="cancel"
            checked={resolution === 'cancel'}
            onChange={() => setResolution('cancel')}
            title="Отменить сообщения"
            description="Сообщение, которое уже взято в отправку, может всё равно уйти."
          />
        </fieldset>
      )}

      <div className="flex items-start gap-2">
        <Checkbox id="impact-ack" checked={ack} onCheckedChange={(c) => setAck(c === true)} className="mt-0.5" />
        <Label htmlFor="impact-ack" className="text-[13px] font-normal leading-snug">
          Понимаю: время существующих сообщений не изменится автоматически, будут пересчитаны только рекомендуемые даты пунктов
        </Label>
      </div>
    </div>
  )

  /* ───────────── Основная форма ───────────── */
  const formBody = (
    <form
      id="intensive-form"
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault()
        void submit()
      }}
      noValidate
    >
      {stale && (
        <InlineNotice tone="warning">
          <p className="font-medium">Интенсив изменён другим пользователем. Обновите страницу.</p>
          <p className="text-muted-foreground">
            Ваш текст сохранён в форме. Можно загрузить актуальную версию с сервера — введённые поля не будут стёрты — и сохранить ещё раз.
          </p>
          {stale.latest && (
            <p className="mt-1 text-xs">
              На сервере сейчас: «{stale.latest.name}», {periodLabel(stale.latest.startDate, stale.latest.endDate)},{' '}
              {formatTimezone(stale.latest.timezone)}.
            </p>
          )}
          {stale.failed && <p className="mt-1 text-xs text-destructive">Не удалось загрузить — повторите.</p>}
          {!stale.latest && (
            <Button type="button" variant="outline" size="sm" className="mt-2" onClick={() => void loadLatest()} disabled={stale.loading}>
              {stale.loading ? <Loader2 className="animate-spin" aria-hidden /> : <RefreshCw aria-hidden />}
              Загрузить актуальную версию
            </Button>
          )}
        </InlineNotice>
      )}
      {formError && !stale && (
        <InlineNotice tone="danger">{formError}</InlineNotice>
      )}
      {conflicts && (
        <InlineNotice tone="danger">
          <p className="font-medium">Период пересекается с опубликованным интенсивом этого пространства.</p>
          {conflicts.length > 0 ? (
            <ul className="mt-1 list-disc pl-4 text-muted-foreground">
              {conflicts.map((c) => (
                <li key={c.id}>{overlapText(c)}</li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">Идёт одновременная публикация другого интенсива. Повторите попытку.</p>
          )}
        </InlineNotice>
      )}

      {target === 'orgSpace' && (
        <Field label="Пространство" htmlFor="intensive-orgspace" required={mode === 'create'} error={errorFor('orgSpaceId')} hint={mode === 'edit' ? 'Пространство интенсива не меняется.' : undefined}>
          <Select value={form.orgSpaceId} onValueChange={(v) => set('orgSpaceId', v)} disabled={mode === 'edit' || submitting}>
            <SelectTrigger id="intensive-orgspace" className="w-full" aria-invalid={!!errorFor('orgSpaceId')}>
              <SelectValue placeholder="Выберите пространство" />
            </SelectTrigger>
            <SelectContent>
              {(mode === 'edit' && intensive ? [intensive.orgSpace] : orgSpaces).map((o) => (
                <SelectItem key={o.id} value={o.id}>
                  {o.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {target === 'workspace' && mode === 'create' && (
        <Field
          label="Пространство"
          htmlFor="intensive-workspace"
          required
          error={errorFor('workspaceId')}
          hint="Интенсив попадёт в график этого пространства."
        >
          <Select value={form.workspaceId} onValueChange={(v) => set('workspaceId', v)} disabled={submitting}>
            <SelectTrigger id="intensive-workspace" className="w-full" aria-invalid={!!errorFor('workspaceId')}>
              <SelectValue placeholder="Выберите пространство" />
            </SelectTrigger>
            <SelectContent>
              {(workspaces ?? []).map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      )}
      {target === 'fixedWorkspace' && errorFor('workspaceId') && <InlineNotice tone="danger">{errorFor('workspaceId')}</InlineNotice>}

      <Field label="Название" htmlFor="intensive-name" required error={errorFor('name')}>
        <Input
          id="intensive-name"
          value={form.name}
          maxLength={220}
          autoComplete="off"
          placeholder="Например, Октябрьский интенсив"
          aria-invalid={!!errorFor('name')}
          aria-describedby={errorFor('name') ? 'intensive-name-error' : undefined}
          onChange={(e) => set('name', e.target.value)}
          disabled={submitting}
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Дата начала" htmlFor="intensive-start" required error={errorFor('startDate')}>
          <DatePicker
            id="intensive-start"
            value={form.startDate}
            onChange={(v) => set('startDate', v)}
            shortcuts={false}
            disabled={readOnly || submitting}
            invalid={!!errorFor('startDate')}
            aria-describedby={errorFor('startDate') ? 'intensive-start-error' : undefined}
          />
        </Field>
        <Field label="Дата окончания" htmlFor="intensive-end" required error={errorFor('endDate')} hint="Окончание включается в период.">
          <DatePicker
            id="intensive-end"
            value={form.endDate}
            min={form.startDate || undefined}
            onChange={(v) => set('endDate', v)}
            shortcuts={false}
            disabled={readOnly || submitting}
            invalid={!!errorFor('endDate')}
            aria-describedby={errorFor('endDate') ? 'intensive-end-error' : 'intensive-end-hint'}
          />
        </Field>
      </div>
      {form.startDate && form.endDate && form.endDate >= form.startDate && !clientErrors.endDate && (
        <p className="-mt-2 text-xs text-muted-foreground">
          {periodLabel(form.startDate, form.endDate)} · {intensiveLengthDays(form.startDate, form.endDate)} дн. Период может пересекать границу года.
        </p>
      )}

      {liveOverlaps.length > 0 && (
        <InlineNotice tone="warning">
          Период пересекается: {liveOverlaps.map(overlapText).join('; ')}. Черновик сохранить можно, но опубликовать — нельзя, пока пересечение не
          устранено.
        </InlineNotice>
      )}

      <Field
        label="Часовой пояс"
        htmlFor="intensive-tz"
        required
        error={errorFor('timezone')}
        hint="В этом поясе считаются дни интенсива и время анонсов."
      >
        <TimezonePicker
          id="intensive-tz"
          value={form.timezone}
          onChange={(v) => set('timezone', v)}
          disabled={readOnly || submitting}
          invalid={!!errorFor('timezone')}
        />
      </Field>
      {readOnly && <p className="-mt-2 text-xs text-muted-foreground">Даты и пояс отменённого или архивного интенсива не меняются.</p>}

      <Field label="Описание" htmlFor="intensive-desc" error={errorFor('description')} hint={`${form.description.length} / 5000`}>
        <Textarea
          id="intensive-desc"
          value={form.description}
          rows={3}
          onChange={(e) => set('description', e.target.value)}
          aria-invalid={!!errorFor('description')}
          disabled={submitting}
          placeholder="Необязательно"
        />
      </Field>

      {mode === 'create' && (
        <p className="text-xs text-muted-foreground">
          Интенсив создаётся как черновик и ничего не отправляет. План анонсов собирается после создания, затем интенсив публикуется.
        </p>
      )}
    </form>
  )

  const footer = impactState ? (
    <>
      <Button type="button" variant="outline" onClick={() => setImpactState(null)} disabled={submitting}>
        <ArrowLeft aria-hidden />
        Назад к форме
      </Button>
      <Button
        type="button"
        disabled={!impactReady || submitting}
        onClick={() => void submit({ confirmImpact: true, ...(resolution ? { outOfRangeResolution: resolution } : {}) })}
      >
        {submitting && <Loader2 className="animate-spin" aria-hidden />}
        Подтвердить и сохранить
      </Button>
    </>
  ) : (
    <>
      <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
        Отмена
      </Button>
      <Button type="submit" form="intensive-form" disabled={!valid || !dirty || submitting}>
        {submitting && <Loader2 className="animate-spin" aria-hidden />}
        {mode === 'create' ? 'Создать черновик' : 'Сохранить'}
      </Button>
    </>
  )

  return (
    <GuardedDialog
      open={open}
      onOpenChange={onOpenChange}
      dirty={dirty && !submitting}
      busy={submitting}
      title={title}
      footer={footer}
    >
      {impactState ? impactBody : formBody}
    </GuardedDialog>
  )
}
