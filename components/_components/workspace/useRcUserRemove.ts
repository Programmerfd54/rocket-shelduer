"use client"

import { useCallback, useRef, useState } from 'react'
import { rcAdminCredentialsPayload, type RcAdminCredentials } from '@/lib/rc-admin-credentials'
import { REMOVE_CONFIRM_WORD, type UserRemoveMode, type UserRemoveResult } from '@/lib/workspace-user-remove'

export type RemoveTargets = { ids?: string[]; usernames?: string[] }
export type RemoveProgress = { current: number; total: number; removed: number; skipped: number; errors: number }
export type RemoveOutcome = { mode: UserRemoveMode; results: UserRemoveResult[] }

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError'

/** Запуск массового удаления / деактивации с чтением потока NDJSON (/users/remove). */
export function useRcUserRemove(workspaceId: string, credentials: RcAdminCredentials) {
  const [running, setRunning] = useState(false)
  const [progress, setProgress] = useState<RemoveProgress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const cancel = useCallback(() => abortRef.current?.abort(), [])

  /** Бросает Error с понятным текстом; при остановке пользователем возвращает частичный результат с partial=true. */
  const run = useCallback(async (mode: UserRemoveMode, targets: RemoveTargets): Promise<RemoveOutcome & { partial: boolean }> => {
    setRunning(true)
    setProgress(null)
    const controller = new AbortController()
    abortRef.current = controller
    const results: UserRemoveResult[] = []
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/remove`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Error-Handling': 'local' },
        body: JSON.stringify({
          ...rcAdminCredentialsPayload(credentials),
          mode,
          ...targets,
          ...(mode === 'delete' ? { confirm: REMOVE_CONFIRM_WORD } : {}),
        }),
        signal: controller.signal,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error([data.error || 'Не удалось выполнить операцию', data.details].filter(Boolean).join(' '))
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let completed = false
      let streamError: string | null = null
      let finalResults: UserRemoveResult[] | null = null
      const handle = (line: string) => {
        if (!line.trim()) return
        try {
          const obj = JSON.parse(line)
          if (obj.t === 'progress') {
            setProgress({ current: obj.current ?? 0, total: obj.total ?? 0, removed: obj.removed ?? 0, skipped: obj.skipped ?? 0, errors: obj.errors ?? 0 })
          } else if (obj.t === 'result') {
            results.push({ username: obj.username, status: obj.status, reason: obj.reason })
          } else if (obj.t === 'done') {
            completed = true
            finalResults = obj.results ?? null
          } else if (obj.t === 'error') {
            streamError = obj.error || 'Операция прервана'
          }
        } catch { /* игнорируем битую строку */ }
      }
      try {
        while (reader) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() ?? ''
          lines.forEach(handle)
        }
        handle(buffer)
      } catch (error) {
        if (!isAbort(error)) throw error
        return { mode, results, partial: true }
      }
      if (streamError) throw new Error(streamError)
      if (!completed) throw new Error('Соединение прервано. Обновите список и проверьте, кто уже обработан.')
      return { mode, results: finalResults ?? results, partial: false }
    } catch (error) {
      if (isAbort(error)) return { mode, results, partial: true }
      throw error
    } finally {
      setRunning(false)
      abortRef.current = null
    }
  }, [workspaceId, credentials])

  return { run, cancel, running, progress }
}
