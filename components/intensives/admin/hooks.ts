'use client'

import { useCallback, useState } from 'react'
import { apiFetch } from '@/lib/intensives/ui'
import type { OrgSpaceDto, OrgSpaceSuggestionGroup } from '@/lib/intensives/types'
import { errText, useDeferredEffect, useSeq } from './kit'

/** Список OrgSpace (Lead_SUP — все). Данные остаются при повторной загрузке; ошибка не затирает старые данные. */
export function useOrgSpaces() {
  const [data, setData] = useState<OrgSpaceDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useSeq()

  const reload = useCallback(async () => {
    const token = seq.begin()
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ orgSpaces: OrgSpaceDto[] }>('/api/org-spaces')
      if (!seq.isCurrent(token)) return
      setData(res.orgSpaces)
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setLoading(false)
    }
  }, [seq])

  useDeferredEffect(() => {
    void reload()
  }, [reload])

  return { orgSpaces: data, error, loading, reload }
}

/** Подсказки: подключения (все, без секретов), сгруппированные по одному серверу Rocket.Chat. */
export function useSuggestions() {
  const [groups, setGroups] = useState<OrgSpaceSuggestionGroup[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useSeq()

  const reload = useCallback(async () => {
    const token = seq.begin()
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ groups: OrgSpaceSuggestionGroup[] }>('/api/org-spaces/suggestions')
      if (!seq.isCurrent(token)) return
      setGroups(res.groups)
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setLoading(false)
    }
  }, [seq])

  useDeferredEffect(() => {
    void reload()
  }, [reload])

  return { groups, error, loading, reload }
}

export type WorkspaceTarget = { id: string; name: string; orgSpaceId: string | null }

/**
 * Пространства (подключения) вызывающего — свои и назначенные (GET /api/workspace), без архивных.
 * Интенсив создаётся в пространстве; организационное пространство сервер подбирает сам.
 */
export function useWorkspaceTargets() {
  const [data, setData] = useState<WorkspaceTarget[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const seq = useSeq()

  const reload = useCallback(async () => {
    const token = seq.begin()
    setLoading(true)
    setError(null)
    try {
      const res = await apiFetch<{ workspaces?: { id: string; workspaceName: string; orgSpaceId?: string | null }[] }>('/api/workspace')
      if (!seq.isCurrent(token)) return
      setData(
        (res.workspaces ?? [])
          .map((w) => ({ id: w.id, name: w.workspaceName, orgSpaceId: w.orgSpaceId ?? null }))
          .sort((a, b) => a.name.localeCompare(b.name, 'ru')),
      )
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    } finally {
      if (seq.isCurrent(token)) setLoading(false)
    }
  }, [seq])

  useDeferredEffect(() => {
    void reload()
  }, [reload])

  return { workspaces: data, error, loading, reload }
}
