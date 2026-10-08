"use client"

import { useState, useEffect, useCallback, type ReactNode } from 'react'
import { useRouter, useSearchParams, usePathname } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { DatePicker } from '@/components/ui/date-picker'
import { TimePicker } from '@/components/ui/time-picker'
import { Badge } from '@/components/ui/badge'
import { Textarea } from '@/components/ui/textarea'
import { Skeleton } from '@/components/ui/skeleton'
import { Field } from '@/components/ui/field'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Copy,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  Search,
  Loader2,
  Plus,
  Pencil,
  Trash2,
  Eye,
  EyeOff,
  CalendarClock,
  History,
  Construction,
  SearchX,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatLocalDate } from '@/lib/utils'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { ChannelCheck } from '@/components/common/ChannelCheck'

const TEMPLATES_PLACEHOLDER_MESSAGE = 'Администратор обновляет информацию, скоро откроет эту вкладку.'

type Template = {
  id: string
  intensiveDay: number
  dayLabel: string
  time: string
  channel: string
  audience?: 'all' | 'mk'
  title?: string
  body: string
  timeNote?: string
}

type UserTemplate = {
  id: string
  channel: string
  intensiveDay: number | null
  time: string
  title: string | null
  body: string
  tags?: string[]
  createdAt: string
  updatedAt: string
  lastSentAt?: string | null
}

type ScheduleChannel = { _id?: string; id?: string; name?: string; displayName?: string }

type TemplateVersion = {
  id: string
  body: string
  title: string | null
  channel: string
  time: string
  intensiveDay: number | null
  createdAt: string
}

const CHANNEL_OPTIONS = [
  { value: 'adm', label: '#adm' },
  { value: 'announcements', label: '#announcements' },
  { value: 'general', label: '#general' },
  { value: 'support', label: '#support' },
  { value: 'services', label: '#services' },
  { value: '__other__', label: 'Другой (ввести ниже)' },
]

/** Имя канала Rocket.Chat: без «#», пробелы → «_». */
function normalizeChannelName(v: string): string {
  return v.trim().replace(/^#+/, '').replace(/\s+/g, '_')
}
const CHANNEL_NAME_RE = /^[\p{L}\p{N}._-]+$/u

/** Текст ошибки для «своего» названия канала или undefined, если всё в порядке. */
function channelNameError(raw: string): string | undefined {
  const name = normalizeChannelName(raw)
  if (!name) return 'Укажите название канала.'
  if (!CHANNEL_NAME_RE.test(name)) return 'Допустимы буквы, цифры, точка, дефис и подчёркивание.'
  return undefined
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/

function errMsg(e: unknown, fallback = 'Проверьте данные и попробуйте ещё раз.'): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function dayTitle(day: number): string {
  return day === 0 ? 'Без дня' : `День ${day}`
}

function announcementsCount(n: number): string {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return `${n} анонс`
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return `${n} анонса`
  return `${n} анонсов`
}

function formatSentAt(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })
}

// Вспомогательная функция для безопасного копирования
async function safeCopyToClipboard(text: string): Promise<boolean> {
  if (typeof navigator === 'undefined' || !navigator.clipboard) {
    // Fallback для старых браузеров
    try {
      const textarea = document.createElement('textarea')
      textarea.value = text
      textarea.style.position = 'fixed'
      textarea.style.opacity = '0'
      textarea.style.pointerEvents = 'none'
      document.body.appendChild(textarea)
      textarea.select()
      const success = document.execCommand('copy')
      document.body.removeChild(textarea)
      return success
    } catch (err) {
      console.warn('Fallback copy failed:', err)
      return false
    }
  }

  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch (err) {
    console.warn('Clipboard API failed:', err)
    return false
  }
}

