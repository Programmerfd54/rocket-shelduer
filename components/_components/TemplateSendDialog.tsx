"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { toast } from "sonner"
import { Copy, Eye, Repeat, TriangleAlert } from "lucide-react"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DatePicker } from "@/components/ui/date-picker"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
import { Label } from "@/components/ui/label"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { SendSummary } from "@/components/common/SendSummary"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Spinner } from "@/components/ui/spinner"
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { TimePicker } from "@/components/ui/time-picker"
import { formatInstantInTz, planScheduleLine } from "@/components/intensives/shared/format"
import { copyToClipboard } from "@/lib/clipboard"
import {
  dayNumberOfDate,
  localHmOfInstant,
  todayInTimeZone,
  zonedDateTimeToUtc,
  type ZonedToUtcResult,
} from "@/lib/intensives/dates"
import type { IntensiveSummary, PlanItemDto } from "@/lib/intensives/types"
import { formatDayHeading, formatRange, formatTimezone } from "@/lib/intensives/ui"
import { cn } from "@/lib/utils"
import {
  buildScheduledDate,
  findChannelByTemplateName,
  formatScheduleShort,
  getBrowserTimeZone,
  getTimeZoneLabel,
  intensiveDayOfDate,
  isScheduleInPast,
  parseTime,
  pickInitialSchedule,
  toYmd,
} from "@/lib/schedule-datetime"
import { describeSaveError } from "./message-dialog-helpers"
import MessageEditor from "./message-editor"
import MessagePreview from "./message-preview"

/** Шаблон, из которого отправляем: общий (официальный) или пользовательский */
export interface TemplateSendTarget {
  id: string
  kind: "official" | "mine"
  title: string
  channel: string
  /** 'HH:mm' */
  time: string
  body: string
  intensiveDay?: number | null
}

/** Планирование из пункта плана интенсива (снимок шаблона + рекомендуемые дата/время в поясе интенсива) */
export interface PlanSendTarget {
  intensive: IntensiveSummary
  item: PlanItemDto
  /** «Запланировать повтор» после успешной отправки (isPlanRepeat) */
  repeat: boolean
}

export interface TemplateSendChannel {
  id: string
  name: string
  displayName?: string
}

export interface TemplateSendWorkspace {
  id: string
  workspaceUrl?: string | null
  workspaceName?: string | null
  username?: string | null
  /** ISO-строка из API (WorkspaceConnection.startDate) */
  startDate?: string | null
}

interface TemplateSendDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  template: TemplateSendTarget | null
  /** Пункт плана интенсива — вместо template */
  plan?: PlanSendTarget | null
  workspace: TemplateSendWorkspace
  channels: TemplateSendChannel[]
  /** Вызывается после успешного создания сообщения — обновить список сообщений на странице */
  onScheduled: () => void | Promise<void>
  /** Открыть настройки пространства (чтобы указать дату начала интенсива) */
  onOpenWorkspaceSettings?: () => void
  /** 409 «уже запланировано»: открыть существующее сообщение (форма остаётся открытой, текст не теряется) */
  onOpenExistingMessage?: (messageId: string) => void
  /** Состояние пункта на сервере изменилось (конфликт, пропуск) — перезагрузить план */
  onPlanChanged?: () => void
}

const MAX_LEN = 5000
/** Минимальный запас до отправки */
const MIN_LEAD_MS = 60_000

