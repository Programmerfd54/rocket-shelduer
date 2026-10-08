"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as toast from '@/lib/toast'
import { Eye, User, Hash, LayoutTemplate, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DatePicker } from '@/components/ui/date-picker'
import { TimePicker } from '@/components/ui/time-picker'
import {
  isScheduleInPast,
  parseTime,
  toYmd,
} from '@/lib/schedule-datetime'
import MessagePreview from './message-preview'
import MessageEditor from './message-editor'
import { useWorkspaceEmojis } from '@/lib/useWorkspaceEmojis'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Badge } from '@/components/ui/badge'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { SendSummary } from '@/components/common/SendSummary'
import { describeSaveError } from './message-dialog-helpers'

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
    return <Badge variant="success">Отправлено</Badge>
  }
  if (status === 'PENDING') {
    return <Badge variant="info">Запланировано</Badge>
  }
  if (status === 'FAILED') {
    return <Badge variant="danger">Ошибка</Badge>
  }
  return <Badge variant="muted">Не отправлялось</Badge>
}

function officialIdFromSelectValue(v: string): string | null {
  if (v.startsWith('official-sup:')) return v.slice('official-sup:'.length)
  if (v.startsWith('official-adm:')) return v.slice('official-adm:'.length)
  return null
}

/**
 * Обёртка: key по пространству/каналу/сообщению — при смене любого из них форма создаётся заново,
 * поэтому данные разных сообщений не смешиваются.
 */
export default function MessageDialog(props: MessageDialogProps) {
  return (
    <MessageDialogInner
      key={`${props.workspaceId}:${props.channelId}:${props.editingMessage?.id ?? 'new'}`}
      {...props}
    />
  )
}

type FormSnapshot = {
  message: string
  scheduledDate: string
  scheduledTime: string
  channelId: string
}

