"use client"

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import Link from 'next/link'
import { ChevronDown, ChevronRight, FileText } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { Section } from '@/components/common/Section'
import { TemplateRow } from '@/components/_components/workspace/TemplateRow'
import type { TemplateSendTarget } from '@/components/_components/TemplateSendDialog'
import type { PlanItemRowHandlers } from '@/components/intensives/shared/PlanItemRow'
import { dayGroupHeading } from '@/components/intensives/shared/format'
import { LoadErrorBlock } from '@/components/intensives/shared/LoadErrorBlock'
import {
  TemplateScopeLabel,
  TemplateScopeTabs,
  scopePanelId,
  scopeTabId,
} from '@/components/intensives/shared/TemplateScopeTabs'
import { dayDate, intensiveLengthDays, localYmdOfInstant } from '@/lib/intensives/dates'
import type { IntensiveSummary } from '@/lib/intensives/types'
import { apiFetch, ApiError } from '@/lib/intensives/ui'
import { cn } from '@/lib/utils'
import { IntensivePlanView } from './IntensivePlanView'
import { TEMPLATE_SCOPE_LABELS, type IntensivePlanState, type TemplateScope, type TemplateScopeState } from './useIntensiveContext'

type OfficialTemplate = {
  id: string
  /** Набор (аддитивное поле GET /api/templates) */
  scope?: 'SUP' | 'ADM'
  intensiveDay: number
  dayLabel: string
  time: string
  channel: string
  audience: 'all' | 'mk'
  title?: string
  body: string
  timeNote?: string
}

type MyTemplate = {
  id: string
  channel: string
  intensiveDay: number | null
  time: string
  title: string | null
  body: string
  lastSentAt?: string | null
}

/** Поля сообщения пространства, нужные для статуса шаблона */
export type TemplateStatusMessage = {
  status: string
  sentAt?: string | null
  scheduledFor?: string | null
  sourceUserTemplateId?: string | null
  sourceOfficialTemplateId?: string | null
  intensiveId?: string | null
}

type DayGroup = { day: number; label: string; rows: ReactNode[] }

const WEEKDAYS = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const
const NO_DAY = 0
const myDayLabel = (day: number) => (day === NO_DAY ? 'Без дня' : `День ${day} (${WEEKDAYS[(day - 1) % 7]})`)

function formatShort(value: string) {
  return new Date(value).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

function pluralAnnouncements(n: number) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return 'анонс'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'анонса'
  return 'анонсов'
}

