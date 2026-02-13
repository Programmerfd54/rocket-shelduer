"use client"

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
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
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
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
  CalendarClock,
  History,
  Hash,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn, formatLocalDate, getChannelTagColors } from '@/lib/utils'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { ListSkeletonCard } from '@/components/common/ListSkeleton'
import { EmptyState } from '@/components/common/EmptyState'
import { Construction } from 'lucide-react'

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
}

const CHANNEL_OPTIONS = [
  { value: 'adm', label: '#adm' },
  { value: 'announcements', label: '#announcements' },
  { value: 'general', label: '#general' },
  { value: 'support', label: '#support' },
  { value: 'services', label: '#services' },
  { value: '__other__', label: 'Другой (ввести ниже)' },
]

export default function TemplatesPage() {
  const router = useRouter()
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
  const [showPreview, setShowPreview] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null)
  const [filterTag, setFilterTag] = useState<string>('_all')
  const [formTags, setFormTags] = useState<string>('')
  const [versionsOpenId, setVersionsOpenId] = useState<string | null>(null)
  const [versions, setVersions] = useState<{ id: string; body: string; title: string | null; channel: string; time: string; intensiveDay: number | null; createdAt: string }[]>([])
  const [reverting, setReverting] = useState(false)
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false)
  const [scheduleTemplate, setScheduleTemplate] = useState<{ body: string; channel: string; time: string } | null>(null)
  const [workspaces, setWorkspaces] = useState<{ id: string; workspaceName: string }[]>([])
  const [scheduleWorkspaceId, setScheduleWorkspaceId] = useState('')
  const [scheduleChannels, setScheduleChannels] = useState<{ _id?: string; id?: string; name?: string; displayName?: string }[]>([])
  const [scheduleChannelId, setScheduleChannelId] = useState('')
  const [scheduleTime, setScheduleTime] = useState('09:00')
  const [scheduleDate, setScheduleDate] = useState('')
  const [scheduleLoading, setScheduleLoading] = useState(false)

  // Диалог редактирования официального шаблона (только ADMIN)
  const [officialEditOpen, setOfficialEditOpen] = useState(false)
  const [officialEditTemplate, setOfficialEditTemplate] = useState<{
    id: string
    scope: 'SUPPORT' | 'ADM'
    title: string
    body: string
  } | null>(null)
  const [officialEditSaving, setOfficialEditSaving] = useState(false)

  const loadBuiltIn = useCallback(() => {
    return fetch('/api/templates')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!d) return
        if (d.templates) setTemplates(d.templates)
        if (d.admTemplates) setAdmTemplates(d.admTemplates)
      })
  }, [])

  const openScheduleDialog = useCallback((t: { body: string; channel: string; time: string }) => {
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
    fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setWorkspaces(d?.workspaces ?? []))
      .catch(() => setWorkspaces([]))
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
        const chs = d?.channels ?? []
        setScheduleChannels(chs)
        const name = (scheduleTemplate?.channel || '').replace(/^#/, '')
        const preselect = chs.find((c: any) => (c.name || c.displayName || '').replace(/^#/, '') === name)
        setScheduleChannelId(preselect ? (preselect._id || preselect.id) : (chs[0]?._id || chs[0]?.id || ''))
      })
      .finally(() => setScheduleLoading(false))
  }, [scheduleWorkspaceId, scheduleTemplate?.channel])

  const goToScheduleMessage = useCallback(() => {
    if (!scheduleTemplate || !scheduleWorkspaceId || !scheduleChannelId) {
      toast.error('Выберите пространство и канал')
      return
    }
    const ch = scheduleChannels.find((c: any) => (c._id || c.id) === scheduleChannelId)
    sessionStorage.setItem(
      'schedule-from-template',
      JSON.stringify({
        workspaceId: scheduleWorkspaceId,
        channelId: scheduleChannelId,
        channelName: ch?.name || ch?.displayName || scheduleTemplate.channel,
        body: scheduleTemplate.body,
        time: scheduleTime,
        date: scheduleDate || undefined,
      })
    )
    setScheduleDialogOpen(false)
    setScheduleTemplate(null)
    router.push(`/dashboard/workspaces/${scheduleWorkspaceId}`)
  }, [scheduleTemplate, scheduleWorkspaceId, scheduleChannelId, scheduleChannels, scheduleTime, scheduleDate, router])

  const loadVersions = useCallback((templateId: string) => {
    setVersionsOpenId(templateId)
    fetch(`/api/templates/mine/${templateId}/versions`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setVersions(d?.versions ?? []))
      .catch(() => setVersions([]))
  }, [])

  const loadMyTemplates = useCallback(() => {
    return fetch('/api/templates/mine')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d?.templates) setMyTemplates(d.templates)
      })
  }, [])

  const openOfficialEdit = useCallback(
    (t: Template, scope: 'SUPPORT' | 'ADM') => {
      setOfficialEditTemplate({
        id: t.id,
        scope,
        title: t.title ?? '',
        body: t.body,
      })
      setOfficialEditOpen(true)
    },
    []
  )

  const saveOfficialOverride = useCallback(async () => {
    if (!officialEditTemplate) return
    setOfficialEditSaving(true)
    try {
      const res = await fetch(`/api/templates/official/${encodeURIComponent(officialEditTemplate.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: officialEditTemplate.scope,
          body: officialEditTemplate.body,
          title: officialEditTemplate.title || null,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
      toast.success('Шаблон сохранён')
      setOfficialEditOpen(false)
      setOfficialEditTemplate(null)
      loadBuiltIn()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setOfficialEditSaving(false)
    }
  }, [officialEditTemplate, loadBuiltIn])

  const resetOfficialOverride = useCallback(async () => {
    if (!officialEditTemplate) return
    setOfficialEditSaving(true)
    try {
      const res = await fetch(
        `/api/templates/official/${encodeURIComponent(officialEditTemplate.id)}?scope=${officialEditTemplate.scope}`,
        { method: 'DELETE' }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка сброса')
      toast.success('Шаблон сброшен к умолчанию')
      setOfficialEditOpen(false)
      setOfficialEditTemplate(null)
      loadBuiltIn()
    } catch (e: unknown) {
      toast.error(e instanceof Error ? e.message : 'Ошибка')
    } finally {
      setOfficialEditSaving(false)
    }
  }, [officialEditTemplate, loadBuiltIn])

  const handleRevert = useCallback(async (templateId: string, versionId: string) => {
    setReverting(true)
    try {
      const res = await fetch(`/api/templates/mine/${templateId}/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ versionId }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка отката')
      toast.success('Шаблон откатан к выбранной версии')
      setVersionsOpenId(null)
      loadMyTemplates()
    } catch (e: any) {
      toast.error(e.message || 'Ошибка')
    } finally {
      setReverting(false)
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
        if (role === 'SUPPORT' || role === 'ADMIN') setActiveTab('support')
        else if (role === 'ADM') setActiveTab('adm')
        if (role !== 'ADM' && role !== 'SUPPORT' && role !== 'ADMIN') {
          router.replace('/dashboard')
          return
        }
        return Promise.all([loadBuiltIn(), loadMyTemplates()])
      })
      .catch(() => toast.error('Ошибка загрузки шаблонов'))
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
    setShowPreview(false)
    setDialogOpen(true)
  }

  const handleSaveTemplate = async () => {
    const time = formTime.trim()
    const body = formBody.trim()
    const channel =
      formChannel === '__other__' ? formChannelOther.trim() : formChannel
    if (!time || !body) {
      toast.error('Укажите время и текст шаблона')
      return
    }
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
        const data = await res.json()
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
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Ошибка сохранения')
        toast.success('Шаблон сохранён')
        setDialogOpen(false)
        loadMyTemplates()
      }
    } catch (e: any) {
      toast.error(e.message || 'Ошибка')
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteTemplate = async (id: string) => {
    try {
      const res = await fetch(`/api/templates/mine/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Ошибка удаления')
      toast.success('Шаблон удалён')
      setDeleteConfirmId(null)
      loadMyTemplates()
    } catch {
      toast.error('Не удалось удалить')
    }
  }

  const [copyFeedbackKey, setCopyFeedbackKey] = useState<string | null>(null)
  const copyBody = async (body: string, feedbackKey?: string) => {
    try {
      await navigator.clipboard.writeText(body)
      toast.success('Текст скопирован в буфер обмена')
      if (feedbackKey) {
        setCopyFeedbackKey(feedbackKey)
        setTimeout(() => setCopyFeedbackKey(null), 2000)
      }
    } catch {
      toast.error('Не удалось скопировать')
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

  const hasAdmTab = userRole === 'SUPPORT' || userRole === 'ADMIN'
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
      (t as { tags?: string[] }).tags?.includes(filterTag)
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
    const matchTag = activeTab !== 'mine' || filterTag === '_all' || (t as { tags?: string[] }).tags?.includes(filterTag)
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

  if (userRole !== 'ADM' && userRole !== 'SUPPORT' && userRole !== 'ADMIN' && !loading) {
    return null
  }

  // Вкладка «Шаблоны» скрыта для не-админов — показываем заглушку
  if (!loading && userRole !== 'ADMIN' && !templatesTabVisible) {
    return (
      <div className="p-4 md:p-6 max-w-4xl mx-auto">
        <Breadcrumbs
          items={[
            { label: 'Дашборд', href: '/dashboard' },
            { label: 'Шаблоны анонсов', current: true },
          ]}
          className="mb-4"
        />
        <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <CardContent className="p-8 sm:p-12 flex flex-col items-center justify-center text-center min-h-[280px]">
            <Construction className="h-12 w-12 text-muted-foreground mb-4" aria-hidden />
            <h2 className="text-lg font-semibold mb-2">Вкладка временно недоступна</h2>
            <p className="text-muted-foreground max-w-md">{TEMPLATES_PLACEHOLDER_MESSAGE}</p>
            <Button variant="outline" className="mt-6 rounded-lg" onClick={() => router.push('/dashboard')}>
              На главную
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  const tabList =
    userRole === 'SUPPORT' || userRole === 'ADMIN'
      ? [
          { value: 'support', label: 'Шаблоны SUPPORT' },
          { value: 'adm', label: 'Шаблоны ADM' },
          { value: 'mine', label: 'Мои шаблоны' },
        ]
      : [
          { value: 'adm', label: 'Шаблоны ADM' },
          { value: 'mine', label: 'Мои шаблоны' },
        ]

  return (
    <div className="p-4 md:p-6 max-w-4xl mx-auto">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Шаблоны анонсов', current: true },
        ]}
        className="mb-4"
      />
      <div className="flex flex-col gap-6">
        <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
            <h2 className="text-xl font-semibold flex items-center gap-2 tracking-tight">
              <FileText className="h-6 w-6" />
              Шаблоны анонсов
            </h2>
            <p className="text-sm text-muted-foreground mt-0.5">
              Встроенные шаблоны по каналу и дню; свои шаблоны — во вкладке «Мои шаблоны». Они подтягиваются в пространство.
            </p>
          </div>
        </Card>

        {loading ? (
          <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
            <CardContent className="p-4 sm:p-6">
              <ListSkeletonCard lines={5} />
            </CardContent>
          </Card>
        ) : (
          <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
            <CardContent className="p-4 sm:p-6">
          <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
            <div className="rounded-xl bg-muted/30 p-1.5 border border-border/60 mb-4">
              <TabsList className="flex flex-wrap h-auto gap-1 p-0 bg-transparent">
                {tabList.map((tab) => (
                  <TabsTrigger
                    key={tab.value}
                    value={tab.value}
                    className="flex-1 min-w-0 data-[state=active]:bg-background data-[state=active]:shadow-sm rounded-lg px-4 py-2 text-sm font-medium"
                  >
                    {tab.label}
                  </TabsTrigger>
                ))}
              </TabsList>
            </div>

            {/* Фильтры: поиск, канал, тег, аудитория */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
              <div className="relative flex-1 min-w-[180px]">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Поиск..."
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="pl-9 rounded-lg border-border/80"
                />
              </div>
              <Select value={filterChannel} onValueChange={setFilterChannel}>
                <SelectTrigger className="w-[140px] rounded-lg border-border/80">
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
                  <SelectTrigger className="w-[130px] rounded-lg border-border/80">
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
                <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
                  {(['', 'all', 'mk'] as const).map((a) => (
                    <Button
                      key={a === '' ? '_all' : a}
                      variant="ghost"
                      size="sm"
                      className={cn("rounded-md h-8", (filterAudience === a) && "bg-background shadow-sm")}
                      onClick={() => setFilterAudience(a)}
                    >
                      {a === '' ? 'Все' : a === 'mk' ? 'МК' : 'all'}
                    </Button>
                  ))}
                </div>
              )}
            </div>

            {/* Табы по дням: Все дни | День 1 | День 2 | ... */}
            {daysForTabs.length > 0 && (
              <div className="rounded-xl bg-muted/30 p-1.5 border border-border/60 mb-4">
                <div className="flex flex-wrap gap-1">
                  <button
                    type="button"
                    onClick={() => setFilterDay('_all')}
                    className={cn(
                      "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                      filterDay === '_all' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Все дни
                  </button>
                  {daysForTabs.map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => setFilterDay(String(d))}
                      className={cn(
                        "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                        filterDay === String(d) ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {d === 0 ? 'Без дня' : `День ${d}`}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Шаблоны SUP */}
            {hasAdmTab && (
              <TabsContent value="support" className="mt-2">
                <BuiltInList
                  list={[]}
                  openIds={openIds}
                  toggleOpen={toggleOpen}
                  copyBody={(t) => copyBody(t.body, t.id)}
                  copyFeedbackKey={copyFeedbackKey}
                  onSchedule={(t) => openScheduleDialog({ body: t.body, channel: t.channel, time: t.time })}
                  onEditOfficial={userRole === 'ADMIN' ? (t) => openOfficialEdit(t, 'SUPPORT') : undefined}
                  groupedByDay
                  groupedByDayData={groupedByDay}
                  allDayMode={filterDay === '_all'}
                  dayCollapsed={dayCollapsed}
                  onToggleDayCollapsed={(day) => setDayCollapsed((s) => { const next = new Set(s); if (next.has(day)) next.delete(day); else next.add(day); return next })}
                />
                {filteredList.length === 0 && (
                  <p className="text-center text-muted-foreground py-8">Нет шаблонов.</p>
                )}
              </TabsContent>
            )}

            {/* Шаблоны ADM */}
            <TabsContent value="adm" className="mt-2">
              <BuiltInList
                list={[]}
                openIds={openIds}
                toggleOpen={toggleOpen}
                copyBody={(t) => copyBody(t.body, t.id)}
                copyFeedbackKey={copyFeedbackKey}
                onSchedule={(t) => openScheduleDialog({ body: t.body, channel: t.channel, time: t.time })}
                onEditOfficial={userRole === 'ADMIN' ? (t) => openOfficialEdit(t, 'ADM') : undefined}
                groupedByDay
                groupedByDayData={groupedByDay}
                allDayMode={filterDay === '_all'}
                dayCollapsed={dayCollapsed}
                onToggleDayCollapsed={(day) => setDayCollapsed((s) => { const next = new Set(s); if (next.has(day)) next.delete(day); else next.add(day); return next })}
              />
              {filteredList.length === 0 && (
                <p className="text-center text-muted-foreground py-8">Нет шаблонов.</p>
              )}
            </TabsContent>

            {/* Мои шаблоны */}
            <TabsContent value="mine" className="mt-2 space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-muted-foreground">
                  Ваши шаблоны отображаются и в созданном пространстве (вкладка «Шаблоны»).
                </p>
                <Button onClick={openCreateDialog} className="rounded-lg shadow-sm">
                  <Plus className="h-4 w-4 mr-2" />
                  Создать шаблон
                </Button>
              </div>
              {myTemplates.length === 0 ? (
                <EmptyState
                  icon={<FileText className="w-8 h-8" />}
                  title="Нет шаблонов"
                  description="Создайте первый — укажите канал, день, время и текст."
                  children={
                    <Button onClick={openCreateDialog} className="mt-4 rounded-lg gap-2" size="sm">
                      <Plus className="w-4 h-4" />
                      Создать шаблон
                    </Button>
                  }
                />
              ) : filteredList.length === 0 ? (
                <p className="text-center text-muted-foreground py-8">Нет шаблонов по фильтрам.</p>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs text-muted-foreground">Группировка:</span>
                    <div className="flex gap-1 rounded-lg border border-border/60 bg-muted/20 p-1">
                      <Button
                        type="button"
                        variant={groupMyBy === 'day' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 rounded-md text-xs"
                        onClick={() => setGroupMyBy('day')}
                      >
                        По дню
                      </Button>
                      <Button
                        type="button"
                        variant={groupMyBy === 'channel' ? 'secondary' : 'ghost'}
                        size="sm"
                        className="h-7 rounded-md text-xs"
                        onClick={() => setGroupMyBy('channel')}
                      >
                        По каналу
                      </Button>
                    </div>
                  </div>
                  {groupMyBy === 'channel' ? (
                    channelNames.map((ch) => {
                      const collapsed = channelCollapsed.has(ch)
                      const items = (groupedByChannel[ch] ?? []).sort((a, b) => (a.time || '').localeCompare(b.time || ''))
                      const tagColors = getChannelTagColors(ch === 'Без канала' ? '' : ch)
                      return (
                        <div key={ch} className="rounded-xl border border-border/70 bg-muted/5 overflow-hidden">
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-2 px-4 py-3 font-medium text-sm hover:bg-muted/20 transition-colors"
                            onClick={() => setChannelCollapsed((s) => { const next = new Set(s); if (next.has(ch)) next.delete(ch); else next.add(ch); return next })}
                          >
                            <div className={cn("inline-flex items-center gap-1.5 rounded-lg border-l-4 pl-2 pr-2.5 py-0.5", tagColors.bar, tagColors.bg, tagColors.text)}>
                              <Hash className="w-3.5 h-3.5 opacity-80" />
                              <span className="font-medium text-xs">#{ch === 'Без канала' ? '—' : ch}</span>
                            </div>
                            <span className="text-muted-foreground text-xs">{items.length} анонсов</span>
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                          {!collapsed && (
                            <div className="divide-y divide-border/40">
                              {items.map((t) => {
                                const ut = myTemplates.find((m) => m.id === t.id)
                                const tTagColors = getChannelTagColors(t.channel)
                                return (
                                  <div key={t.id} className="flex items-center gap-2 px-4 py-3 hover:bg-muted/10 flex-wrap">
                                    <span className="text-muted-foreground tabular-nums w-12 shrink-0 text-sm">~{t.time}</span>
                                    <span className="flex-1 truncate text-sm font-medium">{t.title || '(без названия)'}</span>
                                    <Button variant="outline" size="sm" className="rounded-lg border-border/80 shrink-0" onClick={() => openScheduleDialog({ body: t.body, channel: t.channel, time: t.time })}>
                                      <CalendarClock className="h-4 w-4 mr-1" />
                                      Запланировать
                                    </Button>
                                    <Button variant="outline" size="sm" className={cn("rounded-lg border-border/80 shrink-0", copyFeedbackKey === t.id && "bg-primary/10 border-primary/50 text-primary")} onClick={() => copyBody(t.body, t.id)} aria-label={copyFeedbackKey === t.id ? 'Скопировано' : 'Копировать'}>
                                      {copyFeedbackKey === t.id ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                                      {copyFeedbackKey === t.id ? 'Скопировано' : 'Копировать'}
                                    </Button>
                                    {ut && (
                                      <>
                                        <Button variant="ghost" size="sm" className="rounded-lg shrink-0" onClick={() => loadVersions(ut.id)} title="История версий">
                                          <History className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="rounded-lg shrink-0" onClick={() => openEditDialog(ut)}>
                                          <Pencil className="h-4 w-4" />
                                        </Button>
                                        <Button variant="ghost" size="sm" className="rounded-lg shrink-0 text-destructive" onClick={() => setDeleteConfirmId(t.id)}>
                                          <Trash2 className="h-4 w-4" />
                                        </Button>
                                      </>
                                    )}
                                  </div>
                                )
                              })}
                            </div>
                          )}
                        </div>
                      )
                    })
                  ) : (
                  days.map((day) => {
                    const collapsed = filterDay === '_all' && dayCollapsed.has(day)
                    const items = (groupedByDay[day] ?? []).sort((a, b) => a.time.localeCompare(b.time))
                    return (
                      <div key={day} className="rounded-xl border border-border/70 bg-muted/5 overflow-hidden">
                        {filterDay === '_all' ? (
                          <button
                            type="button"
                            className="w-full flex items-center justify-between gap-2 px-4 py-3 font-medium text-sm hover:bg-muted/20 transition-colors"
                            onClick={() => setDayCollapsed((s) => { const next = new Set(s); if (next.has(day)) next.delete(day); else next.add(day); return next })}
                          >
                            <span>{day === 0 ? 'Без дня' : `День ${day}`}</span>
                            <span className="text-muted-foreground text-xs">{items.length} анонсов</span>
                            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                          </button>
                        ) : (
                          <div className="px-4 py-2 bg-muted/20 font-medium text-sm border-b border-border/60">
                            {day === 0 ? 'Без дня' : `День ${day}`}
                          </div>
                        )}
                        {!collapsed && (
                          <div className="divide-y divide-border/40">
                            {items.map((t) => {
                              const ut = myTemplates.find((m) => m.id === t.id)
                              const tagColors = getChannelTagColors(t.channel)
                              return (
                                <div
                                  key={t.id}
                                  className="flex items-center gap-2 px-4 py-3 hover:bg-muted/10 flex-wrap"
                                >
                                  <span className="text-muted-foreground tabular-nums w-12 shrink-0 text-sm">~{t.time}</span>
                                  <div className={cn("inline-flex items-center gap-1.5 rounded-lg border-l-4 pl-2 pr-2.5 py-1 shrink-0 min-w-0", tagColors.bar, tagColors.bg, tagColors.text)}>
                                    <Hash className="w-3.5 h-3.5 opacity-80" />
                                    <span className="font-medium text-xs truncate">#{t.channel}</span>
                                  </div>
                                  <span className="flex-1 truncate text-sm font-medium">{t.title || '(без названия)'}</span>
                                  <Button variant="outline" size="sm" className="rounded-lg border-border/80 shrink-0" onClick={() => openScheduleDialog({ body: t.body, channel: t.channel, time: t.time })}>
                                    <CalendarClock className="h-4 w-4 mr-1" />
                                    Запланировать
                                  </Button>
                                  <Button variant="outline" size="sm" className={cn("rounded-lg border-border/80 shrink-0", copyFeedbackKey === t.id && "bg-primary/10 border-primary/50 text-primary")} onClick={() => copyBody(t.body, t.id)} aria-label={copyFeedbackKey === t.id ? 'Скопировано' : 'Копировать'}>
                                    {copyFeedbackKey === t.id ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
                                    {copyFeedbackKey === t.id ? 'Скопировано' : 'Копировать'}
                                  </Button>
                                  {ut && (
                                    <>
                                      <Button variant="ghost" size="sm" className="rounded-lg shrink-0" onClick={() => loadVersions(ut.id)} title="История версий">
                                        <History className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="rounded-lg shrink-0" onClick={() => openEditDialog(ut)}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <Button variant="ghost" size="sm" className="rounded-lg shrink-0 text-destructive" onClick={() => setDeleteConfirmId(t.id)}>
                                        <Trash2 className="h-4 w-4" />
                                      </Button>
                                    </>
                                  )}
                                </div>
                              )
                            })}
                          </div>
                        )}
                      </div>
                    )
                  })
                  )}
                </div>
              )}
            </TabsContent>
          </Tabs>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Диалог создания/редактирования своего шаблона */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent
          className="max-w-2xl max-h-[90vh] overflow-y-auto"
          onKeyDown={(e) => {
            if (e.key === 'Escape') setDialogOpen(false)
          }}
        >
          <DialogHeader>
            <DialogTitle>
              {dialogMode === 'create' ? 'Создать шаблон' : 'Редактировать шаблон'}
            </DialogTitle>
          </DialogHeader>
            <div className="grid gap-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Канал</Label>
                <Select value={formChannel} onValueChange={setFormChannel}>
                  <SelectTrigger>
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
                    value={formChannelOther}
                    onChange={(e) => setFormChannelOther(e.target.value)}
                    className="mt-2"
                  />
                )}
              </div>
              <div className="space-y-2">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Label className="cursor-help">День интенсива (1–14, необязательно)</Label>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-xs">
                    Номер дня интенсива для группировки шаблонов в пространстве (День 1, День 2 и т.д.).
                  </TooltipContent>
                </Tooltip>
                <Input
                  type="number"
                  min={1}
                  max={14}
                  placeholder="—"
                  value={formDay}
                  onChange={(e) => setFormDay(e.target.value)}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Время (примерное)</Label>
                <Input
                  type="text"
                  placeholder="09:00"
                  value={formTime}
                  onChange={(e) => setFormTime(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Название (необязательно)</Label>
                <Input
                  placeholder="Краткое название"
                  value={formTitle}
                  onChange={(e) => setFormTitle(e.target.value)}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Теги (через запятую, для фильтра)</Label>
              <Input
                placeholder="экзамен, групповой проект"
                value={formTags}
                onChange={(e) => setFormTags(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label>Текст шаблона</Label>
              <Textarea
                className="min-h-[180px] font-mono text-sm"
                placeholder="Введите текст анонса..."
                value={formBody}
                onChange={(e) => setFormBody(e.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setShowPreview(!showPreview)}
              >
                <Eye className="h-4 w-4 mr-2" />
                {showPreview ? 'Скрыть предпросмотр' : 'Предпросмотр'}
              </Button>
              {showPreview && (
                <div className="rounded-md border bg-muted/30 p-4 mt-2">
                  <pre className="text-sm whitespace-pre-wrap font-sans">{formBody || '—'}</pre>
                </div>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={handleSaveTemplate} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {dialogMode === 'create' ? 'Создать' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Подтверждение удаления */}
      <AlertDialog open={!!deleteConfirmId} onOpenChange={() => setDeleteConfirmId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить шаблон?</AlertDialogTitle>
            <AlertDialogDescription>
              Это действие нельзя отменить.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteConfirmId && handleDeleteTemplate(deleteConfirmId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Диалог «Запланировать» по шаблону */}
      <Dialog open={scheduleDialogOpen} onOpenChange={(open) => { setScheduleDialogOpen(open); if (!open) setScheduleTemplate(null) }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Запланировать сообщение по шаблону</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Пространство</Label>
              <Select value={scheduleWorkspaceId} onValueChange={setScheduleWorkspaceId}>
                <SelectTrigger>
                  <SelectValue placeholder="Выберите пространство" />
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
            <div className="space-y-2">
              <Label>Канал</Label>
              <Select value={scheduleChannelId} onValueChange={setScheduleChannelId} disabled={!scheduleWorkspaceId || scheduleLoading}>
                <SelectTrigger>
                  <SelectValue placeholder={scheduleLoading ? 'Загрузка...' : 'Выберите канал'} />
                </SelectTrigger>
                <SelectContent>
                  {scheduleChannels.map((c: any) => (
                    <SelectItem key={c._id || c.id} value={c._id || c.id}>
                      #{c.name || c.displayName || c._id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Дата</Label>
                <Input
                  type="date"
                  value={scheduleDate}
                  onChange={(e) => setScheduleDate(e.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label>Время</Label>
                <Input
                  type="time"
                  value={scheduleTime}
                  onChange={(e) => setScheduleTime(e.target.value)}
                />
              </div>
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

      {/* Диалог редактирования официального шаблона (ADMIN) */}
      <Dialog open={officialEditOpen} onOpenChange={(open) => { if (!open) setOfficialEditTemplate(null); setOfficialEditOpen(open) }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Редактировать официальный шаблон</DialogTitle>
          </DialogHeader>
          {officialEditTemplate && (
            <div className="grid gap-4 py-4">
              <p className="text-sm text-muted-foreground">
                Изменения применяются для всех пользователей с ролью {officialEditTemplate.scope === 'ADM' ? 'ADM' : 'SUPPORT'}.
              </p>
              <div className="space-y-2">
                <Label>Название (необязательно)</Label>
                <Input
                  placeholder="Краткое название"
                  value={officialEditTemplate.title}
                  onChange={(e) => setOfficialEditTemplate((prev) => prev ? { ...prev, title: e.target.value } : null)}
                />
              </div>
              <div className="space-y-2">
                <Label>Текст шаблона</Label>
                <Textarea
                  className="min-h-[200px] font-mono text-sm"
                  placeholder="Текст анонса..."
                  value={officialEditTemplate.body}
                  onChange={(e) => setOfficialEditTemplate((prev) => prev ? { ...prev, body: e.target.value } : null)}
                />
              </div>
            </div>
          )}
          {officialEditTemplate && (
            <DialogFooter>
              <Button
                variant="outline"
                className="mr-auto text-destructive"
                onClick={resetOfficialOverride}
                disabled={officialEditSaving}
              >
                Сбросить к умолчанию
              </Button>
              <Button variant="outline" onClick={() => { setOfficialEditOpen(false); setOfficialEditTemplate(null) }}>
                Отмена
              </Button>
              <Button onClick={saveOfficialOverride} disabled={officialEditSaving}>
                {officialEditSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Сохранить
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* Диалог «История версий» */}
      <Dialog open={!!versionsOpenId} onOpenChange={(open) => { if (!open) setVersionsOpenId(null) }}>
        <DialogContent className="max-w-lg max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>История версий</DialogTitle>
          </DialogHeader>
          <div className="space-y-2 py-4">
            {versions.length === 0 && !versionsOpenId ? null : versions.length === 0 ? (
              <p className="text-sm text-muted-foreground">Нет сохранённых версий.</p>
            ) : (
              versions.map((v) => (
                <div key={v.id} className="rounded-lg border p-3 text-sm">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      {new Date(v.createdAt).toLocaleString('ru-RU')} — #{v.channel} {v.time}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={reverting}
                      onClick={() => versionsOpenId && handleRevert(versionsOpenId, v.id)}
                    >
                      {reverting ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Откатить'}
                    </Button>
                  </div>
                  {v.title && <p className="font-medium mt-1">{v.title}</p>}
                  <pre className="text-xs mt-1 overflow-x-auto whitespace-pre-wrap max-h-24 overflow-y-auto bg-muted/30 p-2 rounded [word-break:break-word]">
                    {v.body.slice(0, 200)}{v.body.length > 200 ? '…' : ''}
                  </pre>
                </div>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  )
}

function BuiltInList({
  list,
  openIds,
  toggleOpen,
  copyBody,
  copyFeedbackKey,
  onSchedule,
  onEditOfficial,
  groupedByDay,
  groupedByDayData,
  allDayMode,
  dayCollapsed,
  onToggleDayCollapsed,
}: {
  list: Template[]
  openIds: Set<string>
  toggleOpen: (id: string) => void
  copyBody: (t: Template) => void
  copyFeedbackKey?: string | null
  onSchedule?: (t: Template) => void
  onEditOfficial?: (t: Template) => void
  groupedByDay?: boolean
  groupedByDayData?: Record<number, Template[]>
  allDayMode?: boolean
  dayCollapsed?: Set<number>
  onToggleDayCollapsed?: (day: number) => void
}) {
  if (groupedByDay && groupedByDayData) {
    const days = Object.keys(groupedByDayData)
      .map(Number)
      .sort((a, b) => a - b)
    const collapsedSet = dayCollapsed ?? new Set<number>()
    return (
      <div className="space-y-3">
        {days.map((day) => {
          const collapsed = allDayMode && collapsedSet.has(day)
          const items = groupedByDayData[day] ?? []
          return (
            <div key={day} className="rounded-xl border border-border/70 bg-muted/5 overflow-hidden">
              {allDayMode && onToggleDayCollapsed ? (
                <button
                  type="button"
                  className="w-full flex items-center justify-between gap-2 px-4 py-3 font-medium text-sm hover:bg-muted/20 transition-colors"
                  onClick={() => onToggleDayCollapsed(day)}
                >
                  <span>{day === 0 ? 'Без дня' : `День ${day}`}</span>
                  <span className="text-muted-foreground text-xs">{items.length} анонсов</span>
                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                </button>
              ) : (
                <div className="px-4 py-2 bg-muted/20 font-medium text-sm border-b border-border/60">
                  {day === 0 ? 'Без дня' : `День ${day}`}
                </div>
              )}
              {!collapsed && (
                <div className="divide-y divide-border/40">
                  {items.map((t) => (
                    <RowBuiltIn
                      key={t.id}
                      t={t}
                      openIds={openIds}
                      toggleOpen={toggleOpen}
                      copyBody={() => copyBody(t)}
                      copyFeedbackKey={copyFeedbackKey}
                      onSchedule={onSchedule ? () => onSchedule(t) : undefined}
                      onEditOfficial={onEditOfficial ? () => onEditOfficial(t) : undefined}
                    />
                  ))}
                </div>
              )}
            </div>
          )
        })}
      </div>
    )
  }
  return (
    <div className="divide-y divide-border/40 rounded-xl border border-border/70 bg-muted/5">
      {list.map((t) => (
        <RowBuiltIn
          key={t.id}
          t={t}
          openIds={openIds}
          toggleOpen={toggleOpen}
          copyBody={() => copyBody(t)}
          copyFeedbackKey={copyFeedbackKey}
          onSchedule={onSchedule ? () => onSchedule(t) : undefined}
          onEditOfficial={onEditOfficial ? () => onEditOfficial(t) : undefined}
        />
      ))}
      {list.length === 0 && (
        <p className="text-center text-muted-foreground py-8">Нет шаблонов.</p>
      )}
    </div>
  )
}

function RowBuiltIn({
  t,
  openIds,
  toggleOpen,
  copyBody,
  copyFeedbackKey,
  onSchedule,
  onEditOfficial,
}: {
  t: Template
  openIds: Set<string>
  toggleOpen: (id: string) => void
  copyBody: () => void
  copyFeedbackKey?: string | null
  onSchedule?: () => void
  onEditOfficial?: () => void
}) {
  const justCopied = copyFeedbackKey === t.id
  const tagColors = getChannelTagColors(t.channel)
  return (
    <div className="rounded-xl border border-transparent hover:bg-muted/10 transition-colors overflow-hidden">
      <div
        className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-wrap"
        onClick={() => toggleOpen(t.id)}
      >
        <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg" onClick={(e) => { e.stopPropagation(); toggleOpen(t.id) }}>
          {openIds.has(t.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </Button>
        <span className="text-muted-foreground tabular-nums w-12 shrink-0 text-sm">~{t.time}</span>
        <div className={cn("inline-flex items-center gap-1.5 rounded-lg border-l-4 pl-2 pr-2.5 py-1 shrink-0 min-w-0", tagColors.bar, tagColors.bg, tagColors.text)}>
          <Hash className="w-3.5 h-3.5 opacity-80" />
          <span className="font-medium text-xs truncate">#{t.channel}</span>
        </div>
        {t.audience === 'mk' && <Badge variant="secondary" className="shrink-0 rounded-full text-xs">МК</Badge>}
        <span className="flex-1 truncate text-sm font-medium min-w-0">{t.title ?? (t as Template).dayLabel ?? '—'}</span>
        {onSchedule && (
          <Button variant="outline" size="sm" className="shrink-0 rounded-lg border-border/80" onClick={(e) => { e.stopPropagation(); onSchedule() }}>
            <CalendarClock className="h-4 w-4 mr-1" />
            Запланировать
          </Button>
        )}
        {onEditOfficial && (
          <Button variant="outline" size="sm" className="shrink-0 rounded-lg border-border/80" onClick={(e) => { e.stopPropagation(); onEditOfficial() }} title="Редактировать (только для суперпользователя)">
            <Pencil className="h-4 w-4 mr-1" />
            Редактировать
          </Button>
        )}
        <Button variant="outline" size="sm" className={cn("shrink-0 rounded-lg border-border/80", justCopied && "bg-primary/10 border-primary/50 text-primary")} onClick={(e) => { e.stopPropagation(); copyBody() }} aria-label={justCopied ? 'Скопировано' : 'Копировать'}>
          {justCopied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
          {justCopied ? 'Скопировано' : 'Копировать'}
        </Button>
      </div>
      {openIds.has(t.id) && (
        <div className="px-4 pb-4 pt-0 pl-14">
          <pre className="text-xs rounded-xl p-4 bg-muted/30 overflow-x-auto whitespace-pre-wrap font-sans border border-border/60">
            {t.body}
          </pre>
          <Button variant="ghost" size="sm" className={cn("mt-2 rounded-lg", justCopied && "text-primary")} onClick={copyBody} aria-label={justCopied ? 'Скопировано' : 'Копировать текст'}>
            {justCopied ? <Check className="h-4 w-4 mr-1" /> : <Copy className="h-4 w-4 mr-1" />}
            {justCopied ? 'Скопировано' : 'Копировать текст'}
          </Button>
        </div>
      )}
    </div>
  )
}
