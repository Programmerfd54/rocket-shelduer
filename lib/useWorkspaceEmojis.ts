"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import type { CustomEmojiLike } from '@/lib/emoji-data'

export interface WorkspaceEmoji extends CustomEmojiLike {
  _updatedAt?: string
}

interface CacheEntry {
  emojis: WorkspaceEmoji[]
  workspaceUrl: string
  at: number
}

/** Кэш на уровне модуля: повторное открытие диалога показывает эмодзи сразу, а обновляет их в фоне. */
const cache = new Map<string, CacheEntry>()
const FRESH_MS = 60_000

/** Сбросить кэш эмодзи (при выходе из аккаунта: данные пространств не должны достаться следующему пользователю в этой вкладке). */
export function clearWorkspaceEmojisCache(): void {
  cache.clear()
}

export interface UseWorkspaceEmojisResult {
  emojis: WorkspaceEmoji[]
  workspaceUrl: string
  loading: boolean
  /** Текст ошибки загрузки; null — загрузка успешна (список может быть пустым — эмодзи в пространстве нет). */
  error: string | null
  reload: () => void
}

/**
 * Загрузка кастомных эмодзи воркспейса.
 * Различает «пусто» (error === null, emojis = []) и «не удалось загрузить» (error !== null).
 * Нет таймаута, который обнуляет список, пока запрос ещё идёт.
 */
export function useWorkspaceEmojis(
  workspaceId: string | undefined,
  enabled: boolean
): UseWorkspaceEmojisResult {
  const cached = workspaceId ? cache.get(workspaceId) : undefined
  const [emojis, setEmojis] = useState<WorkspaceEmoji[]>(cached?.emojis ?? [])
  const [workspaceUrl, setWorkspaceUrl] = useState(cached?.workspaceUrl ?? '')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)
  const forceRef = useRef(false)

  const reload = useCallback(() => {
    forceRef.current = true
    setReloadKey((k) => k + 1)
  }, [])

  useEffect(() => {
    if (!enabled || !workspaceId) {
      setLoading(false)
      return
    }
    const entry = cache.get(workspaceId)
    if (entry) {
      setEmojis(entry.emojis)
      setWorkspaceUrl(entry.workspaceUrl)
    } else {
      setEmojis([])
      setWorkspaceUrl('')
    }
    const force = forceRef.current
    forceRef.current = false
    if (entry && !force && Date.now() - entry.at < FRESH_MS) {
      setError(null)
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)
    setError(null)
    ;(async () => {
      try {
        const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}/emojis`, {
          signal: controller.signal,
          cache: force ? 'reload' : 'default',
        })
        const data = await res.json().catch(() => ({}))
        if (controller.signal.aborted) return
        if (!res.ok || data?.error) {
          const msg =
            data?.code === 'RC_NOT_CONNECTED'
              ? 'Нет подключения к Rocket.Chat'
              : typeof data?.error === 'string' && data.error
                ? data.error
                : `Ошибка ${res.status}`
          setError(msg)
          if (data?.workspaceUrl) setWorkspaceUrl(data.workspaceUrl)
          return
        }
        const list: WorkspaceEmoji[] = Array.isArray(data.emojis) ? data.emojis : []
        const url: string = data.workspaceUrl || ''
        cache.set(workspaceId, { emojis: list, workspaceUrl: url, at: Date.now() })
        setEmojis(list)
        setWorkspaceUrl(url)
      } catch (e) {
        if (controller.signal.aborted || (e instanceof DOMException && e.name === 'AbortError')) return
        setError('Не удалось связаться с сервером')
      } finally {
        if (!controller.signal.aborted) setLoading(false)
      }
    })()

    return () => controller.abort()
  }, [enabled, workspaceId, reloadKey])

  return { emojis, workspaceUrl, loading, error, reload }
}
