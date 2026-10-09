"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'

import type { IntensiveSummary, PlanResponse } from '@/lib/intensives/types'
import { apiFetch, ApiError } from '@/lib/intensives/ui'

const URL_PARAM = 'intensive'
/** Все статусы: черновики сервер отдаёт только Lead_SUP, отменённые/архивные — для просмотра истории */
const LIST_STATUSES = 'DRAFT,PUBLISHED,CANCELLED,ARCHIVED'

function readUrlIntensive(): string | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(URL_PARAM)
  return v && /^[A-Za-z0-9_-]{1,64}$/.test(v) ? v : null
}

/** Записать выбор в URL, сохранив остальные параметры и #вкладку (без перехода и прокрутки). */
function writeUrlIntensive(id: string | null) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (id) url.searchParams.set(URL_PARAM, id)
  else url.searchParams.delete(URL_PARAM)
  const next = `${url.pathname}${url.search}${url.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', next)
  }
}

/** Первоначальный выбор (ТЗ §6): текущий опубликованный → ближайший будущий → без привязки. */
export function pickDefaultIntensive(list: IntensiveSummary[]): IntensiveSummary | null {
  const pub = list.filter((i) => i.status === 'PUBLISHED')
  const running = pub.filter((i) => i.phase === 'RUNNING').sort((a, b) => a.startDate.localeCompare(b.startDate))
  if (running[0]) return running[0]
  const upcoming = pub.filter((i) => i.phase === 'UPCOMING').sort((a, b) => a.startDate.localeCompare(b.startDate))
  return upcoming[0] ?? null
}

function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message
  return 'Нет соединения с сервером. Проверьте сеть и повторите.'
}

export interface IntensiveContextState {
  /** null — ещё не известно; false — функция выключена (страница работает как раньше) */
  featureEnabled: boolean | null
  /** Список загружен и выбор сделан (или функция выключена / ошибка загрузки) */
  ready: boolean
  loadingList: boolean
  listError: string | null
  intensives: IntensiveSummary[]
  selectedId: string | null
  selected: IntensiveSummary | null
  select: (id: string | null) => void
  reloadList: () => void
}

/**
 * Контекст интенсива на странице пространства.
 * Выбор фиксируется в состоянии страницы (не переключается в полночь и при обновлении данных) и
 * сохраняется в URL (`?intensive=`). Страница пространства монтируется с key={workspaceId},
 * поэтому при смене пространства выбор проверяется заново по списку этого пространства.
 */
export function useIntensiveContext(workspaceId: string): IntensiveContextState {
  const [featureEnabled, setFeatureEnabled] = useState<boolean | null>(null)
  const [intensives, setIntensives] = useState<IntensiveSummary[]>([])
  const [listError, setListError] = useState<string | null>(null)
  const [loadingList, setLoadingList] = useState(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [initialized, setInitialized] = useState(false)
  const initializedRef = useRef(false)
  const selectedRef = useRef<string | null>(null)
  const seqRef = useRef(0)
  const featureRef = useRef<boolean | null>(null)
  const hasListRef = useRef(false)

  const applySelection = useCallback((id: string | null) => {
    selectedRef.current = id
    setSelectedId(id)
    writeUrlIntensive(id)
  }, [])

  const load = useCallback(async () => {
    const seq = ++seqRef.current
    setLoadingList(true)
    try {
      if (featureRef.current == null) {
        const f = await apiFetch<{ enabled: boolean }>('/api/intensives/feature')
        if (seq !== seqRef.current) return
        featureRef.current = !!f.enabled
        setFeatureEnabled(!!f.enabled)
      }
      if (!featureRef.current) {
        initializedRef.current = true
        setInitialized(true)
        return
      }
      const res = await apiFetch<{ intensives: IntensiveSummary[]; orgSpaceId: string | null }>(
        `/api/intensives?workspaceId=${encodeURIComponent(workspaceId)}&status=${LIST_STATUSES}&progress=false`,
      )
      if (seq !== seqRef.current) return
      const list = res.intensives ?? []
      hasListRef.current = true
      setIntensives(list)
      setListError(null)

      if (!initializedRef.current) {
        initializedRef.current = true
        setInitialized(true)
        const fromUrl = readUrlIntensive()
        const explicit = fromUrl ? list.find((i) => i.id === fromUrl) : undefined
        const fallback = explicit ?? pickDefaultIntensive(list)
        if (fromUrl && !explicit) {
          toast.warning('Интенсив из ссылки недоступен', {
            description: fallback
              ? `Он не относится к этому пространству или у вас нет доступа. Показан «${fallback.name}».`
              : 'Он не относится к этому пространству или у вас нет доступа. Показан режим «Без привязки к интенсиву».',
          })
        }
        applySelection(fallback?.id ?? null)
        return
      }

      // Обновление списка не меняет выбор; если выбранный интенсив пропал (нет доступа) — возвращаемся к «Без привязки»
      const cur = selectedRef.current
      if (cur && !list.some((i) => i.id === cur)) {
        toast.warning('Выбранный интенсив больше недоступен', { description: 'Показан режим «Без привязки к интенсиву».' })
        applySelection(null)
      }
    } catch (e) {
      if (seq !== seqRef.current) return
      if (e instanceof ApiError && e.code === 'FEATURE_DISABLED') {
        featureRef.current = false
        setFeatureEnabled(false)
        initializedRef.current = true
        setInitialized(true)
        return
      }
      if (featureRef.current == null) {
        // Флаг не удалось узнать — ведём себя как раньше, без интенсивов
        setFeatureEnabled(false)
        initializedRef.current = true
        setInitialized(true)
        return
      }
      setListError(errorText(e))
      if (hasListRef.current) toast.error('Не удалось обновить список интенсивов', { description: errorText(e) })
      // Ошибка первой загрузки: работаем «без привязки», но URL не трогаем (выбор восстановится после повтора)
      setInitialized(true)
    } finally {
      if (seq === seqRef.current) setLoadingList(false)
    }
  }, [workspaceId, applySelection])

  useEffect(() => {
    // Загрузка при монтировании; setState происходит только в асинхронных колбэках
    const t = setTimeout(() => void load(), 0)
    return () => clearTimeout(t)
  }, [load])

  const select = useCallback(
    (id: string | null) => {
      if (id && !intensives.some((i) => i.id === id)) {
        toast.error('Интенсив недоступен', { description: 'Обновите страницу и выберите другой.' })
        return
      }
      applySelection(id)
    },
    [intensives, applySelection],
  )

  const selected = selectedId ? (intensives.find((i) => i.id === selectedId) ?? null) : null

  return {
    featureEnabled,
    ready: initialized,
    loadingList,
    listError: intensives.length > 0 ? null : listError,
    intensives,
    selectedId: selected ? selectedId : null,
    selected,
    select,
    reloadList: () => void load(),
  }
}

/* ───────────── Набор шаблонов (SUP / ADM) ───────────── */

export type TemplateScope = 'SUP' | 'ADM'
export const TEMPLATE_SCOPES: readonly TemplateScope[] = ['SUP', 'ADM']
export const TEMPLATE_SCOPE_LABELS: Record<TemplateScope, string> = {
  SUP: 'Шаблоны SUP',
  ADM: 'Шаблоны ADM',
}
const SCOPE_URL_PARAM = 'scope'

function readUrlScope(): TemplateScope | null {
  if (typeof window === 'undefined') return null
  const v = new URLSearchParams(window.location.search).get(SCOPE_URL_PARAM)?.trim().toUpperCase()
  return v === 'SUP' || v === 'ADM' ? v : null
}

/** Записать набор в URL (`?scope=`), сохранив остальные параметры (`?intensive=`) и #вкладку. */
function writeUrlScope(scope: TemplateScope) {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  url.searchParams.set(SCOPE_URL_PARAM, scope)
  const next = `${url.pathname}${url.search}${url.hash}`
  if (next !== `${window.location.pathname}${window.location.search}${window.location.hash}`) {
    window.history.replaceState(null, '', next)
  }
}

export interface TemplateScopeState {
  /** Роль пользователя известна (до этого набор не выбран — не грузим лишнего) */
  ready: boolean
  /** Показываемый набор: SUP / ADM; null — у роли нет своего набора (MEMBER видит только общие пункты) */
  scope: TemplateScope | null
  /** Lead_SUP переключает вкладки «Шаблоны SUP» / «Шаблоны ADM»; остальным набор задаёт роль */
  canSwitch: boolean
  setScope: (scope: TemplateScope) => void
}

/**
 * Какой набор шаблонов показывать на вкладке «Шаблоны» (и в плане интенсива, и «Без привязки к интенсиву»).
 * Lead_SUP — выбор вкладки, по умолчанию SUP, хранится в URL (`?scope=SUP|ADM`) и не сбрасывается при смене
 * интенсива или вкладки страницы. SUP — только SUP, ADM — только ADM (сервер для них параметр игнорирует).
 */
export function useTemplateScope(role: string | null): TemplateScopeState {
  // Ленивая инициализация из URL: на сервере — SUP, на клиенте — значение из ссылки
  const [leadChoice, setLeadChoice] = useState<TemplateScope>(() => readUrlScope() ?? 'SUP')
  const canSwitch = role === 'LEAD_SUP'

  const setScope = useCallback(
    (next: TemplateScope) => {
      if (!canSwitch) return
      setLeadChoice(next)
      writeUrlScope(next)
    },
    [canSwitch],
  )

  const scope: TemplateScope | null = canSwitch ? leadChoice : role === 'SUP' ? 'SUP' : role === 'ADM' ? 'ADM' : null

  return useMemo(() => ({ ready: role != null, scope, canSwitch, setScope }), [role, scope, canSwitch, setScope])
}

/* ───────────── План выбранного интенсива ───────────── */

export interface IntensivePlanState {
  /** Для какого интенсива запрошен план */
  intensiveId: string | null
  /** Набор, запрошенный у сервера (`?scope=`, только Lead_SUP); null — набор задаёт роль */
  scope: TemplateScope | null
  /** Данные строго для intensiveId + scope (поздний ответ другого интенсива или вкладки сюда не попадёт) */
  data: PlanResponse | null
  /** Первая загрузка для этого интенсива/набора — данных ещё нет (действия недоступны) */
  loading: boolean
  /** Идёт обновление при уже показанных данных */
  refreshing: boolean
  /** Есть запрос в работе (в т.ч. повтор после ошибки) */
  busy: boolean
  /** Ошибка первой загрузки (≠ «план пуст») */
  error: string | null
  /** Число пунктов по наборам для текущего интенсива (вкладки Lead_SUP); нет числа — ещё не известно */
  scopeTotals: Partial<Record<TemplateScope, number>>
  /** Названия пунктов всех загруженных наборов текущего интенсива (для истории Lead_SUP) */
  itemTitles: Record<string, string>
  reload: () => Promise<void>
}

type PlanEntry = { data: PlanResponse | null; error: string | null }

const planKey = (id: string, scope: TemplateScope | null) => `${id}|${scope ?? ''}`
const keyIntensive = (key: string) => key.slice(0, key.indexOf('|'))

/**
 * Загрузка плана с защитой от гонок: каждый запрос получает номер; ответ применяется, только если он
 * последний и относится к текущему интенсиву и набору. Данные хранятся по ключу «интенсив + набор», поэтому
 * пункты двух вкладок не смешиваются; вернувшись на вкладку, пользователь сразу видит её прежние данные,
 * а сервер их обновляет. После изменения (reload) данные другой вкладки того же интенсива сбрасываются.
 *
 * `enabled: false` — роль ещё неизвестна: план не запрашивается (иначе Lead_SUP получил бы лишний запрос «всё»).
 * `prefetchOtherScope` — Lead_SUP: один лёгкий запрос карточки интенсива (`GET /api/intensives/[id]?scope=`)
 * ради числа пунктов на соседней вкладке.
 */
export function useIntensivePlan(
  intensiveId: string | null,
  opts: { scope?: TemplateScope | null; enabled?: boolean; prefetchOtherScope?: boolean } = {},
): IntensivePlanState {
  const { scope = null, enabled = true, prefetchOtherScope = false } = opts
  const activeKey = enabled && intensiveId ? planKey(intensiveId, scope) : null

  const [entries, setEntries] = useState<Record<string, PlanEntry>>({})
  const [totals, setTotals] = useState<Record<string, number>>({})
  const [inFlightFor, setInFlightFor] = useState<string | null>(null)
  const seqRef = useRef(0)
  const keyRef = useRef<string | null>(activeKey)
  const paramsRef = useRef<{ id: string; scope: TemplateScope | null } | null>(null)
  const entriesRef = useRef<Record<string, PlanEntry>>({})
  const prefetchedRef = useRef<Set<string>>(new Set())

  const commitEntries = useCallback((next: Record<string, PlanEntry>) => {
    entriesRef.current = next
    setEntries(next)
  }, [])

  const load = useCallback(
    async (id: string, sc: TemplateScope | null, opts?: { invalidateOthers?: boolean }) => {
      const key = planKey(id, sc)
      const seq = ++seqRef.current
      setInFlightFor(key)
      try {
        const qs = sc ? `?scope=${sc}` : ''
        const data = await apiFetch<PlanResponse>(`/api/intensives/${encodeURIComponent(id)}/plan${qs}`)
        if (seq !== seqRef.current || keyRef.current !== key) return
        if (data.intensive?.id !== id) return
        // Храним только наборы текущего интенсива; после изменения — только эту вкладку (соседняя устарела)
        const kept: Record<string, PlanEntry> = {}
        for (const [k, v] of Object.entries(entriesRef.current)) {
          if (k !== key && keyIntensive(k) === id && !opts?.invalidateOthers) kept[k] = v
        }
        kept[key] = { data, error: null }
        commitEntries(kept)
        setTotals((prev) => (prev[key] === data.progress.total ? prev : { ...prev, [key]: data.progress.total }))
      } catch (e) {
        if (seq !== seqRef.current || keyRef.current !== key) return
        const message = errorText(e)
        const prev = entriesRef.current[key]
        if (prev?.data) {
          // Обновление не удалось — прежние данные этой вкладки остаются на экране
          toast.error('Не удалось обновить план', { description: `${message} Показаны прежние данные.` })
          return
        }
        commitEntries({ ...entriesRef.current, [key]: { data: null, error: message } })
      } finally {
        if (seq === seqRef.current) setInFlightFor(null)
      }
    },
    [commitEntries],
  )

  useEffect(() => {
    keyRef.current = activeKey
    paramsRef.current = activeKey && intensiveId ? { id: intensiveId, scope } : null
    if (!activeKey || !intensiveId) {
      seqRef.current += 1
      return
    }
    const t = setTimeout(() => void load(intensiveId, scope), 0)
    return () => clearTimeout(t)
  }, [activeKey, intensiveId, scope, load])

  // Lead_SUP: число пунктов соседней вкладки — один лёгкий запрос на интенсив (без N+1, без загрузки текстов)
  const otherScope: TemplateScope | null = scope === 'SUP' ? 'ADM' : scope === 'ADM' ? 'SUP' : null
  const otherKey = enabled && prefetchOtherScope && intensiveId && otherScope ? planKey(intensiveId, otherScope) : null
  const otherKnown = !!otherKey && otherKey in totals
  useEffect(() => {
    if (!otherKey || otherKnown || !intensiveId || !otherScope || prefetchedRef.current.has(otherKey)) return
    // Ответ применяется по своему ключу даже после смены вкладки — так число не теряется
    const t = setTimeout(() => {
      prefetchedRef.current.add(otherKey)
      apiFetch<{ intensive: IntensiveSummary }>(`/api/intensives/${encodeURIComponent(intensiveId)}?scope=${otherScope}`)
        .then((res) => {
          const total = res.intensive?.progress?.total
          if (typeof total !== 'number') return
          setTotals((prev) => (otherKey in prev ? prev : { ...prev, [otherKey]: total }))
        })
        .catch(() => {
          // Число на вкладке необязательно — без него вкладка работает так же
          prefetchedRef.current.delete(otherKey)
        })
    }, 0)
    return () => clearTimeout(t)
  }, [otherKey, otherKnown, intensiveId, otherScope])

  const current = activeKey ? entries[activeKey] : undefined
  const reload = useCallback(async () => {
    const p = paramsRef.current
    if (p) await load(p.id, p.scope, { invalidateOthers: true })
  }, [load])

  const scopeTotals = useMemo(() => {
    const out: Partial<Record<TemplateScope, number>> = {}
    if (!intensiveId) return out
    for (const s of TEMPLATE_SCOPES) {
      const n = totals[planKey(intensiveId, s)]
      if (typeof n === 'number') out[s] = n
    }
    return out
  }, [totals, intensiveId])

  const itemTitles = useMemo(() => {
    const out: Record<string, string> = {}
    if (!intensiveId) return out
    for (const [k, v] of Object.entries(entries)) {
      if (keyIntensive(k) !== intensiveId || !v.data) continue
      for (const i of v.data.items) out[i.id] = i.title || '(без названия)'
    }
    return out
  }, [entries, intensiveId])

  const waitingRole = !!intensiveId && !enabled
  return {
    intensiveId,
    scope,
    data: current?.data ?? null,
    loading: waitingRole || (!!activeKey && !current?.data && !current?.error),
    refreshing: !!activeKey && inFlightFor === activeKey && !!current?.data,
    busy: !!activeKey && inFlightFor === activeKey,
    error: current && !current.data ? current.error : null,
    scopeTotals,
    itemTitles,
    reload,
  }
}