function MessageDialogInner({
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
  currentUserRole = 'MEMBER',
  sourceUserTemplateId = null,
  workspaceMessages = null,
}: MessageDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  /** Защита от двойного клика: state обновляется асинхронно, ref — сразу */
  const submitLockRef = useRef(false)
  const [workspace, setWorkspace] = useState<any>(null)
  const [workspaceLoaded, setWorkspaceLoaded] = useState(false)
  const [mobileView, setMobileView] = useState<'edit' | 'preview'>('edit')
  const [confirmCloseOpen, setConfirmCloseOpen] = useState(false)
  /** Значения формы на момент открытия — по ним определяем «есть несохранённые изменения» */
  const [baseline, setBaseline] = useState<FormSnapshot>({
    message: '',
    scheduledDate: '',
    scheduledTime: '',
    channelId: '',
  })
  /** Общая ошибка сохранения (у кнопки) и ошибки полей от сервера */
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [serverTimeError, setServerTimeError] = useState('')
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const {
    emojis,
    workspaceUrl: emojisWorkspaceUrl,
    loading: emojisLoading,
    error: emojisError,
    reload: reloadEmojis,
  } = useWorkspaceEmojis(workspaceId, open)
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
    <T extends { channel: string },>(list: T[]): T[] => {
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
  const hasMineTemplates = filteredMine.length > 0

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
    if (hasMineTemplates && !hasCommonTemplates) setTemplatePickerTab('mine')
    else setTemplatePickerTab('common')
  }, [open, editingMessage, hasMineTemplates, hasCommonTemplates])

  const hasTemplatesForChannel =
    filteredOfficialSup.length + filteredOfficialAdm.length + filteredMine.length > 0

  const isStaffTemplates =
    currentUserRole === 'SUP' ||
    currentUserRole === 'ADM' ||
    currentUserRole === 'LEAD_SUP'

  const showTemplateSection = !editingMessage && isStaffTemplates

  // SUP / ADM / Lead_SUP: «Отправить от имени» (для ADM — только ADM и волонтёры MEMBER)
  useEffect(() => {
    if (open && isStaffTemplates && !editingMessage) {
      fetch('/api/admin/users')
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d) => {
          const raw = (d.users || []).map(
            (u: {
              id: string
              name: string | null
              email: string
              role?: string
              volunteerExpiresAt?: string | null
            }) => ({
              id: u.id,
              name: u.name || u.email,
              email: u.email,
              role: u.role,
              volunteerExpiresAt: u.volunteerExpiresAt,
            }),
          )
          const list =
            currentUserRole === 'ADM'
              ? raw.filter(
                  (u: { role?: string; volunteerExpiresAt?: string | null }) =>
                    u.role === 'ADM' || (u.role === 'MEMBER' && !!u.volunteerExpiresAt),
                )
              : raw
          setUsersForSendAs(list)
        })
        .catch(() => setUsersForSendAs([]))
    } else {
      setUsersForSendAs([])
      setSendAsUserId('')
    }
  }, [open, currentUserRole, editingMessage, isStaffTemplates])

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
        .finally(() => setWorkspaceLoaded(true))
    }
  }, [open, workspaceId])

  // Эмодзи воркспейса грузит хук useWorkspaceEmojis (состояния loading/error + retry); URL воркспейса — отсюда
  useEffect(() => {
    if (emojisWorkspaceUrl) setWorkspaceUrl(emojisWorkspaceUrl)
  }, [emojisWorkspaceUrl])

  // Общие шаблоны (SUP/ADM) и «Мои» — для подстановки текста и связи с UserTemplate
  useEffect(() => {
    if (!open || editingMessage) return
    if (!isStaffTemplates) {
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
  }, [open, editingMessage, currentUserRole, isStaffTemplates])

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

  // Начальные значения формы при открытии. Зависим от id сообщения, а не от объекта —
  // иначе обновление списка сообщений на странице стирало бы то, что пользователь уже ввёл.
  useEffect(() => {
    if (!open) return
    let next: typeof formData
    if (editingMessage) {
      const scheduledDate = new Date(editingMessage.scheduledFor)
      next = {
        message: editingMessage.message || '',
        scheduledFor: editingMessage.scheduledFor || '',
        scheduledDate: toYmd(scheduledDate),
        scheduledTime: scheduledDate.toTimeString().slice(0, 5),
        channelId: editingMessage.channelId || '',
        channelName: editingMessage.channelName || '',
      }
    } else if (initialMessage != null || initialTime != null || initialDate != null) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      next = {
        message: initialMessage || '',
        scheduledFor: '',
        scheduledDate: initialDate || toYmd(tomorrow),
        scheduledTime: initialTime || '09:00',
        channelId: '',
        channelName: '',
      }
    } else {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      next = {
        message: '',
        scheduledFor: '',
        scheduledDate: toYmd(tomorrow),
        scheduledTime: '09:00',
        channelId: '',
        channelName: '',
      }
      // Черновик нового сообщения этого пространства и канала (не старше 24 часов)
      try {
        const savedDraft = localStorage.getItem(`message-draft-${workspaceId}-${channelId}`)
        if (savedDraft) {
          const draft = JSON.parse(savedDraft)
          if (Date.now() - draft.timestamp < 24 * 60 * 60 * 1000) {
            next = {
              ...next,
              message: draft.message || next.message,
              // Прошедшую дату из черновика не подставляем
              scheduledDate:
                draft.scheduledDate && draft.scheduledDate >= toYmd(new Date()) ? draft.scheduledDate : next.scheduledDate,
              scheduledTime: draft.scheduledTime || next.scheduledTime,
            }
          }
        }
      } catch (e) {
        console.error('Failed to load draft:', e)
      }
    }
    setFormData(next)
    setBaseline({
      message: next.message,
      scheduledDate: next.scheduledDate,
      scheduledTime: next.scheduledTime,
      channelId: next.channelId,
    })
    setSubmitError(null)
    setServerTimeError('')
    setSubmitAttempted(false)
    setMobileView('edit')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, editingMessage?.id, workspaceId, channelId, initialMessage, initialTime, initialDate])

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

  // Дата/время нужны для нового и для запланированного (PENDING) сообщения
  const scheduleRequired = !editingMessage || editingMessage.status === 'PENDING'

  const todayYmd = toYmd(new Date())
  const scheduleInPast =
    scheduleRequired && isScheduleInPast(formData.scheduledDate, formData.scheduledTime)
  /** Если уже выбрана прошедшая дата — ошибка у даты, если сегодня, но время ушло — у времени */
  const pastOnDate = scheduleInPast && formData.scheduledDate < todayYmd
  const dateError =
    scheduleRequired && !formData.scheduledDate && submitAttempted
      ? 'Выберите дату'
      : pastOnDate
        ? 'Время уже прошло'
        : ''
  const timeError =
    scheduleRequired && !parseTime(formData.scheduledTime) && submitAttempted
      ? 'Укажите время'
      : scheduleInPast && !pastOnDate
        ? 'Время уже прошло'
        : serverTimeError
  const messageError = submitAttempted
    ? !formData.message.trim()
      ? 'Введите текст сообщения'
      : formData.message.length > 5000
        ? 'Превышен лимит 5000 символов'
        : ''
    : ''

  // Что изменено относительно момента открытия — для защиты от случайной потери текста
  const isDirty =
    formData.message !== baseline.message ||
    formData.channelId !== baseline.channelId ||
    (scheduleRequired &&
      (formData.scheduledDate !== baseline.scheduledDate ||
        formData.scheduledTime !== baseline.scheduledTime)) ||
    (!editingMessage && !!sendAsUserId)

  const requestClose = () => {
    if (isSubmitting) return
    if (isDirty) setConfirmCloseOpen(true)
    else onOpenChange(false)
  }

  // Сводка перед отправкой: только реальные значения формы
  const sendAsUser = usersForSendAs.find((u) => u.id === sendAsUserId) ?? null
  const authorFromMessage: string | null = editingMessage?.user
    ? editingMessage.user.name || (editingMessage.user.username ? `@${editingMessage.user.username}` : null)
    : null
  const senderLabel = sendAsUser
    ? sendAsUser.name || sendAsUser.email
    : authorFromMessage || (workspace?.username ? `@${workspace.username}` : null)
  const senderNote = sendAsUser ? 'выбран вручную' : senderLabel && !editingMessage ? 'вы' : null
  const summaryChannel = editingMessage
    ? formData.channelName || editingMessage.channelName || channelName
    : channelName

  const patchForm = (patch: Partial<typeof formData>) => {
    setFormData((prev) => ({ ...prev, ...patch }))
    setSubmitError(null)
    setServerTimeError('')
  }

  const saveDraftNow = () => {
    if (editingMessage || !formData.message.trim()) return
    try {
      localStorage.setItem(
        `message-draft-${workspaceId}-${channelId}`,
        JSON.stringify({
          message: formData.message,
          scheduledDate: formData.scheduledDate,
          scheduledTime: formData.scheduledTime,
          timestamp: Date.now(),
        }),
      )
    } catch {
      /* хранилище недоступно — не критично */
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitLockRef.current) return
    setSubmitAttempted(true)
    setSubmitError(null)
    setServerTimeError('')

    if (!formData.message.trim() || formData.message.length > 5000) {
      setMobileView('edit')
      return
    }

    // Для отправленных сообщений дата не обязательна
    let scheduledFor = editingMessage?.scheduledFor ? new Date(editingMessage.scheduledFor) : null

    if (!editingMessage || editingMessage.status === 'PENDING') {
      if (!formData.scheduledDate || !formData.scheduledTime) {
        setMobileView('edit')
        return
      }

      // Combine date and time
      scheduledFor = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`)

      if (scheduledFor <= new Date()) {
        setServerTimeError('Время отправки должно быть в будущем')
        setMobileView('edit')
        return
      }
    }

    submitLockRef.current = true
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
          ...(isStaffTemplates && sendAsUserId && { asUserId: sendAsUserId }),
          ...(selectedTemplateValue.startsWith('mine:') && {
            sourceUserTemplateId: selectedTemplateValue.slice('mine:'.length),
          }),
          ...(postOfficialTemplateId ? { sourceOfficialTemplateId: postOfficialTemplateId } : {}),
        }

    let status = 0
    let data: { error?: unknown; code?: unknown } | null = null
    try {
      const res = await fetch(url, {
        method,
        // 'local' — ошибку показываем здесь, у формы, а не общим тостом
        headers: { 'Content-Type': 'application/json', 'X-Error-Handling': 'local' },
        body: JSON.stringify(body),
      })
      status = res.status
      data = await res.json().catch(() => null)
      if (res.ok) {
        // Успех — только после подтверждения сервера
        if (!editingMessage) {
          try {
            localStorage.removeItem(`message-draft-${workspaceId}-${channelId}`)
          } catch {
            /* ignore */
          }
        }
        toast.success(editingMessage ? 'Сообщение обновлено!' : 'Сообщение запланировано!')
        onOpenChange(false)
        onSuccess()
        return
      }
    } catch {
      status = 0
    } finally {
      submitLockRef.current = false
      setIsSubmitting(false)
    }

    // Ошибка: введённые данные остаются в форме
    const info = describeSaveError(status, data)
    if (info.kind === 'auth') {
      // Глобальный обработчик 401 перенаправит на вход — текст нового сообщения сохраняем в черновик
      saveDraftNow()
      setSubmitError(
        editingMessage
          ? 'Сессия истекла. Войдите снова и повторите изменение — скопируйте текст, чтобы не потерять его.'
          : info.message,
      )
    } else {
      setSubmitError(info.message)
    }
    if (info.timeError) {
      setServerTimeError(info.timeError)
      setMobileView('edit')
    }
    toast.error(info.message, { title: 'Не удалось сохранить' })
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !e.shiftKey) {
      // Enter на кнопках/вкладках/списках должен срабатывать как обычно, а не отправлять форму
      if (e.target instanceof HTMLElement && e.target.closest('button, a, [role="combobox"], [role="option"], [role="tab"]')) return
      e.preventDefault()
      const form = (e.target as HTMLElement).closest('form')
      if (form) form.requestSubmit()
    }
  }

  return (
    <>
    <Dialog
      open={open}
      onOpenChange={(v) => {
        // Esc, клик по подложке, крестик и «Отмена» — всё через защиту от потери текста
        if (v) onOpenChange(true)
        else requestClose()
      }}
    >
      <DialogContent
        className="flex max-h-[calc(100dvh-1rem)] flex-col gap-0 overflow-hidden p-0 sm:max-h-[calc(100dvh-3rem)] sm:max-w-[640px] lg:max-w-[1040px]"
        onKeyDown={handleKeyDown}
        onInteractOutside={(e) => {
          // Пока идёт сохранение, случайный клик мимо не должен ничего закрывать
          if (isSubmitting) e.preventDefault()
        }}
      >
        <form onSubmit={handleSubmit} className="flex min-h-0 min-w-0 flex-1 flex-col" noValidate>
          <DialogHeader className="space-y-1 border-b px-4 py-3 pr-12 sm:px-6 sm:py-4">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {editingMessage ? 'Редактировать сообщение' : 'Запланировать сообщение'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              {workspace?.workspaceName && (
                <>
                  Пространство: <span className="font-medium text-foreground">{workspace.workspaceName}</span>
                  {' · '}
                </>
              )}
              Канал: <span className="font-medium text-foreground">#{summaryChannel}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-6">
            <Tabs
              value={mobileView}
              onValueChange={(v) => setMobileView(v as 'edit' | 'preview')}
              className="mb-4 lg:hidden"
            >
              <TabsList className="grid w-full grid-cols-2">
                <TabsTrigger value="edit">Редактор</TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2">
                  <Eye className="size-4" aria-hidden />
                  Предпросмотр
                </TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(300px,380px)] lg:gap-6">
              <div className={cn('grid min-w-0 content-start gap-5', mobileView === 'preview' && 'hidden lg:grid')}>
            {editingMessage && editingMessage.status === 'PENDING' && channels.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="channel">
                  <Hash className="inline w-4 h-4 mr-1" />
                  Канал
                </Label>
                <Select
                  value={formData.channelId || editingMessage.channelId}
                  onValueChange={(val) => {
                    const ch = channels.find((c) => c.id === val)
                    patchForm({
                      channelId: val,
                      channelName: ch?.name || ch?.displayName || val,
                    })
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
              <div className="space-y-3">
                <Label className="flex items-center gap-2 text-sm font-semibold">
                  <LayoutTemplate className="w-4 h-4 text-muted-foreground" />
                  Шаблон для канала #{channelName}
                </Label>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Справа в строке — статус шаблона в этом пространстве. Нажмите строку, чтобы подставить текст и время.
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
                        className="shrink-0"
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

                    {hasCommonTemplates && hasMineTemplates ? (
                      <Tabs
                        value={templatePickerTab}
                        onValueChange={(v) => setTemplatePickerTab(v as 'common' | 'mine')}
                        className="w-full min-w-0"
                      >
                        <TabsList className="grid w-full grid-cols-2">
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
                                <p className="text-xs font-medium text-muted-foreground px-0.5">
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
                                          'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                          sel
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border bg-background hover:bg-muted/40'
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
                                <p className="text-xs font-medium text-muted-foreground px-0.5">
                                  {templatesRole === 'ADM' ? 'Расписание' : 'Расписание (интенсив)'}
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
                                          'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                          sel
                                            ? 'border-primary bg-primary/5'
                                            : 'border-border bg-background hover:bg-muted/40'
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
                                    'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                    sel
                                      ? 'border-primary bg-primary/5'
                                      : 'border-border bg-background hover:bg-muted/40'
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
                            <p className="text-xs font-medium text-muted-foreground px-0.5">
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
                                      'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                      sel
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border bg-background hover:bg-muted/40'
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
                            <p className="text-xs font-medium text-muted-foreground px-0.5">
                              {templatesRole === 'ADM' ? 'Расписание' : 'Расписание (интенсив)'}
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
                                      'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                      sel
                                        ? 'border-primary bg-primary/5'
                                        : 'border-border bg-background hover:bg-muted/40'
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
                                'w-full flex items-start gap-3 rounded-md border px-3 py-2 text-left transition-colors',
                                sel
                                  ? 'border-primary bg-primary/5'
                                  : 'border-border bg-background hover:bg-muted/40'
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
                  <p className="text-xs text-muted-foreground">
                    Для канала <span className="font-medium">#{channelName}</span> нет шаблонов с таким именем канала в данных. Выберите другой канал или введите текст вручную.
                  </p>
                )}
              </div>
            )}

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
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
                    onChange={(value) => patchForm({ message: value })}
                    placeholder="Введите текст сообщения..."
                    maxLength={5000}
                    emojis={emojis}
                    workspaceId={workspaceId}
                    workspaceUrl={workspaceUrl}
                    emojisLoading={emojisLoading}
                    emojisError={emojisError}
                    onRetryEmojis={reloadEmojis}
                  />
                  {messageError && (
                    <p id="message-error" role="alert" className="text-xs text-destructive">
                      {messageError}
                    </p>
                  )}
                  {draftSavedAt > 0 && (
                    <p className="text-xs text-muted-foreground">Черновик сохранён</p>
                  )}
                </div>

            {isStaffTemplates && !editingMessage && usersForSendAs.length > 0 && (
              <div className="space-y-2">
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
              <section className="space-y-3" aria-label="Время отправки">
                <h3 className="text-sm font-semibold">Когда отправить</h3>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,160px)]">
                  <div className="space-y-1.5">
                    <Label htmlFor="scheduledDate">Дата</Label>
                    <DatePicker
                      id="scheduledDate"
                      value={formData.scheduledDate}
                      onChange={(v) => patchForm({ scheduledDate: v })}
                      min={todayYmd}
                      invalid={!!dateError}
                      aria-describedby={dateError ? 'scheduledDate-error' : undefined}
                    />
                    {dateError && (
                      <p id="scheduledDate-error" role="alert" className="text-xs text-destructive">
                        {dateError}
                      </p>
                    )}
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="scheduledTime">Время</Label>
                    <TimePicker
                      id="scheduledTime"
                      value={formData.scheduledTime}
                      onChange={(v) => patchForm({ scheduledTime: v })}
                      invalid={!!timeError}
                      aria-describedby={timeError ? 'scheduledTime-error' : undefined}
                    />
                    {timeError && (
                      <p id="scheduledTime-error" role="alert" className="text-xs text-destructive">
                        {timeError}
                      </p>
                    )}
                  </div>
                </div>
              </section>
            )}

            {editingMessage && editingMessage.status === 'SENT' && (
              <p className="flex items-start gap-2 text-sm text-muted-foreground">
                <TriangleAlert className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
                Это сообщение уже отправлено. Изменения будут применены в Rocket.Chat.
              </p>
            )}
              </div>

              <aside className="min-w-0 space-y-4 lg:sticky lg:top-0 lg:self-start">
                <div className={cn('space-y-2', mobileView === 'edit' && 'hidden lg:block')}>
                  <h3 className="text-sm font-semibold">Предпросмотр</h3>
                  <div className="lg:max-h-[45vh] lg:overflow-y-auto">
                    {formData.message.trim() ? (
                      <MessagePreview
                        message={formData.message}
                        username={workspace?.username || 'user'}
                        channelName={summaryChannel}
                        workspaceName={workspace?.workspaceName}
                        workspaceId={workspaceId}
                        workspaceUrl={workspaceUrl}
                        emojis={emojis}
                      />
                    ) : (
                      <div className="rounded-md border border-dashed py-8 text-center text-sm text-muted-foreground">
                        Введите текст сообщения для предпросмотра
                      </div>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Предпросмотр приблизительный: форматирование Rocket.Chat воспроизведено не полностью. Он ничего не
                    отправляет и не сохраняет.
                  </p>
                </div>

                <SendSummary
                  workspaceName={workspace?.workspaceName}
                  channelName={summaryChannel}
                  sender={senderLabel}
                  senderLoading={!workspaceLoaded}
                  senderNote={senderNote}
                  date={formData.scheduledDate}
                  time={formData.scheduledTime}
                  requireSchedule={scheduleRequired}
                />
              </aside>
            </div>
          </div>

          <div className="border-t bg-background px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-6 sm:pb-4">
            {submitError && (
              <p
                role="alert"
                className="mb-3 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive"
              >
                <TriangleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span className="min-w-0 break-words">{submitError}</span>
              </p>
            )}
            <div className="flex gap-2 sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="flex-1 sm:flex-none"
                onClick={requestClose}
                disabled={isSubmitting}
              >
                Отмена
              </Button>
              <Button
                type="submit"
                className="flex-1 sm:flex-none"
                disabled={isSubmitting || scheduleInPast}
                aria-busy={isSubmitting}
              >
                {isSubmitting ? (
                  <>
                    <Spinner className="mr-2 h-4 w-4" />
                    Сохранение...
                  </>
                ) : (
                  editingMessage ? 'Сохранить изменения' : 'Запланировать'
                )}
              </Button>
            </div>
          </div>
        </form>
      </DialogContent>
    </Dialog>

    <ConfirmDialog
      open={confirmCloseOpen}
      onOpenChange={setConfirmCloseOpen}
      title="Закрыть без сохранения?"
      description={
        editingMessage
          ? 'Внесённые изменения не будут сохранены.'
          : 'Сообщение не будет запланировано. Текст сохранится в черновике на этом устройстве на 24 часа.'
      }
      confirmLabel="Закрыть"
      cancelLabel="Продолжить редактирование"
      destructive
      onConfirm={() => {
        saveDraftNow()
        setConfirmCloseOpen(false)
        onOpenChange(false)
      }}
    />
    </>
  )
}
