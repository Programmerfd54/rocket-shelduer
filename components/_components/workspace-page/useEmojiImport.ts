"use client"

import { useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'

export const DEFAULT_EMOJI_YAML_URL = 'https://raw.githubusercontent.com/Programmerfd54/emoji/refs/heads/main/emojis.yaml'

export type EmojiProgress = { current: number; total: number; uploaded: number; skipped: number; errorsCount: number }
export type EmojiResult = { uploaded: number; skipped: number; total: number; errors?: string[] }
export type EmojiLastStatus = EmojiResult & { date: string; errorsCount: number }

/** Проверка URL каталога: пусто / не URL / не http(s). Возвращает текст ошибки или ''. */
export function validateYamlUrl(value: string): string {
  const url = value.trim()
  if (!url) return 'Укажите ссылку на YAML-каталог.'
  try {
    const u = new URL(url)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return 'Ссылка должна начинаться с http:// или https://.'
  } catch {
    return 'Это не похоже на ссылку. Пример: https://example.com/emojis.yaml'
  }
  return ''
}

/** Состояние и действия массового импорта эмодзи (проверка каталога, потоковый импорт, отмена). */
export function useEmojiImport(workspaceId: string) {
  const [importing, setImporting] = useState(false)
  const [progress, setProgress] = useState<EmojiProgress | null>(null)
  const [interrupted, setInterrupted] = useState<EmojiProgress | null>(null)
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [result, setResult] = useState<EmojiResult | null>(null)
  const [lastStatus, setLastStatus] = useState<EmojiLastStatus | null>(null)
  const [yamlUrl, setYamlUrl] = useState(DEFAULT_EMOJI_YAML_URL)
  const [preview, setPreview] = useState<{ total: number; names: string[] } | null>(null)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)

  // Восстановление статуса последнего импорта и признака «прервано перезагрузкой»
  useEffect(() => {
    const savedImport = localStorage.getItem(`lastEmojiImport_${workspaceId}`)
    if (savedImport) {
      try {
        const parsed = JSON.parse(savedImport)
        if (parsed?.date) setLastStatus(parsed)
      } catch {}
    }
    const savedProgress = localStorage.getItem(`emojiImportProgress_${workspaceId}`)
    if (savedProgress) {
      try {
        const parsed = JSON.parse(savedProgress)
        if (parsed?.status === 'in_progress' && parsed?.total != null) {
          setInterrupted({
            current: parsed.current ?? 0,
            total: parsed.total,
            uploaded: parsed.uploaded ?? 0,
            skipped: parsed.skipped ?? 0,
            errorsCount: parsed.errorsCount ?? 0,
          })
        }
        localStorage.removeItem(`emojiImportProgress_${workspaceId}`)
      } catch {}
    }
  }, [workspaceId])

  const runPreview = async () => {
    const url = yamlUrl.trim()
    if (validateYamlUrl(url)) {
      toast.error('Проверьте ссылку на каталог', { description: validateYamlUrl(url) })
      return
    }
    setPreviewLoading(true)
    setPreview(null)
    const toastId = 'emoji-preview'
    toast.loading('Загружаем каталог…', { id: toastId })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/emoji-import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yamlUrl: url }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Не удалось загрузить каталог', {
          id: toastId,
          description: 'Проверьте, что ссылка открывается и ведёт на YAML-файл.',
        })
        return
      }
      setPreview({ total: data.total ?? 0, names: data.names ?? [] })
      toast.success(`В каталоге ${data.total ?? 0} эмодзи`, { id: toastId })
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка проверки каталога', { id: toastId, description: 'Проверьте сеть и повторите.' })
    } finally {
      setPreviewLoading(false)
    }
  }

  const runImport = async () => {
    setConfirmOpen(false)
    const username = adminUsername.trim()
    const password = adminPassword
    const url = yamlUrl.trim()
    setImporting(true)
    setResult(null)
    setProgress(null)
    setInterrupted(null)
    abortRef.current = new AbortController()
    const progressKey = `emojiImportProgress_${workspaceId}`
    const toastId = 'emoji-import'
    toast.loading('Запускаем импорт эмодзи…', { id: toastId })
    const saveProgress = (p: EmojiProgress) => {
      localStorage.setItem(progressKey, JSON.stringify({ status: 'in_progress', ...p }))
    }
    const finish = (r: EmojiResult) => {
      setResult(r)
      const status: EmojiLastStatus = {
        date: new Date().toISOString(),
        uploaded: r.uploaded,
        skipped: r.skipped,
        total: r.total,
        errorsCount: r.errors?.length ?? 0,
        errors: r.errors,
      }
      setLastStatus(status)
      localStorage.setItem(`lastEmojiImport_${workspaceId}`, JSON.stringify(status))
      toast.success(`Импорт завершён: загружено ${r.uploaded}, пропущено (уже есть) ${r.skipped}`, { id: toastId })
    }
    let settled = false
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/emoji-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yamlUrl: url, adminUsername: username, adminPassword: password }),
        signal: abortRef.current.signal,
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/x-ndjson')) {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Ошибка импорта эмодзи', {
            id: toastId,
            description: res.status === 401 ? 'Проверьте логин и пароль администратора для этого сервера.' : undefined,
          })
          settled = true
          localStorage.removeItem(progressKey)
          return
        }
      }
      if (!res.body) {
        toast.error('Нет ответа от сервера', { id: toastId, description: 'Повторите попытку через минуту.' })
        settled = true
        localStorage.removeItem(progressKey)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const handle = (msg: any) => {
        if (msg.t === 'start') {
          const p = { current: 0, total: msg.total || 0, uploaded: 0, skipped: 0, errorsCount: 0 }
          setProgress(p)
          saveProgress(p)
        } else if (msg.t === 'progress') {
          const p = {
            current: msg.current ?? 0,
            total: msg.total ?? 0,
            uploaded: msg.uploaded ?? 0,
            skipped: msg.skipped ?? 0,
            errorsCount: msg.errorsCount ?? 0,
          }
          setProgress(p)
          saveProgress(p)
        } else if (msg.t === 'done') {
          settled = true
          finish({ uploaded: msg.uploaded ?? 0, skipped: msg.skipped ?? 0, total: msg.total ?? 0, errors: msg.errors })
        } else if (msg.t === 'error') {
          settled = true
          toast.error(msg.error || 'Импорт прерван', { id: toastId })
        }
      }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handle(JSON.parse(line))
          } catch {}
        }
      }
      if (buffer.trim()) {
        try {
          handle(JSON.parse(buffer))
        } catch {}
      }
      if (!settled) {
        settled = true
        toast.warning('Соединение прервано до завершения импорта', {
          id: toastId,
          description: 'Запустите импорт снова — уже загруженные эмодзи будут пропущены.',
        })
      }
    } catch (e: any) {
      settled = true
      if (e?.name === 'AbortError') toast.info('Импорт отменён', { id: toastId })
      else toast.error(e?.message || 'Ошибка импорта эмодзи', { id: toastId, description: 'Проверьте сеть и повторите.' })
    } finally {
      if (!settled) toast.dismiss(toastId)
      setImporting(false)
      setProgress(null)
      abortRef.current = null
      localStorage.removeItem(progressKey)
    }
  }

  return {
    importing,
    progress,
    interrupted,
    dismissInterrupted: () => setInterrupted(null),
    adminUsername,
    setAdminUsername,
    adminPassword,
    setAdminPassword,
    result,
    lastStatus,
    yamlUrl,
    setYamlUrl,
    preview,
    previewLoading,
    runPreview,
    confirmOpen,
    setConfirmOpen,
    runImport,
    cancelImport: () => abortRef.current?.abort(),
  }
}

export type EmojiImportState = ReturnType<typeof useEmojiImport>
