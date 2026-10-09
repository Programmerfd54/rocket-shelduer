'use client'

import { useEffect, useState } from 'react'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { apiFetch } from '@/lib/intensives/ui'
import { errText, type TemplateVersion, type UserTemplate } from './lib'

/** «История версий» своего шаблона с откатом. Монтируется на конкретный шаблон (key в родителе). */
export function TemplateVersionsDialog({
  template,
  onClose,
  onReverted,
}: {
  template: UserTemplate
  onClose: () => void
  onReverted: () => void | Promise<void>
}) {
  const [versions, setVersions] = useState<TemplateVersion[]>([])
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [revertingId, setRevertingId] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    apiFetch<{ versions?: TemplateVersion[] }>(`/api/templates/mine/${encodeURIComponent(template.id)}/versions`)
      .then((d) => {
        if (cancelled) return
        setVersions(d.versions ?? [])
        setState('ready')
      })
      .catch(() => {
        if (!cancelled) setState('error')
      })
    return () => {
      cancelled = true
    }
  }, [template.id, reloadKey])

  const revert = async (versionId: string) => {
    if (revertingId) return
    setRevertingId(versionId)
    try {
      await apiFetch(`/api/templates/mine/${encodeURIComponent(template.id)}/revert`, { method: 'POST', json: { versionId } })
      toast.success('Шаблон откатан к выбранной версии')
      onClose()
      await onReverted()
    } catch (e) {
      toast.error('Не удалось откатить шаблон', { description: errText(e) })
    } finally {
      setRevertingId(null)
    }
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !revertingId && onClose()}>
      <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>История версий</DialogTitle>
          <DialogDescription>
            {template.title ? `Шаблон «${template.title}». Выберите версию, чтобы вернуть её.` : 'Выберите версию, чтобы вернуть её.'}
          </DialogDescription>
        </DialogHeader>
        {state === 'loading' ? (
          <div className="space-y-3" role="status" aria-busy="true" aria-label="Загрузка">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="space-y-2">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-12 w-full" />
              </div>
            ))}
          </div>
        ) : state === 'error' ? (
          <div role="alert" className="space-y-3 py-2 text-center">
            <p className="text-sm text-muted-foreground">Не удалось загрузить историю версий.</p>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setState('loading')
                setReloadKey((k) => k + 1)
              }}
            >
              <RefreshCw aria-hidden />
              Повторить
            </Button>
          </div>
        ) : versions.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">Нет сохранённых версий.</p>
        ) : (
          <ul className="divide-y rounded-lg border">
            {versions.map((v) => (
              <li key={v.id} className="space-y-1.5 p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="text-[13px] text-muted-foreground">{new Date(v.createdAt).toLocaleString('ru-RU')}</p>
                    <p className="truncate font-medium">
                      {v.title || 'Без названия'}
                      <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">
                        #{v.channel} · {v.time}
                      </span>
                    </p>
                  </div>
                  <Button variant="outline" size="sm" className="shrink-0" disabled={!!revertingId} onClick={() => void revert(v.id)}>
                    {revertingId === v.id && <Loader2 className="animate-spin" aria-hidden />}
                    Откатить
                  </Button>
                </div>
                <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-sans text-xs [word-break:break-word]">
                  {v.body.slice(0, 200)}
                  {v.body.length > 200 ? '…' : ''}
                </pre>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
