'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { DatePicker } from '@/components/ui/date-picker'
import { TimePicker } from '@/components/ui/time-picker'
import { Field } from '@/components/ui/field'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { formatLocalDate } from '@/lib/utils'
import type { ScheduleSource } from './lib'

type ScheduleChannel = { _id?: string; id?: string; name?: string; displayName?: string }

const channelId = (c: ScheduleChannel) => c._id || c.id || ''
const channelName = (c: ScheduleChannel) => (c.name || c.displayName || '').replace(/^#/, '')

/**
 * «Запланировать сообщение по шаблону»: выбор пространства/канала/даты/времени → переход на страницу пространства
 * с заполненной формой (sessionStorage 'schedule-from-template', как раньше).
 * Монтируется заново на каждый шаблон (key в родителе), поэтому начальное состояние — из source.
 */
export function ScheduleFromTemplateDialog({
  source,
  onClose,
}: {
  source: ScheduleSource
  onClose: () => void
}) {
  const router = useRouter()
  const [workspaces, setWorkspaces] = useState<{ id: string; workspaceName: string }[]>([])
  const [workspacesState, setWorkspacesState] = useState<'loading' | 'ready' | 'error'>('loading')
  const [reloadKey, setReloadKey] = useState(0)
  const [workspaceId, setWorkspaceId] = useState('')
  const [channels, setChannels] = useState<ScheduleChannel[]>([])
  const [channelsLoading, setChannelsLoading] = useState(false)
  const [selectedChannelId, setSelectedChannelId] = useState('')
  const [time, setTime] = useState(source.time || '09:00')
  const [date, setDate] = useState(() => formatLocalDate(new Date()))

  useEffect(() => {
    let cancelled = false
    fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((d) => {
        if (cancelled) return
        setWorkspaces(d?.workspaces ?? [])
        setWorkspacesState('ready')
      })
      .catch(() => {
        if (cancelled) return
        setWorkspaces([])
        setWorkspacesState('error')
      })
    return () => {
      cancelled = true
    }
  }, [reloadKey])

  const selectWorkspace = (id: string) => {
    setWorkspaceId(id)
    setChannels([])
    setSelectedChannelId('')
    setChannelsLoading(true)
    fetch(`/api/workspace/${id}/channels`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((d) => {
        const chs: ScheduleChannel[] = d?.channels ?? []
        setChannels(chs)
        const name = source.channel.replace(/^#/, '')
        const preselect = chs.find((c) => channelName(c) === name)
        setSelectedChannelId(preselect ? channelId(preselect) : chs[0] ? channelId(chs[0]) : '')
      })
      .catch(() => {
        setChannels([])
        toast.error('Не удалось загрузить каналы', { description: 'Выберите пространство ещё раз.' })
      })
      .finally(() => setChannelsLoading(false))
  }

  const go = () => {
    if (!workspaceId || !selectedChannelId) {
      toast.error('Выберите пространство и канал')
      return
    }
    const ch = channels.find((c) => channelId(c) === selectedChannelId)
    try {
      sessionStorage.setItem(
        'schedule-from-template',
        JSON.stringify({
          workspaceId,
          channelId: selectedChannelId,
          channelName: ch?.name || ch?.displayName || source.channel,
          body: source.body,
          time,
          date: date || undefined,
          ...(source.userTemplateId ? { userTemplateId: source.userTemplateId } : {}),
        }),
      )
    } catch {
      toast.error('Не удалось передать шаблон', { description: 'Разрешите сохранение данных сайта в браузере и повторите.' })
      return
    }
    onClose()
    router.push(`/dashboard/workspaces/${workspaceId}`)
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Запланировать сообщение по шаблону</DialogTitle>
          <DialogDescription>Откроется страница пространства с заполненным текстом, каналом, датой и временем.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <Field
            label="Пространство"
            htmlFor="schedule-workspace"
            required
            error={workspacesState === 'error' ? 'Не удалось загрузить пространства.' : undefined}
            hint={workspacesState === 'ready' && workspaces.length === 0 ? 'Нет доступных пространств.' : undefined}
          >
            <div className="flex gap-2">
              <Select value={workspaceId} onValueChange={selectWorkspace} disabled={workspacesState !== 'ready'}>
                <SelectTrigger id="schedule-workspace" className="w-full min-w-0" aria-invalid={workspacesState === 'error' || undefined}>
                  <SelectValue placeholder={workspacesState === 'loading' ? 'Загрузка…' : 'Выберите пространство'} />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.workspaceName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {workspacesState === 'error' && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setWorkspacesState('loading')
                    setReloadKey((k) => k + 1)
                  }}
                >
                  <RefreshCw aria-hidden />
                  Повторить
                </Button>
              )}
            </div>
          </Field>
          <Field label="Канал" htmlFor="schedule-channel" required>
            <Select value={selectedChannelId} onValueChange={setSelectedChannelId} disabled={!workspaceId || channelsLoading}>
              <SelectTrigger id="schedule-channel" className="w-full">
                <SelectValue placeholder={channelsLoading ? 'Загрузка…' : 'Выберите канал'} />
              </SelectTrigger>
              <SelectContent>
                {channels.map((c) => (
                  <SelectItem key={channelId(c)} value={channelId(c)}>
                    #{c.name || c.displayName || channelId(c)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Дата" htmlFor="schedule-date">
              <DatePicker id="schedule-date" value={date} onChange={setDate} clearable />
            </Field>
            <Field label="Время" htmlFor="schedule-time">
              <TimePicker id="schedule-time" value={time} onChange={setTime} />
            </Field>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Отмена
          </Button>
          <Button onClick={go} disabled={!workspaceId || !selectedChannelId || channelsLoading}>
            {channelsLoading && <Loader2 className="animate-spin" aria-hidden />}
            Перейти к созданию
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
