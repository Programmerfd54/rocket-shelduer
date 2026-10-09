'use client'

/**
 * «Каналы» (Lead_SUP): словарь каналов шаблонов — список, поиск, добавление, удаление неиспользуемых.
 * Удаление используемого канала → 409 CHANNEL_IN_USE { usage } — показываем, где он используется.
 */
import { useState } from 'react'
import { AlertCircle, Hash, RefreshCw, Search, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import {
  NewChannelForm,
  channelDisplay,
  channelErrorText,
  removeTemplateChannel,
  useTemplateChannels,
} from '@/components/common/ChannelSelect'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import type { TemplateChannelDto, TemplateChannelUsage } from '@/lib/templates/types'

function usageText(u: TemplateChannelUsage): string {
  const parts: string[] = []
  if (u.officialTemplates) parts.push(`официальные шаблоны — ${u.officialTemplates}`)
  if (u.overrides) parts.push(`изменения встроенных шаблонов — ${u.overrides}`)
  if (u.userTemplates) parts.push(`личные шаблоны — ${u.userTemplates}`)
  if (u.planItems) parts.push(`пункты планов интенсивов — ${u.planItems}`)
  // customTemplates входят в officialTemplates (созданные шаблоны не скрываются), отдельно не показываем
  return parts.length > 0 ? parts.join(', ') : `шаблоны — ${u.customTemplates}`
}

export function ChannelsManagerDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { status, channels, error, reload } = useTemplateChannels()
  const [query, setQuery] = useState('')
  const [formKey, setFormKey] = useState(0)
  const [confirm, setConfirm] = useState<TemplateChannelDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [inUse, setInUse] = useState<Record<string, TemplateChannelUsage>>({})

  const q = query.trim().replace(/^#+/, '').toLowerCase()
  const list = q ? channels.filter((c) => c.name.includes(q) || (c.label ?? '').toLowerCase().includes(q)) : channels

  const doDelete = async () => {
    if (!confirm || deleting) return
    const ch = confirm
    setDeleting(true)
    try {
      await apiFetch(`/api/template-channels/${encodeURIComponent(ch.id)}`, { method: 'DELETE' })
      removeTemplateChannel(ch.id)
      toast.success(`Канал #${ch.name} удалён из списка`)
      setConfirm(null)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'CHANNEL_IN_USE' && e.body.usage) {
        setInUse((m) => ({ ...m, [ch.id]: e.body.usage as TemplateChannelUsage }))
        toast.error(`Канал #${ch.name} используется`, { description: 'Сначала замените его в шаблонах и пунктах планов.' })
        setConfirm(null)
      } else if (e instanceof ApiError && e.code === 'CHANNEL_NOT_FOUND') {
        removeTemplateChannel(ch.id)
        toast.info(`Канала #${ch.name} уже нет в списке`)
        setConfirm(null)
      } else {
        toast.error('Не удалось удалить канал', { description: channelErrorText(e) })
      }
    } finally {
      setDeleting(false)
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="flex max-h-[88vh] flex-col gap-4 sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Каналы</DialogTitle>
            <DialogDescription>
              Общий список каналов для шаблонов и пунктов планов. Новый канал сразу появляется в выборе везде. Сами чаты в
              Rocket.Chat не создаются и не удаляются.
            </DialogDescription>
          </DialogHeader>

          <div className="rounded-lg border p-3">
            <NewChannelForm
              key={formKey}
              autoFocus={false}
              onDone={(ch, created) => {
                toast.success(created ? `Канал #${ch.name} добавлен` : `Канал #${ch.name} уже есть в списке`)
                setFormKey((k) => k + 1)
              }}
            />
          </div>

          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти канал"
              aria-label="Поиск канала"
              className="pl-9"
            />
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto">
            {status === 'loading' || status === 'idle' ? (
              <div className="space-y-2" role="status" aria-busy="true" aria-label="Загрузка каналов">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-10 w-full" />
                ))}
              </div>
            ) : status === 'error' ? (
              <div role="alert" className="flex flex-col gap-3 rounded-lg border p-4 sm:flex-row sm:items-center">
                <p className="flex min-w-0 flex-1 items-start gap-2 text-[13px]">
                  <AlertCircle className="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden />
                  <span>Не удалось загрузить каналы. {error}</span>
                </p>
                <Button variant="outline" size="sm" onClick={() => void reload()}>
                  <RefreshCw aria-hidden />
                  Повторить
                </Button>
              </div>
            ) : list.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">
                {channels.length === 0 ? 'Список каналов пуст.' : 'Ничего не найдено.'}
              </p>
            ) : (
              <ul className="divide-y rounded-lg border" aria-label="Каналы">
                {list.map((c) => (
                  <li key={c.id} className="px-3 py-1.5">
                    <div className="flex min-h-9 items-center gap-2">
                      <Hash className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                      <span className="min-w-0 flex-1 truncate font-mono text-sm">{channelDisplay(c).replace(/^#/, '')}</span>
                      {c.label && <span className="shrink-0 font-mono text-xs text-muted-foreground">#{c.name}</span>}
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        aria-label={`Удалить канал #${c.name} из списка`}
                        title="Удалить из списка"
                        onClick={() => setConfirm(c)}
                      >
                        <Trash2 aria-hidden />
                      </Button>
                    </div>
                    {inUse[c.id] && (
                      <p className="pb-1 pl-6 text-xs text-muted-foreground" role="note">
                        Нельзя удалить — используется: {usageText(inUse[c.id])}.
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>
      <ConfirmDialog
        open={!!confirm}
        onOpenChange={(o) => !o && setConfirm(null)}
        title={confirm ? `Удалить канал #${confirm.name} из списка?` : 'Удалить канал?'}
        description="Канал исчезнет из выбора в шаблонах и пунктах планов. Если он где-то используется, удалить его не получится — мы покажем где. Сам чат в Rocket.Chat не затрагивается."
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={doDelete}
      />
    </>
  )
}
