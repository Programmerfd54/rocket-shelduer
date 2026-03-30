"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as toast from '@/lib/toast'
import { Calendar, Clock, Eye, User, Hash, LayoutTemplate } from 'lucide-react'
import { cn } from '@/lib/utils'
import MessagePreview from './message-preview'
import MessageEditor from './message-editor'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'

interface MessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  channelId: string
  channelName: string
  editingMessage?: any
  onSuccess: () => void
  /** Подстановка из шаблона: текст, время, дата (YYYY-MM-DD) */
  initialMessage?: string
  initialTime?: string
  initialDate?: string
  /** Роль текущего пользователя — для SUP доступно «Отправить от имени» */
  currentUserRole?: string
  /** Связь с пользовательским шаблоном (статус «отправлено» в шаблонах) */
  sourceUserTemplateId?: string | null
  /** Сообщения пространства — чтобы в списке шаблонов показать статус в этом пространстве */
  workspaceMessages?: any[] | null
}

function normCh(name: string) {
  return name.replace(/^#/, '').trim().toLowerCase()
}

function parseTimeForInput(time: string): string | null {
  const m = time.trim().match(/^(\d{1,2}):(\d{2})$/)
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

type OfficialTpl = {
  id: string
  channel: string
  time: string
  body: string
  title?: string
  dayLabel?: string
  intensiveDay?: number
}

type MineTpl = {
  id: string
  channel: string
  time: string
  body: string
  title?: string | null
  intensiveDay?: number | null
}

function formatOfficialOptionLabel(t: OfficialTpl) {
  const day = t.intensiveDay != null ? `День ${t.intensiveDay}` : ''
  const head = [day, t.dayLabel].filter(Boolean).join(' · ')
  const title = (t.title || '').trim() || 'без названия'
  return head ? `${head} · ~${t.time} · ${title}` : `~${t.time} · ${title}`
}

function formatMineOptionLabel(t: MineTpl) {
  const day = t.intensiveDay != null ? `День ${t.intensiveDay}` : ''
  const title = (t.title || '').trim() || 'без названия'
  return day ? `${day} · ~${t.time} · ${title}` : `~${t.time} · ${title}`
}

/** Сообщения с sourceUserTemplateId или sourceOfficialTemplateId — один id на шаблон */
function buildTemplateIdStatusMap(messages: any[] | null | undefined) {
  const byId = new Map<string, Set<string>>()
  for (const m of messages || []) {
    const id = (m.sourceUserTemplateId || m.sourceOfficialTemplateId) as string | undefined
    if (!id) continue
    if (!byId.has(id)) byId.set(id, new Set())
    byId.get(id)!.add(m.status)
  }
  const out = new Map<string, 'SENT' | 'PENDING' | 'FAILED'>()
  for (const [id, statuses] of byId) {
    if (statuses.has('SENT')) out.set(id, 'SENT')
    else if (statuses.has('PENDING')) out.set(id, 'PENDING')
    else if (statuses.has('FAILED')) out.set(id, 'FAILED')
  }
  return out
}

function TemplateStatusBadge({
  status,
}: {
  status: 'SENT' | 'PENDING' | 'FAILED' | undefined
}) {
  if (status === 'SENT') {
    return (
      <Badge className="shrink-0 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200 border-emerald-500/30 font-normal">
        Отправлено
      </Badge>
    )
  }
  if (status === 'PENDING') {
    return (
      <Badge className="shrink-0 bg-sky-500/15 text-sky-900 dark:text-sky-100 border-sky-500/30 font-normal">
        Запланировано
      </Badge>
    )
  }
  if (status === 'FAILED') {
    return (
      <Badge variant="destructive" className="shrink-0 font-normal">
        Ошибка
      </Badge>
    )
  }
  return (
    <Badge variant="outline" className="shrink-0 text-muted-foreground font-normal border-dashed">
      Нет связи
    </Badge>
  )
}

function officialIdFromSelectValue(v: string): string | null {
  if (v.startsWith('official-sup:')) return v.slice('official-sup:'.length)
  if (v.startsWith('official-adm:')) return v.slice('official-adm:'.length)
  return null
}

export default function MessageDialog({
  open,
  onOpenChange,
  workspaceId,
  channelId,
  channelName,
  editingMessage,
  onSuccess,
  initialMessage,
  initialTime,
  initialDate,
  currentUserRole = 'USER',
  sourceUserTemplateId = null,
  workspaceMessages = null,
}: MessageDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workspace, setWorkspace] = useState<any>(null)
  const [emojis, setEmojis] = useState<any[]>([])
  const [workspaceUrl, setWorkspaceUrl] = useState<string>('')
  const [sendAsUserId, setSendAsUserId] = useState<string>('')
  const [usersForSendAs, setUsersForSendAs] = useState<{ id: string; name: string | null; email: string }[]>([])
  const [formData, setFormData] = useState({
    message: '',
    scheduledFor: '',
    scheduledDate: '',
    scheduledTime: '',
    channelId: '',
    channelName: '',
  })
  const [channels, setChannels] = useState<{ id: string; name: string; displayName?: string }[]>([])

  const [officialSup, setOfficialSup] = useState<OfficialTpl[]>([])
  const [officialAdm, setOfficialAdm] = useState<OfficialTpl[]>([])
  const [mineTemplates, setMineTemplates] = useState<MineTpl[]>([])
  const [templatesLoading, setTemplatesLoading] = useState(false)
  const [templatesRole, setTemplatesRole] = useState<string | null>(null)
  const [selectedTemplateValue, setSelectedTemplateValue] = useState('none')
  const prevChannelIdRef = useRef<string | null>(null)

  const templateIdStatusInWorkspace = useMemo(
    () => buildTemplateIdStatusMap(workspaceMessages ?? undefined),
    [workspaceMessages]
  )

  const [templatePickerTab, setTemplatePickerTab] = useState<'common' | 'mine'>('common')

  const filterByChannel = useCallback(
    (list: { channel: string }[]) => {
      const cn = normCh(channelName)
      return list.filter((t) => normCh(t.channel) === cn)
    },
    [channelName]
  )

  const filteredOfficialSup = useMemo(() => filterByChannel(officialSup), [filterByChannel, officialSup])
  const filteredOfficialAdm = useMemo(() => filterByChannel(officialAdm), [filterByChannel, officialAdm])
  const filteredMine = useMemo(() => filterByChannel(mineTemplates), [filterByChannel, mineTemplates])

  const commonTemplateCount = filteredOfficialSup.length + filteredOfficialAdm.length
  const hasCommonTemplates = commonTemplateCount > 0
  const hasMineTemplatesOnlyCount = filteredMine.length > 0

  const selectedTemplateSummary = useMemo(() => {
    if (selectedTemplateValue === 'none') return null
    if (selectedTemplateValue.startsWith('mine:')) {
      const id = selectedTemplateValue.slice('mine:'.length)
      const t = mineTemplates.find((x) => x.id === id)
      return t ? formatMineOptionLabel(t) : selectedTemplateValue
    }
    const oid = officialIdFromSelectValue(selectedTemplateValue)
    if (oid) {
      const t = officialSup.find((x) => x.id === oid) || officialAdm.find((x) => x.id === oid)
      return t ? formatOfficialOptionLabel(t) : oid
    }
    return null
  }, [selectedTemplateValue, mineTemplates, officialSup, officialAdm])

  useEffect(() => {
    if (!open || editingMessage) return
    if (hasMineTemplatesOnlyCount > 0 && !hasCommonTemplates) setTemplatePickerTab('mine')
    else setTemplatePickerTab('common')
  }, [open, editingMessage, hasMineTemplatesOnlyCount, hasCommonTemplates])

  const hasTemplatesForChannel =
    filteredOfficialSup.length + filteredOfficialAdm.length + filteredMine.length > 0

  const showTemplateSection =
    !editingMessage &&
    (currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN')

  // SUP/ADM/ADMIN: загрузка списка пользователей для «Отправить от имени» (ADM — только ADM и VOL)
  useEffect(() => {
    if (open && (currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN') && !editingMessage) {
      fetch('/api/admin/users')
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d) => {
          const raw = (d.users || []).map((u: { id: string; name: string | null; email: string; role?: string }) => ({
            id: u.id,
            name: u.name || u.email,
            email: u.email,
            role: u.role,
          }))
          const list = currentUserRole === 'ADM'
            ? raw.filter((u: { role?: string }) => u.role === 'ADM' || u.role === 'VOL')
            : raw
          setUsersForSendAs(list)
        })
        .catch(() => setUsersForSendAs([]))
    } else {
      setUsersForSendAs([])
      setSendAsUserId('')
    }
  }, [open, currentUserRole, editingMessage])

  // Load workspace for username and emojis
  useEffect(() => {
    if (open && workspaceId) {
      // Load workspace
      fetch(`/api/workspace/${workspaceId}`)
        .then(res => res.json())
        .then(data => {
          setWorkspace(data.workspace)
          setWorkspaceUrl(data.workspace?.workspaceUrl || '')
        })
        .catch(console.error)
      
      // Load emojis (с таймаутом, чтобы не блокировать UI)
      const emojiTimeout = setTimeout(() => {
        // Если загрузка слишком долгая, используем пустой массив (стандартные эмодзи будут показаны)
        setEmojis([])
      }, 3000) // 3 секунды таймаут
      
      fetch(`/api/workspace/${workspaceId}/emojis`)
        .then(res => res.json())
        .then(data => {
          clearTimeout(emojiTimeout)
          setEmojis(data.emojis || [])
          if (data.workspaceUrl) {
            setWorkspaceUrl(data.workspaceUrl)
          }
        })
        .catch(() => {
          clearTimeout(emojiTimeout)
          setEmojis([]) // Используем стандартные эмодзи
        })
    }
  }, [open, workspaceId])

  // Общие шаблоны (SUP/ADM) и «Мои» — для подстановки текста и связи с UserTemplate
  useEffect(() => {
    if (!open || editingMessage) return
    if (currentUserRole !== 'SUPPORT' && currentUserRole !== 'ADM' && currentUserRole !== 'ADMIN') {
      setOfficialSup([])
      setOfficialAdm([])
      setMineTemplates([])
      setTemplatesRole(null)
      return
    }
    setTemplatesLoading(true)
    Promise.all([
      fetch('/api/templates').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/templates/mine').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([gen, mine]) => {
        if (!gen) {
          setOfficialSup([])
          setOfficialAdm([])
          setTemplatesRole(null)
        } else {
          setTemplatesRole(gen.role ?? null)
          if (gen.role === 'ADM') {
            setOfficialSup([])
            setOfficialAdm((gen.admTemplates || gen.templates || []) as OfficialTpl[])
          } else {
            setOfficialSup((gen.templates || []) as OfficialTpl[])
            setOfficialAdm((gen.admTemplates || []) as OfficialTpl[])
          }
        }
        setMineTemplates((mine?.templates || []) as MineTpl[])
      })
      .catch(() => {
        setOfficialSup([])
        setOfficialAdm([])
        setMineTemplates([])
      })
      .finally(() => setTemplatesLoading(false))
  }, [open, editingMessage, currentUserRole])

  useEffect(() => {
    if (!open) {
      prevChannelIdRef.current = null
      return
    }
    if (prevChannelIdRef.current != null && prevChannelIdRef.current !== channelId) {
      setSelectedTemplateValue('none')
    }
    prevChannelIdRef.current = channelId
  }, [open, channelId])

  useEffect(() => {
    if (!open || editingMessage) return
    if (sourceUserTemplateId) {
      setSelectedTemplateValue(`mine:${sourceUserTemplateId}`)
    } else {
      setSelectedTemplateValue('none')
    }
  }, [open, editingMessage, sourceUserTemplateId])

  const [draftSavedAt, setDraftSavedAt] = useState(0)

  // Auto-save draft to localStorage
  const saveDraft = useCallback(() => {
    if (formData.message.trim()) {
      const draftKey = `message-draft-${workspaceId}-${channelId}`
      localStorage.setItem(draftKey, JSON.stringify({
        message: formData.message,
        scheduledDate: formData.scheduledDate,
        scheduledTime: formData.scheduledTime,
        timestamp: Date.now()
      }))
      setDraftSavedAt(Date.now())
    }
  }, [formData, workspaceId, channelId])

  useEffect(() => {
    if (!draftSavedAt) return
    const t = setTimeout(() => setDraftSavedAt(0), 2000)
    return () => clearTimeout(t)
  }, [draftSavedAt])

  // Load draft from localStorage
  useEffect(() => {
    if (open && !editingMessage) {
      const draftKey = `message-draft-${workspaceId}-${channelId}`
      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft)
          // Load draft if it's less than 24 hours old
          if (Date.now() - draft.timestamp < 24 * 60 * 60 * 1000) {
            setFormData(prev => ({
              ...prev,
              message: draft.message || prev.message,
              scheduledDate: draft.scheduledDate || prev.scheduledDate,
              scheduledTime: draft.scheduledTime || prev.scheduledTime,
            }))
          }
        } catch (e) {
          console.error('Failed to load draft:', e)
        }
      }
    }
  }, [open, workspaceId, channelId, editingMessage])

  // Auto-save on message change
  useEffect(() => {
    if (open && formData.message.trim() && !editingMessage) {
      const timeoutId = setTimeout(saveDraft, 1000) // Debounce 1 second
      return () => clearTimeout(timeoutId)
    }
  }, [formData.message, open, editingMessage, saveDraft])

  // Load channels when editing PENDING message (for channel change)
  useEffect(() => {
    if (open && workspaceId && editingMessage?.status === 'PENDING') {
      fetch(`/api/workspace/${workspaceId}/channels`)
        .then((r) => (r.ok ? r.json() : { channels: [] }))
        .then((d) => setChannels(d.channels || []))
        .catch(() => setChannels([]))
    } else {
      setChannels([])
    }
  }, [open, workspaceId, editingMessage?.status])

  useEffect(() => {
    if (editingMessage) {
      const scheduledDate = new Date(editingMessage.scheduledFor)
      const dateStr = scheduledDate.toISOString().split('T')[0]
      const timeStr = scheduledDate.toTimeString().slice(0, 5)
      
      setFormData({
        message: editingMessage.message || '',
        scheduledFor: editingMessage.scheduledFor || '',
        scheduledDate: dateStr,
        scheduledTime: timeStr,
        channelId: editingMessage.channelId || '',
        channelName: editingMessage.channelName || '',
      })
    } else if (open && (initialMessage != null || initialTime != null || initialDate != null)) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateStr = initialDate || tomorrow.toISOString().split('T')[0]
      const timeStr = initialTime || '09:00'
      setFormData({
        message: initialMessage || '',
        scheduledFor: '',
        scheduledDate: dateStr,
        scheduledTime: timeStr,
        channelId: '',
        channelName: '',
      })
    } else if (open) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      const dateStr = tomorrow.toISOString().split('T')[0]
      const timeStr = '09:00'
      setFormData({
        message: '',
        scheduledFor: '',
        scheduledDate: dateStr,
        scheduledTime: timeStr,
        channelId: '',
        channelName: '',
      })
    }
  }, [editingMessage, open, initialMessage, initialTime, initialDate])

  const onTemplateSelect = useCallback(
    (value: string) => {
      setSelectedTemplateValue(value)
      if (value.startsWith('mine:')) setTemplatePickerTab('mine')
      else if (value === 'none') {
        /* keep tab */
      } else if (officialIdFromSelectValue(value)) setTemplatePickerTab('common')
      if (value === 'none') {
        return
      }
      const applyBodyAndTime = (body: string, time?: string) => {
        const tt = time ? parseTimeForInput(time) : null
        setFormData((prev) => ({
          ...prev,
          message: body,
          ...(tt ? { scheduledTime: tt } : {}),
        }))
      }
      if (value.startsWith('official-sup:')) {
        const id = value.slice('official-sup:'.length)
        const t = officialSup.find((x) => x.id === id)
        if (t) applyBodyAndTime(t.body, t.time)
        return
      }
      if (value.startsWith('official-adm:')) {
        const id = value.slice('official-adm:'.length)
        const t = officialAdm.find((x) => x.id === id)
        if (t) applyBodyAndTime(t.body, t.time)
        return
      }
      if (value.startsWith('mine:')) {
        const id = value.slice('mine:'.length)
        const t = mineTemplates.find((x) => x.id === id)
        if (t) applyBodyAndTime(t.body, t.time)
      }
    },
    [officialSup, officialAdm, mineTemplates]
  )

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.message.trim()) {
      toast.error('Введите текст сообщения', { title: 'Пустое сообщение' })
      return
    }

    // Для отправленных сообщений дата не обязательна
    let scheduledFor = editingMessage?.scheduledFor ? new Date(editingMessage.scheduledFor) : null
    
    if (!editingMessage || editingMessage.status === 'PENDING') {
      if (!formData.scheduledDate || !formData.scheduledTime) {
        toast.error('Выберите дату и время отправки', { title: 'Нет даты' })
        return
      }

      // Combine date and time
      scheduledFor = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`)
      
      if (scheduledFor <= new Date()) {
        toast.error('Время отправки должно быть в будущем', { title: 'Неверное время' })
        return
      }
    }

    setIsSubmitting(true)

    const url = editingMessage
      ? `/api/messages/${editingMessage.id}`
      : '/api/messages'
    const method = editingMessage ? 'PATCH' : 'POST'

    const postOfficialTemplateId = officialIdFromSelectValue(selectedTemplateValue)

    const body = editingMessage
      ? {
          message: formData.message,
          ...(scheduledFor && { scheduledFor: scheduledFor.toISOString() }),
          ...(editingMessage.status === 'PENDING' && formData.channelId && {
            channelId: formData.channelId,
            channelName: formData.channelName || formData.channelId,
          }),
        }
      : {
          workspaceId,
          channelId,
          channelName,
          message: formData.message,
          ...(scheduledFor && { scheduledFor: scheduledFor.toISOString() }),
          ...((currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN') && sendAsUserId && { asUserId: sendAsUserId }),
          ...(selectedTemplateValue.startsWith('mine:') && {
            sourceUserTemplateId: selectedTemplateValue.slice('mine:'.length),
          }),
          ...(postOfficialTemplateId ? { sourceOfficialTemplateId: postOfficialTemplateId } : {}),
        }

    const savePromise = fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Ошибка при сохранении сообщения')
        return data
      })

    toast.promise(savePromise, {
      loading: 'Сохранение...',
      success: editingMessage ? 'Сообщение обновлено!' : 'Сообщение запланировано!',
      error: (e: Error) => e?.message ?? 'Ошибка при сохранении сообщения',
    })

    savePromise
      .then(() => {
        if (!editingMessage) {
          const draftKey = `message-draft-${workspaceId}-${channelId}`
          localStorage.removeItem(draftKey)
        }
        onOpenChange(false)
        onSuccess()
        if (!editingMessage) {
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          tomorrow.setHours(9, 0, 0, 0)
          const dateStr = tomorrow.toISOString().split('T')[0]
          setFormData({
            message: '',
            scheduledFor: '',
            scheduledDate: dateStr,
            scheduledTime: '09:00',
            channelId: '',
            channelName: '',
          })
          setSelectedTemplateValue('none')
        }
      })
      .finally(() => setIsSubmitting(false))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !e.shiftKey) {
      e.preventDefault()
      const form = (e.target as HTMLElement).closest('form')
      if (form) form.requestSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] max-h-[90vh] overflow-y-auto rounded-xl border-border/80 shadow-lg" onKeyDown={handleKeyDown}>
        <form onSubmit={handleSubmit} className="min-w-0 overflow-hidden">
          <DialogHeader className="space-y-1.5 pb-2 border-b border-border/60">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {editingMessage ? 'Редактировать сообщение' : 'Создать отложенное сообщение'}
            </DialogTitle>
            {!editingMessage || editingMessage.status !== 'PENDING' ? (
              <DialogDescription className="text-sm text-muted-foreground">
                Канал: <span className="font-medium text-foreground">#{channelName}</span>
              </DialogDescription>
            ) : null}
          </DialogHeader>

          <div className="grid gap-5 py-5">
            {editingMessage && editingMessage.status === 'PENDING' && channels.length > 0 && (
              <div className="space-y-2">
                <Label htmlFor="channel">
                  <Hash className="inline w-4 h-4 mr-1" />
                  Канал
                </Label>
                <Select
                  value={formData.channelId || editingMessage.channelId}
                  onValueChange={(val) => {
                    const ch = channels.find((c) => c.id === val)
                    setFormData((prev) => ({
                      ...prev,
                      channelId: val,
                      channelName: ch?.name || ch?.displayName || val,
                    }))
                  }}
                >
                  <SelectTrigger id="channel" className="bg-background">
                    <SelectValue placeholder="Выберите канал" />
                  </SelectTrigger>
                  <SelectContent>
                    {channels.map((ch) => (
                      <SelectItem key={ch.id} value={ch.id}>
                        #{ch.displayName || ch.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {showTemplateSection && (
              <div className="space-y-3 rounded-lg border border-border/80 bg-muted/20 p-4">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <LayoutTemplate className="w-4 h-4 text-muted-foreground" />
                  Шаблон для канала #{channelName}
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Вкладки «Общие» и «Мои»: в каждой строке справа — статус в этом пространстве (отправлено, запланировано или ещё не создавали отложенное сообщение с привязкой). Нажмите строку, чтобы подставить текст и время.
                </p>
                {templatesLoading ? (
                  <div className="flex items-center gap-2 text-sm text-muted-foreground py-1">
                    <Spinner className="h-4 w-4" />
                    Загрузка шаблонов…
                  </div>
                ) : hasTemplatesForChannel ? (
                  <div className="space-y-3 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Button
                        type="button"
                        variant={selectedTemplateValue === 'none' ? 'secondary' : 'outline'}
                        size="sm"
                        className="rounded-lg shrink-0"
                        onClick={() => onTemplateSelect('none')}
                      >
                        Без шаблона
                      </Button>
                      {selectedTemplateSummary && (
                        <p className="text-xs text-muted-foreground min-w-0 flex-1">
                          <span className="text-muted-foreground">Выбрано: </span>
                          <span className="font-medium text-foreground break-words">{selectedTemplateSummary}</span>
                        </p>
                      )}
                    </div>

                    {hasCommonTemplates && hasMineTemplatesOnlyCount > 0 ? (
                      <Tabs
                        value={templatePickerTab}
                        onValueChange={(v) => setTemplatePickerTab(v as 'common' | 'mine')}
                        className="w-full min-w-0"
                      >
                        <TabsList className="grid w-full grid-cols-2 h-9 rounded-lg bg-muted/60 p-0.5">
                          <TabsTrigger value="common" className="rounded-md text-xs sm:text-sm gap-1.5">
                            Общие
                            <span className="tabular-nums opacity-70">({commonTemplateCount})</span>
                          </TabsTrigger>
                          <TabsTrigger value="mine" className="rounded-md text-xs sm:text-sm gap-1.5">
                            Мои
                            <span className="tabular-nums opacity-70">({filteredMine.length})</span>
                          </TabsTrigger>
                        </TabsList>
                        <TabsContent value="common" className="mt-3 space-y-0 focus-visible:outline-none">
                          <div className="max-h-[min(280px,45vh)] overflow-y-auto overscroll-contain space-y-4 pr-1 -mr-1">
                            {filteredOfficialSup.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
                                  Расписание SUP
                                </p>
                                <div className="space-y-2">
                                  {filteredOfficialSup.map((t) => {
                                    const value = `official-sup:${t.id}`
                                    const sel = selectedTemplateValue === value
                                    return (
                                      <button
                                        key={value}
                                        type="button"
                                        onClick={() => onTemplateSelect(value)}
                                        className={cn(
                                          'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                          sel
                                            ? 'border-primary bg-primary/10 shadow-sm'
                                            : 'border-border/70 bg-background/80 hover:bg-muted/50'
                                        )}
                                      >
                                        <div className="min-w-0 flex-1 space-y-0.5">
                                          <p className="text-sm font-medium leading-snug text-foreground break-words">
                                            {formatOfficialOptionLabel(t)}
                                          </p>
                                        </div>
                                        <TemplateStatusBadge status={templateIdStatusInWorkspace.get(t.id)} />
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                            {filteredOfficialAdm.length > 0 && (
                              <div className="space-y-2">
                                <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
                                  {templatesRole === 'ADM' ? 'Расписание' : 'Расписание ADM'}
                                </p>
                                <div className="space-y-2">
                                  {filteredOfficialAdm.map((t) => {
                                    const value = `official-adm:${t.id}`
                                    const sel = selectedTemplateValue === value
                                    return (
                                      <button
                                        key={value}
                                        type="button"
                                        onClick={() => onTemplateSelect(value)}
                                        className={cn(
                                          'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                          sel
                                            ? 'border-primary bg-primary/10 shadow-sm'
                                            : 'border-border/70 bg-background/80 hover:bg-muted/50'
                                        )}
                                      >
                                        <div className="min-w-0 flex-1 space-y-0.5">
                                          <p className="text-sm font-medium leading-snug text-foreground break-words">
                                            {formatOfficialOptionLabel(t)}
                                          </p>
                                        </div>
                                        <TemplateStatusBadge status={templateIdStatusInWorkspace.get(t.id)} />
                                      </button>
                                    )
                                  })}
                                </div>
                              </div>
                            )}
                          </div>
                        </TabsContent>
                        <TabsContent value="mine" className="mt-3 focus-visible:outline-none">
                          <div className="max-h-[min(280px,45vh)] overflow-y-auto overscroll-contain space-y-2 pr-1 -mr-1">
                            {filteredMine.map((t) => {
                              const value = `mine:${t.id}`
                              const sel = selectedTemplateValue === value
                              return (
                                <button
                                  key={value}
                                  type="button"
                                  onClick={() => onTemplateSelect(value)}
                                  className={cn(
                                    'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                    sel
                                      ? 'border-primary bg-primary/10 shadow-sm'
                                      : 'border-border/70 bg-background/80 hover:bg-muted/50'
                                  )}
                                >
                                  <div className="min-w-0 flex-1 space-y-0.5">
                                    <p className="text-sm font-medium leading-snug text-foreground break-words">
                                      {formatMineOptionLabel(t)}
                                    </p>
                                  </div>
                                  <TemplateStatusBadge status={templateIdStatusInWorkspace.get(t.id)} />
                                </button>
                              )
                            })}
                          </div>
                        </TabsContent>
                      </Tabs>
                    ) : hasCommonTemplates ? (
                      <div className="max-h-[min(280px,45vh)] overflow-y-auto overscroll-contain space-y-4 pr-1 -mr-1">
                        {filteredOfficialSup.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
                              Расписание SUP
                            </p>
                            <div className="space-y-2">
                              {filteredOfficialSup.map((t) => {
                                const value = `official-sup:${t.id}`
                                const sel = selectedTemplateValue === value
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => onTemplateSelect(value)}
                                    className={cn(
                                      'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                      sel
                                        ? 'border-primary bg-primary/10 shadow-sm'
                                        : 'border-border/70 bg-background/80 hover:bg-muted/50'
                                    )}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium leading-snug text-foreground break-words">
                                        {formatOfficialOptionLabel(t)}
                                      </p>
                                    </div>
                                    <TemplateStatusBadge status={templateIdStatusInWorkspace.get(t.id)} />
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                        {filteredOfficialAdm.length > 0 && (
                          <div className="space-y-2">
                            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
                              {templatesRole === 'ADM' ? 'Расписание' : 'Расписание ADM'}
                            </p>
                            <div className="space-y-2">
                              {filteredOfficialAdm.map((t) => {
                                const value = `official-adm:${t.id}`
                                const sel = selectedTemplateValue === value
                                return (
                                  <button
                                    key={value}
                                    type="button"
                                    onClick={() => onTemplateSelect(value)}
                                    className={cn(
                                      'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                      sel
                                        ? 'border-primary bg-primary/10 shadow-sm'
                                        : 'border-border/70 bg-background/80 hover:bg-muted/50'
                                    )}
                                  >
                                    <div className="min-w-0 flex-1">
                                      <p className="text-sm font-medium leading-snug text-foreground break-words">
                                        {formatOfficialOptionLabel(t)}
                                      </p>
                                    </div>
                                    <TemplateStatusBadge status={templateIdStatusInWorkspace.get(t.id)} />
                                  </button>
                                )
                              })}
                            </div>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="max-h-[min(280px,45vh)] overflow-y-auto overscroll-contain space-y-2 pr-1 -mr-1">
                        {filteredMine.map((t) => {
                          const value = `mine:${t.id}`
                          const sel = selectedTemplateValue === value
                          return (
                            <button
                              key={value}
                              type="button"
                              onClick={() => onTemplateSelect(value)}
                              className={cn(
                                'w-full flex items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-colors',
                                sel
                                  ? 'border-primary bg-primary/10 shadow-sm'
                                  : 'border-border/70 bg-background/80 hover:bg-muted/50'
                              )}
                            >
                              <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium leading-snug text-foreground break-words">
                                  {formatMineOptionLabel(t)}
                                </p>
                              </div>
                              <TemplateStatusBadge status={templateIdStatusInWorkspace.get(t.id)} />
                            </button>
                          )
                        })}
                      </div>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-amber-800 dark:text-amber-200/90 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2">
                    Для канала <span className="font-medium">#{channelName}</span> нет шаблонов с таким именем канала в данных. Выберите другой канал или введите текст вручную.
                  </p>
                )}
              </div>
            )}

            <Tabs defaultValue="edit" className="w-full min-w-0">
              <TabsList className="grid w-full grid-cols-2 h-10 rounded-lg bg-muted/50 p-1">
                <TabsTrigger value="edit" className="rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  Редактор
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Eye className="w-4 h-4" />
                  Предпросмотр
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="edit" className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="message">Текст сообщения</Label>
                  <span className={cn(
                    "text-xs text-muted-foreground",
                    formData.message.length > 5000 && "text-destructive font-medium"
                  )}>
                    {formData.message.length} / 5000 символов
                  </span>
                </div>
                <MessageEditor
                  value={formData.message}
                  onChange={(value) => setFormData({ ...formData, message: value })}
                  placeholder="Введите текст сообщения..."
                  maxLength={5000}
                  emojis={emojis}
                  workspaceId={workspaceId}
                  workspaceUrl={workspaceUrl}
                />
                {draftSavedAt > 0 && (
                  <p className="text-xs text-green-600 dark:text-green-400">Черновик сохранён</p>
                )}
              </TabsContent>
              
              <TabsContent value="preview" className="mt-4">
                {formData.message.trim() ? (
                  <MessagePreview
                    message={formData.message}
                    username={workspace?.username || 'user'}
                    channelName={channelName}
                    workspaceName={workspace?.workspaceName}
                    workspaceId={workspaceId}
                    workspaceUrl={workspaceUrl}
                    emojis={emojis}
                  />
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Введите текст сообщения для предпросмотра
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN') && !editingMessage && usersForSendAs.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-4">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <User className="w-4 h-4 text-muted-foreground" />
                  Отправить от имени
                </Label>
                <Select value={sendAsUserId || '__me__'} onValueChange={(v) => setSendAsUserId(v === '__me__' ? '' : v)}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Я (текущий пользователь)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__me__">Я (текущий пользователь)</SelectItem>
                    {usersForSendAs.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.email} {u.email && u.name ? `(${u.email})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                  Используйте «Отправить от имени» только чтобы подстраховать коллегу.
                </p>
                <p className="text-xs text-muted-foreground">
                  Сообщение в списке будет отображаться как созданное выбранным пользователем.
                </p>
                <p className="text-xs text-muted-foreground/90">
                  Чтобы в Rocket.Chat сообщение отправилось от его имени, у пользователя должно быть подключено это же пространство (тот же URL) к своему аккаунту. Иначе сообщение уйдёт от владельца пространства.
                </p>
              </div>
            )}

            {(!editingMessage || editingMessage.status === 'PENDING') && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="scheduledDate">
                      <Calendar className="inline w-4 h-4 mr-1" />
                      Дата отправки
                    </Label>
                    <Input
                      id="scheduledDate"
                      type="date"
                      value={formData.scheduledDate}
                      onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                      min={new Date().toISOString().split('T')[0]}
                      required={!editingMessage || editingMessage.status === 'PENDING'}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="scheduledTime">
                      <Clock className="inline w-4 h-4 mr-1" />
                      Время отправки
                    </Label>
                    <Input
                      id="scheduledTime"
                      type="time"
                      value={formData.scheduledTime}
                      onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
                      required={!editingMessage || editingMessage.status === 'PENDING'}
                    />
                  </div>
                </div>

                {formData.scheduledDate && formData.scheduledTime && (() => {
                  const scheduled = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`)
                  const isPast = scheduled <= new Date()
                  return (
                    <div className={isPast ? 'rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3' : 'rounded-lg border border-border/80 bg-muted/30 px-4 py-3'}>
                      {isPast ? (
                        <p className="text-sm text-destructive font-medium">Время в прошлом — выберите будущую дату и время</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Сообщение будет отправлено:{' '}
                          <span className="font-semibold text-foreground">
                            {scheduled.toLocaleString('ru-RU', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </p>
                      )}
                    </div>
                  )
                })()}
              </>
            )}

            {editingMessage && editingMessage.status === 'SENT' && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
                <p className="text-sm text-blue-900 dark:text-blue-200">
                  ⚠️ Это сообщение уже отправлено. Изменения будут применены в Rocket.Chat.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Сохранение...
                </>
              ) : (
                editingMessage ? 'Сохранить изменения' : 'Запланировать'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
