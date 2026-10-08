"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
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

/* ───────────── План выбранного интенсива ───────────── */

export interface IntensivePlanState {
  /** Для какого интенсива запрошен план */
  intensiveId: string | null
  /** Данные строго для intensiveId (поздний ответ другого интенсива сюда не попадёт) */
  data: PlanResponse | null
  /** Первая загрузка для этого интенсива — данных ещё нет (действия недоступны) */
  loading: boolean
  /** Идёт обновление при уже показанных данных */
  refreshing: boolean
  /** Есть запрос в работе (в т.ч. повтор после ошибки) */
  busy: boolean
  /** Ошибка первой загрузки (≠ «план пуст») */
  error: string | null
  reload: () => Promise<void>
}

type PlanStore = { id: string; data: PlanResponse | null; error: string | null }

/**
 * Загрузка плана с защитой от гонок: каждый запрос получает номер; ответ применяется, только если
 * он последний и относится к текущему интенсиву. Обновление оставляет старые данные видимыми.
 */
export function useIntensivePlan(intensiveId: string | null): IntensivePlanState {
  const [store, setStore] = useState<PlanStore | null>(null)
  const [inFlightFor, setInFlightFor] = useState<string | null>(null)
  const seqRef = useRef(0)
  const idRef = useRef<string | null>(intensiveId)
  const storeRef = useRef<PlanStore | null>(null)

  const load = useCallback(async (id: string) => {
    const seq = ++seqRef.current
    setInFlightFor(id)
    try {
      const data = await apiFetch<PlanResponse>(`/api/intensives/${encodeURIComponent(id)}/plan`)
      if (seq !== seqRef.current || idRef.current !== id) return
      storeRef.current = { id, data, error: null }
      setStore(storeRef.current)
    } catch (e) {
      if (seq !== seqRef.current || idRef.current !== id) return
      const message = errorText(e)
      const prev = storeRef.current
      if (prev && prev.id === id && prev.data) {
        // Обновление не удалось — прежние данные остаются на экране
        toast.error('Не удалось обновить план', { description: `${message} Показаны прежние данные.` })
        return
      }
      storeRef.current = { id, data: null, error: message }
      setStore(storeRef.current)
    } finally {
      if (seq === seqRef.current) setInFlightFor(null)
    }
  }, [])

  useEffect(() => {
    idRef.current = intensiveId
    if (!intensiveId) {
      seqRef.current += 1
      return
    }
    const t = setTimeout(() => void load(intensiveId), 0)
    return () => clearTimeout(t)
  }, [intensiveId, load])

  const current = intensiveId && store?.id === intensiveId ? store : null
  const reload = useCallback(async () => {
    const id = idRef.current
    if (id) await load(id)
  }, [load])

  return {
    intensiveId,
    data: current?.data ?? null,
    loading: !!intensiveId && !current?.data && !current?.error,
    refreshing: !!intensiveId && inFlightFor === intensiveId && !!current?.data,
    busy: !!intensiveId && inFlightFor === intensiveId,
    error: current && !current.data ? current.error : null,
    reload,
  }
}