/** Переключатель «Все дни / День N» + плоские группы по дням со сворачиванием. */
function DayGroupedList({
  groups,
  tabLabel,
}: {
  groups: DayGroup[]
  tabLabel: (day: number) => string
}) {
  const [selected, setSelected] = useState<number | 'all'>('all')
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set())
  const toggle = (day: number) =>
    setCollapsed((prev) => {
      const next = new Set(prev)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })
  const chip = (active: boolean) =>
    cn(
      'h-8 rounded-md px-2.5 text-[13px] font-medium transition-colors',
      active ? 'bg-muted text-foreground' : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
    )
  const visible = selected === 'all' ? groups : groups.filter((g) => g.day === selected)

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-1" role="group" aria-label="День интенсива">
        <button type="button" aria-pressed={selected === 'all'} onClick={() => setSelected('all')} className={chip(selected === 'all')}>
          Все дни
        </button>
        {groups.map((g) => (
          <button key={g.day} type="button" aria-pressed={selected === g.day} onClick={() => setSelected(g.day)} className={chip(selected === g.day)}>
            {tabLabel(g.day)}
          </button>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        {visible.map((g) => {
          const isCollapsed = selected === 'all' && collapsed.has(g.day)
          return (
            <div key={g.day} className="border-b last:border-b-0">
              {selected === 'all' && (
                <button
                  type="button"
                  aria-expanded={!isCollapsed}
                  onClick={() => toggle(g.day)}
                  className="flex w-full items-center gap-2 border-b bg-muted/40 px-3 py-2 text-left text-sm font-medium transition-colors hover:bg-muted/60"
                >
                  {isCollapsed ? <ChevronRight className="size-4 text-muted-foreground" /> : <ChevronDown className="size-4 text-muted-foreground" />}
                  <span className="min-w-0 flex-1 truncate">{g.label}</span>
                  <span className="text-xs font-normal tabular-nums text-muted-foreground">
                    {g.rows.length} {pluralAnnouncements(g.rows.length)}
                  </span>
                </button>
              )}
              {!isCollapsed && <div className="[&>div:last-child]:border-b-0">{g.rows}</div>}
            </div>
          )
        })}
      </div>
    </div>
  )
}

type SendInfo = { state: 'SENT' | 'PENDING' | 'FAILED'; lastSentAt?: string | null; pendingScheduledFor?: string | null }

/** Статус шаблона по сообщениям, привязанным к шаблону */
function buildSendInfo(messages: TemplateStatusMessage[]): Map<string, SendInfo> {
  const statuses = new Map<string, Set<string>>()
  const lastSentAt = new Map<string, string>()
  const pendingFor = new Map<string, string>()
  for (const msg of messages) {
    const tid = msg.sourceUserTemplateId || msg.sourceOfficialTemplateId
    if (!tid) continue
    if (!statuses.has(tid)) statuses.set(tid, new Set())
    statuses.get(tid)!.add(msg.status)
    if (msg.status === 'SENT' && msg.sentAt) {
      const prev = lastSentAt.get(tid)
      if (!prev || new Date(msg.sentAt) > new Date(prev)) lastSentAt.set(tid, msg.sentAt)
    }
    if (msg.status === 'PENDING' && msg.scheduledFor) {
      const prev = pendingFor.get(tid)
      if (!prev || new Date(msg.scheduledFor).getTime() < new Date(prev).getTime()) pendingFor.set(tid, msg.scheduledFor)
    }
  }
  const out = new Map<string, SendInfo>()
  for (const [tid, set] of statuses) {
    if (set.has('SENT')) out.set(tid, { state: 'SENT', lastSentAt: lastSentAt.get(tid) ?? null })
    else if (set.has('PENDING')) out.set(tid, { state: 'PENDING', pendingScheduledFor: pendingFor.get(tid) ?? null })
    else if (set.has('FAILED')) out.set(tid, { state: 'FAILED' })
  }
  return out
}

function StatusBadge({ info, emptyTitle }: { info: SendInfo | undefined; emptyTitle: string }) {
  if (info?.state === 'SENT') {
    return (
      <Badge variant="success">
        Отправлено
        {info.lastSentAt && <span className="opacity-80 tabular-nums">{formatShort(info.lastSentAt)}</span>}
      </Badge>
    )
  }
  if (info?.state === 'PENDING') {
    return (
      <Badge variant="info">
        Запланировано
        {info.pendingScheduledFor && <span className="opacity-80 tabular-nums">{formatShort(info.pendingScheduledFor)}</span>}
      </Badge>
    )
  }
  if (info?.state === 'FAILED') return <Badge variant="danger">Ошибка отправки</Badge>
  return (
    <span className="text-xs text-muted-foreground" title={emptyTitle}>
      Не отправлялось
    </span>
  )
}

/** Скелет по форме списка: (чипы дней) + заголовок группы дня + строки шаблонов. */
function RowsSkeleton({ label, withDays = false }: { label: string; withDays?: boolean }) {
  return (
    <div className="space-y-3" role="status" aria-busy="true" aria-label={label}>
      {withDays && (
        <div className="flex flex-wrap gap-1">
          {Array.from({ length: 5 }).map((_, i) => (
            <Skeleton key={i} className="h-8 w-16" />
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-lg border bg-card">
        {withDays && (
          <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2">
            <Skeleton className="size-4" />
            <Skeleton className="h-4 w-48 max-w-[60%]" />
            <Skeleton className="ml-auto h-3 w-16" />
          </div>
        )}
        <div className="divide-y">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3 py-3">
              <Skeleton className="size-6" />
              <Skeleton className="h-4 w-10" />
              <Skeleton className="h-5 w-24" />
              <Skeleton className="h-4 flex-1" />
              <Skeleton className="hidden h-8 w-28 sm:block" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

type LoadStatus = { loading: boolean; error: string | null; forbidden: boolean }
const INITIAL_STATUS: LoadStatus = { loading: true, error: null, forbidden: false }

function loadErrorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Нет соединения с сервером. Проверьте сеть и повторите.'
}

const LEGACY_SCOPE_ID_PREFIX = 'legacy-scope'

/**
 * Вкладка «Шаблоны».
 *  - Выбран интенсив → план анонсов интенсива (набор шаблонов: вкладки Lead_SUP или набор роли) + блок
 *    «Мои дополнительные сообщения» (личные шаблоны в план не входят).
 *  - «Без привязки к интенсиву» → прежний список общих шаблонов со статусами («История использования вне интенсивов»)
 *    и «Мои шаблоны». Набор: SUP — только «Шаблоны SUP», ADM — только «Шаблоны ADM», Lead_SUP — вкладки с обоими
 *    (тот же выбор, что и в плане, `?scope=`). Статус считается только по сообщениям без привязки к интенсиву.
 */
export function TemplatesTab({
  messages,
  onSend,
  onCopyBody,
  featureEnabled = false,
  contextReady = true,
  intensive = null,
  plan,
  planHandlers,
  templateScope,
}: {
  /** Роль пользователя (набор шаблонов задаёт templateScope) */
  currentUserRole?: string
  messages: TemplateStatusMessage[]
  onSend: (target: TemplateSendTarget) => void
  onCopyBody: (body: string) => void
  /** Функция «Интенсивы» включена */
  featureEnabled?: boolean
  /** Контекст интенсива определён (список загружен, выбор сделан) */
  contextReady?: boolean
  intensive?: IntensiveSummary | null
  plan?: IntensivePlanState
  planHandlers?: PlanItemRowHandlers
  /** Набор шаблонов: SUP / ADM / вкладки Lead_SUP */
  templateScope: TemplateScopeState
}) {
  const [supTemplates, setSupTemplates] = useState<OfficialTemplate[]>([])
  const [admTemplates, setAdmTemplates] = useState<OfficialTemplate[]>([])
  const [officialStatus, setOfficialStatus] = useState<LoadStatus>(INITIAL_STATUS)
  const [myTemplates, setMyTemplates] = useState<MyTemplate[]>([])
  const [mineStatus, setMineStatus] = useState<LoadStatus>(INITIAL_STATUS)
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const officialSeq = useRef(0)
  const mineSeq = useRef(0)

  /** GET /api/templates: SUP/Lead_SUP — templates = SUP, admTemplates = ADM; ADM — оба поля = ADM; MEMBER — 403 */
  const loadOfficial = useCallback(async () => {
    const seq = ++officialSeq.current
    setOfficialStatus((s) => ({ ...s, loading: true }))
    try {
      const d = await apiFetch<{ templates?: OfficialTemplate[]; admTemplates?: OfficialTemplate[]; role?: string }>('/api/templates')
      if (seq !== officialSeq.current) return
      const adm = (d.admTemplates ?? (d.role === 'ADM' ? d.templates : undefined) ?? []).filter((t) => !t.scope || t.scope === 'ADM')
      const sup = d.role === 'ADM' ? [] : (d.templates ?? []).filter((t) => !t.scope || t.scope === 'SUP')
      setSupTemplates(sup)
      setAdmTemplates(adm)
      setOfficialStatus({ loading: false, error: null, forbidden: false })
    } catch (e) {
      if (seq !== officialSeq.current) return
      if (e instanceof ApiError && e.status === 403) {
        setOfficialStatus({ loading: false, error: null, forbidden: true })
        return
      }
      setOfficialStatus({ loading: false, error: loadErrorText(e), forbidden: false })
    }
  }, [])

  const loadMine = useCallback(async () => {
    const seq = ++mineSeq.current
    setMineStatus((s) => ({ ...s, loading: true }))
    try {
      const mine = await apiFetch<{ templates?: MyTemplate[] }>('/api/templates/mine')
      if (seq !== mineSeq.current) return
      setMyTemplates(mine.templates ?? [])
      setMineStatus({ loading: false, error: null, forbidden: false })
    } catch (e) {
      if (seq !== mineSeq.current) return
      if (e instanceof ApiError && (e.status === 403 || e.status === 401)) {
        // Роли без личных шаблонов — просто пустой список
        setMyTemplates([])
        setMineStatus({ loading: false, error: null, forbidden: true })
        return
      }
      setMineStatus({ loading: false, error: loadErrorText(e), forbidden: false })
    }
  }, [])

  useEffect(() => {
    const t = setTimeout(() => {
      void loadOfficial()
      void loadMine()
    }, 0)
    return () => clearTimeout(t)
  }, [loadOfficial, loadMine])

  const planMode = !!intensive && !!plan && !!planHandlers

  /**
   * Сообщения, по которым считается статус шаблонов:
   *  - режим интенсива (личные шаблоны) — сообщения с датой в периоде интенсива (по его поясу);
   *  - «Без привязки» — только сообщения без интенсива (не смешиваем с прогрессом интенсива).
   */
  const statusMessages = useMemo(() => {
    if (planMode && intensive) {
      return messages.filter((m) => {
        if (!m.scheduledFor) return false
        const d = new Date(m.scheduledFor)
        if (Number.isNaN(d.getTime())) return false
        const ymd = localYmdOfInstant(d, intensive.timezone)
        return ymd >= intensive.startDate && ymd <= intensive.endDate
      })
    }
    return featureEnabled ? messages.filter((m) => !m.intensiveId) : messages
  }, [messages, planMode, intensive, featureEnabled])

  const sendInfo = useMemo(() => buildSendInfo(statusMessages), [statusMessages])
  const emptyTitle = planMode
    ? 'В период этого интенсива по шаблону ещё не создавали сообщение'
    : 'В этом пространстве по шаблону ещё не создавали сообщение'

  const toggleOpen = (id: string) =>
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  /** Набор общего списка: вкладка Lead_SUP или набор роли (SUP — только SUP, ADM — только ADM) */
  const scope: TemplateScope | null = templateScope.scope
  const officialList = scope === 'SUP' ? supTemplates : scope === 'ADM' ? admTemplates : []

  const officialGroups: DayGroup[] = (() => {
    const byDay = new Map<number, OfficialTemplate[]>()
    for (const t of officialList) byDay.set(t.intensiveDay, [...(byDay.get(t.intensiveDay) ?? []), t])
    return [...byDay.keys()]
      .sort((a, b) => a - b)
      .map((day) => {
        const items = [...byDay.get(day)!].sort(
          (a, b) => a.time.localeCompare(b.time) || (a.audience === 'mk' ? 1 : 0) - (b.audience === 'mk' ? 1 : 0),
        )
        return {
          day,
          label: `День ${day}${items[0]?.dayLabel ? ` — ${items[0].dayLabel}` : ''}`,
          rows: items.map((t) => (
            <TemplateRow
              key={t.id}
              id={t.id}
              time={t.time}
              channel={t.channel}
              title={t.title ?? t.dayLabel}
              mk={t.audience === 'mk'}
              body={t.body}
              open={openIds.has(t.id)}
              onToggle={() => toggleOpen(t.id)}
              status={<StatusBadge info={sendInfo.get(t.id)} emptyTitle={emptyTitle} />}
              onCopy={() => onCopyBody(t.body)}
              onSend={() =>
                onSend({ id: t.id, kind: 'official', title: t.title ?? t.dayLabel, channel: t.channel, time: t.time, body: t.body, intensiveDay: t.intensiveDay })
              }
            />
          )),
        }
      })
  })()

  const totalDays = intensive ? intensiveLengthDays(intensive.startDate, intensive.endDate) : 0
  const myGroupLabel = (day: number) => {
    if (planMode && intensive && day !== NO_DAY && day <= totalDays) return dayGroupHeading(day, dayDate(intensive.startDate, day))
    return planMode ? (day === NO_DAY ? 'Без дня' : `День ${day}`) : myDayLabel(day)
  }

  const myGroups: DayGroup[] = (() => {
    const byDay = new Map<number, MyTemplate[]>()
    for (const t of myTemplates) {
      const day = t.intensiveDay ?? NO_DAY
      byDay.set(day, [...(byDay.get(day) ?? []), t])
    }
    return [...byDay.keys()]
      .sort((a, b) => (a === NO_DAY ? 1 : b === NO_DAY ? -1 : a - b))
      .map((day) => ({
        day,
        label: myGroupLabel(day),
        rows: [...byDay.get(day)!]
          .sort((a, b) => a.time.localeCompare(b.time))
          .map((t) => (
            <TemplateRow
              key={t.id}
              id={t.id}
              time={t.time}
              channel={t.channel}
              title={t.title || '(без названия)'}
              body={t.body}
              open={openIds.has(t.id)}
              onToggle={() => toggleOpen(t.id)}
              status={<StatusBadge info={sendInfo.get(t.id)} emptyTitle={emptyTitle} />}
              onCopy={() => onCopyBody(t.body)}
              onSend={() =>
                onSend({ id: t.id, kind: 'mine', title: t.title || '(без названия)', channel: t.channel, time: t.time, body: t.body, intensiveDay: t.intensiveDay })
              }
            />
          )),
      }))
  })()

  const editLink = (
    <Link href="/dashboard/templates" className="text-[13px] font-medium text-primary hover:underline underline-offset-4">
      Редактировать
    </Link>
  )

  // Пока не известно, выбран ли интенсив и какая роль, не показываем прежний список (чтобы он не «мигал» перед планом)
  if (!contextReady || !templateScope.ready) {
    return <RowsSkeleton label="Загрузка шаблонов" withDays />
  }

  if (planMode && intensive && plan && planHandlers) {
    return (
      <div className="space-y-8">
        <IntensivePlanView intensive={intensive} plan={plan} handlers={planHandlers} scope={templateScope} />

        <Section
          bare
          title="Мои дополнительные сообщения"
          description="Личные шаблоны не входят в план интенсива и не влияют на его прогресс."
          actions={editLink}
        >
          {mineStatus.loading && myTemplates.length === 0 && !mineStatus.error ? (
            <RowsSkeleton label="Загрузка личных шаблонов" />
          ) : mineStatus.error && myTemplates.length === 0 ? (
            <LoadErrorBlock title="Не удалось загрузить личные шаблоны" message={mineStatus.error} onRetry={() => void loadMine()} retrying={mineStatus.loading} />
          ) : myGroups.length === 0 ? (
            <p className="rounded-lg border border-dashed px-4 py-6 text-center text-[13px] text-muted-foreground">
              Личных шаблонов нет. Их можно создать на странице{' '}
              <Link href="/dashboard/templates" className="font-medium text-primary underline-offset-2 hover:underline">
                Шаблоны
              </Link>
              .
            </p>
          ) : (
            <DayGroupedList key={`mine:${intensive.id}`} groups={myGroups} tabLabel={(day) => (day === NO_DAY ? 'Без дня' : `День ${day}`)} />
          )}
        </Section>
      </div>
    )
  }

  const scopeLabel = scope ? TEMPLATE_SCOPE_LABELS[scope] : null
  const tabs = templateScope.canSwitch && !!scope
  const legacyTitle: ReactNode = featureEnabled ? (
    <span className="inline-flex flex-wrap items-center gap-2">
      История использования вне интенсивов
      {!tabs && scope && <TemplateScopeLabel scope={scope} />}
    </span>
  ) : (
    scopeLabel ?? 'Шаблоны анонсов'
  )
  const legacyDescription = featureEnabled
    ? `${tabs || !scopeLabel ? 'Общие шаблоны' : scopeLabel}: статус считается по сообщениям этого пространства без привязки к интенсиву. Копирование текста статус не меняет.`
    : 'Статус считается по сообщениям с привязкой к шаблону в этом пространстве. Копирование текста статус не меняет.'

  const officialBody = officialStatus.loading && supTemplates.length === 0 && admTemplates.length === 0 && !officialStatus.error ? (
    <RowsSkeleton label={scopeLabel ? `Загрузка: ${scopeLabel}` : 'Загрузка шаблонов'} withDays />
  ) : officialStatus.forbidden || !scope ? (
    <EmptyState
      icon={<FileText />}
      title="Общие шаблоны недоступны"
      description="Шаблоны анонсов доступны ролям SUP, ADM и Lead_SUP. Личные шаблоны и сообщения работают как обычно."
    />
  ) : officialStatus.error && supTemplates.length === 0 && admTemplates.length === 0 ? (
    <LoadErrorBlock
      title={scopeLabel ? `Не удалось загрузить «${scopeLabel}»` : 'Не удалось загрузить шаблоны'}
      message={officialStatus.error}
      onRetry={() => void loadOfficial()}
      retrying={officialStatus.loading}
    />
  ) : officialGroups.length === 0 ? (
    <EmptyState
      icon={<FileText />}
      title={scopeLabel ? `В наборе «${scopeLabel}» шаблонов пока нет` : 'Шаблонов пока нет'}
      description="Когда руководитель добавит шаблоны анонсов, они появятся здесь."
    />
  ) : (
    <DayGroupedList key={`official:${scope}`} groups={officialGroups} tabLabel={(day) => `День ${day}`} />
  )

  return (
    <div className="space-y-6">
      {myGroups.length > 0 ? (
        <Section bare title="Мои шаблоны" actions={editLink}>
          <DayGroupedList groups={myGroups} tabLabel={myDayLabel} />
        </Section>
      ) : mineStatus.error ? (
        <LoadErrorBlock title="Не удалось загрузить личные шаблоны" message={mineStatus.error} onRetry={() => void loadMine()} retrying={mineStatus.loading} />
      ) : null}

      <Section bare title={legacyTitle} description={legacyDescription}>
        {tabs && scope ? (
          <div className="space-y-3">
            <TemplateScopeTabs
              idPrefix={LEGACY_SCOPE_ID_PREFIX}
              label="Набор общих шаблонов"
              value={scope}
              onChange={templateScope.setScope}
              counts={officialStatus.loading || officialStatus.error ? undefined : { SUP: supTemplates.length, ADM: admTemplates.length }}
              loadingScope={officialStatus.loading ? scope : null}
            />
            <div role="tabpanel" id={scopePanelId(LEGACY_SCOPE_ID_PREFIX)} aria-labelledby={scopeTabId(LEGACY_SCOPE_ID_PREFIX, scope)}>
              {officialBody}
            </div>
          </div>
        ) : (
          officialBody
        )}
      </Section>
    </div>
  )
}