/** Ключ идемпотентности: один на открытие формы; при повторе после сетевого сбоя — тот же */
function newClientRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") return crypto.randomUUID()
  } catch {
    /* ignore */
  }
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`
}

/** Локальные дата+время в поясе интенсива → UTC; неоднозначность (перевод часов) не разрешается автоматически */
function safeZoned(date: string, time: string, tz: string): ZonedToUtcResult | null {
  try {
    return zonedDateTimeToUtc(date, time, tz)
  } catch {
    return null
  }
}

function planToTarget(item: PlanItemDto): TemplateSendTarget {
  return {
    id: item.id,
    kind: "official",
    title: item.title,
    channel: item.channel,
    time: item.time ?? "",
    body: item.body,
    intensiveDay: item.dayNumber,
  }
}

/** key по шаблону/пункту и пространству: данные разных шаблонов/пространств не смешиваются */
export default function TemplateSendDialog(props: TemplateSendDialogProps) {
  const key = props.plan
    ? `plan:${props.plan.intensive.id}:${props.plan.item.id}:${props.plan.repeat ? "repeat" : "main"}`
    : (props.template?.id ?? "none")
  return <TemplateSendDialogInner key={`${props.workspace.id}:${key}`} {...props} />
}

type ConflictState = { existingMessageId: string | null }

function TemplateSendDialogInner({
  open,
  onOpenChange,
  template: templateProp,
  plan,
  workspace,
  channels: channelsProp,
  onScheduled,
  onOpenWorkspaceSettings,
  onOpenExistingMessage,
  onPlanChanged,
}: TemplateSendDialogProps) {
  const router = useRouter()
  const planItem = plan?.item ?? null
  const template = useMemo(() => (planItem ? planToTarget(planItem) : templateProp), [planItem, templateProp])
  const intensive = plan?.intensive ?? null
  const tz = intensive?.timezone ?? ""

  const [channels, setChannels] = useState<TemplateSendChannel[]>(channelsProp)
  const [channelId, setChannelId] = useState("")
  const [channelTouched, setChannelTouched] = useState(false)
  const [message, setMessage] = useState("")
  const [date, setDate] = useState("")
  const [time, setTime] = useState("")
  const [autoDate, setAutoDate] = useState(false)
  const [emojis, setEmojis] = useState<any[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [now, setNow] = useState(() => new Date())
  const [mobileView, setMobileView] = useState<"edit" | "preview">("edit")
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [serverTimeError, setServerTimeError] = useState("")
  const [serverDateError, setServerDateError] = useState("")
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  /** Явный выбор при неоднозначном локальном времени (перевод часов назад) */
  const [dstChoice, setDstChoice] = useState<"earlier" | "later" | null>(null)
  /** 409 PLAN_ITEM_ALREADY_SCHEDULED: форма не очищается, предлагаем открыть существующее */
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  /** Что сделать после подтверждённого закрытия (например, открыть настройки пространства) */
  const afterCloseRef = useRef<(() => void) | null>(null)
  const submitLockRef = useRef(false)
  const clientRequestIdRef = useRef("")
  /** Дата/время на момент открытия — чтобы понять, менял ли пользователь форму */
  const [baseline, setBaseline] = useState({ date: "", time: "" })

  const hasStartDate = !!workspace.startDate
  const templateId = template?.id

  // Каналы: берём со страницы, а если их нет — подгружаем сами
  useEffect(() => {
    setChannels(channelsProp)
  }, [channelsProp])

  useEffect(() => {
    if (!open || channelsProp.length > 0) return
    let cancelled = false
    fetch(`/api/workspace/${workspace.id}/channels`)
      .then((r) => (r.ok ? r.json() : { channels: [] }))
      .then((d) => {
        if (!cancelled) setChannels(d.channels || [])
      })
      .catch(() => {
        if (!cancelled) setChannels([])
      })
    return () => {
      cancelled = true
    }
  }, [open, channelsProp.length, workspace.id])

  // Кастомные эмодзи пространства — для редактора и предпросмотра (не критично, с таймаутом)
  useEffect(() => {
    if (!open) return
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 3000)
    fetch(`/api/workspace/${workspace.id}/emojis`, { signal: ctrl.signal })
      .then((r) => (r.ok ? r.json() : { emojis: [] }))
      .then((d) => setEmojis(d.emojis || []))
      .catch(() => setEmojis([]))
      .finally(() => clearTimeout(timer))
    return () => {
      clearTimeout(timer)
      ctrl.abort()
    }
  }, [open, workspace.id])

  // Начальные значения при открытии / смене шаблона
  useEffect(() => {
    if (!open || !template) return
    let initial: { date: string; time: string; auto: boolean }
    if (planItem) {
      // Пункт плана: рекомендуемые дата/время в поясе интенсива. Прошедшее время НЕ переносится на сегодня.
      const rec = planItem.recommended
      initial = { date: rec.date ?? "", time: rec.time ?? planItem.time ?? "", auto: !!rec.date }
    } else {
      initial = pickInitialSchedule({
        startDate: workspace.startDate,
        intensiveDay: template.intensiveDay,
        templateTime: template.time,
      })
    }
    setDate(initial.date)
    setTime(initial.time)
    setBaseline({ date: initial.date, time: initial.time })
    setSubmitError(null)
    setServerTimeError("")
    setServerDateError("")
    setDstChoice(null)
    setConflict(null)
    setMobileView("edit")
    setAutoDate(initial.auto)
    setMessage(template.body)
    setChannelTouched(false)
    setChannelId("")
    setSubmitting(false)
    setNow(new Date())
    clientRequestIdRef.current = newClientRequestId()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, templateId, workspace.startDate])

  // Предвыбор канала по имени из шаблона (после загрузки каналов)
  const matchedChannel = useMemo(
    () => (template ? findChannelByTemplateName(channels, template.channel) : null),
    [channels, template],
  )
  useEffect(() => {
    if (!open || channelTouched) return
    setChannelId(matchedChannel?.id ?? "")
  }, [open, matchedChannel, channelTouched, templateId])

  // Пока диалог открыт — обновляем «сейчас», чтобы ошибка «время уже прошло» не устаревала
  useEffect(() => {
    if (!open) return
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [open])

  const todayYmd = intensive ? todayInTimeZone(tz, now) : toYmd(now)
  const selectedChannel = channels.find((c) => c.id === channelId) ?? null
  const channelMissingInWorkspace = !!template && channels.length > 0 && !matchedChannel
  const templateChannelLabel = (template?.channel ?? "").replace(/^#/, "").trim()

  const parsedTime = parseTime(time)
  const scheduleIncomplete = !date || !parsedTime

  /* ── Режим пункта плана: дата/время — в поясе интенсива ── */
  const zoned = intensive && date && parsedTime ? safeZoned(date, parsedTime, tz) : null
  const nonexistent = zoned?.kind === "nonexistent" ? zoned : null
  const ambiguous = zoned?.kind === "ambiguous" ? zoned : null
  const planScheduledAt =
    zoned?.kind === "ok"
      ? zoned.utc
      : ambiguous && dstChoice
        ? dstChoice === "earlier"
          ? ambiguous.earlierUtc
          : ambiguous.laterUtc
        : null
  const outOfPeriod = !!intensive && !!date && (date < intensive.startDate || date > intensive.endDate)
  const pristineSchedule = date === baseline.date && time === baseline.time
  const recommendedPast = !!planItem?.recommended.isPast && pristineSchedule

  const inPast = intensive
    ? !!planScheduledAt && planScheduledAt.getTime() <= now.getTime() + MIN_LEAD_MS
    : !scheduleIncomplete && isScheduleInPast(date, time, now, MIN_LEAD_MS)
  const pastOnDate = inPast && date < todayYmd
  const dateError = !date
    ? "Выберите дату"
    : outOfPeriod && intensive
      ? `Дата вне периода интенсива (${formatRange(intensive.startDate, intensive.endDate)})`
      : serverDateError
        ? serverDateError
        : pastOnDate
          ? recommendedPast
            ? "Рекомендуемое время уже прошло, выберите новое"
            : "Время уже прошло"
          : ""
  const timeError = !parsedTime
    ? "Укажите время"
    : nonexistent
      ? "Такого времени в этот день нет (перевод часов). Выберите другое время."
      : inPast && !pastOnDate
        ? recommendedPast
          ? "Рекомендуемое время уже прошло, выберите новое"
          : "Время уже прошло"
        : serverTimeError
  const messageEmpty = !message.trim()
  const tooLong = message.length > MAX_LEN
  const channelError = !channelId ? "Выберите канал" : ""
  const planScheduleReady = !intensive || (!!planScheduledAt && !outOfPeriod)

  const dayHint = useMemo(() => {
    if (intensive) {
      if (!date) return null
      const n = dayNumberOfDate(intensive.startDate, intensive.endDate, date)
      return n != null ? `День ${n} · ${formatDayHeading(date)}` : null
    }
    if (!hasStartDate) return null
    const n = intensiveDayOfDate(workspace.startDate, date)
    return n != null ? `День ${n} интенсива` : null
  }, [intensive, hasStartDate, workspace.startDate, date])

  /** Как это время выглядит в поясе браузера (если он отличается от пояса интенсива) */
  const browserTz = getBrowserTimeZone()
  const localEquivalent =
    intensive && planScheduledAt && browserTz && browserTz !== tz
      ? `У вас: ${formatInstantInTz(planScheduledAt, browserTz)} (${getTimeZoneLabel(planScheduledAt, browserTz).label})`
      : null

  const textEdited = !!planItem && message !== planItem.body

  const isDirty =
    !!template &&
    (message !== template.body || channelTouched || date !== baseline.date || time !== baseline.time || dstChoice != null)

  const requestClose = (after?: () => void) => {
    if (submitting) return
    if (isDirty) {
      afterCloseRef.current = after ?? null
      setConfirmCloseOpen(true)
      return
    }
    onOpenChange(false)
    after?.()
  }
  const canSubmit =
    !submitting &&
    !!template &&
    !channelError &&
    !messageEmpty &&
    !tooLong &&
    !scheduleIncomplete &&
    !inPast &&
    planScheduleReady

  const clearScheduleErrors = () => {
    setServerTimeError("")
    setServerDateError("")
    setSubmitError(null)
    setDstChoice(null)
  }

  /** Ошибки API интенсивов (code) → у поля / у формы. Возвращает текст ошибки или null (не ошибка интенсивов). */
  const handlePlanError = (data: { error?: unknown; code?: unknown; fieldErrors?: unknown; existingMessageId?: unknown } | null): string | null => {
    const code = typeof data?.code === "string" ? data.code : ""
    const text = typeof data?.error === "string" && data.error ? data.error : null
    const fieldErrors = (data?.fieldErrors && typeof data.fieldErrors === "object" ? data.fieldErrors : {}) as Record<string, string>
    switch (code) {
      case "PLAN_ITEM_ALREADY_SCHEDULED": {
        const existing = typeof data?.existingMessageId === "string" ? data.existingMessageId : null
        setConflict({ existingMessageId: existing })
        onPlanChanged?.()
        return "Это сообщение уже запланировано"
      }
      case "OUT_OF_INTENSIVE_PERIOD": {
        const msg = fieldErrors.scheduledFor || text || "Дата вне периода интенсива"
        setServerDateError(msg)
        setMobileView("edit")
        return msg
      }
      case "PLAN_ITEM_SKIPPED":
      case "REPEAT_REQUIRES_SENT":
      case "PLAN_ITEM_NOT_FOUND":
      case "PLAN_ITEM_NOT_VISIBLE":
        onPlanChanged?.()
        return text ?? "Пункт плана изменился. Обновите план."
      case "INTENSIVE_NOT_PUBLISHED":
        return text ?? "Интенсив не опубликован — планирование из плана недоступно."
      case "IDEMPOTENCY_KEY_CONFLICT":
        clientRequestIdRef.current = newClientRequestId()
        return "Не удалось сохранить: повторите отправку."
      case "WORKSPACE_NOT_IN_INTENSIVE_SPACE":
      case "FEATURE_DISABLED":
      case "VALIDATION_ERROR":
      case "BAD_REQUEST":
      case "NOT_FOUND":
        if (fieldErrors.scheduledFor) setServerDateError(fieldErrors.scheduledFor)
        return text ?? "Не удалось запланировать сообщение"
      default:
        return null
    }
  }

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitLockRef.current || !template || !canSubmit || !selectedChannel) return
    // Повторная проверка на момент отправки
    const scheduledFor = intensive ? planScheduledAt : buildScheduledDate(date, time)
    if (!scheduledFor || scheduledFor.getTime() <= Date.now() + MIN_LEAD_MS / 2) {
      setNow(new Date())
      setServerTimeError("Время отправки должно быть в будущем")
      setMobileView("edit")
      return
    }

    submitLockRef.current = true
    setSubmitting(true)
    setSubmitError(null)
    setServerTimeError("")
    setServerDateError("")
    setConflict(null)
    let status = 0
    let data: { error?: unknown; code?: unknown; fieldErrors?: unknown; existingMessageId?: unknown; idempotent?: unknown } | null = null
    const officialSourceId =
      planItem?.sourceType === "OFFICIAL" && planItem.sourceTemplateId && /^[a-zA-Z0-9._-]{1,80}$/.test(planItem.sourceTemplateId)
        ? planItem.sourceTemplateId
        : null
    try {
      const res = await fetch("/api/messages", {
        method: "POST",
        // 'local' — ошибку показываем здесь, у формы, а не общим тостом
        headers: { "Content-Type": "application/json", "X-Error-Handling": "local" },
        body: JSON.stringify({
          workspaceId: workspace.id,
          channelId: selectedChannel.id,
          channelName: selectedChannel.name || selectedChannel.displayName || selectedChannel.id,
          message,
          scheduledFor: scheduledFor.toISOString(),
          ...(plan && planItem
            ? {
                ...(officialSourceId ? { sourceOfficialTemplateId: officialSourceId } : {}),
                intensiveId: plan.intensive.id,
                planItemId: planItem.id,
                clientRequestId: clientRequestIdRef.current,
                ...(plan.repeat ? { isPlanRepeat: true } : {}),
              }
            : template.kind === "mine"
              ? { sourceUserTemplateId: template.id }
              : { sourceOfficialTemplateId: template.id }),
        }),
      })
      status = res.status
      data = await res.json().catch(() => null)
      if (res.ok) {
        // Успех — только после подтверждения сервера
        const when = intensive
          ? `${formatInstantInTz(scheduledFor, tz)} · ${formatTimezone(tz)}`
          : (formatScheduleShort(date, time) ?? "")
        toast.success(`Запланировано на ${when}`, {
          description: data?.idempotent ? "Сообщение уже было создано при предыдущей попытке — дубль не создан." : undefined,
          action: {
            label: "Открыть календарь",
            onClick: () => router.push(`/dashboard/calendar?workspaceId=${workspace.id}`),
          },
          duration: 8000,
        })
        onOpenChange(false)
        await onScheduled()
        return
      }
    } catch {
      status = 0
    } finally {
      submitLockRef.current = false
      setSubmitting(false)
    }

    // Ошибка: введённые данные остаются в форме
    const planMessage = plan ? handlePlanError(data) : null
    if (planMessage) {
      setSubmitError(conflictMessageOrNull(planMessage, data))
      toast.error(planMessage, { description: "Данные в форме сохранены" })
      return
    }
    const info = describeSaveError(status, data)
    setSubmitError(
      info.kind === "auth"
        ? "Сессия истекла. Войдите снова и повторите отправку — скопируйте текст, если вы его меняли."
        : info.message,
    )
    if (info.timeError) {
      setServerTimeError(info.timeError)
      setNow(new Date())
      setMobileView("edit")
    }
    toast.error(info.message, { description: "Данные в форме сохранены" })
  }

  if (!template) return null

  const sender = workspace.username ? `@${workspace.username}` : null
  const summaryChannelName = selectedChannel ? selectedChannel.name || selectedChannel.displayName : ""
  const repeat = !!plan?.repeat
  const title = plan ? (repeat ? "Запланировать повтор" : "Запланировать сообщение") : "Запланировать сообщение"

  return (
    <>
      <Dialog
        open={open}
        onOpenChange={(v) => {
          // Esc, клик по подложке, крестик и «Отмена» — через защиту от потери текста
          if (v) onOpenChange(true)
          else requestClose()
        }}
      >
        <DialogContent
          className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-3rem)] sm:max-w-[640px] lg:max-w-[1040px]"
          onInteractOutside={(e) => {
            if (submitting) e.preventDefault()
          }}
        >
          <form onSubmit={submit} className="flex min-h-0 min-w-0 flex-1 flex-col">
            <DialogHeader className="space-y-1 border-b px-4 py-3 pr-12 sm:px-6 sm:py-4">
              <DialogTitle className="text-lg font-semibold tracking-tight">{title}</DialogTitle>
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                  <span className="min-w-0 break-words font-medium text-foreground">
                    {template.title || "(без названия)"}
                  </span>
                  {template.intensiveDay != null && <Badge variant="muted">День {template.intensiveDay}</Badge>}
                  {intensive ? (
                    <span className="min-w-0 break-words">· {intensive.name}</span>
                  ) : (
                    workspace.workspaceName && (
                      <span className="min-w-0 break-words">· Пространство: {workspace.workspaceName}</span>
                    )
                  )}
                </div>
              </DialogDescription>
            </DialogHeader>

            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
              <Tabs
                value={mobileView}
                onValueChange={(v) => setMobileView(v as "edit" | "preview")}
                className="mb-4 lg:hidden"
              >
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="edit">Редактор</TabsTrigger>
                  <TabsTrigger value="preview" className="flex items-center gap-2">
                    <Eye className="size-4" aria-hidden />
                    Предпросмотр
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              {repeat && (
                <p className="mb-4 flex items-start gap-2 rounded-md border px-3 py-2 text-[13px] text-muted-foreground">
                  <Repeat className="mt-0.5 size-4 shrink-0" aria-hidden />
                  Пункт уже выполнен. Повтор — дополнительная отправка: прогресс плана не изменится.
                </p>
              )}

              <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-6">
                <div className={cn("grid min-w-0 content-start gap-5", mobileView === "preview" && "hidden lg:grid")}>
                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-send-channel">Канал</Label>
                    <Select
                      value={channelId}
                      onValueChange={(v) => {
                        setChannelTouched(true)
                        setChannelId(v)
                        setSubmitError(null)
                      }}
                    >
                      <SelectTrigger id="tpl-send-channel" className="w-full" aria-invalid={!channelId || undefined}>
                        <SelectValue placeholder={channels.length === 0 ? "Каналы не загружены" : "Выберите канал"} />
                      </SelectTrigger>
                      <SelectContent>
                        {channels.map((ch) => (
                          <SelectItem key={ch.id} value={ch.id}>
                            #{ch.name || ch.displayName}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {!channelId && channels.length > 0 && (
                      <p role="alert" className="text-xs text-destructive">
                        {channelError}
                      </p>
                    )}
                    {channelMissingInWorkspace && (
                      <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                        <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
                        Канал #{templateChannelLabel} не найден в этом пространстве — выберите вручную
                      </p>
                    )}
                    {channels.length === 0 && (
                      <p className="text-xs text-muted-foreground">
                        Список каналов пуст. Проверьте подключение к Rocket.Chat в настройках пространства.
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <Label htmlFor="message">Текст</Label>
                      <span className={cn("text-xs text-muted-foreground", tooLong && "font-medium text-destructive")}>
                        {message.length} / {MAX_LEN}
                      </span>
                    </div>
                    <MessageEditor
                      value={message}
                      onChange={(v) => {
                        setMessage(v)
                        setSubmitError(null)
                      }}
                      placeholder="Введите текст сообщения..."
                      maxLength={MAX_LEN}
                      emojis={emojis}
                      workspaceId={workspace.id}
                      workspaceUrl={workspace.workspaceUrl ?? undefined}
                    />
                    <p className={cn("text-xs text-destructive", !messageEmpty && "invisible")} role="alert">
                      Текст сообщения не может быть пустым
                    </p>
                    {textEdited && (
                      <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        Текст изменён относительно плана — связь с пунктом сохранится.
                        <button
                          type="button"
                          className="text-primary underline-offset-2 hover:underline"
                          onClick={() => setMessage(planItem?.body ?? "")}
                        >
                          Вернуть текст из плана
                        </button>
                      </p>
                    )}
                  </div>

                  <section className="space-y-3" aria-label="Время отправки">
                    <h3 className="text-sm font-semibold">Когда отправить</h3>
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,160px)]">
                      <div className="space-y-1.5">
                        <Label htmlFor="tpl-send-date">Дата</Label>
                        <DatePicker
                          id="tpl-send-date"
                          value={date}
                          onChange={(v) => {
                            setDate(v)
                            setAutoDate(false)
                            clearScheduleErrors()
                          }}
                          min={intensive ? (intensive.startDate > todayYmd ? intensive.startDate : todayYmd) : todayYmd}
                          max={intensive?.endDate}
                          invalid={!!dateError}
                          aria-describedby="tpl-send-date-hint"
                        />
                        <div id="tpl-send-date-hint" className="space-y-1">
                          {dateError ? (
                            <p role="alert" className="text-xs text-destructive">
                              {dateError}
                            </p>
                          ) : dayHint ? (
                            <p className="text-xs text-muted-foreground">
                              {dayHint}
                              {autoDate ? (intensive ? " · рекомендовано планом" : " · дата подставлена по дате начала интенсива") : ""}
                            </p>
                          ) : null}
                        </div>
                      </div>

                      <div className="space-y-1.5">
                        <Label htmlFor="tpl-send-time">Время</Label>
                        <TimePicker
                          id="tpl-send-time"
                          value={time}
                          onChange={(v) => {
                            setTime(v)
                            clearScheduleErrors()
                          }}
                          invalid={!!timeError}
                          aria-describedby="tpl-send-time-error"
                        />
                        {timeError && (
                          <p id="tpl-send-time-error" role="alert" className="text-xs text-destructive">
                            {timeError}
                          </p>
                        )}
                        {nonexistent && (
                          <button
                            type="button"
                            className="text-xs text-primary underline-offset-2 hover:underline"
                            onClick={() => {
                              setTime(localHmOfInstant(nonexistent.suggestedUtc, tz))
                              clearScheduleErrors()
                            }}
                          >
                            Использовать {localHmOfInstant(nonexistent.suggestedUtc, tz)}
                          </button>
                        )}
                      </div>
                    </div>

                    {intensive && ambiguous && (
                      <div role="group" aria-label="Выбор времени при переводе часов" className="space-y-2 rounded-md border px-3 py-2">
                        <p className="text-xs text-foreground">
                          В этот день {parsedTime} наступает дважды (перевод часов). Выберите, какое время использовать:
                        </p>
                        <div className="flex flex-wrap gap-2">
                          {(["earlier", "later"] as const).map((choice) => {
                            const at = choice === "earlier" ? ambiguous.earlierUtc : ambiguous.laterUtc
                            return (
                              <Button
                                key={choice}
                                type="button"
                                size="sm"
                                variant={dstChoice === choice ? "default" : "outline"}
                                aria-pressed={dstChoice === choice}
                                onClick={() => setDstChoice(choice)}
                              >
                                {choice === "earlier" ? "Первое (до перевода)" : "Второе (после перевода)"}
                                <span className="opacity-80">· {getTimeZoneLabel(at, tz).offset}</span>
                              </Button>
                            )
                          })}
                        </div>
                      </div>
                    )}

                    {intensive ? (
                      <p className="text-xs text-muted-foreground">
                        Время — по часовому поясу интенсива: {formatTimezone(tz)} ({tz}).
                        {localEquivalent ? ` ${localEquivalent}.` : ""}
                        {!planItem?.recommended.date &&
                          ` Рекомендуемая дата не определена — выберите день в пределах ${formatRange(intensive.startDate, intensive.endDate)}.`}
                      </p>
                    ) : (
                      <>
                        {!hasStartDate && (
                          <p className="text-xs text-muted-foreground">
                            Укажите дату начала интенсива в настройках пространства, чтобы дата подставлялась автоматически.
                            {onOpenWorkspaceSettings && (
                              <>
                                {" "}
                                <button
                                  type="button"
                                  className="text-primary underline-offset-2 hover:underline"
                                  onClick={() => requestClose(onOpenWorkspaceSettings)}
                                >
                                  Открыть настройки
                                </button>
                              </>
                            )}
                          </p>
                        )}
                        {hasStartDate && template.intensiveDay == null && (
                          <p className="text-xs text-muted-foreground">
                            У шаблона не указан день интенсива, поэтому дату нужно выбрать вручную.
                          </p>
                        )}
                      </>
                    )}
                  </section>
                </div>

                <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
                  <div className={cn("space-y-2", mobileView === "edit" && "hidden lg:block")}>
                    <h3 className="text-sm font-semibold">Предпросмотр</h3>
                    <div className="lg:max-h-[45vh] lg:overflow-y-auto">
                      {message.trim() ? (
                        <MessagePreview
                          message={message}
                          username={workspace.username || "user"}
                          channelName={selectedChannel?.name || templateChannelLabel}
                          workspaceName={workspace.workspaceName ?? undefined}
                          workspaceId={workspace.id}
                          workspaceUrl={workspace.workspaceUrl ?? undefined}
                          emojis={emojis}
                        />
                      ) : (
                        <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                          Введите текст сообщения для предпросмотра
                        </div>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Предпросмотр приблизительный: форматирование Rocket.Chat воспроизведено не полностью. Он ничего не
                      отправляет и не сохраняет.
                    </p>
                  </div>

                  <SendSummary
                    workspaceName={workspace.workspaceName}
                    channelName={summaryChannelName}
                    sender={sender}
                    senderNote={sender ? "вы" : null}
                    date={date}
                    time={time}
                    minLeadMs={MIN_LEAD_MS}
                    intensiveName={intensive?.name ?? null}
                    schedule={
                      intensive
                        ? {
                            label: planScheduledAt ? planScheduleLine(intensive, date, parsedTime) : null,
                            secondary: localEquivalent,
                            inPast,
                          }
                        : undefined
                    }
                  />
                </aside>
              </div>
            </div>

            <div className="border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
              {conflict ? (
                <div
                  role="alert"
                  className="mb-3 flex flex-col gap-2 rounded-md border border-amber-500/40 px-3 py-2 text-sm sm:flex-row sm:items-center"
                >
                  <TriangleAlert className="hidden size-4 shrink-0 text-amber-600 dark:text-amber-400 sm:block" aria-hidden />
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">Это сообщение уже запланировано</p>
                    <p className="text-[13px] text-muted-foreground">
                      Другой сотрудник успел запланировать этот пункт. Ваш текст сохранён в форме.
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={async () => {
                        const ok = await copyToClipboard(message)
                        if (ok) toast.success("Текст скопирован")
                        else toast.error("Не удалось скопировать текст", { description: "Разрешите доступ к буферу обмена." })
                      }}
                    >
                      <Copy aria-hidden />
                      Копировать текст
                    </Button>
                    {conflict.existingMessageId && onOpenExistingMessage && (
                      <Button
                        type="button"
                        size="sm"
                        onClick={() => onOpenExistingMessage(conflict.existingMessageId as string)}
                      >
                        <Eye aria-hidden />
                        Открыть существующее
                      </Button>
                    )}
                  </div>
                </div>
              ) : (
                submitError && (
                  <p
                    role="alert"
                    className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
                  >
                    <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                    <span className="min-w-0 break-words">{submitError}</span>
                  </p>
                )
              )}
              <div className="flex gap-2 sm:justify-end">
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => requestClose()}
                  disabled={submitting}
                >
                  Отмена
                </Button>
                <Button type="submit" className="flex-1 sm:flex-none" disabled={!canSubmit} aria-busy={submitting}>
                  {submitting ? (
                    <>
                      <Spinner className="mr-2 h-4 w-4" />
                      Сохранение...
                    </>
                  ) : repeat ? (
                    "Запланировать повтор"
                  ) : (
                    "Запланировать"
                  )}
                </Button>
              </div>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmCloseOpen}
        onOpenChange={(v) => {
          setConfirmCloseOpen(v)
          if (!v) afterCloseRef.current = null
        }}
        title="Закрыть без сохранения?"
        description="Сообщение не будет запланировано, внесённые изменения пропадут."
        confirmLabel="Закрыть"
        cancelLabel="Продолжить редактирование"
        destructive
        onConfirm={() => {
          const after = afterCloseRef.current
          afterCloseRef.current = null
          setConfirmCloseOpen(false)
          onOpenChange(false)
          after?.()
        }}
      />
    </>
  )
}

/** Для конфликта текст показывает отдельный блок — общий текст ошибки не нужен */
function conflictMessageOrNull(message: string, data: { code?: unknown } | null): string | null {
  return data?.code === "PLAN_ITEM_ALREADY_SCHEDULED" ? null : message
}