export default function TemplatesPage() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const chromeMinimal = searchParams.get('chrome') === '0'
  const templatesHubIsAdmin = pathname.startsWith('/dashboard/admin')
  const [templates, setTemplates] = useState<Template[]>([])
  const [admTemplates, setAdmTemplates] = useState<Template[]>([])
  const [myTemplates, setMyTemplates] = useState<UserTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [userRole, setUserRole] = useState<string | null>(null)
  const [templatesTabVisible, setTemplatesTabVisible] = useState(true)
  const [search, setSearch] = useState('')
  const [filterAudience, setFilterAudience] = useState<'all' | 'mk' | ''>('')
  const [filterDay, setFilterDay] = useState<string>('_all')
  const [groupMyBy, setGroupMyBy] = useState<'day' | 'channel'>('day')
  const [channelCollapsed, setChannelCollapsed] = useState<Set<string>>(new Set())
  const [filterChannel, setFilterChannel] = useState<string>('_all')
  const [openIds, setOpenIds] = useState<Set<string>>(new Set())
  const [activeTab, setActiveTab] = useState('adm')
  /** Свёрнутые блоки по дням (когда фильтр «Все дни»). Номер дня -> свёрнут */
  const [dayCollapsed, setDayCollapsed] = useState<Set<number>>(new Set())

  // Диалог создания/редактирования своего шаблона
  const [dialogOpen, setDialogOpen] = useState(false)
  const [dialogMode, setDialogMode] = useState<'create' | 'edit'>('create')
  const [dialogId, setDialogId] = useState<string | null>(null)
  const [formChannel, setFormChannel] = useState('adm')
  const [formChannelOther, setFormChannelOther] = useState('') // когда канал «Другой»
  const [formDay, setFormDay] = useState<string>('')
  const [formTime, setFormTime] = useState('09:00')
  const [formTitle, setFormTitle] = useState('')
  const [formBody, setFormBody] = useState('')
  const [formSubmitted, setFormSubmitted] = useState(false)
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [filterTag, setFilterTag] = useState<string>('_all')
  const [formTags, setFormTags] = useState<string>('')
  const [versionsOpenId, setVersionsOpenId] = useState<string | null>(null)
  const [versions, setVersions] = useState<TemplateVersion[]>([])
  const [versionsLoading, setVersionsLoading] = useState(false)
  const [revertingId, setRevertingId] = useState<string | null>(null)
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [scheduleTemplate, setScheduleTemplate] = useState<{
    body: string
    channel: string
    time: string
    userTemplateId?: string
  } | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; workspaceName: string }[]>([])
  const [workspacesLoading, setWorkspacesLoading] = useState(false)
  const [scheduleWorkspaceId, setScheduleWorkspaceId] = useState('')
  const [scheduleChannels, setScheduleChannels] = useState<ScheduleChannel[]>([])
  const [scheduleChannelId, setScheduleChannelId] = useState('')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleLoading, setScheduleLoading] = useState(false)

  // Диалог редактирования официального шаблона (только Lead_SUP)
  const [officialEditOpen, setOfficialEditOpen] = useState(false)
  const [officialEditTemplate, setOfficialEditTemplate] = useState<{
    id: string
    scope: 'SUP' | 'ADM'
    title: string
    body: string
    channel: string
    channelOther: string
    time: string
  } | null>(null)
  const [officialEditSaving, setOfficialEditSaving] = useState(false)
  const [officialSubmitted, setOfficialSubmitted] = useState(false)
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false)

  const loadBuiltIn = useCallback(() => {
    return fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        if (d.templates) setTemplates(d.templates)
        if (d.admTemplates) setAdmTemplates(d.admTemplates)
      })
  }, [])

  const openScheduleDialog = useCallback((t: { body: string; channel: string; time: string; userTemplateId?: string }) => {
    setScheduleTemplate(t)
    const today = new Date().toISOString().split('T')[0]
    setScheduleDate(today)
    setScheduleTime(t.time || '09:00')
    setScheduleWorkspaceId('')
    setScheduleChannelId('')
    setScheduleChannels([])
    setScheduleDialogOpen(true)
  }, [])

  useEffect(() => {
    if (!scheduleDialogOpen) return
    setWorkspacesLoading(true)
    fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWorkspaces(d?.workspaces ?? []))
      .catch(() => {
        setWorkspaces([])
        toast.error('Не удалось загрузить пространства', { description: 'Закройте окно и попробуйте ещё раз.' })
      })
      .finally(() => setWorkspacesLoading(false))
  }, [scheduleDialogOpen])

  useEffect(() => {
    if (!scheduleWorkspaceId) {
      setScheduleChannels([])
      setScheduleChannelId('')
      return
    }
    setScheduleLoading(true)
    fetch(`/api/workspace/${scheduleWorkspaceId}/channels`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        const chs: ScheduleChannel[] = d?.channels ?? []
        setScheduleChannels(chs)
        const name = (scheduleTemplate?.channel || '').replace(/^#/, '')
        const preselect = chs.find((c: ScheduleChannel) => (c.name || c.displayName || '').replace(/^#/, '') === name)
        setScheduleChannelId(preselect ? (preselect._id || preselect.id || '') : (chs[0]?._id || chs[0]?.id || ''))
      })
      .catch(() => {
        setScheduleChannels([])
        toast.error('Не удалось загрузить каналы', { description: 'Выберите пространство ещё раз.' })
      })
      .finally(() => setScheduleLoading(false))
  }, [scheduleWorkspaceId, scheduleTemplate?.channel])

  const goToScheduleMessage = useCallback(() => {
    if (!scheduleTemplate || !scheduleWorkspaceId || !scheduleChannelId) {
      toast.error('Выберите пространство и канал')
      return
    }
    const ch = scheduleChannels.find((c) => (c._id || c.id) === scheduleChannelId)
    sessionStorage.setItem(
      'schedule-from-template',
      JSON.stringify({
        workspaceId: scheduleWorkspaceId,
        channelId: scheduleChannelId,
        channelName: ch?.name || ch?.displayName || scheduleTemplate.channel,
        body: scheduleTemplate.body,
        time: scheduleTime,
        date: scheduleDate || undefined,
        ...(scheduleTemplate.userTemplateId ? { userTemplateId: scheduleTemplate.userTemplateId } : {}),
      })
    )
    setScheduleDialogOpen(false)
    setScheduleTemplate(null)
    router.push(`/dashboard/workspaces/${scheduleWorkspaceId}`)
  }, [scheduleTemplate, scheduleWorkspaceId, scheduleChannelId, scheduleChannels, scheduleTime, scheduleDate, router])

  const loadVersions = useCallback((templateId: string) => {
    setVersionsOpenId(templateId)
    setVersions([])
    setVersionsLoading(true)
    fetch(`/api/templates/mine/${templateId}/versions`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error('load'))))
      .then((d) => setVersions(d?.versions ?? []))
      .catch(() => {
        setVersions([])
        toast.error('Не удалось загрузить историю версий', { description: 'Закройте окно и попробуйте ещё раз.' })
      })
      .finally(() => setVersionsLoading(false))
  }, [])

  const loadMyTemplates = useCallback(() => {
    return fetch('/api/templates/mine')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.templates) setMyTemplates(d.templates)
      })
  }, [])

  const openOfficialEdit = useCallback(
    (t: Template, scope: 'SUP' | 'ADM') => {
      const isOther = !CHANNEL_OPTIONS.some((o) => o.value !== '__other__' && o.value === t.channel)
      setOfficialEditTemplate({
        id: t.id,
        scope,
        title: t.title ?? '',
        body: t.body,
        channel: isOther ? '__other__' : (t.channel ?? 'adm'),
        channelOther: isOther ? (t.channel ?? '') : '',
        time: t.time ?? '09:00',
      })
      setOfficialSubmitted(false)
      setOfficialEditOpen(true)
    },
    []
  )

  const officialErrors = (() => {
    const errors: { body?: string; channel?: string; time?: string } = {}
    if (!officialEditTemplate) return errors
    if (!officialEditTemplate.body.trim()) errors.body = 'Введите текст шаблона.'
    if (officialEditTemplate.channel === '__other__') {
      const err = channelNameError(officialEditTemplate.channelOther)
      if (err) errors.channel = err
    }
    const time = officialEditTemplate.time.trim()
    if (time && !TIME_RE.test(time)) errors.time = 'Укажите время в формате ЧЧ:ММ, например 09:00.'
    return errors
  })()

  const saveOfficialOverride = useCallback(async () => {
    if (!officialEditTemplate) return
    setOfficialSubmitted(true)
    if (Object.keys(officialErrors).length > 0) {
      toast.error('Проверьте поля формы', { description: 'Исправьте отмеченные ошибки и сохраните ещё раз.' })
      return
    }
    setOfficialEditSaving(true)
    try {
      const res = await fetch(`/api/templates/official/${encodeURIComponent(officialEditTemplate.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: officialEditTemplate.scope,
          body: officialEditTemplate.body,
          title: officialEditTemplate.title || null,
          channel: (officialEditTemplate.channel === '__other__' ? normalizeChannelName(officialEditTemplate.channelOther) : officialEditTemplate.channel) || null,
          time: officialEditTemplate.time || null,
        }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      toast.success('Шаблон сохранён')
      setOfficialEditOpen(false)
      setOfficialEditTemplate(null)
      loadBuiltIn()
    } catch (e: unknown) {
      toast.error('Не удалось сохранить шаблон', { description: errMsg(e) })
    } finally {
      setOfficialEditSaving(false)
    }
  }, [officialEditTemplate, officialErrors, loadBuiltIn])

  const resetOfficialOverride = useCallback(async () => {
    if (!officialEditTemplate) return
    setOfficialEditSaving(true)
    try {
      const res = await fetch(
        `/api/templates/official/${encodeURIComponent(officialEditTemplate.id)}?scope=${officialEditTemplate.scope}`,
        { method: 'DELETE' }
      )
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Ошибка сброса')
      toast.success('Шаблон сброшен к умолчанию')
      setOfficialEditOpen(false)
      setOfficialEditTemplate(null)
      loadBuiltIn()
    } catch (e: unknown) {
      toast.error('Не удалось сбросить шаблон', { description: errMsg(e) })
    } finally {
      setOfficialEditSaving(false)
      setResetConfirmOpen(false)
    }
  }, [officialEditTemplate, loadBuiltIn])

  const handleRevert = useCallback(async (templateId: string, versionId: string) => {
    setRevertingId(versionId)
    try {
      const res = await fetch(`/api/templates/mine/${templateId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Ошибка отката')
      toast.success('Шаблон откатан к выбранной версии')
      setVersionsOpenId(null)
      loadMyTemplates()
    } catch (e: unknown) {
      toast.error('Не удалось откатить шаблон', { description: errMsg(e) })
    } finally {
      setRevertingId(null)
    }
  }, [loadMyTemplates])

  useEffect(() => {
    Promise.all([
      fetch('/api/auth/me').then((r) => r.json()),
      fetch('/api/help/visibility').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([meData, visData]) => {
        const role = meData?.user?.role ?? null
        setUserRole(role)
        if (visData) setTemplatesTabVisible(visData.templatesTabVisible !== false)
        if (role === 'SUP' || role === 'LEAD_SUP') setActiveTab('support')
        else setActiveTab('adm')
        const allowed = ['ADM', 'SUP', 'LEAD_SUP', 'MEMBER']
        if (!role || !allowed.includes(role)) {
          router.replace('/dashboard')
          return
        }
        return Promise.all([loadBuiltIn(), loadMyTemplates()])
      })
      .catch(() => toast.error('Не удалось загрузить шаблоны', { description: 'Обновите страницу или проверьте соединение.' }))
      .finally(() => setLoading(false))
  }, [router, loadBuiltIn, loadMyTemplates])

  const openCreateDialog = () => {
    setDialogMode('create')
    setDialogId(null)
    setFormChannel('adm')
    setFormChannelOther('')
    setFormDay('')
    setFormTime('09:00')
    setFormTitle('')
    setFormBody('')
    setFormTags('')
    setFormSubmitted(false)
    setShowPreview(false)
    setDialogOpen(true)
  }

  const openEditDialog = (t: UserTemplate) => {
    setDialogMode('edit')
    setDialogId(t.id)
    const isOther = !CHANNEL_OPTIONS.some((o) => o.value !== '__other__' && o.value === t.channel)
    setFormChannel(isOther ? '__other__' : t.channel)
    setFormChannelOther(isOther ? t.channel : '')
    setFormDay(t.intensiveDay != null ? String(t.intensiveDay) : '')
    setFormTime(t.time)
    setFormTitle(t.title ?? '')
    setFormBody(t.body)
    setFormTags((t.tags ?? []).join(', '))
    setFormSubmitted(false)
    setShowPreview(false)
    setDialogOpen(true)
  }

  const formErrors = (() => {
    const errors: { channel?: string; day?: string; time?: string; body?: string } = {}
    if (formChannel === '__other__') {
      const err = channelNameError(formChannelOther)
      if (err) errors.channel = err
    }
    const day = formDay.trim()
    if (day) {
      const n = Number(day)
      if (!Number.isInteger(n) || n < 1 || n > 14) errors.day = 'Введите целое число от 1 до 14.'
    }
    const time = formTime.trim()
    if (!time) errors.time = 'Укажите время.'
    else if (!TIME_RE.test(time)) errors.time = 'Укажите время в формате ЧЧ:ММ, например 09:00.'
    if (!formBody.trim()) errors.body = 'Введите текст шаблона.'
    return errors
  })()

  const handleSaveTemplate = async () => {
    setFormSubmitted(true)
    if (Object.keys(formErrors).length > 0) {
      toast.error('Проверьте поля формы', { description: 'Исправьте отмеченные ошибки и сохраните ещё раз.' })
      return
    }
    const time = formTime.trim()
    const body = formBody.trim()
    const channel =
      formChannel === '__other__' ? normalizeChannelName(formChannelOther) : formChannel
    if (!channel) {
      toast.error('Укажите канал')
      return
    }
    setSaving(true)
    try {
      const tags = formTags.split(',').map((s) => s.trim()).filter(Boolean)
      const payload = {
        channel,
        intensiveDay: formDay ? Number(formDay) : null,
        time,
        title: formTitle.trim() || null,
        body,
        tags,
      }
      if (dialogMode === 'create') {
        const res = await fetch('/api/templates/mine', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Ошибка создания')
        toast.success('Шаблон создан')
        setDialogOpen(false)
        loadMyTemplates()
      } else if (dialogId) {
        const res = await fetch(`/api/templates/mine/${dialogId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
        toast.success('Шаблон сохранён')
        setDialogOpen(false)
        loadMyTemplates()
      }
    } catch (e: unknown) {
      toast.error(dialogMode === 'create' ? 'Не удалось создать шаблон' : 'Не удалось сохранить шаблон', {
        description: errMsg(e),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    setDeleting(true)
    try {
      const res = await fetch(`/api/templates/mine/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка удаления')
      toast.success('Шаблон удалён')
      setDeleteConfirmId(null)
      loadMyTemplates()
    } catch {
      toast.error('Не удалось удалить шаблон', { description: 'Попробуйте ещё раз.' })
    } finally {
      setDeleting(false)
    }
  }

  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null)

  // Безопасная функция копирования с обратной связью
  const copyBody = async (body: string, feedbackKey?: string) => {
    const success = await safeCopyToClipboard(body)
    if (success) {
      toast.success('Текст скопирован')
      if (feedbackKey) {
        setCopyFeedbackKey(feedbackKey)
        setTimeout(() => setCopyFeedbackKey(null), 2000)
      }
    } else {
      toast.error('Не удалось скопировать', { description: 'Выделите текст вручную и скопируйте его.' })
    }
  }

  const toggleOpen = (id: string) => {
    setOpenIds((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const toggleDayCollapsed = (day: number) =>
    setDayCollapsed((s) => {
      const next = new Set(s)
      if (next.has(day)) next.delete(day)
      else next.add(day)
      return next
    })

  const toggleChannelCollapsed = (ch: string) =>
    setChannelCollapsed((s) => {
      const next = new Set(s)
      if (next.has(ch)) next.delete(ch)
      else next.add(ch)
      return next
    })

  const hasAdmTab = userRole === 'SUP' || userRole === 'LEAD_SUP'
  // Список для текущей вкладки: ADM tab → admTemplates, SUP tab → templates, Мои → myTemplates
  const listForTab =
    activeTab === 'adm'
      ? admTemplates
      : activeTab === 'support'
        ? templates
        : myTemplates.map((t) => ({
            id: t.id,
            intensiveDay: t.intensiveDay ?? 0,
            dayLabel: t.intensiveDay != null ? `День ${t.intensiveDay}` : '—',
            time: t.time,
            channel: t.channel,
            title: t.title ?? undefined,
            body: t.body,
          }))

  const filteredList = listForTab.filter((t) => {
    const matchSearch =
      !search ||
      (t.title?.toLowerCase().includes(search.toLowerCase()) ||
        t.body.toLowerCase().includes(search.toLowerCase()) ||
        (t as Template).dayLabel?.toLowerCase().includes(search.toLowerCase()))
    const matchAudience =
      !filterAudience || (t as Template).audience === filterAudience
    const matchDay =
      filterDay === '_all' ||
      String((t as Template & { intensiveDay?: number }).intensiveDay ?? '') === filterDay
    const matchChannel =
      filterChannel === '_all' || (t.channel || '') === filterChannel
    const matchTag =
      activeTab !== 'mine' ||
      filterTag === '_all' ||
      (myTemplates.find((m) => m.id === t.id)?.tags ?? []).includes(filterTag)
    return matchSearch && matchAudience && matchDay && matchChannel && matchTag
  })

  const groupedByDay = filteredList.reduce<Record<number, (Template & { intensiveDay?: number })[]>>((acc, t) => {
    const day = (t as Template & { intensiveDay?: number }).intensiveDay ?? 0
    if (!acc[day]) acc[day] = []
    acc[day].push(t as Template & { intensiveDay?: number })
    return acc
  }, {})
  const groupedByChannel = activeTab === 'mine' ? filteredList.reduce<Record<string, Template[]>>((acc, t) => {
    const ch = t.channel || 'Без канала'
    if (!acc[ch]) acc[ch] = []
    acc[ch].push(t)
    return acc
  }, {}) : {}
  const channelNames = Object.keys(groupedByChannel).sort()
  const days = Object.keys(groupedByDay)
    .map(Number)
    .sort((a, b) => a - b)
  // Дни для табов (без фильтра по дню) — чтобы показывать «Все дни | День 1 | День 2 | ...»
  const listNoDayFilter = listForTab.filter((t) => {
    const matchSearch = !search || (t.title?.toLowerCase().includes(search.toLowerCase()) || t.body.toLowerCase().includes(search.toLowerCase()) || (t as Template).dayLabel?.toLowerCase().includes(search.toLowerCase()))
    const matchAudience = !filterAudience || (t as Template).audience === filterAudience
    const matchChannel = filterChannel === '_all' || (t.channel || '') === filterChannel
    const matchTag = activeTab !== 'mine' || filterTag === '_all' || (myTemplates.find((m) => m.id === t.id)?.tags ?? []).includes(filterTag)
    return matchSearch && matchAudience && matchChannel && matchTag
  })
  const daysForTabs = [...new Set(listNoDayFilter.map((t) => (t as Template & { intensiveDay?: number }).intensiveDay ?? 0))].sort((a, b) => a - b)
  const channelOptions = Array.from(
    new Set(
      (activeTab === 'adm'
        ? admTemplates
        : activeTab === 'support'
          ? templates
          : myTemplates
      )
        .map((t) => t.channel)
        .filter(Boolean)
    )
  ).sort()
  const tagOptions = Array.from(
    new Set(myTemplates.flatMap((t) => t.tags ?? []).filter(Boolean))
  ).sort()

  const filtersActive =
    !!search ||
    filterChannel !== '_all' ||
    filterDay !== '_all' ||
    !!filterAudience ||
    (activeTab === 'mine' && filterTag !== '_all')

  const resetFilters = () => {
    setSearch('')
    setFilterChannel('_all')
    setFilterDay('_all')
    setFilterAudience('')
    setFilterTag('_all')
  }

  if (
    userRole !== 'ADM' &&
    userRole !== 'SUP' &&
    userRole !== 'LEAD_SUP' &&
    userRole !== 'MEMBER' &&
    !loading
  ) {
    return null
  }

  const containerClass = chromeMinimal ? 'max-w-none px-3 py-3 lg:py-3' : 'px-4 sm:px-6'

  const breadcrumbs = chromeMinimal ? undefined : (
    <Breadcrumbs
      items={
        templatesHubIsAdmin
          ? [
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Шаблоны анонсов', current: true },
            ]
          : [
              { label: 'Пространства', href: '/dashboard/workspaces' },
              { label: 'Шаблоны анонсов', current: true },
            ]
      }
    />
  )

  // Вкладка «Шаблоны» скрыта для не-админов — показываем заглушку
  if (!loading && userRole !== 'LEAD_SUP' && !templatesTabVisible) {
    return (
      <PageContainer size="narrow" className={containerClass}>
        <PageHeader title="Шаблоны анонсов" breadcrumbs={breadcrumbs} />
        <EmptyState
          icon={<Construction />}
          title="Вкладка временно недоступна"
          description={TEMPLATES_PLACEHOLDER_MESSAGE}
        >
          <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push('/dashboard')}>
            На главную
          </Button>
        </EmptyState>
      </PageContainer>
    )
  }

  const tabList =
    userRole === 'SUP' || userRole === 'LEAD_SUP'
      ? [
          { value: 'support', label: 'Шаблоны SUP' },
          { value: 'adm', label: 'Шаблоны ADM' },
          { value: 'mine', label: 'Мои шаблоны' },
        ]
      : [
          { value: 'adm', label: 'Шаблоны ADM' },
          { value: 'mine', label: 'Мои шаблоны' },
        ]

  const deleteTarget = deleteConfirmId ? myTemplates.find((m) => m.id === deleteConfirmId) : undefined
  const versionsTemplate = versionsOpenId ? myTemplates.find((m) => m.id === versionsOpenId) : undefined

  const renderBuiltIn = (scope: 'SUP' | 'ADM') => (
    <>
      {filteredList.length === 0 ? (
        <ListEmpty
          hasItems={listForTab.length > 0}
          filtersActive={filtersActive}
          onReset={resetFilters}
        />
      ) : (
        <BuiltInList
          openIds={openIds}
          toggleOpen={toggleOpen}
          copyBody={(t) => copyBody(t.body, t.id)}
          copyFeedbackKey={copyFeedbackKey}
          onSchedule={(t) => openScheduleDialog({ body: t.body, channel: t.channel, time: t.time })}
          onEditOfficial={userRole === 'LEAD_SUP' ? (t) => openOfficialEdit(t, scope) : undefined}
          groupedByDayData={groupedByDay}
          allDayMode={filterDay === '_all'}
          dayCollapsed={dayCollapsed}
          onToggleDayCollapsed={toggleDayCollapsed}
        />
      )}
    </>
  )

  const renderMineRow = (t: Template) => {
    const ut = myTemplates.find((m) => m.id === t.id)
    return (
      <MyTemplateRow
        key={t.id}
        t={t}
        ut={ut}
        showChannel={groupMyBy === 'day'}
        justCopied={copyFeedbackKey === t.id}
        onSchedule={() => openScheduleDialog({ body: t.body, channel: t.channel, time: t.time, userTemplateId: t.id })}
        onCopy={() => copyBody(t.body, t.id)}
        onHistory={ut ? () => loadVersions(ut.id) : undefined}
        onEdit={ut ? () => openEditDialog(ut) : undefined}
        onDelete={ut ? () => setDeleteConfirmId(t.id) : undefined}
      />
    )
  }

  return (
    <PageContainer className={containerClass}>
      <PageHeader
        title="Шаблоны анонсов"
        description="Встроенные шаблоны по каналу и дню. Свои шаблоны — во вкладке «Мои шаблоны», они подтягиваются в пространство."
        breadcrumbs={breadcrumbs}
        actions={
          !loading && activeTab === 'mine' ? (
            <Button size="sm" onClick={openCreateDialog}>
              <Plus aria-hidden />
              Создать шаблон
            </Button>
          ) : undefined
        }
      />

      {loading ? (
        <TemplatesSkeleton />
      ) : (
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full gap-4">
          <TabsList className="h-auto max-w-full self-start overflow-x-auto">
            {tabList.map((tab) => (
              <TabsTrigger key={tab.value} value={tab.value} className="h-8 px-3">
                {tab.label}
              </TabsTrigger>
            ))}
          </TabsList>

          {/* Фильтры: поиск, канал, тег, аудитория */}
          <div className="space-y-2">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <div className="relative sm:min-w-[200px] sm:flex-1">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                <Input
                  placeholder="Поиск по названию и тексту"
                  aria-label="Поиск шаблонов"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9"
                />
              </div>
              <Select value={filterChannel} onValueChange={setFilterChannel}>
                <SelectTrigger className="w-full sm:w-[160px]" aria-label="Фильтр по каналу">
                  <SelectValue placeholder="Канал" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_all">Все каналы</SelectItem>
                  {channelOptions.map((ch) => (
                    <SelectItem key={ch} value={ch}>
                      #{ch}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {activeTab === 'mine' && tagOptions.length > 0 && (
                <Select value={filterTag} onValueChange={setFilterTag}>
                  <SelectTrigger className="w-full sm:w-[150px]" aria-label="Фильтр по тегу">
                    <SelectValue placeholder="Тег" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_all">Все теги</SelectItem>
                    {tagOptions.map((tag) => (
                      <SelectItem key={tag} value={tag}>
                        {tag}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              {(activeTab === 'adm' || activeTab === 'support') && (
                <div className="flex gap-0.5 rounded-md bg-muted p-[3px]" role="group" aria-label="Аудитория">
                  {(['', 'all', 'mk'] as const).map((a) => (
                    <button
                      key={a === '' ? '_all' : a}
                      type="button"
                      aria-pressed={filterAudience === a}
                      onClick={() => setFilterAudience(a)}
                      className={cn(
                        'h-8 flex-1 rounded-[5px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
                        filterAudience === a
                          ? 'bg-background text-foreground shadow-xs'
                          : 'text-muted-foreground hover:text-foreground'
                      )}
                    >
                      {a === '' ? 'Все' : a === 'mk' ? 'МК' : 'Для всех'}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Дни: Все дни | День 1 | День 2 | ... */}
            {daysForTabs.length > 0 && (
              <div className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1" role="group" aria-label="Фильтр по дню">
                {['_all', ...daysForTabs.map(String)].map((d) => (
                  <button
                    key={d}
                    type="button"
                    aria-pressed={filterDay === d}
                    onClick={() => setFilterDay(d)}
                    className={cn(
                      'h-9 shrink-0 rounded-md px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
                      filterDay === d
                        ? 'bg-secondary text-foreground'
                        : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                    )}
                  >
                    {d === '_all' ? 'Все дни' : dayTitle(Number(d))}
                  </button>
                ))}
              </div>
            )}

            {filtersActive && (
              <div className="flex items-center gap-3 text-[13px] text-muted-foreground">
                <span>Найдено: {filteredList.length}</span>
                <Button variant="ghost" size="sm" className="h-8 px-2" onClick={resetFilters}>
                  Сбросить фильтры
                </Button>
              </div>
            )}
          </div>

          {/* Шаблоны SUP */}
          {hasAdmTab && (
            <TabsContent value="support">{renderBuiltIn('SUP')}</TabsContent>
          )}

          {/* Шаблоны ADM */}
          <TabsContent value="adm">{renderBuiltIn('ADM')}</TabsContent>

          {/* Мои шаблоны */}
          <TabsContent value="mine" className="space-y-3">
            {myTemplates.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="Шаблонов пока нет"
                description="Создайте первый: укажите канал, день, время и текст."
              >
                <Button onClick={openCreateDialog} className="mt-4" size="sm">
                  <Plus aria-hidden />
                  Создать шаблон
                </Button>
              </EmptyState>
            ) : filteredList.length === 0 ? (
              <ListEmpty hasItems filtersActive={filtersActive} onReset={resetFilters} />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] text-muted-foreground">Группировка</span>
                  <div className="flex gap-0.5 rounded-md bg-muted p-[3px]" role="group" aria-label="Группировка шаблонов">
                    {([
                      ['day', 'По дню'],
                      ['channel', 'По каналу'],
                    ] as const).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={groupMyBy === value}
                        onClick={() => setGroupMyBy(value)}
                        className={cn(
                          'h-8 rounded-[5px] px-3 text-[13px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/30',
                          groupMyBy === value
                            ? 'bg-background text-foreground shadow-xs'
                            : 'text-muted-foreground hover:text-foreground'
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-3">
                  {groupMyBy === 'channel'
                    ? channelNames.map((ch) => {
                        const items = [...(groupedByChannel[ch] ?? [])].sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                        return (
                          <GroupBlock
                            key={ch}
                            title={<span className="font-mono">{ch === 'Без канала' ? 'Без канала' : `#${ch}`}</span>}
                            count={items.length}
                            collapsible
                            collapsed={channelCollapsed.has(ch)}
                            onToggle={() => toggleChannelCollapsed(ch)}
                          >
                            {items.map(renderMineRow)}
                          </GroupBlock>
                        )
                      })
                    : days.map((day) => {
                        const items = [...(groupedByDay[day] ?? [])].sort((a, b) => a.time.localeCompare(b.time))
                        return (
                          <GroupBlock
                            key={day}
                            title={dayTitle(day)}
                            count={items.length}
                            collapsible={filterDay === '_all'}
                            collapsed={filterDay === '_all' && dayCollapsed.has(day)}
                            onToggle={() => toggleDayCollapsed(day)}
                          >
                            {items.map(renderMineRow)}
                          </GroupBlock>
                        )
                      })}
                </div>
              </>
            )}
          </TabsContent>
        </Tabs>
      )}

      {/* Диалог создания/редактирования своего шаблона */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'Создать шаблон' : 'Редактировать шаблон'}
            </DialogTitle>
            <DialogDescription>
              Личный шаблон виден только вам и доступен в пространстве во вкладке «Шаблоны».
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Канал"
                htmlFor="tpl-channel"
                required
                className="sm:col-span-2"
                hint="Выберите из списка или «Другой» и введите своё название. Проверка в Rocket.Chat ничего не блокирует."
                error={formSubmitted ? formErrors.channel : undefined}
              >
                <Select value={formChannel} onValueChange={setFormChannel}>
                  <SelectTrigger id="tpl-channel" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>
                        {o.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {formChannel === '__other__' && (
                  <Input
                    placeholder="Название канала (без #)"
                    aria-label="Название канала"
                    aria-invalid={formSubmitted && !!formErrors.channel}
                    value={formChannelOther}
                    onChange={(e) => setFormChannelOther(e.target.value)}
                    onBlur={() => setFormChannelOther((v) => normalizeChannelName(v))}
                  />
                )}
                <ChannelCheck channel={formChannel === '__other__' ? formChannelOther : formChannel} />
              </Field>
              <Field
                label="День интенсива"
                htmlFor="tpl-day"
                hint="От 1 до 14, необязательно. Для группировки шаблонов в пространстве."
                error={formSubmitted ? formErrors.day : undefined}
              >
                <Input
                  id="tpl-day"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={14}
                  placeholder="—"
                  aria-invalid={formSubmitted && !!formErrors.day}
                  value={formDay}
                  onChange={(e) => setFormDay(e.target.value)}
                />
              </Field>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field
                label="Время (примерное)"
                htmlFor="tpl-time"
                required
                error={formSubmitted ? formErrors.time : undefined}
              >
                <TimePicker
                  id="tpl-time"
                  value={formTime}
                  onChange={setFormTime}
                  invalid={formSubmitted && !!formErrors.time}
                />
              </Field>
              <Field label="Название" htmlFor="tpl-title" hint="Необязательно">
                <Input
                  id="tpl-title"
                  placeholder="Краткое название"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </Field>
            </div>
            <Field label="Теги" htmlFor="tpl-tags" hint="Через запятую, для фильтра. Необязательно.">
              <Input
                id="tpl-tags"
                placeholder="экзамен, групповой проект"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
              />
            </Field>
            <Field
              label="Текст шаблона"
              htmlFor="tpl-body"
              required
              error={formSubmitted ? formErrors.body : undefined}
            >
              <Textarea
                id="tpl-body"
                className="min-h-[180px] font-mono text-sm"
                placeholder="Введите текст анонса..."
                aria-invalid={formSubmitted && !!formErrors.body}
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-pressed={showPreview}
                onClick={() => setShowPreview(!showPreview)}
              >
                {showPreview ? <EyeOff aria-hidden /> : <Eye aria-hidden />}
                {showPreview ? 'Скрыть предпросмотр' : 'Предпросмотр'}
              </Button>
              {showPreview && (
                <div className="rounded-md border bg-muted/40 p-3">
                  <pre className="whitespace-pre-wrap font-sans text-sm">{formBody || '—'}</pre>
                </div>
              )}
            </Field>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Отмена
            </Button>
            <Button onClick={handleSaveTemplate} disabled={saving}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {dialogMode === 'create' ? 'Создать' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <ConfirmDialog
        open={!!deleteConfirmId}
        onOpenChange={(open) => { if (!open) setDeleteConfirmId(null) }}
        title={deleteTarget ? `Удалить шаблон «${deleteTarget.title || 'без названия'}»?` : 'Удалить шаблон?'}
        description="Это действие нельзя отменить."
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={() => deleteConfirmId ? handleDeleteTemplate(deleteConfirmId) : undefined}
      />

      {/* Диалог «Запланировать» по шаблону */}
      <Dialog open={scheduleDialogOpen} onOpenChange={(open) => { setScheduleDialogOpen(open); if (!open) setScheduleTemplate(null) }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Запланировать сообщение по шаблону</DialogTitle>
            <DialogDescription>
              Откроется страница пространства с заполненным текстом, каналом, датой и временем.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <Field
              label="Пространство"
              htmlFor="schedule-workspace"
              required
              hint={!workspacesLoading && workspaces.length === 0 ? 'Нет доступных пространств.' : undefined}
            >
              <Select value={scheduleWorkspaceId} onValueChange={setScheduleWorkspaceId} disabled={workspacesLoading}>
                <SelectTrigger id="schedule-workspace" className="w-full">
                  <SelectValue placeholder={workspacesLoading ? 'Загрузка...' : 'Выберите пространство'} />
                </SelectTrigger>
                <SelectContent>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>
                      {w.workspaceName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Канал" htmlFor="schedule-channel" required>
              <Select value={scheduleChannelId} onValueChange={setScheduleChannelId} disabled={!scheduleWorkspaceId || scheduleLoading}>
                <SelectTrigger id="schedule-channel" className="w-full">
                  <SelectValue placeholder={scheduleLoading ? 'Загрузка...' : 'Выберите канал'} />
                </SelectTrigger>
                <SelectContent>
                  {scheduleChannels.map((c) => (
                    <SelectItem key={c._id || c.id} value={c._id || c.id || ''}>
                      #{c.name || c.displayName || c._id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Дата" htmlFor="schedule-date">
                <DatePicker
                  id="schedule-date"
                  value={scheduleDate}
                  onChange={setScheduleDate}
                  clearable
                />
              </Field>
              <Field label="Время" htmlFor="schedule-time">
                <TimePicker
                  id="schedule-time"
                  value={scheduleTime}
                  onChange={setScheduleTime}
                />
              </Field>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setScheduleDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={goToScheduleMessage} disabled={!scheduleWorkspaceId || !scheduleChannelId}>
              Перейти к созданию
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог редактирования официального шаблона (Lead_SUP) */}
      <Dialog open={officialEditOpen} onOpenChange={(open) => { if (!open) setOfficialEditTemplate(null); setOfficialEditOpen(open) }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Редактировать официальный шаблон</DialogTitle>
            {officialEditTemplate && (
              <DialogDescription>
                Изменения применяются для всех пользователей с ролью {officialEditTemplate.scope === 'ADM' ? 'ADM' : 'SUP'}.
              </DialogDescription>
            )}
          </DialogHeader>
          {officialEditTemplate && (
            <div className="grid gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Канал"
                  htmlFor="official-channel"
                  className="sm:col-span-2"
                  hint="Выберите из списка или «Другой» и введите своё название. Проверка в Rocket.Chat ничего не блокирует."
                  error={officialSubmitted ? officialErrors.channel : undefined}
                >
                  <Select
                    value={officialEditTemplate.channel}
                    onValueChange={(v) => setOfficialEditTemplate((prev) => prev ? { ...prev, channel: v } : null)}
                  >
                    <SelectTrigger id="official-channel" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {CHANNEL_OPTIONS.map((o) => (
                        <SelectItem key={o.value} value={o.value}>
                          {o.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  {officialEditTemplate.channel === '__other__' && (
                    <Input
                      placeholder="Название канала (без #)"
                      aria-label="Название канала"
                      aria-invalid={officialSubmitted && !!officialErrors.channel}
                      value={officialEditTemplate.channelOther}
                      onChange={(e) => setOfficialEditTemplate((prev) => prev ? { ...prev, channelOther: e.target.value } : null)}
                      onBlur={() => setOfficialEditTemplate((prev) => prev ? { ...prev, channelOther: normalizeChannelName(prev.channelOther) } : null)}
                    />
                  )}
                  <ChannelCheck
                    channel={officialEditTemplate.channel === '__other__' ? officialEditTemplate.channelOther : officialEditTemplate.channel}
                  />
                </Field>
                <Field
                  label="Время (примерное)"
                  htmlFor="official-time"
                  error={officialSubmitted ? officialErrors.time : undefined}
                >
                  <TimePicker
                    id="official-time"
                    value={officialEditTemplate.time}
                    onChange={(v) => setOfficialEditTemplate((prev) => prev ? { ...prev, time: v } : null)}
                    invalid={officialSubmitted && !!officialErrors.time}
                  />
                </Field>
              </div>
              <Field label="Название" htmlFor="official-title" hint="Необязательно">
                <Input
                  id="official-title"
                  placeholder="Краткое название"
                  value={officialEditTemplate.title}
                  onChange={(e) => setOfficialEditTemplate((prev) => prev ? { ...prev, title: e.target.value } : null)}
                />
              </Field>
              <Field
                label="Текст шаблона"
                htmlFor="official-body"
                required
                error={officialSubmitted ? officialErrors.body : undefined}
              >
                <Textarea
                  id="official-body"
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="Текст анонса..."
                  aria-invalid={officialSubmitted && !!officialErrors.body}
                  value={officialEditTemplate.body}
                  onChange={(e) => setOfficialEditTemplate((prev) => prev ? { ...prev, body: e.target.value } : null)}
                />
              </Field>
            </div>
          )}
          {officialEditTemplate && (
            <DialogFooter className="sm:justify-between">
              <Button
                variant="ghost"
                className="text-destructive hover:text-destructive"
                onClick={() => setResetConfirmOpen(true)}
                disabled={officialEditSaving}
              >
                Сбросить к умолчанию
              </Button>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button variant="outline" onClick={() => { setOfficialEditOpen(false); setOfficialEditTemplate(null) }} disabled={officialEditSaving}>
                  Отмена
                </Button>
                <Button onClick={saveOfficialOverride} disabled={officialEditSaving}>
                  {officialEditSaving && <Loader2 className="animate-spin" aria-hidden />}
                  Сохранить
                </Button>
              </div>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={resetConfirmOpen}
        onOpenChange={setResetConfirmOpen}
        title="Сбросить шаблон к умолчанию?"
        description="Ваши правки текста, канала и времени будут удалены, шаблон вернётся к исходному виду для всех пользователей."
        confirmLabel="Сбросить"
        destructive
        loading={officialEditSaving}
        onConfirm={resetOfficialOverride}
      />

      {/* Диалог «История версий» */}
      <Dialog open={!!versionsOpenId} onOpenChange={(open) => { if (!open) setVersionsOpenId(null) }}>
        <DialogContent className="max-h-[80vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>История версий</DialogTitle>
            <DialogDescription>
              {versionsTemplate?.title
                ? `Шаблон «${versionsTemplate.title}». Выберите версию, чтобы вернуть её.`
                : 'Выберите версию, чтобы вернуть её.'}
            </DialogDescription>
          </DialogHeader>
          {versionsLoading ? (
            <div className="space-y-3" role="status" aria-busy="true" aria-label="Загрузка">
              {Array.from({ length: 3 }).map((_, i) => (
                <div key={i} className="space-y-2">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-12 w-full" />
                </div>
              ))}
            </div>
          ) : versions.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">Нет сохранённых версий.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {versions.map((v) => (
                <li key={v.id} className="space-y-1.5 p-3 text-sm">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-[13px] text-muted-foreground">
                        {new Date(v.createdAt).toLocaleString('ru-RU')}
                      </p>
                      <p className="truncate font-medium">
                        {v.title || 'Без названия'}
                        <span className="ml-2 font-mono text-xs font-normal text-muted-foreground">#{v.channel} · {v.time}</span>
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="shrink-0"
                      disabled={!!revertingId}
                      onClick={() => versionsOpenId && handleRevert(versionsOpenId, v.id)}
                    >
                      {revertingId === v.id && <Loader2 className="animate-spin" aria-hidden />}
                      Откатить
                    </Button>
                  </div>
                  <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2 font-sans text-xs [word-break:break-word]">
                    {v.body.slice(0, 200)}{v.body.length > 200 ? '…' : ''}
                  </pre>
                </li>
              ))}
            </ul>
          )}
        </DialogContent>
      </Dialog>
    </PageContainer>
  )
}

function TemplatesSkeleton() {
  return (
    <div className="space-y-4" role="status" aria-busy="true" aria-label="Загрузка шаблонов">
      <Skeleton className="h-9 w-72 max-w-full" />
      <div className="flex gap-2">
        <Skeleton className="h-9 flex-1" />
        <Skeleton className="h-9 w-32" />
      </div>
      <div className="divide-y rounded-lg border bg-card">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3">
            <Skeleton className="size-4 shrink-0" />
            <Skeleton className="h-4 w-10 shrink-0" />
            <Skeleton className="h-5 w-20 shrink-0" />
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="ml-auto h-8 w-24 shrink-0" />
          </div>
        ))}
      </div>
    </div>
  )
}

function ListEmpty({
  hasItems,
  filtersActive,
  onReset,
}: {
  hasItems: boolean
  filtersActive: boolean
  onReset: () => void
}) {
  if (hasItems && filtersActive) {
    return (
      <EmptyState
        icon={<SearchX />}
        title="Ничего не найдено"
        description="Измените запрос или сбросьте фильтры."
        action={{ label: 'Сбросить фильтры', onClick: onReset }}
      />
    )
  }
  return (
    <EmptyState
      icon={<FileText />}
      title="Нет шаблонов"
      description="Здесь пока ничего нет."
    />
  )
}

/** Блок группы (день/канал): заголовок со счётчиком и список строк с разделителями. */
function GroupBlock({
  title,
  count,
  collapsible,
  collapsed,
  onToggle,
  children,
}: {
  title: ReactNode
  count: number
  collapsible?: boolean
  collapsed?: boolean
  onToggle?: () => void
  children: ReactNode
}) {
  const headerInner = (
    <>
      {collapsible && (collapsed ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <ChevronDown className="size-4 shrink-0 text-muted-foreground" aria-hidden />)}
      <span className="min-w-0 truncate text-sm font-medium">{title}</span>
      <span className="ml-auto shrink-0 text-xs text-muted-foreground">{announcementsCount(count)}</span>
    </>
  )
  return (
    <section className="overflow-hidden rounded-lg border bg-card">
      {collapsible && onToggle ? (
        <button
          type="button"
          aria-expanded={!collapsed}
          className="flex min-h-10 w-full items-center gap-2 bg-muted/30 px-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/30"
          onClick={onToggle}
        >
          {headerInner}
        </button>
      ) : (
        <div className="flex min-h-10 items-center gap-2 bg-muted/30 px-3">{headerInner}</div>
      )}
      {!collapsed && <div className="divide-y border-t">{children}</div>}
    </section>
  )
}

function ChannelTag({ channel }: { channel: string }) {
  return (
    <Badge variant="muted" className="max-w-[9rem] font-mono">
      <span className="truncate">#{channel}</span>
    </Badge>
  )
}

function MyTemplateRow({
  t,
  ut,
  showChannel,
  justCopied,
  onSchedule,
  onCopy,
  onHistory,
  onEdit,
  onDelete,
}: {
  t: Template
  ut?: UserTemplate
  showChannel: boolean
  justCopied: boolean
  onSchedule: () => void
  onCopy: () => void
  onHistory?: () => void
  onEdit?: () => void
  onDelete?: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2 transition-colors hover:bg-muted/40">
      <div className="flex min-w-0 flex-1 basis-[16rem] flex-wrap items-center gap-x-2 gap-y-1">
        <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">~{t.time}</span>
        {showChannel && <ChannelTag channel={t.channel} />}
        <span className={cn('min-w-0 flex-1 basis-32 truncate text-sm font-medium', !t.title && 'text-muted-foreground')}>
          {t.title || 'Без названия'}
        </span>
        {ut?.lastSentAt ? (
          <Badge variant="success">Отправлено {formatSentAt(ut.lastSentAt)}</Badge>
        ) : (
          <Badge variant="muted">Не отправлялся</Badge>
        )}
      </div>
      <div className="ml-auto flex shrink-0 items-center gap-1">
        <Button variant="outline" size="sm" className="h-9 sm:h-8" onClick={onSchedule}>
          <CalendarClock aria-hidden />
          Запланировать
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className={cn(justCopied && 'text-primary')}
          onClick={onCopy}
          aria-label={justCopied ? 'Скопировано' : 'Копировать текст'}
          title="Копировать текст"
        >
          {justCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
        </Button>
        {onHistory && (
          <Button variant="ghost" size="icon" onClick={onHistory} aria-label="История версий" title="История версий">
            <History aria-hidden />
          </Button>
        )}
        {onEdit && (
          <Button variant="ghost" size="icon" onClick={onEdit} aria-label="Редактировать шаблон" title="Редактировать">
            <Pencil aria-hidden />
          </Button>
        )}
        {onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="text-destructive hover:text-destructive"
            onClick={onDelete}
            aria-label="Удалить шаблон"
            title="Удалить"
          >
            <Trash2 aria-hidden />
          </Button>
        )}
      </div>
    </div>
  )
}

function BuiltInList({
  openIds,
  toggleOpen,
  copyBody,
  copyFeedbackKey,
  onSchedule,
  onEditOfficial,
  groupedByDayData,
  allDayMode,
  dayCollapsed,
  onToggleDayCollapsed,
}: {
  openIds: Set<string>
  toggleOpen: (id: string) => void
  copyBody: (t: Template) => void
  copyFeedbackKey?: string | null
  onSchedule?: (t: Template) => void
  onEditOfficial?: (t: Template) => void
  groupedByDayData: Record<number, Template[]>
  allDayMode?: boolean
  dayCollapsed?: Set<number>
  onToggleDayCollapsed?: (day: number) => void
}) {
  const days = Object.keys(groupedByDayData)
    .map(Number)
    .sort((a, b) => a - b)
  const collapsedSet = dayCollapsed ?? new Set<number>()
  return (
    <div className="space-y-3">
      {days.map((day) => {
        const items = groupedByDayData[day] ?? []
        return (
          <GroupBlock
            key={day}
            title={dayTitle(day)}
            count={items.length}
            collapsible={!!allDayMode && !!onToggleDayCollapsed}
            collapsed={!!allDayMode && collapsedSet.has(day)}
            onToggle={() => onToggleDayCollapsed?.(day)}
          >
            {items.map((t) => (
              <RowBuiltIn
                key={t.id}
                t={t}
                open={openIds.has(t.id)}
                toggleOpen={toggleOpen}
                copyBody={() => copyBody(t)}
                justCopied={copyFeedbackKey === t.id}
                onSchedule={onSchedule ? () => onSchedule(t) : undefined}
                onEditOfficial={onEditOfficial ? () => onEditOfficial(t) : undefined}
              />
            ))}
          </GroupBlock>
        )
      })}
    </div>
  )
}

function RowBuiltIn({
  t,
  open,
  toggleOpen,
  copyBody,
  justCopied,
  onSchedule,
  onEditOfficial,
}: {
  t: Template
  open: boolean
  toggleOpen: (id: string) => void
  copyBody: () => void
  justCopied: boolean
  onSchedule?: () => void
  onEditOfficial?: () => void
}) {
  return (
    <div className="transition-colors hover:bg-muted/40">
      <div
        className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2"
        onClick={() => toggleOpen(t.id)}
      >
        <div className="flex min-w-0 flex-1 basis-[16rem] items-center gap-2">
          <Button
            variant="ghost"
            size="icon"
            className="-ml-1 shrink-0"
            aria-expanded={open}
            aria-label={open ? 'Свернуть текст шаблона' : 'Показать текст шаблона'}
            onClick={(e) => { e.stopPropagation(); toggleOpen(t.id) }}
          >
            {open ? <ChevronDown aria-hidden /> : <ChevronRight aria-hidden />}
          </Button>
          <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">~{t.time}</span>
          <ChannelTag channel={t.channel} />
          {t.audience === 'mk' && <Badge variant="info">МК</Badge>}
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{t.title ?? t.dayLabel ?? '—'}</span>
        </div>
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {onSchedule && (
            <Button
              variant="outline"
              size="sm"
              className="h-9 sm:h-8"
              onClick={(e) => { e.stopPropagation(); onSchedule() }}
            >
              <CalendarClock aria-hidden />
              Запланировать
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className={cn(justCopied && 'text-primary')}
            onClick={(e) => { e.stopPropagation(); copyBody() }}
            aria-label={justCopied ? 'Скопировано' : 'Копировать текст'}
            title="Копировать текст"
          >
            {justCopied ? <Check aria-hidden /> : <Copy aria-hidden />}
          </Button>
          {onEditOfficial && (
            <Button
              variant="ghost"
              size="icon"
              onClick={(e) => { e.stopPropagation(); onEditOfficial() }}
              aria-label="Редактировать шаблон"
              title="Редактировать (только Lead_SUP)"
            >
              <Pencil aria-hidden />
            </Button>
          )}
        </div>
      </div>
      {open && (
        <div className="px-3 pb-3 sm:pl-14">
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md border bg-muted/40 p-3 font-sans text-[13px] leading-relaxed">
            {t.body}
          </pre>
        </div>
      )}
    </div>
  )
}
