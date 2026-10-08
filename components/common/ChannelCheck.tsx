"use client"

import { useCallback, useEffect, useRef, useState } from 'react'
import { CheckCircle2, CircleAlert, HelpCircle, Loader2, RefreshCw } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { cn } from '@/lib/utils'

export type ChannelCheckStatus = 'idle' | 'checking' | 'found' | 'not_found' | 'unknown'

type WorkspaceOption = { id: string; workspaceName: string }

const STORAGE_KEY = 'channelCheckWorkspaceId'

function readStored(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}
function writeStored(v: string) {
  try {
    localStorage.setItem(STORAGE_KEY, v)
  } catch {
    /* localStorage может быть недоступен */
  }
}

/**
 * Проверка канала в Rocket.Chat: пользователь выбирает пространство, мы спрашиваем у RC,
 * существует ли канал, и показываем понятный статус («чат есть, всё хорошо, можно сохранять»).
 * Компонент ничего не блокирует — статус наружу отдаётся через onStatusChange.
 */
export function ChannelCheck({
  channel,
  workspaceId,
  onStatusChange,
  className,
}: {
  channel: string
  /** Если задан — пространство фиксировано (например, проверяем в том, где открыта страница) */
  workspaceId?: string
  onStatusChange?: (status: ChannelCheckStatus) => void
  className?: string
}) {
  const [workspaces, setWorkspaces] = useState<WorkspaceOption[]>([])
  const [wsId, setWsId] = useState<string | undefined>(workspaceId)
  const [status, setStatus] = useState<ChannelCheckStatus>('idle')
  const [detail, setDetail] = useState<{ kind?: 'public' | 'private'; message?: string } | null>(null)
  const requestSeq = useRef(0)

  const name = channel.trim().replace(/^#/, '').replace(/\s+/g, '_')

  // Список пространств (если пространство не зафиксировано)
  useEffect(() => {
    if (workspaceId) {
      setWsId(workspaceId)
      return
    }
    let cancelled = false
    fetch('/api/workspace')
      .then((r) => (r.ok ? r.json() : { workspaces: [] }))
      .then((d) => {
        if (cancelled) return
        const list: WorkspaceOption[] = (d.workspaces ?? []).map((w: any) => ({ id: w.id, workspaceName: w.workspaceName }))
        setWorkspaces(list)
        const stored = readStored()
        setWsId((cur) => cur ?? (list.find((w) => w.id === stored)?.id ?? list[0]?.id))
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const update = useCallback(
    (s: ChannelCheckStatus) => {
      setStatus(s)
      onStatusChange?.(s)
    },
    [onStatusChange],
  )

  const run = useCallback(async () => {
    if (!wsId || !name) {
      update('idle')
      setDetail(null)
      return
    }
    const seq = ++requestSeq.current
    update('checking')
    try {
      const res = await fetch(`/api/workspace/${wsId}/channels/check?name=${encodeURIComponent(name)}`, {
        headers: { 'X-Error-Handling': 'local' },
      })
      const data = await res.json().catch(() => ({}))
      if (seq !== requestSeq.current) return
      if (!res.ok) {
        setDetail({ message: data.error || 'Не удалось проверить канал' })
        update('unknown')
        return
      }
      setDetail({ kind: data.kind, message: data.message })
      update(data.status === 'found' ? 'found' : data.status === 'not_found' ? 'not_found' : 'unknown')
    } catch {
      if (seq !== requestSeq.current) return
      setDetail({ message: 'Нет связи с сервером' })
      update('unknown')
    }
  }, [wsId, name, update])

  // Дебаунс: проверяем через 600 мс после последнего ввода
  useEffect(() => {
    if (!name || !wsId) {
      requestSeq.current++
      update('idle')
      setDetail(null)
      return
    }
    const t = setTimeout(() => void run(), 600)
    return () => clearTimeout(t)
  }, [name, wsId, run, update])

  const wsName = workspaces.find((w) => w.id === wsId)?.workspaceName

  if (!name) return null

  return (
    <div className={cn('space-y-1.5', className)} aria-live="polite">
      <div
        className={cn(
          'flex items-start gap-2 rounded-md border px-3 py-2 text-[13px]',
          status === 'found' && 'border-emerald-500/30 bg-emerald-500/5 text-emerald-800 dark:text-emerald-300',
          status === 'not_found' && 'border-amber-500/40 bg-amber-500/5 text-amber-900 dark:text-amber-300',
          (status === 'unknown' || status === 'checking' || status === 'idle') && 'text-muted-foreground',
        )}
      >
        {status === 'checking' && <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" aria-hidden />}
        {status === 'found' && <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
        {status === 'not_found' && <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
        {(status === 'unknown' || status === 'idle') && <HelpCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
        <div className="min-w-0 flex-1">
          {status === 'checking' && <p>Проверяем #{name}…</p>}
          {status === 'found' && (
            <p>
              Чат <b>#{name}</b> есть{wsName ? <> в «{wsName}»</> : null}
              {detail?.kind === 'private' ? ' (приватный)' : ''}. Всё хорошо — можно сохранять.
            </p>
          )}
          {status === 'not_found' && (
            <p>
              Чата <b>#{name}</b> {wsName ? <>в «{wsName}» </> : null}нет. Проверьте написание — сохранить можно, но сообщение в этот канал не уйдёт, пока он не появится.
            </p>
          )}
          {status === 'unknown' && (
            <p>{detail?.message ? `Не удалось проверить: ${detail.message}` : 'Не удалось проверить канал.'}</p>
          )}
          {status === 'idle' && !wsId && <p>Подключите пространство, чтобы проверять каналы.</p>}
        </div>
        {status !== 'checking' && wsId && (
          <Button type="button" variant="ghost" size="icon-xs" onClick={() => void run()} aria-label="Проверить ещё раз">
            <RefreshCw aria-hidden />
          </Button>
        )}
      </div>
      {!workspaceId && workspaces.length > 1 && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="shrink-0">Проверять в пространстве:</span>
          <Select
            value={wsId}
            onValueChange={(v) => {
              setWsId(v)
              writeStored(v)
            }}
          >
            <SelectTrigger size="sm" className="h-7 max-w-[240px] text-xs" aria-label="Пространство для проверки">
              <SelectValue placeholder="Выберите" />
            </SelectTrigger>
            <SelectContent>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>
                  {w.workspaceName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  )
}
