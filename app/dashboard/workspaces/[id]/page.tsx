"use client"

import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { 
  ArrowLeft, 
  Hash, 
  MessageSquare, 
  Plus, 
  Search,
  RefreshCw,
  Clock,
  CheckCircle2,
  XCircle,
  Archive,
  Star,
  Smile,
  Upload,
  Users,
  UserPlus,
  LogIn,
  AlertTriangle
} from 'lucide-react'
import { toast } from 'sonner'
import MessageDialog from '@/components/_components/message-dialog'
import { WorkspaceEditDialog } from '@/components/common/WorkspaceEditDialog'
import Link from 'next/link'
import CompactMessages from '@/components/_components/common/CompactMessage'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { cn, getInitials, generateAvatarColor, getChannelTagColors, messageStatusBadgeClasses } from '@/lib/utils'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { EmptyState } from '@/components/common/EmptyState'
import { VirtualList } from '@/components/_components/VirtualList'
import { Trash2, RotateCcw, ChevronDown, ChevronRight, ChevronUp, Copy, FileText } from 'lucide-react'
import { Calendar, ExternalLink } from 'lucide-react'

export default function WorkspaceDetailPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string

  const [workspace, setWorkspace] = useState<any>(null)
  const [channels, setChannels] = useState([])
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [externalStatuses, setExternalStatuses] = useState<Record<string, 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'>>({})
  const [selectedMessageChannelId, setSelectedMessageChannelId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<string>('channels')
  const [channelView, setChannelView] = useState<'all' | 'favorites'>('all')
  const [channelSort, setChannelSort] = useState<'name' | 'messages' | 'public_first'>('name')
  const [channelViewMode, setChannelViewMode] = useState<'grid' | 'list'>('grid')
  const [favoriteChannelIds, setFavoriteChannelIds] = useState<Set<string>>(new Set())
  const [currentUserRole, setCurrentUserRole] = useState<string>('USER')
  const [userVolunteerIntensive, setUserVolunteerIntensive] = useState<string | null>(null)
  const [userVolunteerExpiresAt, setUserVolunteerExpiresAt] = useState<string | null>(null)
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [messageFilterFromStats, setMessageFilterFromStats] = useState<string | null>(null)
  /** Фильтр по автору сообщений (многопользовательское пространство) */
  const [messageFilterByUserId, setMessageFilterByUserId] = useState<string | null>(null)
  /** Период просмотра сообщений: все, 2 недели, период интенсива */
  const [messagePeriodFilter, setMessagePeriodFilter] = useState<'all' | '2weeks' | 'intensive'>('all')
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  /** Назначенные на пространство (SUP/ADMIN) */
  const [workspaceAssignments, setWorkspaceAssignments] = useState<{
    id: string
    userId: string
    user: { id: string; name: string | null; email: string; username?: string | null; role: string; avatarUrl?: string | null }
    assignedBy: { id: string; name: string | null; email: string }
    createdAt: string
  }[]>([])
  /** Владелец пространства (из assign-adm GET) для блока «Участники» */
  const [workspaceOwner, setWorkspaceOwner] = useState<{ id: string; name: string | null; email: string; username?: string | null; role: string; avatarUrl?: string | null } | null>(null)
  const [assignDialogOpen, setAssignDialogOpen] = useState(false)
  const [assignSelectedUserId, setAssignSelectedUserId] = useState<string>('')
  const [assignLoading, setAssignLoading] = useState(false)
  const [assignCandidates, setAssignCandidates] = useState<{ id: string; name: string | null; email: string; role: string }[]>([])
  const [assignCandidatesLoading, setAssignCandidatesLoading] = useState(false)
  const [leaveAssignmentLoading, setLeaveAssignmentLoading] = useState(false)
  /** Диалог «Подключиться к пространству» для назначенного без своего подключения */
  const [confirmAssignmentOpen, setConfirmAssignmentOpen] = useState(false)
  const [confirmAssignmentUsername, setConfirmAssignmentUsername] = useState('')
  const [confirmAssignmentPassword, setConfirmAssignmentPassword] = useState('')
  const [confirmAssignmentLoading, setConfirmAssignmentLoading] = useState(false)
  /** Сворачивание блока «Назначенные администраторы» */
  const [assignmentsCollapsed, setAssignmentsCollapsed] = useState(false)
  const [workspaceActionLog, setWorkspaceActionLog] = useState<{
    lastEmojiImport: { userName: string | null; userEmail: string; at: string } | null
    lastUsersAdd: { userName: string | null; userEmail: string; at: string } | null
  } | null>(null)
  /** Ограничения вкладок для SUP/ADM (от ADMIN). ADMIN всегда все true. */
  const [tabRestrictions, setTabRestrictions] = useState<{ templates: boolean; emojiImport: boolean; usersAdd: boolean } | null>(null)
  
  // Message dialog state
  const [showMessageDialog, setShowMessageDialog] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<any>(null)
  const [editingMessage, setEditingMessage] = useState<any>(null)
  /** Подстановка из шаблона (страница «Шаблоны» → Запланировать) */
  const [scheduleFromTemplate, setScheduleFromTemplate] = useState<{ body: string; time: string; date?: string } | null>(null)
  /** Текст, скопированный из шаблона на этой странице — подставляется в форму при открытии диалога сообщения */
  const [templateCopiedBody, setTemplateCopiedBody] = useState<string | null>(null)

  // Emoji import state
  const [emojiImporting, setEmojiImporting] = useState(false)
  const [emojiImportProgress, setEmojiImportProgress] = useState<{
    current: number
    total: number
    uploaded: number
    skipped: number
    errorsCount: number
  } | null>(null)
  const [emojiImportInterrupted, setEmojiImportInterrupted] = useState<{
    current: number
    total: number
    uploaded: number
    skipped: number
    errorsCount: number
  } | null>(null)
  const [emojiAdminUsername, setEmojiAdminUsername] = useState('')
  const [emojiAdminPassword, setEmojiAdminPassword] = useState('')
  const [emojiImportResult, setEmojiImportResult] = useState<{
    uploaded: number
    skipped: number
    total: number
    errors?: string[]
  } | null>(null)
  const [lastEmojiImportStatus, setLastEmojiImportStatus] = useState<{
    date: string
    uploaded: number
    skipped: number
    total: number
    errorsCount: number
    errors?: string[]
  } | null>(null)
  const DEFAULT_EMOJI_YAML_URL = 'https://raw.githubusercontent.com/Programmerfd54/emoji/refs/heads/main/emojis.yaml'
  const [emojiYamlUrl, setEmojiYamlUrl] = useState(DEFAULT_EMOJI_YAML_URL)
  const [emojiPreview, setEmojiPreview] = useState<{ total: number; names: string[] } | null>(null)
  const [emojiPreviewLoading, setEmojiPreviewLoading] = useState(false)
  const [emojiConfirmOpen, setEmojiConfirmOpen] = useState(false)
  const [emojiResultErrorsExpanded, setEmojiResultErrorsExpanded] = useState(false)
  const [lastEmojiErrorsExpanded, setLastEmojiErrorsExpanded] = useState(false)
  const [emojiPreviewListVisible, setEmojiPreviewListVisible] = useState(false)
  const emojiImportAbortRef = useRef<AbortController | null>(null)

  // Добавление пользователей (админка)
  const [usersAddAdminUsername, setUsersAddAdminUsername] = useState('')
  const [usersAddAdminPassword, setUsersAddAdminPassword] = useState('')
  const [usersLogins, setUsersLogins] = useState('')
  const [usersAdding, setUsersAdding] = useState(false)
  const [addUsersResults, setAddUsersResults] = useState<{ login: string; status: string; error?: string }[] | null>(null)
  const [addedUsersList, setAddedUsersList] = useState<{
    id: string
    username: string
    email: string
    addedAt: string
    lastLoginAt: string | null
    status: string
    errorMessage: string | null
  }[]>([])
  const [usersRefreshLoading, setUsersRefreshLoading] = useState(false)
  const [previewLogins, setPreviewLogins] = useState<string[] | null>(null)
  const [addConfirmOpen, setAddConfirmOpen] = useState(false)

  // Шаблоны анонсов (ADM/SUP)
  const [workspaceTemplates, setWorkspaceTemplates] = useState<{
    id: string
    intensiveDay: number
    dayLabel: string
    time: string
    channel: string
    audience: 'all' | 'mk'
    title?: string
    body: string
    timeNote?: string
  }[]>([])
  const [workspaceAdmTemplates, setWorkspaceAdmTemplates] = useState<typeof workspaceTemplates>([])
  const [workspaceShowAdmTemplates, setWorkspaceShowAdmTemplates] = useState(false)
  const [workspaceTemplatesLoading, setWorkspaceTemplatesLoading] = useState(false)
  const [workspaceTemplatesOpenIds, setWorkspaceTemplatesOpenIds] = useState<Set<string>>(new Set())
  /** Выбранный день во вкладке шаблонов: число или 'all'. Для SUP/ADM списка. */
  const [workspaceTemplatesSelectedDay, setWorkspaceTemplatesSelectedDay] = useState<number | 'all'>('all')
  /** Выбранный день в блоке «Мои шаблоны». */
  const [workspaceMyTemplatesSelectedDay, setWorkspaceMyTemplatesSelectedDay] = useState<number | 'all'>('all')
  /** Свёрнутые блоки по дням (когда выбран «Все»). Day number -> collapsed */
  const [workspaceTemplatesDayCollapsed, setWorkspaceTemplatesDayCollapsed] = useState<Set<number>>(new Set())
  const [workspaceMyTemplatesDayCollapsed, setWorkspaceMyTemplatesDayCollapsed] = useState<Set<number>>(new Set())
  const [workspaceMyTemplates, setWorkspaceMyTemplates] = useState<{
    id: string
    channel: string
    intensiveDay: number | null
    time: string
    title: string | null
    body: string
  }[]>([])
  const [addUsersProgress, setAddUsersProgress] = useState<{ current: number; total: number; added: number; errors: number; skipped: number } | null>(null)
  const [usersAddChannelId, setUsersAddChannelId] = useState<string>('')
  const [usersAddChannelType, setUsersAddChannelType] = useState<'c' | 'p'>('c')
  const [usersAddRoleId, setUsersAddRoleId] = useState<string>('')
  const [usersRolesList, setUsersRolesList] = useState<{ _id: string; name: string }[]>([])
  const [usersRolesLoading, setUsersRolesLoading] = useState(false)
  const [usersIfUserExists, setUsersIfUserExists] = useState<'skip' | 'reset_password'>('skip')
  const [usersTableSearch, setUsersTableSearch] = useState('')
  const [usersTableFilter, setUsersTableFilter] = useState<'all' | 'ADDED' | 'ERROR' | 'ALREADY_EXISTS' | 'never_logged'>('all')
  const [usersTableSort, setUsersTableSort] = useState<'addedAt' | 'lastLoginAt' | 'status'>('addedAt')
  const [usersRetryFailedLoading, setUsersRetryFailedLoading] = useState(false)
  const [usersRetryProgress, setUsersRetryProgress] = useState<{ current: number; total: number; added: number; errors: number; skipped: number } | null>(null)
  const [pendingAddLogins, setPendingAddLogins] = useState<string[] | null>(null)
  const addUsersAbortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        setCurrentUserRole(data?.user?.role ?? 'USER')
        setUserVolunteerIntensive(data?.user?.volunteerIntensive ?? null)
        setUserVolunteerExpiresAt(data?.user?.volunteerExpiresAt ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (currentUserRole === 'ADMIN') {
      setTabRestrictions({ templates: true, emojiImport: true, usersAdd: true })
      return
    }
    if (currentUserRole === 'SUPPORT' || currentUserRole === 'ADM') {
      fetch('/api/workspace-tab-restrictions')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => setTabRestrictions(d && typeof d.templates === 'boolean' ? d : { templates: true, emojiImport: true, usersAdd: true }))
        .catch(() => setTabRestrictions({ templates: true, emojiImport: true, usersAdd: true }))
      return
    }
    setTabRestrictions(null)
  }, [currentUserRole])

  const allowedTabsList = useMemo(() => {
    if (currentUserRole === 'ADMIN') return ['channels', 'messages', 'templates', 'emoji-import', 'users-add']
    if (currentUserRole === 'SUPPORT') {
      if (!tabRestrictions) return ['channels', 'messages', 'templates', 'emoji-import', 'users-add']
      const t = ['channels', 'messages']
      if (tabRestrictions.templates) t.push('templates')
      if (tabRestrictions.emojiImport) t.push('emoji-import')
      if (tabRestrictions.usersAdd) t.push('users-add')
      return t
    }
    if (currentUserRole === 'ADM') {
      if (!tabRestrictions) return ['channels', 'messages', 'templates']
      return ['channels', 'messages', ...(tabRestrictions.templates ? ['templates'] : [])]
    }
    return ['channels', 'messages']
  }, [currentUserRole, tabRestrictions])

  useEffect(() => {
    if ((currentUserRole === 'SUPPORT' || currentUserRole === 'ADM') && tabRestrictions && !allowedTabsList.includes(activeTab)) {
      setActiveTab('channels')
    }
  }, [currentUserRole, tabRestrictions, allowedTabsList, activeTab])

  useEffect(() => {
    if (currentUserRole !== 'SUPPORT' && currentUserRole !== 'ADMIN' || !workspaceId) return
    fetch(`/api/workspace/${workspaceId}/action-log`)
      .then((r) => r.json())
      .then((data) => {
        if (data.lastEmojiImport || data.lastUsersAdd) {
          setWorkspaceActionLog({
            lastEmojiImport: data.lastEmojiImport
              ? { userName: data.lastEmojiImport.userName, userEmail: data.lastEmojiImport.userEmail, at: data.lastEmojiImport.at }
              : null,
            lastUsersAdd: data.lastUsersAdd
              ? { userName: data.lastUsersAdd.userName, userEmail: data.lastUsersAdd.userEmail, at: data.lastUsersAdd.at }
              : null,
          })
        }
      })
      .catch(() => {})
  }, [currentUserRole, workspaceId])

  useEffect(() => {
    loadData()
    
    // Загружаем избранные каналы из localStorage
    const savedFavorites = localStorage.getItem(`favoriteChannels_${workspaceId}`)
    if (savedFavorites) {
      try {
        const favorites = JSON.parse(savedFavorites)
        setFavoriteChannelIds(new Set(favorites))
      } catch (e) {
        console.error('Failed to load favorite channels:', e)
      }
    }
    
    // Загружаем активную вкладку из localStorage
    const savedTab = localStorage.getItem(`activeTab_${workspaceId}`)
    const allowedTabs =
      currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN'
        ? ['channels', 'messages', 'templates', 'emoji-import', 'users-add']
        : currentUserRole === 'ADM'
          ? ['channels', 'messages', 'templates']
          : ['channels', 'messages']
    if (savedTab && allowedTabs.includes(savedTab)) {
      setActiveTab(savedTab)
    }
    // Статус последнего импорта эмодзи для этого пространства
    const savedImport = localStorage.getItem(`lastEmojiImport_${workspaceId}`)
    if (savedImport) {
      try {
        const parsed = JSON.parse(savedImport)
        if (parsed?.date) setLastEmojiImportStatus(parsed)
      } catch (_) {}
    }
    // Импорт был прерван перезагрузкой — показываем последнее состояние
    const savedProgress = localStorage.getItem(`emojiImportProgress_${workspaceId}`)
    if (savedProgress) {
      try {
        const parsed = JSON.parse(savedProgress)
        if (parsed?.status === 'in_progress' && parsed?.total != null) {
          setEmojiImportInterrupted({
            current: parsed.current ?? 0,
            total: parsed.total,
            uploaded: parsed.uploaded ?? 0,
            skipped: parsed.skipped ?? 0,
            errorsCount: parsed.errorsCount ?? 0,
          })
        }
        localStorage.removeItem(`emojiImportProgress_${workspaceId}`)
      } catch (_) {}
    }
  }, [workspaceId])

  // Синхронизация вкладки при смене роли или workspace (учитываем ограничения вкладок для SUP/ADM)
  useEffect(() => {
    const savedTab = localStorage.getItem(`activeTab_${workspaceId}`)
    if (savedTab && allowedTabsList.includes(savedTab)) {
      setActiveTab(savedTab)
    } else if (currentUserRole === 'VOL' || currentUserRole === 'USER') {
      setActiveTab((prev) => (prev === 'emoji-import' || prev === 'users-add' || prev === 'templates' ? 'channels' : prev))
    }
  }, [currentUserRole, workspaceId, allowedTabsList])
  
  // Сохраняем активную вкладку в localStorage
  useEffect(() => {
    if (workspaceId && activeTab) {
      localStorage.setItem(`activeTab_${workspaceId}`, activeTab)
    }
  }, [activeTab, workspaceId])

  // URL hash → tab: #messages, #channels и т.д.
  useEffect(() => {
    const hash = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    if (hash && allowedTabsList.includes(hash)) setActiveTab(hash)
  }, [currentUserRole, allowedTabsList])
  const handleTabChange = (value: string) => {
    setActiveTab(value)
    if (value !== 'messages') setMessageFilterFromStats(null)
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}#${value}`)
    }
  }

  // Сброс фильтра из статистики после применения, чтобы не переопределять выбор пользователя
  useEffect(() => {
    if (!messageFilterFromStats || activeTab !== 'messages') return
    const t = setTimeout(() => setMessageFilterFromStats(null), 100)
    return () => clearTimeout(t)
  }, [messageFilterFromStats, activeTab])

  const handleCheckConnection = async () => {
    setCheckingConnection(true)
    toast.loading('Проверка подключения к Rocket.Chat...', { id: 'workspace-test-connection' })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/test`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      toast.dismiss('workspace-test-connection')
      if (res.ok) {
        toast.success('Подключение успешно')
        await loadData()
      } else {
        toast.error(data.error || 'Ошибка проверки подключения', {
          action: { label: 'Повторить', onClick: () => handleCheckConnection() },
        })
      }
    } catch {
      toast.dismiss('workspace-test-connection')
      toast.error('Ошибка проверки подключения', {
        action: { label: 'Повторить', onClick: () => handleCheckConnection() },
      })
    } finally {
      setCheckingConnection(false)
    }
  }

  const handleRefresh = async () => {
    setRefreshing(true)
    try {
      await loadData()
      toast.success('Данные обновлены')
    } finally {
      setRefreshing(false)
    }
  }

  const loadAddedUsers = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users`)
      if (!res.ok) return
      const data = await res.json()
      setAddedUsersList(data.users ?? [])
    } catch (_) {}
  }, [workspaceId])

  useEffect(() => {
    if (activeTab === 'users-add') loadAddedUsers()
  }, [activeTab, loadAddedUsers])

  const loadAssignments = useCallback(async () => {
    if (!workspaceId) return
    try {
      const res = await fetch(`/api/admin/workspaces/${workspaceId}/assign-adm`)
      if (!res.ok) return
      const data = await res.json()
      setWorkspaceAssignments(data.assignments ?? [])
      setWorkspaceOwner(data.owner ?? null)
    } catch (_) {}
  }, [workspaceId])

  const canSeeAssignments = currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN' || !!workspace?.isAssigned
  useEffect(() => {
    if (canSeeAssignments && workspaceId) loadAssignments()
  }, [canSeeAssignments, workspaceId, loadAssignments])

  // Авто-открытие диалога подключения для назначенного без своего подключения
  useEffect(() => {
    if (loading || !workspace) return
    if (workspace.isAssigned && workspace.hasOwnConnection === false) {
      setConfirmAssignmentOpen(true)
    }
  }, [loading, workspace])

  useEffect(() => {
    if (!assignDialogOpen || (currentUserRole !== 'SUPPORT' && currentUserRole !== 'ADMIN')) return
    setAssignCandidatesLoading(true)
    fetch('/api/admin/users')
      .then((r) => (r.ok ? r.json() : { users: [] }))
      .then((d) => {
        const users = (d.users || []).filter(
          (u: { id: string; role: string }) =>
            (currentUserRole === 'ADMIN' && (u.role === 'ADM' || u.role === 'SUPPORT' || u.role === 'VOL')) ||
            (currentUserRole === 'SUPPORT' && (u.role === 'ADM' || u.role === 'VOL'))
        )
        const assignedIds = new Set(workspaceAssignments.map((a) => a.userId))
        setAssignCandidates(users.filter((u: { id: string }) => !assignedIds.has(u.id)))
      })
      .catch(() => setAssignCandidates([]))
      .finally(() => setAssignCandidatesLoading(false))
  }, [assignDialogOpen, currentUserRole, workspaceAssignments])

  useEffect(() => {
    const canLoadTemplates = currentUserRole === 'ADM' || currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN'
    if (!canLoadTemplates || activeTab !== 'templates') return
    setWorkspaceTemplatesLoading(true)
    Promise.all([
      fetch('/api/templates').then((r) => (r.ok ? r.json() : null)),
      fetch('/api/templates/mine').then((r) => (r.ok ? r.json() : null)),
    ])
      .then(([d, mine]) => {
        if (d) {
          if (d.templates) setWorkspaceTemplates(d.templates)
          if (d.admTemplates) setWorkspaceAdmTemplates(d.admTemplates)
        }
        if (mine?.templates) setWorkspaceMyTemplates(mine.templates)
      })
      .finally(() => setWorkspaceTemplatesLoading(false))
  }, [currentUserRole, activeTab])

  // Открытие создания сообщения из шаблона (страница «Шаблоны» → Запланировать)
  useEffect(() => {
    if (!workspaceId || !channels?.length || loading) return
    try {
      const raw = sessionStorage.getItem('schedule-from-template')
      if (!raw) return
      const payload = JSON.parse(raw) as { workspaceId: string; channelId?: string; channelName?: string; body: string; time: string; date?: string }
      if (payload.workspaceId !== workspaceId) return
      sessionStorage.removeItem('schedule-from-template')
      const ch = payload.channelId
        ? (channels as any[]).find((c: any) => (c._id || c.id) === payload.channelId)
        : (channels as any[]).find((c: any) => (c.name || c.displayName || '').replace(/^#/, '') === (payload.channelName || '').replace(/^#/, ''))
      if (!ch) {
        toast.error('Канал не найден', { description: payload.channelName || payload.channelId || 'Выберите канал вручную' })
        return
      }
      setSelectedChannel({ id: (ch as any)._id || (ch as any).id, name: (ch as any).name || (ch as any).displayName })
      setScheduleFromTemplate({ body: payload.body || '', time: payload.time || '09:00', date: payload.date })
      setShowMessageDialog(true)
      setActiveTab('messages')
    } catch (_) {
      sessionStorage.removeItem('schedule-from-template')
    }
  }, [workspaceId, channels, loading])

  useEffect(() => {
    // Check for ended intensive
    if (workspace?.endDate) {
      const endDate = new Date(workspace.endDate)
      const now = new Date()
      const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
      
      if (endDate < now && !workspace.isArchived) {
        toast.warning('Интенсив завершен', {
          description: `Пространство "${workspace.workspaceName}" завершилось ${Math.abs(daysUntilEnd)} ${Math.abs(daysUntilEnd) === 1 ? 'день' : 'дней'} назад. Рекомендуется заархивировать его.`,
          duration: 10000,
        })
      } else if (daysUntilEnd > 0 && daysUntilEnd <= 7 && !workspace.isArchived) {
        toast.info('Интенсив скоро завершится', {
          description: `Пространство "${workspace.workspaceName}" завершится через ${daysUntilEnd} ${daysUntilEnd === 1 ? 'день' : 'дней'}.`,
          duration: 8000,
        })
      }
    }
  }, [workspace])

  const loadData = async () => {
    try {
      // Load workspace
      const workspaceResponse = await fetch(`/api/workspace/${workspaceId}`)
      if (!workspaceResponse.ok) {
        throw new Error('Workspace not found')
      }
      const workspaceData = await workspaceResponse.json()
      const ws = workspaceData.workspace
      setWorkspace(ws)

      // Назначенный без своего подключения: не запрашиваем каналы/сообщения — избегаем 403 и тостов
      const assignedWithoutConnection = ws?.isAssigned && ws?.hasOwnConnection === false
      if (assignedWithoutConnection) {
        setLoading(false)
        return
      }

      // Load channels
      const channelsResponse = await fetch(`/api/workspace/${workspaceId}/channels`)
      if (channelsResponse.ok) {
        const channelsData = await channelsResponse.json()
        setChannels(channelsData.channels)
      } else {
        const errorData = await channelsResponse.json().catch(() => ({}))
        toast.error('Ошибка загрузки каналов', {
          description: errorData.details || 'Не удалось загрузить каналы',
          action: { label: 'Повторить', onClick: () => loadData() },
        })
      }

      // Load messages for this workspace
      const messagesResponse = await fetch(`/api/messages?workspaceId=${workspaceId}`)
      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        const msgs = messagesData.messages
        setMessages(msgs)
        // Проверяем статусы в Rocket.Chat (только для отправленных с messageId_RC)
        checkExternalMessageStatuses(msgs)
        
        // Устанавливаем первый канал с сообщениями как выбранный по умолчанию
        if (msgs.length > 0) {
          setSelectedMessageChannelId((prev) => prev || msgs[0].channelId)
        }
      }
    } catch (error: any) {
      console.error('Failed to load workspace:', error)
      toast.error('Ошибка загрузки', {
        description: error.message,
        action: { label: 'Повторить', onClick: () => loadData() },
      })
      router.push('/dashboard/workspaces')
    } finally {
      setLoading(false)
    }
  }

  const checkExternalMessageStatuses = async (msgs: any[]) => {
    const toCheck = (msgs || []).filter(
      (m: any) => m.status === 'SENT' && m.messageId_RC
    ) as { id: string; messageId_RC?: string | null }[]

    if (toCheck.length === 0) return

    const newStatuses: Record<string, 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'> = {}

    await Promise.all(
      toCheck.map(async (msg) => {
        try {
          const res = await fetch(`/api/messages/${msg.id}`)
          if (!res.ok) {
            newStatuses[msg.id] = 'UNKNOWN'
            return
          }
          const data = await res.json()
          newStatuses[msg.id] = data.externalStatus || 'UNKNOWN'
        } catch {
          newStatuses[msg.id] = 'UNKNOWN'
        }
      })
    )

    setExternalStatuses((prev) => ({ ...prev, ...newStatuses }))
  }

  const handleChannelSelect = (channel: any) => {
    setSelectedChannel(channel)
    setEditingMessage(null)
    setShowMessageDialog(true)
  }
  
  const toggleFavoriteChannel = (channelId: string, e: React.MouseEvent) => {
    e.stopPropagation() // Предотвращаем открытие диалога при клике на звездочку
    
    const newFavorites = new Set(favoriteChannelIds)
    if (newFavorites.has(channelId)) {
      newFavorites.delete(channelId)
    } else {
      newFavorites.add(channelId)
    }
    
    setFavoriteChannelIds(newFavorites)
    
    // Сохраняем в localStorage
    if (workspaceId) {
      localStorage.setItem(`favoriteChannels_${workspaceId}`, JSON.stringify(Array.from(newFavorites)))
    }
  }
  
  const runEmojiPreview = async () => {
    const url = emojiYamlUrl.trim()
    if (!url) {
      toast.error('Введите URL каталога YAML')
      return
    }
    setEmojiPreviewLoading(true)
    setEmojiPreview(null)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/emoji-import/preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ yamlUrl: url }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Не удалось загрузить каталог')
        return
      }
      setEmojiPreview({ total: data.total ?? 0, names: data.names ?? [] })
      setEmojiPreviewListVisible(false)
      toast.success(`В каталоге ${data.total ?? 0} эмодзи`)
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка проверки каталога')
    } finally {
      setEmojiPreviewLoading(false)
    }
  }

  const openEmojiConfirm = () => {
    const username = emojiAdminUsername.trim()
    const password = emojiAdminPassword
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора Rocket.Chat')
      return
    }
    const url = emojiYamlUrl.trim()
    if (!url) {
      toast.error('Введите URL каталога YAML')
      return
    }
   
    setEmojiConfirmOpen(true)
  }

  const runEmojiImport = async () => {
    setEmojiConfirmOpen(false)
    const username = emojiAdminUsername.trim()
    const password = emojiAdminPassword
    const url = emojiYamlUrl.trim()
    setEmojiImporting(true)
    setEmojiImportResult(null)
    setEmojiImportProgress(null)
    setEmojiImportInterrupted(null)
    emojiImportAbortRef.current = new AbortController()
    const progressKey = `emojiImportProgress_${workspaceId}`
    const saveProgress = (p: { current: number; total: number; uploaded: number; skipped: number; errorsCount: number }) => {
      localStorage.setItem(progressKey, JSON.stringify({ status: 'in_progress', ...p }))
    }
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/emoji-import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          yamlUrl: url,
          adminUsername: username,
          adminPassword: password,
        }),
        signal: emojiImportAbortRef.current.signal,
      })
      const contentType = res.headers.get('content-type') || ''
      if (!contentType.includes('application/x-ndjson')) {
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          toast.error(data.error || 'Ошибка импорта эмодзи')
          if (res.status === 401) toast.error('Проверьте логин и пароль администратора для этого сервера.')
          setEmojiImporting(false)
          localStorage.removeItem(progressKey)
          return
        }
      }
      if (!res.body) {
        toast.error('Нет ответа от сервера')
        setEmojiImporting(false)
        localStorage.removeItem(progressKey)
        return
      }
      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      let result = { uploaded: 0, skipped: 0, total: 0, errors: undefined as string[] | undefined }
      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const msg = JSON.parse(line)
            if (msg.t === 'start') {
              setEmojiImportProgress({ current: 0, total: msg.total || 0, uploaded: 0, skipped: 0, errorsCount: 0 })
              saveProgress({ current: 0, total: msg.total || 0, uploaded: 0, skipped: 0, errorsCount: 0 })
            } else if (msg.t === 'progress') {
              const p = {
                current: msg.current ?? 0,
                total: msg.total ?? 0,
                uploaded: msg.uploaded ?? 0,
                skipped: msg.skipped ?? 0,
                errorsCount: msg.errorsCount ?? 0,
              }
              setEmojiImportProgress(p)
              saveProgress(p)
            } else if (msg.t === 'done') {
              result = {
                uploaded: msg.uploaded ?? 0,
                skipped: msg.skipped ?? 0,
                total: msg.total ?? 0,
                errors: msg.errors,
              }
              setEmojiImportResult(result)
              const status = {
                date: new Date().toISOString(),
                uploaded: result.uploaded,
                skipped: result.skipped,
                total: result.total,
                errorsCount: result.errors?.length ?? 0,
                errors: result.errors,
              }
              setLastEmojiImportStatus(status)
              localStorage.setItem(`lastEmojiImport_${workspaceId}`, JSON.stringify(status))
              toast.success(`Импорт завершён: загружено ${result.uploaded}, пропущено (уже есть) ${result.skipped}`)
            } else if (msg.t === 'error') {
              toast.error(msg.error || 'Импорт прерван')
            }
          } catch (_) {}
        }
      }
      if (buffer.trim()) {
        try {
          const msg = JSON.parse(buffer)
          if (msg.t === 'done') {
            result = { uploaded: msg.uploaded ?? 0, skipped: msg.skipped ?? 0, total: msg.total ?? 0, errors: msg.errors }
            setEmojiImportResult(result)
            const status = { date: new Date().toISOString(), uploaded: result.uploaded, skipped: result.skipped, total: result.total, errorsCount: result.errors?.length ?? 0, errors: result.errors }
            setLastEmojiImportStatus(status)
            localStorage.setItem(`lastEmojiImport_${workspaceId}`, JSON.stringify(status))
            toast.success(`Импорт завершён: загружено ${result.uploaded}, пропущено (уже есть) ${result.skipped}`)
          } else if (msg.t === 'error') toast.error(msg.error || 'Импорт прерван')
        } catch (_) {}
      }
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.info('Импорт отменён')
      } else {
        toast.error(e?.message || 'Ошибка импорта эмодзи')
      }
    } finally {
      setEmojiImporting(false)
      setEmojiImportProgress(null)
      emojiImportAbortRef.current = null
      localStorage.removeItem(progressKey)
    }
  }

  const cancelEmojiImport = () => {
    emojiImportAbortRef.current?.abort()
  }

  const dismissInterrupted = () => {
    setEmojiImportInterrupted(null)
  }

  const parseLogins = (text: string) =>
    text
      .split(/[\n,;]+/)
      .map((s) => s.trim().replace(/^@/, ''))
      .filter(Boolean)

  const openPreview = () => {
    const logins = parseLogins(usersLogins)
    if (logins.length === 0) {
      toast.error('Введите хотя бы один логин (по одному на строку)')
      return
    }
    if (logins.length > 100) {
      toast.error('Максимум 100 пользователей за один запрос')
      return
    }
    setPreviewLogins(logins)
  }

  const startAddWithConfirm = () => {
    if (!previewLogins?.length) return
    setPendingAddLogins(previewLogins)
    setAddConfirmOpen(true)
  }

  const runAddUsers = async (loginsOverride?: string[]) => {
    const username = usersAddAdminUsername.trim()
    const password = usersAddAdminPassword
    const logins = loginsOverride ?? parseLogins(usersLogins)
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора Rocket.Chat')
      return
    }
    if (logins.length === 0) {
      toast.error('Введите хотя бы один логин')
      return
    }
    setAddConfirmOpen(false)
    setPendingAddLogins(null)
    setPreviewLogins(null)
    setUsersAdding(true)
    setAddUsersResults(null)
    setAddUsersProgress({ current: 0, total: logins.length, added: 0, errors: 0, skipped: 0 })
    addUsersAbortRef.current = new AbortController()
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUsername: username,
          adminPassword: password,
          logins,
          channelId: usersAddChannelId || undefined,
          channelType: usersAddChannelId ? usersAddChannelType : undefined,
          roleId: usersAddRoleId || undefined,
          ifUserExists: usersIfUserExists,
        }),
        signal: addUsersAbortRef.current.signal,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Ошибка добавления')
        setUsersAdding(false)
        setAddUsersProgress(null)
        return
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const results: { login: string; status: string; error?: string }[] = []
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            if (obj.t === 'progress') {
              setAddUsersProgress({
                current: obj.current ?? 0,
                total: obj.total ?? 0,
                added: obj.added ?? 0,
                errors: obj.errors ?? 0,
                skipped: obj.skipped ?? 0,
              })
            } else if (obj.t === 'result') {
              results.push({ login: obj.login, status: obj.status, error: obj.error })
            } else if (obj.t === 'done') {
              setAddUsersResults(obj.results ?? results)
            } else if (obj.t === 'error') {
              toast.error(obj.error || 'Ошибка')
            }
          } catch (_) {}
        }
      }
      if (buffer.trim()) {
        try {
          const obj = JSON.parse(buffer)
          if (obj.t === 'done') setAddUsersResults(obj.results ?? results)
          else if (obj.t === 'error') toast.error(obj.error || 'Ошибка')
        } catch (_) {}
      }
      await loadAddedUsers()
      const added = results.filter((r) => r.status === 'ADDED').length
      const errs = results.filter((r) => r.status === 'ERROR').length
      const skipped = results.filter((r) => r.status === 'ALREADY_EXISTS').length
      toast.success(`Добавлено: ${added}${errs > 0 ? `, ошибок: ${errs}` : ''}${skipped > 0 ? `, пропущено (уже есть): ${skipped}` : ''}`)
    } catch (e: any) {
      if (e?.name === 'AbortError') {
        toast.info('Добавление пользователей отменено')
      } else {
        toast.error(e?.message || 'Ошибка добавления')
      }
    } finally {
      setUsersAdding(false)
      setAddUsersProgress(null)
      addUsersAbortRef.current = null
    }
  }

  const cancelAddUsers = () => {
    addUsersAbortRef.current?.abort()
  }

  const loadUsersRoles = async () => {
    const username = usersAddAdminUsername.trim()
    const password = usersAddAdminPassword
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора')
      return
    }
    setUsersRolesLoading(true)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: username, adminPassword: password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Не удалось загрузить роли')
        return
      }
      setUsersRolesList(data.roles ?? [])
      toast.success('Роли загружены')
    } catch (e: any) {
      toast.error('Ошибка загрузки ролей')
    } finally {
      setUsersRolesLoading(false)
    }
  }

  const runRetryFailed = async () => {
    const username = usersAddAdminUsername.trim()
    const password = usersAddAdminPassword
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора')
      return
    }
    setUsersRetryFailedLoading(true)
    setUsersRetryProgress({ current: 0, total: 1, added: 0, errors: 0, skipped: 0 })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/retry-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adminUsername: username,
          adminPassword: password,
          channelId: usersAddChannelId || undefined,
          channelType: usersAddChannelId ? usersAddChannelType : undefined,
          roleId: usersAddRoleId || undefined,
        }),
      })
      const contentType = res.headers.get('content-type') || ''
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Ошибка повтора')
        setUsersRetryFailedLoading(false)
        setUsersRetryProgress(null)
        return
      }
      if (contentType.includes('application/json') && !contentType.includes('ndjson')) {
        const data = await res.json().catch(() => ({}))
        if (data.message) toast.info(data.message)
        setUsersRetryFailedLoading(false)
        setUsersRetryProgress(null)
        return
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            const obj = JSON.parse(line)
            if (obj.t === 'progress') {
              setUsersRetryProgress({
                current: obj.current ?? 0,
                total: obj.total ?? 0,
                added: obj.added ?? 0,
                errors: obj.errors ?? 0,
                skipped: obj.skipped ?? 0,
              })
            } else if (obj.t === 'done') {
              await loadAddedUsers()
              toast.success(`Повтор: добавлено ${obj.added ?? 0}, ошибок ${obj.errors ?? 0}, пропущено ${obj.skipped ?? 0}`)
            } else if (obj.t === 'error') {
              toast.error(obj.error || 'Ошибка')
            }
          } catch (_) {}
        }
      }
      setUsersRetryProgress(null)
      await loadAddedUsers()
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка')
    } finally {
      setUsersRetryFailedLoading(false)
    }
  }

  const removeAddedUser = async (addedUserId: string) => {
    if (!confirm('Убрать запись из списка? (Пользователь в Rocket.Chat не удаляется)')) return
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/${addedUserId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      await loadAddedUsers()
      toast.success('Запись удалена из списка')
    } catch {
      toast.error('Не удалось удалить')
    }
  }

  const failedUsersCount = addedUsersList.filter((u) => u.status === 'ERROR').length

  const filteredAndSortedUsers = (() => {
    let list = [...addedUsersList]
    const q = usersTableSearch.trim().toLowerCase()
    if (q) {
      list = list.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    }
    if (usersTableFilter === 'ADDED') list = list.filter((u) => u.status === 'ADDED')
    else if (usersTableFilter === 'ERROR') list = list.filter((u) => u.status === 'ERROR')
    else if (usersTableFilter === 'ALREADY_EXISTS') list = list.filter((u) => u.status === 'ALREADY_EXISTS')
    else if (usersTableFilter === 'never_logged') list = list.filter((u) => u.status === 'ADDED' && !u.lastLoginAt)
    if (usersTableSort === 'addedAt') list.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    else if (usersTableSort === 'lastLoginAt') list.sort((a, b) => (b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0) - (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0))
    else if (usersTableSort === 'status') list.sort((a, b) => a.status.localeCompare(b.status))
    return list
  })()

  const runRefreshLogin = async () => {
    const username = usersAddAdminUsername.trim()
    const password = usersAddAdminPassword
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора для обновления статусов входа')
      return
    }
    setUsersRefreshLoading(true)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/refresh-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ adminUsername: username, adminPassword: password }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Ошибка обновления')
        setUsersRefreshLoading(false)
        return
      }
      setAddedUsersList(data.users ?? [])
      toast.success('Статусы входа обновлены')
    } catch (e: any) {
      toast.error(e?.message || 'Ошибка обновления')
    } finally {
      setUsersRefreshLoading(false)
    }
  }

  const handleEditMessage = (message: any) => {
    setEditingMessage(message)
    setSelectedChannel({ id: message.channelId, name: message.channelName })
    setShowMessageDialog(true)
  }

  const handleDeleteMessage = async (messageId: string) => {
    if (!confirm('Удалить сообщение?')) return

    try {
      const response = await fetch(`/api/messages/${messageId}`, {
        method: 'DELETE',
      })

      if (!response.ok) throw new Error('Failed to delete')

      await loadData()
      toast.success('Сообщение удалено')
    } catch (error: any) {
      toast.error('Ошибка удаления')
    }
  }

  const handleRetryMessage = async (messageId: string) => {
    try {
      const res = await fetch(`/api/messages/${messageId}/retry`, { method: 'POST' })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка повтора')
      await loadData()
      toast.success('Сообщение перенесено в очередь — отправка через минуту')
    } catch (error: any) {
      toast.error(error.message || 'Ошибка повтора отправки', {
        action: {
          label: 'Повторить',
          onClick: () => handleRetryMessage(messageId),
        },
        cancel: {
          label: 'Детали',
          onClick: () => {
            setActiveTab('messages')
            setMessageFilterFromStats('FAILED')
            if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}#messages`)
          },
        },
      })
    }
  }

  const getStatusBadge = (status: string) => {
    const cls = messageStatusBadgeClasses[status]
    const labels: Record<string, React.ReactNode> = {
      PENDING: <><Clock className="w-3 h-3 mr-1" aria-hidden />Ожидает</>,
      SENT: <><CheckCircle2 className="w-3 h-3 mr-1" aria-hidden />Отправлено</>,
      FAILED: <><XCircle className="w-3 h-3 mr-1" aria-hidden />Ошибка</>,
    }
    if (status === 'FAILED') return <Badge variant="destructive" className="text-xs"><XCircle className="w-3 h-3 mr-1" aria-hidden />Ошибка</Badge>
    if (cls) return <Badge className={cls}>{labels[status] ?? status}</Badge>
    return <Badge>{status}</Badge>
  }

  const filteredChannelsRaw = channels.filter((channel: any) => {
    const matchesSearch = channel.name.toLowerCase().includes(searchQuery.toLowerCase())
    const matchesView = channelView === 'all' || favoriteChannelIds.has(channel.id)
    return matchesSearch && matchesView
  })

  const filteredChannels = (() => {
    const list = [...filteredChannelsRaw].map((ch: any) => ({
      ...ch,
      scheduledCount: messages.filter((m: any) => m.channelId === ch.id).length,
    }))
    if (channelSort === 'name') {
      list.sort((a: any, b: any) => (a.name || '').localeCompare(b.name || ''))
    } else if (channelSort === 'messages') {
      list.sort((a: any, b: any) => (b.messageCount ?? 0) - (a.messageCount ?? 0))
    } else if (channelSort === 'public_first') {
      list.sort((a: any, b: any) => {
        const aPub = a.type === 'c' ? 1 : 0
        const bPub = b.type === 'c' ? 1 : 0
        if (bPub !== aPub) return bPub - aPub
        return (a.name || '').localeCompare(b.name || '')
      })
    }
    return list
  })()
  const channelsPublic = filteredChannels.filter((ch: any) => ch.type === 'c')
  const channelsPrivate = filteredChannels.filter((ch: any) => ch.type === 'p')
  const showChannelGroups = channelSort === 'public_first' && (channelsPublic.length > 0 && channelsPrivate.length > 0)

  const stats = {
    pending: messages.filter((m: any) => m.status === 'PENDING').length,
    sent: messages.filter((m: any) => m.status === 'SENT').length,
    failed: messages.filter((m: any) => m.status === 'FAILED').length,
  }

  const messagesWithExternalStatus = messages.map((m: any) => ({
    ...m,
    externalStatus: externalStatuses[m.id],
  }))

  // Фильтр по периоду: все, 2 недели вперёд, период интенсива (startDate–endDate)
  const messagesFilteredByPeriod = useMemo(() => {
    const list = messages || []
    if (messagePeriodFilter === 'all') return list
    const now = new Date()
    if (messagePeriodFilter === '2weeks') {
      const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      return list.filter((m: any) => {
        const d = new Date(m.scheduledFor)
        return d >= now && d <= end
      })
    }
    if (messagePeriodFilter === 'intensive' && workspace?.startDate && workspace?.endDate) {
      const start = new Date(workspace.startDate)
      const end = new Date(workspace.endDate)
      return list.filter((m: any) => {
        const d = new Date(m.scheduledFor)
        return d >= start && d <= end
      })
    }
    return list
  }, [messages, messagePeriodFilter, workspace?.startDate, workspace?.endDate])

  // После фильтра по автору: только сообщения выбранного автора (для каналов и списка)
  const baseMessagesForView = useMemo(() => {
    if (messageFilterByUserId) {
      return messagesFilteredByPeriod.filter((m: any) => m.user?.id === messageFilterByUserId)
    }
    return messagesFilteredByPeriod
  }, [messagesFilteredByPeriod, messageFilterByUserId])

  // Каналы с сообщениями: при выбранном авторе — только каналы, в которые он отправлял
  const channelsWithMessages = useMemo(() => {
    return Array.from(
      new Map(
        baseMessagesForView.map((m: any) => [
          m.channelId,
          {
            channelId: m.channelId,
            channelName: m.channelName || 'Неизвестный канал',
            messageCount: baseMessagesForView.filter((msg: any) => msg.channelId === m.channelId).length,
          },
        ])
      ).values()
    )
  }, [baseMessagesForView])

  // Уникальные авторы сообщений (для фильтра в многопользовательском пространстве)
  const messageAuthors = useMemo(() => {
    const seen = new Set<string>()
    return (messages || [])
      .filter((m: any) => m.user?.id && !seen.has(m.user.id) && seen.add(m.user.id))
      .map((m: any) => m.user as { id: string; name: string | null; email: string; username?: string | null; role?: string })
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
  }, [messages])

  // Список сообщений выбранного канала: с внешним статусом, хронологически по scheduledFor
  const filteredMessagesByChannel = useMemo(() => {
    if (!selectedMessageChannelId) return []
    const list = baseMessagesForView.filter((m: any) => m.channelId === selectedMessageChannelId)
    const withStatus = list.map((m: any) => ({ ...m, externalStatus: externalStatuses[m.id] }))
    return withStatus.sort((a: any, b: any) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  }, [baseMessagesForView, selectedMessageChannelId, externalStatuses])

  // При смене автора/периода: если выбранный канал не в списке — выбрать первый канал из списка
  const channelIdsForView = useMemo(() => new Set(channelsWithMessages.map((c: any) => c.channelId)), [channelsWithMessages])
  useEffect(() => {
    if (selectedMessageChannelId && !channelIdsForView.has(selectedMessageChannelId)) {
      const first = channelsWithMessages[0] as { channelId: string } | undefined
      setSelectedMessageChannelId(first?.channelId ?? null)
    }
  }, [channelIdsForView, selectedMessageChannelId, channelsWithMessages])

  const renderChannelCard = (channel: any) => {
    const isFavorite = favoriteChannelIds.has(channel.id)
    const scheduledCount = channel.scheduledCount ?? 0
    const tagColors = getChannelTagColors(channel.name || channel.id)
    return (
      <Card
        key={channel.id}
        className="group relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm hover:shadow-md hover:border-border/80 transition-all duration-200 cursor-pointer"
        onClick={() => handleChannelSelect(channel)}
      >
        <div className={cn("absolute left-0 top-0 bottom-0 w-1 shrink-0", tagColors.bar.replace('border-', 'bg-'))} />
        <CardContent className="p-4 pl-5">
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <Hash className={cn("w-4 h-4 shrink-0 opacity-70", tagColors.text)} />
                <span className={cn("font-semibold text-base truncate", tagColors.text)}>{channel.name}</span>
                <Badge
                  variant="secondary"
                  className={cn(
                    "text-[10px] font-medium shrink-0 h-5 px-1.5",
                    channel.type === 'c'
                      ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-0"
                      : "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-0"
                  )}
                >
                  {channel.type === 'c' ? 'Публичный' : 'Приватный'}
                </Badge>
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {channel.messageCount ?? 0} сообщ. в RC
                {scheduledCount > 0 && (
                  <span> · запланировано {scheduledCount}</span>
                )}
              </p>
            </div>
            <button
              onClick={(e) => toggleFavoriteChannel(channel.id, e)}
              className="shrink-0 p-1.5 rounded-md hover:bg-muted/60 transition-colors"
              title={isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}
            >
              <Star
                className={cn(
                  "w-4 h-4 transition-colors",
                  isFavorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground"
                )}
              />
            </button>
          </div>
          {channel.displayName && (
            <p className="text-xs text-muted-foreground line-clamp-2 pt-2 border-t border-border/60">
              {channel.displayName}
            </p>
          )}
        </CardContent>
      </Card>
    )
  }

  const renderChannelRow = (channel: any) => {
    const isFavorite = favoriteChannelIds.has(channel.id)
    const scheduledCount = channel.scheduledCount ?? 0
    const tagColors = getChannelTagColors(channel.name || channel.id)
    return (
      <Card
        key={channel.id}
        className="group relative overflow-hidden rounded-xl border border-border/70 bg-card shadow-sm hover:shadow-md hover:border-border/80 transition-all duration-200 cursor-pointer"
        onClick={() => handleChannelSelect(channel)}
      >
        <div className={cn("absolute left-0 top-0 bottom-0 w-1 shrink-0", tagColors.bar.replace('border-', 'bg-'))} />
        <CardContent className="py-2.5 px-4 pl-5 flex flex-row items-center gap-4 flex-wrap">
          <Hash className={cn("w-4 h-4 shrink-0 opacity-70", tagColors.text)} />
          <span className={cn("font-semibold text-sm truncate min-w-0 max-w-[220px]", tagColors.text)}>
            {channel.name}
          </span>
          <Badge
            variant="secondary"
            className={cn(
              "text-[10px] font-medium shrink-0 h-5 px-1.5",
              channel.type === 'c'
                ? "bg-blue-500/15 text-blue-700 dark:text-blue-300 border-0"
                : "bg-violet-500/15 text-violet-700 dark:text-violet-300 border-0"
            )}
          >
            {channel.type === 'c' ? 'Публичный' : 'Приватный'}
          </Badge>
          <span className="text-xs text-muted-foreground shrink-0">
            {channel.messageCount ?? 0} сообщ.
            {scheduledCount > 0 && ` · ${scheduledCount} заплан.`}
          </span>
          <button
            onClick={(e) => toggleFavoriteChannel(channel.id, e)}
            className="shrink-0 p-1.5 rounded-md hover:bg-muted/60 ml-auto"
            title={isFavorite ? 'Удалить из избранного' : 'Добавить в избранное'}
          >
            <Star
              className={cn(
                "w-4 h-4",
                isFavorite ? "fill-amber-400 text-amber-500" : "text-muted-foreground"
              )}
            />
          </button>
        </CardContent>
      </Card>
    )
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
          <div className="space-y-6">
            <Skeleton className="h-9 w-40" />
            <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
              <div className="flex items-start gap-4">
                <Skeleton className="w-16 h-16 rounded-2xl" />
                <div className="space-y-3">
                  <Skeleton className="h-10 w-64" />
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-56" />
                </div>
              </div>
              <div className="flex items-center gap-3">
                <Skeleton className="h-9 w-24" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {[1, 2, 3].map((i) => (
                <Card key={i} className="border-muted/70">
                  <CardContent className="p-6">
                    <div className="flex items-center justify-between">
                      <div className="space-y-2">
                        <Skeleton className="h-8 w-16" />
                        <Skeleton className="h-4 w-20" />
                      </div>
                      <Skeleton className="w-12 h-12 rounded-xl" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
          <div className="space-y-5">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <div className="flex gap-1">
                <Skeleton className="h-10 w-32 rounded-t-lg" />
                <Skeleton className="h-10 w-32 rounded-t-lg" />
              </div>
            </div>
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
              <Skeleton className="h-10 flex-1" />
              <Skeleton className="h-10 w-32" />
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
              {[1, 2, 3, 4, 5, 6].map((i) => (
                <Card key={i} className="border-muted/70">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3 mb-3">
                      <Skeleton className="w-11 h-11 rounded-xl" />
                      <div className="flex-1 space-y-2">
                        <Skeleton className="h-5 w-full" />
                        <Skeleton className="h-3 w-20" />
                      </div>
                    </div>
                    <Skeleton className="h-6 w-24 rounded-full" />
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        </div>
      </div>
    )
  }

  if (!workspace) return null

  return (
    <div className="min-h-screen bg-background">
      <div className="container max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-6">
        <Breadcrumbs
          items={[
            { label: 'Дашборд', href: '/dashboard' },
            { label: 'Пространства', href: '/dashboard/workspaces' },
            { label: workspace.workspaceName, current: true },
          ]}
          className="-ml-2"
        />

        {workspace && !workspace.isActive && (
          <Alert className="rounded-2xl border-amber-500/50 bg-amber-500/10">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle>Подключение неактивно</AlertTitle>
            <AlertDescription>
              Проверьте подключение к пространству, чтобы подтянулись все данные (каналы, сообщения). Нажмите кнопку ниже.
            </AlertDescription>
            <Button
              variant="outline"
              size="sm"
              className="mt-3 gap-2 border-amber-500/50 hover:bg-amber-500/20"
              onClick={handleCheckConnection}
              disabled={checkingConnection}
            >
              {checkingConnection ? <Spinner className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
              Проверить подключение
            </Button>
          </Alert>
        )}

        <div className="grid gap-6 lg:grid-cols-1">
          {/* Блок: Информация о пространстве + Действия — в стиле result-ai.tech */}
          <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
            <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
              <h2 className="text-base font-semibold text-foreground tracking-tight">Пространство и действия</h2>
              <p className="text-sm text-muted-foreground mt-0.5">Подключение к Rocket.Chat и быстрые действия</p>
            </div>
            <CardContent className="p-6">
              <div className="flex flex-col sm:flex-row sm:items-start gap-6">
                <div
                  className="w-14 h-14 sm:w-16 sm:h-16 rounded-2xl flex items-center justify-center shadow-lg ring-2 ring-background shrink-0"
                  style={{ backgroundColor: workspace.color || '#ef4444' }}
                >
                  <MessageSquare className="w-7 h-7 sm:w-8 sm:h-8 text-white" />
                </div>
                <div className="space-y-3 min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-xl sm:text-2xl font-bold tracking-tight truncate">{workspace.workspaceName}</h1>
                    {currentUserRole === 'VOL' && userVolunteerIntensive && workspace.workspaceUrl?.toLowerCase().includes(userVolunteerIntensive.toLowerCase()) && (
                      <Badge variant="secondary" className="bg-primary/10 text-primary shrink-0 rounded-full text-xs">Ваш интенсив</Badge>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                    <span className="truncate font-mono text-xs bg-muted/50 px-2.5 py-1.5 rounded-lg border border-border/60">{workspace.workspaceUrl.replace(/^https?:\/\//, '')}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 w-8 p-0 shrink-0 rounded-lg hover:bg-muted/60"
                      title="Копировать URL"
                      onClick={() => {
                        navigator.clipboard.writeText(workspace.workspaceUrl)
                        toast.success('URL скопирован')
                      }}
                    >
                      <Copy className="w-4 h-4" />
                    </Button>
                  </div>
                  {workspace.startDate && workspace.endDate && (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Clock className="w-4 h-4 shrink-0" />
                      <span>
                        Интенсив: {new Date(workspace.startDate).toLocaleDateString('ru-RU')} — {new Date(workspace.endDate).toLocaleDateString('ru-RU')}
                      </span>
                    </div>
                  )}
                  {currentUserRole === 'VOL' && userVolunteerExpiresAt && (
                    <p className="text-sm text-muted-foreground">
                      Доступ до {new Date(userVolunteerExpiresAt).toLocaleDateString('ru-RU')}
                      {(() => {
                        const days = Math.ceil((new Date(userVolunteerExpiresAt).getTime() - Date.now()) / (1000 * 60 * 60 * 24))
                        if (days <= 7 && days > 0) return <span className="text-amber-600 dark:text-amber-400 ml-1">(осталось {days} дн.)</span>
                        if (days <= 0) return <span className="text-destructive ml-1">(истёк)</span>
                        return null
                      })()}
                    </p>
                  )}
                  {workspace.lastConnected && (
                    <p className="text-xs text-muted-foreground">
                      Последнее подключение: {new Date(workspace.lastConnected).toLocaleString('ru-RU')}
                    </p>
                  )}
                </div>
                <div className="flex flex-col gap-4 shrink-0 border-t sm:border-t-0 sm:border-l border-border/70 pt-4 sm:pt-0 sm:pl-6">
                  <div className="flex flex-wrap items-center gap-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="default" size="sm" className="rounded-lg shadow-sm" asChild>
                          <a href={workspace.workspaceUrl} target="_blank" rel="noopener noreferrer">
                            <ExternalLink className="w-4 h-4 mr-2" />
                            Открыть в RC
                          </a>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Открыть в Rocket.Chat</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button variant="default" size="sm" className="rounded-lg shadow-sm" asChild>
                          <Link href={`/dashboard/calendar?workspaceId=${workspaceId}`}>
                            <Calendar className="w-4 h-4 mr-2" />
                            Календарь
                          </Link>
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Календарь с фильтром по этому пространству</TooltipContent>
                    </Tooltip>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="rounded-lg border-border/80 hover:bg-muted/50"
                          onClick={handleRefresh}
                          disabled={refreshing}
                        >
                          {refreshing ? <Spinner className="w-4 h-4 mr-2" /> : <RefreshCw className="w-4 h-4 mr-2" />}
                          Обновить
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Обновить данные</TooltipContent>
                    </Tooltip>
                    {currentUserRole !== 'VOL' && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant="outline"
                            size="sm"
                            className="rounded-lg border-border/80 hover:bg-muted/50"
                            onClick={handleCheckConnection}
                            disabled={checkingConnection}
                          >
                            {checkingConnection ? <Spinner className="w-4 h-4 mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
                            Проверить
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Проверить подключение к Rocket.Chat</TooltipContent>
                      </Tooltip>
                    )}
                    {currentUserRole !== 'VOL' && (
                      <WorkspaceEditDialog
                        workspace={workspace}
                        onSuccess={loadData}
                      />
                    )}
                  </div>
                  <div className="flex items-center gap-2 rounded-lg bg-muted/30 px-3 py-2 w-fit">
                    <span className="text-xs font-medium text-muted-foreground">Статус:</span>
                    <Badge
                      variant={workspace.isActive ? 'default' : 'secondary'}
                      className="text-xs px-2 py-0.5 rounded-full"
                      title={workspace.isActive ? 'Подключение активно' : 'Подключение неактивно'}
                    >
                      {workspace.isActive ? 'Активно' : 'Неактивно'}
                    </Badge>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Баннер для назначенного пользователя: можно отказаться от назначения (если уже есть своё подключение) */}
          {workspace?.isAssigned && workspace?.hasOwnConnection !== false && (
            <Alert className="rounded-2xl border border-primary/40 bg-primary/5 [&>svg]:text-primary shadow-[0_1px_3px_rgba(0,0,0,0.06)]">
              <Users className="size-5" />
              <AlertTitle>Вы назначены на это пространство</AlertTitle>
              <AlertDescription>
                <span className="block mb-2">
                  Вы видите это пространство по назначению. Календарь и сообщения синхронизируются для всех назначенных. Вы можете отказаться от назначения и добавить пространство самостоятельно в списке пространств.
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={leaveAssignmentLoading}
                  onClick={async () => {
                    if (!confirm('Отказаться от назначения? Пространство исчезнет из вашего списка. Вы сможете добавить его сами позже.')) return
                    setLeaveAssignmentLoading(true)
                    try {
                      const res = await fetch(`/api/workspace/${workspaceId}/leave-assignment`, { method: 'POST' })
                      if (res.ok) {
                        toast.success('Назначение снято')
                        router.push('/dashboard/workspaces')
                      } else {
                        const d = await res.json().catch(() => ({}))
                        toast.error(d.error || 'Ошибка')
                      }
                    } finally {
                      setLeaveAssignmentLoading(false)
                    }
                  }}
                >
                  {leaveAssignmentLoading ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  Отказаться от назначения
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Диалог подключения для назначенного без своего подключения: нельзя обойти — только «Подтвердить» или «Я сам добавлю» */}
          <Dialog
            open={confirmAssignmentOpen}
            onOpenChange={(open) => {
              if (open) setConfirmAssignmentOpen(true)
            }}
          >
            <DialogContent
              className="w-[calc(100%-2rem)] max-w-md min-w-0 overflow-hidden"
              showCloseButton={false}
              onInteractOutside={(e) => e.preventDefault()}
              onEscapeKeyDown={(e) => e.preventDefault()}
            >
              <DialogHeader className="min-w-0">
                <DialogTitle className="flex items-center gap-2 min-w-0">
                  <LogIn className="h-5 w-5 shrink-0" />
                  <span className="min-w-0 truncate">Подключиться к пространству</span>
                </DialogTitle>
                <DialogDescription className="min-w-0">
                  Введите логин и пароль Rocket.Chat (LDAP) для этого пространства. После входа нажмите «Подтвердить назначение» — будет создано ваше подключение. Если хотите добавить пространство сами, нажмите «Я сам добавлю себе пространство».
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2 min-w-0 overflow-hidden">
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="confirm-assignment-username">Логин Rocket.Chat</Label>
                  <Input
                    id="confirm-assignment-username"
                    type="text"
                    placeholder="логин (LDAP)"
                    value={confirmAssignmentUsername}
                    onChange={(e) => setConfirmAssignmentUsername(e.target.value)}
                    autoComplete="username"
                    className="min-w-0 w-full"
                  />
                </div>
                <div className="space-y-2 min-w-0">
                  <Label htmlFor="confirm-assignment-password">Пароль</Label>
                  <Input
                    id="confirm-assignment-password"
                    type="password"
                    placeholder="пароль"
                    value={confirmAssignmentPassword}
                    onChange={(e) => setConfirmAssignmentPassword(e.target.value)}
                    autoComplete="current-password"
                    className="min-w-0 w-full"
                  />
                </div>
              </div>
              <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between min-w-0 flex-wrap">
                <Button
                  variant="outline"
                  className="order-2 sm:order-1 min-w-0 shrink-0"
                  disabled={confirmAssignmentLoading || leaveAssignmentLoading}
                  onClick={async () => {
                    setLeaveAssignmentLoading(true)
                    try {
                      const res = await fetch(`/api/workspace/${workspaceId}/leave-assignment`, { method: 'POST' })
                      if (res.ok) {
                        toast.success('Назначение снято. Добавьте пространство в списке пространств.')
                        setConfirmAssignmentOpen(false)
                        router.push('/dashboard/workspaces')
                      } else {
                        const d = await res.json().catch(() => ({}))
                        toast.error(d.error || 'Ошибка')
                      }
                    } finally {
                      setLeaveAssignmentLoading(false)
                    }
                  }}
                >
                  {leaveAssignmentLoading ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  Я сам добавлю себе пространство
                </Button>
                <Button
                  className="order-1 sm:order-2"
                  disabled={!confirmAssignmentUsername.trim() || !confirmAssignmentPassword || confirmAssignmentLoading || leaveAssignmentLoading}
                  onClick={async () => {
                    if (!confirmAssignmentUsername.trim() || !confirmAssignmentPassword) return
                    setConfirmAssignmentLoading(true)
                    try {
                      const res = await fetch(`/api/workspace/${workspaceId}/confirm-assignment`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({
                          username: confirmAssignmentUsername.trim(),
                          password: confirmAssignmentPassword,
                        }),
                      })
                      const data = await res.json().catch(() => ({}))
                      if (res.ok && data.workspaceId) {
                        toast.success('Подключение создано')
                        setConfirmAssignmentOpen(false)
                        setConfirmAssignmentUsername('')
                        setConfirmAssignmentPassword('')
                        router.push(`/dashboard/workspaces/${data.workspaceId}`)
                      } else {
                        toast.error(data.error || 'Ошибка подключения')
                      }
                    } finally {
                      setConfirmAssignmentLoading(false)
                    }
                  }}
                >
                  {confirmAssignmentLoading ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  Подтвердить назначение
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Intensive Status Alert */}
          {workspace.endDate && (
            (() => {
              const endDate = new Date(workspace.endDate)
              const now = new Date()
              const daysUntilEnd = Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24))
              const isEnded = endDate < now
              const isEndingSoon = daysUntilEnd > 0 && daysUntilEnd <= 7

              if (isEnded && !workspace.isArchived) {
                return (
                  <Alert variant="destructive" className="border-destructive/50 [&>svg]:size-5">
                    <XCircle className="size-5" />
                    <AlertTitle>Интенсив завершен</AlertTitle>
                    <AlertDescription>
                      <span className="block mb-3">
                        Интенсив завершился {Math.abs(daysUntilEnd)} {Math.abs(daysUntilEnd) === 1 ? 'день' : 'дней'} назад.
                        {currentUserRole !== 'VOL' && ' Рекомендуется заархивировать пространство.'}
                      </span>
                      {currentUserRole !== 'VOL' && (
                        <Button
                          variant="destructive"
                          size="sm"
                          onClick={() => {
                            const editButton = document.querySelector('[data-workspace-edit-trigger]') as HTMLElement
                            editButton?.click()
                          }}
                          className="mt-1"
                        >
                          <Archive className="w-4 h-4 mr-2" />
                          Архивировать
                        </Button>
                      )}
                    </AlertDescription>
                  </Alert>
                )
              } else if (isEndingSoon && !workspace.isArchived) {
                return (
                  <Alert className="border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-800 dark:bg-amber-950/30 dark:text-amber-200 [&>svg]:text-amber-600 dark:[&>svg]:text-amber-400">
                    <Clock className="size-5" />
                    <AlertTitle>Интенсив скоро завершится</AlertTitle>
                    <AlertDescription className="text-amber-800 dark:text-amber-300">
                      Интенсив завершится через {daysUntilEnd} {daysUntilEnd === 1 ? 'день' : 'дней'} ({endDate.toLocaleDateString('ru-RU')}).
                    </AlertDescription>
                  </Alert>
                )
              }
              return null
            })()
          )}

          {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && workspaceActionLog && (workspaceActionLog.lastEmojiImport || workspaceActionLog.lastUsersAdd) && (
            <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
                <h2 className="text-base font-semibold text-foreground tracking-tight">Последние действия по пространству</h2>
                <p className="text-sm text-muted-foreground mt-0.5">Импорт эмодзи и добавление пользователей</p>
              </div>
              <CardContent className="p-6">
                <div className="flex flex-col sm:flex-row sm:flex-wrap gap-3 text-sm">
                  {workspaceActionLog.lastEmojiImport && (
                    <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 w-full sm:w-auto">
                      <span className="text-muted-foreground">Импорт эмодзи:</span>
                      <strong className="text-foreground">{workspaceActionLog.lastEmojiImport.userName || workspaceActionLog.lastEmojiImport.userEmail}</strong>
                      <span className="text-muted-foreground text-xs ml-auto">{new Date(workspaceActionLog.lastEmojiImport.at).toLocaleString('ru-RU')}</span>
                    </div>
                  )}
                  {workspaceActionLog.lastUsersAdd && (
                    <div className="flex items-center gap-2 rounded-xl border border-border/70 bg-muted/20 px-4 py-3 w-full sm:w-auto">
                      <span className="text-muted-foreground">Добавление пользователей:</span>
                      <strong className="text-foreground">{workspaceActionLog.lastUsersAdd.userName || workspaceActionLog.lastUsersAdd.userEmail}</strong>
                      <span className="text-muted-foreground text-xs ml-auto">{new Date(workspaceActionLog.lastUsersAdd.at).toLocaleString('ru-RU')}</span>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Назначенные администраторы: в многопользовательском пространстве только SUP/ADMIN; в индивидуальном — все, кто видит пространство */}
          {canSeeAssignments && (currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN' || workspaceAssignments.length === 0) && (
            <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60 flex items-center justify-between flex-wrap gap-3">
                <button
                  type="button"
                  className="flex items-center gap-2 text-base font-semibold text-foreground tracking-tight hover:opacity-80 transition-opacity"
                  onClick={() => setAssignmentsCollapsed((c) => !c)}
                >
                  {assignmentsCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                  Назначенные администраторы
                  {workspaceAssignments.length > 0 && (
                    <span className="text-muted-foreground font-normal text-sm">({workspaceAssignments.length})</span>
                  )}
                </button>
                {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button size="sm" className="rounded-lg shadow-sm" onClick={() => { setAssignDialogOpen(true); setAssignSelectedUserId('') }}>
                        <UserPlus className="w-4 h-4 mr-2" />
                        Назначить
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="bottom" className="max-w-xs">
                      <p>Добавить администратора на это пространство. Пользователь увидит его в списке с пометкой «Назначено».</p>
                      {currentUserRole === 'ADMIN' && <p className="mt-1 text-muted-foreground text-xs">ADMIN может назначать ADM или SUP; SUPPORT — только ADM.</p>}
                      {currentUserRole === 'SUPPORT' && <p className="mt-1 text-muted-foreground text-xs">SUPPORT может назначать только ADM.</p>}
                    </TooltipContent>
                  </Tooltip>
                )}
              </div>
              {!assignmentsCollapsed && (
                <CardContent className="p-6">
                  {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (
                    <p className="text-sm text-muted-foreground mb-4 rounded-xl bg-muted/20 border border-border/60 px-4 py-3">
                      {currentUserRole === 'ADMIN'
                        ? 'Назначьте ADM, SUP или VOL на это пространство — они увидят его в списке с пометкой «Назначено» и смогут подключиться своими учётными данными Rocket.Chat.'
                        : 'Назначьте ADM или VOL на это пространство — они увидят его в списке с пометкой «Назначено».'}
                    </p>
                  )}
                  {workspaceAssignments.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Никого не назначено.</p>
                  ) : (
                    <ul className="space-y-3">
                      {workspaceAssignments.map((a) => (
                        <li key={a.id} className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/10 px-4 py-3 hover:bg-muted/20 transition-colors">
                          <div>
                            <span className="font-medium">{a.user.name || a.user.email}</span>
                            <span className="text-muted-foreground text-sm ml-2">({a.user.role})</span>
                            <p className="text-xs text-muted-foreground mt-0.5">Назначил: {a.assignedBy.name || a.assignedBy.email}</p>
                          </div>
                          {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="text-destructive hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                  disabled={assignLoading}
                                  onClick={async () => {
                                    if (!confirm('Снять назначение с этого пользователя?')) return
                                    setAssignLoading(true)
                                    try {
                                      const res = await fetch(`/api/admin/workspaces/${workspaceId}/assign-adm`, {
                                        method: 'DELETE',
                                        headers: { 'Content-Type': 'application/json' },
                                        body: JSON.stringify({ userId: a.userId }),
                                      })
                                      if (res.ok) {
                                        toast.success('Назначение снято')
                                        loadAssignments()
                                      } else {
                                        const d = await res.json().catch(() => ({}))
                                        toast.error(d.error || 'Ошибка')
                                      }
                                    } finally {
                                      setAssignLoading(false)
                                    }
                                  }}
                                >
                                  Снять
                                </Button>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-xs">
                                Снять назначение с этого пользователя — пространство исчезнет из его списка.
                              </TooltipContent>
                            </Tooltip>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              )}
            </Card>
          )}

          {/* Участники пространства: владелец + назначенные — имя, логин, роль (для всех, кто видит пространство) */}
          {canSeeAssignments && (workspaceOwner || workspaceAssignments.length > 0) && (
            <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
                <h2 className="text-base font-semibold text-foreground tracking-tight">Участники пространства</h2>
                <p className="text-sm text-muted-foreground mt-0.5">С кем работаете — владелец и назначенные пользователи</p>
              </div>
              <CardContent className="p-0">
                <div className="overflow-x-auto rounded-b-2xl">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/70 bg-muted/20">
                        <th className="text-left font-medium py-3.5 px-5 text-muted-foreground">Имя</th>
                        <th className="text-left font-medium py-3.5 px-5 text-muted-foreground">Логин</th>
                        <th className="text-left font-medium py-3.5 px-5 text-muted-foreground">Роль</th>
                      </tr>
                    </thead>
                    <tbody>
                      {workspaceOwner && (
                        <tr className="border-b border-border/60 hover:bg-muted/15 transition-colors">
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 shrink-0 ring-2 ring-background">
                                {workspaceOwner.avatarUrl && <AvatarImage src={workspaceOwner.avatarUrl} alt="" />}
                                <AvatarFallback className={`${generateAvatarColor(workspaceOwner.email)} text-white text-xs font-semibold`}>
                                  {getInitials(workspaceOwner.name || workspaceOwner.email)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">{workspaceOwner.name || workspaceOwner.email || '—'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-5 text-muted-foreground">{workspaceOwner.username || workspaceOwner.email || '—'}</td>
                          <td className="py-3 px-5">
                            <Badge variant="secondary" className="rounded-full text-xs">{workspaceOwner.role}</Badge>
                            <span className="text-muted-foreground text-xs ml-1.5">(владелец)</span>
                          </td>
                        </tr>
                      )}
                      {workspaceAssignments.map((a) => (
                        <tr key={a.id} className="border-b border-border/60 hover:bg-muted/15 last:border-b-0 transition-colors">
                          <td className="py-3 px-5">
                            <div className="flex items-center gap-3">
                              <Avatar className="h-9 w-9 shrink-0 ring-2 ring-background">
                                {a.user.avatarUrl && <AvatarImage src={a.user.avatarUrl} alt="" />}
                                <AvatarFallback className={`${generateAvatarColor(a.user.email)} text-white text-xs font-semibold`}>
                                  {getInitials(a.user.name || a.user.email)}
                                </AvatarFallback>
                              </Avatar>
                              <span className="font-medium">{a.user.name || a.user.email || '—'}</span>
                            </div>
                          </td>
                          <td className="py-3 px-5 text-muted-foreground">{a.user.username ?? a.user.email ?? '—'}</td>
                          <td className="py-3 px-5">
                            <Badge variant="outline" className="rounded-full text-xs">{a.user.role}</Badge>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Диалог «Назначить администратора» */}
          <Dialog open={assignDialogOpen} onOpenChange={setAssignDialogOpen}>
            <DialogContent className="sm:max-w-md">
              <DialogHeader>
                <DialogTitle>Назначить на пространство</DialogTitle>
                <DialogDescription>
                  Выберите пользователя — он увидит это пространство в списке с пометкой «Назначено» и сможет работать с календарём и сообщениями.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-4">
                {assignCandidatesLoading ? (
                  <div className="flex items-center justify-center py-6">
                    <Spinner className="w-6 h-6" />
                  </div>
                ) : assignCandidates.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Нет доступных пользователей для назначения (все уже назначены или нет подходящих по роли).</p>
                ) : (
                  <div className="space-y-2">
                    <Label>Пользователь</Label>
                    <Select value={assignSelectedUserId} onValueChange={setAssignSelectedUserId}>
                      <SelectTrigger>
                        <SelectValue placeholder="Выберите пользователя" />
                      </SelectTrigger>
                      <SelectContent>
                        {assignCandidates.map((u) => (
                          <SelectItem key={u.id} value={u.id}>
                            {u.name || u.email} ({u.role})
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                )}
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setAssignDialogOpen(false)}>Отмена</Button>
                <Button
                  disabled={!assignSelectedUserId || assignLoading}
                  onClick={async () => {
                    if (!assignSelectedUserId) return
                    setAssignLoading(true)
                    try {
                      const res = await fetch(`/api/admin/workspaces/${workspaceId}/assign-adm`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ userId: assignSelectedUserId }),
                      })
                      if (res.ok) {
                        toast.success('Пользователь назначен на пространство')
                        setAssignDialogOpen(false)
                        setAssignSelectedUserId('')
                        loadAssignments()
                      } else {
                        const d = await res.json().catch(() => ({}))
                        const msg = d.message || (d.error === 'USER_ALREADY_ADDED' ? 'Пользователь уже добавил себе это пространство. Назначение невозможно.' : null) || d.error || 'Ошибка назначения'
                        toast.error(msg)
                      }
                    } finally {
                      setAssignLoading(false)
                    }
                  }}
                >
                  {assignLoading ? <Spinner className="w-4 h-4 mr-2" /> : null}
                  Назначить
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          {/* Статистика сообщений — компактный блок */}
          <Card className="border-border/80 bg-card shadow-sm overflow-hidden">
            <div className="px-4 py-2.5 border-b border-border/80 bg-muted/30 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-foreground">Статистика сообщений</h2>
            </div>
            <CardContent className="p-3 sm:p-4">
              <div className="grid grid-cols-4 gap-2 sm:gap-3">
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:bg-muted/50 hover:border-primary/30 focus:outline-none focus:ring-2 focus:ring-primary/20"
                  onClick={() => { setActiveTab('messages'); setMessageFilterFromStats('all'); if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}#messages`) }}
                >
                  <MessageSquare className="w-5 h-5 text-muted-foreground shrink-0" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">{messages.length}</p>
                    <p className="text-xs text-muted-foreground">Всего</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:bg-yellow-500/10 hover:border-yellow-500/50 focus:outline-none focus:ring-2 focus:ring-yellow-500/20"
                  onClick={() => { setActiveTab('messages'); setMessageFilterFromStats('PENDING'); if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}#messages`) }}
                >
                  <Clock className="w-5 h-5 text-yellow-600 dark:text-yellow-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">{stats.pending}</p>
                    <p className="text-xs text-muted-foreground">Ожидает</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:bg-green-500/10 hover:border-green-500/50 focus:outline-none focus:ring-2 focus:ring-green-500/20"
                  onClick={() => { setActiveTab('messages'); setMessageFilterFromStats('SENT'); if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}#messages`) }}
                >
                  <CheckCircle2 className="w-5 h-5 text-green-600 dark:text-green-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">{stats.sent}</p>
                    <p className="text-xs text-muted-foreground">Отправлено</p>
                  </div>
                </button>
                <button
                  type="button"
                  className="flex items-center gap-2 rounded-lg border border-border/70 bg-card p-3 text-left transition-colors hover:bg-red-500/10 hover:border-red-500/50 focus:outline-none focus:ring-2 focus:ring-red-500/20"
                  onClick={() => { setActiveTab('messages'); setMessageFilterFromStats('FAILED'); if (typeof window !== 'undefined') window.history.replaceState(null, '', `${window.location.pathname}#messages`) }}
                >
                  <XCircle className="w-5 h-5 text-red-600 dark:text-red-500 shrink-0" />
                  <div className="min-w-0">
                    <p className="text-lg font-bold leading-tight">{stats.failed}</p>
                    <p className="text-xs text-muted-foreground">Ошибки</p>
                  </div>
                </button>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Tabs block — оформление в стиле result-ai.tech */}
        <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
          <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
            <h2 className="text-base font-semibold text-foreground tracking-tight">Каналы, сообщения и настройки</h2>
            <p className="text-sm text-muted-foreground mt-0.5">Управление каналами, планирование сообщений и настройки пространства</p>
          </div>
          <div className="p-6">
        <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
          <div className="rounded-xl bg-muted/30 p-1.5 border border-border/60">
            <TabsList className="bg-transparent h-auto p-0 gap-1.5 flex flex-wrap w-full">
              <TabsTrigger 
                value="channels"
                className="flex-1 min-w-0 sm:flex-initial data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground rounded-lg border-0 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Hash className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">Каналы</span>
                <Badge variant="secondary" className="ml-2 text-[10px] h-5 px-1.5 shrink-0">
                  {channels.length}
                </Badge>
              </TabsTrigger>
              <TabsTrigger 
                value="messages"
                className="flex-1 min-w-0 sm:flex-initial data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground rounded-lg border-0 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <MessageSquare className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">Сообщения</span>
                <Badge variant="secondary" className="ml-2 text-[10px] h-5 px-1.5 shrink-0">
                  {messages.length}
                </Badge>
              </TabsTrigger>
              {(currentUserRole === 'ADM' || currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (currentUserRole === 'ADMIN' || tabRestrictions === null || tabRestrictions.templates) && (
              <TabsTrigger 
                value="templates"
                className="flex-1 min-w-0 sm:flex-initial data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground rounded-lg border-0 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <FileText className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">Шаблоны</span>
              </TabsTrigger>
              )}
              {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (currentUserRole === 'ADMIN' || tabRestrictions === null || tabRestrictions.emojiImport) && (
              <TabsTrigger 
                value="emoji-import"
                className="flex-1 min-w-0 sm:flex-initial data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground rounded-lg border-0 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Smile className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">Импорт эмодзи</span>
              </TabsTrigger>
              )}
              {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (currentUserRole === 'ADMIN' || tabRestrictions === null || tabRestrictions.usersAdd) && (
              <TabsTrigger 
                value="users-add"
                className="flex-1 min-w-0 sm:flex-initial data-[state=active]:bg-background data-[state=active]:shadow-sm data-[state=active]:text-foreground rounded-lg border-0 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
              >
                <Users className="w-4 h-4 mr-2 shrink-0" />
                <span className="truncate">Добавление пользователей</span>
              </TabsTrigger>
              )}
            </TabsList>
          </div>

          {/* Channels Tab */}
          <TabsContent value="channels" className="space-y-5 mt-6">
            <div className="flex flex-col gap-3">
              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-3">
                <div className="relative flex-1">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                  <Input
                    placeholder="Поиск каналов..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10 h-10 bg-background border-muted/70"
                  />
                </div>
                <Button 
                  variant="outline" 
                  onClick={loadData}
                  className="h-10 border-muted/70 hover:bg-muted/50"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Перезагрузить
                </Button>
              </div>
              
              <div className="flex flex-wrap items-center gap-3">
                {/* Переключатель Все / Мои добавленные */}
                {favoriteChannelIds.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-muted-foreground">Отображение:</span>
                    <div className="inline-flex rounded-lg border border-muted/70 bg-background p-1">
                      <button
                        onClick={() => setChannelView('all')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          channelView === 'all'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Все
                      </button>
                      <button
                        onClick={() => setChannelView('favorites')}
                        className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                          channelView === 'favorites'
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        Мои добавленные
                      </button>
                    </div>
                  </div>
                )}
                <Select value={channelSort} onValueChange={(v: 'name' | 'messages' | 'public_first') => setChannelSort(v)}>
                  <SelectTrigger className="w-[200px] h-9 border-muted/70">
                    <SelectValue placeholder="Сортировка" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">По имени</SelectItem>
                    <SelectItem value="messages">По кол-ву сообщений (RC)</SelectItem>
                    <SelectItem value="public_first">Публичные сначала</SelectItem>
                  </SelectContent>
                </Select>
                <div className="inline-flex rounded-lg border border-muted/70 bg-background p-1">
                  <button
                    onClick={() => setChannelViewMode('grid')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      channelViewMode === 'grid' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title="Сетка"
                  >
                    Сетка
                  </button>
                  <button
                    onClick={() => setChannelViewMode('list')}
                    className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                      channelViewMode === 'list' ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                    }`}
                    title="Список"
                  >
                    Список
                  </button>
                </div>
              </div>
            </div>

            {filteredChannels.length === 0 ? (
              <Card className="border-dashed border-muted/70">
                <CardContent className="py-20 text-center">
                  <div className="w-16 h-16 bg-muted/50 rounded-2xl flex items-center justify-center mx-auto mb-4">
                    <Hash className="w-8 h-8 text-muted-foreground" />
                  </div>
                  <p className="text-muted-foreground font-medium">
                    {searchQuery ? 'Каналы не найдены' : 'Нет доступных каналов'}
                  </p>
                  {!searchQuery && (
                    <p className="text-sm text-muted-foreground mt-2">
                      Каналы появятся после подключения к Rocket.Chat
                    </p>
                  )}
                </CardContent>
              </Card>
            ) : (
              <>
                {showChannelGroups ? (
                  <div className="space-y-6">
                    {channelsPublic.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Публичные</h3>
                        {channelViewMode === 'grid' ? (
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {channelsPublic.map((channel: any) => renderChannelCard(channel))}
                          </div>
                        ) : (
                          <VirtualList
                            items={channelsPublic}
                            height="min(40vh, 350px)"
                            estimateSize={64}
                            getItemKey={(c: any) => c.id}
                            renderItem={(channel: any) => (
                              <div className="pb-2">{renderChannelRow(channel)}</div>
                            )}
                          />
                        )}
                      </div>
                    )}
                    {channelsPrivate.length > 0 && (
                      <div>
                        <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Приватные</h3>
                        {channelViewMode === 'grid' ? (
                          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                            {channelsPrivate.map((channel: any) => renderChannelCard(channel))}
                          </div>
                        ) : (
                          <VirtualList
                            items={channelsPrivate}
                            height="min(40vh, 350px)"
                            estimateSize={64}
                            getItemKey={(c: any) => c.id}
                            renderItem={(channel: any) => (
                              <div className="pb-2">{renderChannelRow(channel)}</div>
                            )}
                          />
                        )}
                      </div>
                    )}
                  </div>
                ) : (
                  channelViewMode === 'grid' ? (
                    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                      {filteredChannels.map((channel: any) => renderChannelCard(channel))}
                    </div>
                  ) : (
                    <VirtualList
                      items={filteredChannels}
                      height="min(65vh, 600px)"
                      estimateSize={64}
                      getItemKey={(c: any) => c.id}
                      renderItem={(channel: any) => (
                        <div className="pb-2">{renderChannelRow(channel)}</div>
                      )}
                    />
                  )
                )}
              </>
            )}
          </TabsContent>

          {/* Messages Tab */}
          <TabsContent value="messages" className="space-y-5 mt-6">
            {currentUserRole === 'VOL' && messages.length > 0 && (
              <p className="text-sm text-muted-foreground">
                Показаны только ваши запланированные сообщения
              </p>
            )}
            <div className="space-y-3">
              {messageAuthors.length >= 2 && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg border border-muted/70 bg-muted/20 p-3">
                  <span className="text-sm font-medium text-muted-foreground shrink-0">Автор:</span>
                  <div className="flex flex-wrap gap-1.5">
                    <Button
                      variant={!messageFilterByUserId ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 rounded-md text-xs"
                      onClick={() => setMessageFilterByUserId(null)}
                    >
                      Все
                    </Button>
                    {messageAuthors.map((u) => (
                      <Button
                        key={u.id}
                        variant={messageFilterByUserId === u.id ? 'default' : 'outline'}
                        size="sm"
                        className="h-8 rounded-md text-xs"
                        onClick={() => setMessageFilterByUserId(u.id)}
                      >
                        {u.name || u.email || u.username || u.id}
                        {u.role && <span className="ml-1 opacity-80">({u.role})</span>}
                      </Button>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex flex-wrap items-center gap-2 rounded-lg border border-muted/70 bg-muted/20 p-3">
                <span className="text-sm font-medium text-muted-foreground shrink-0">Период:</span>
                <div className="flex flex-wrap gap-1.5">
                  <Button
                    variant={messagePeriodFilter === 'all' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 rounded-md text-xs"
                    onClick={() => setMessagePeriodFilter('all')}
                  >
                    Все
                  </Button>
                  <Button
                    variant={messagePeriodFilter === '2weeks' ? 'default' : 'outline'}
                    size="sm"
                    className="h-8 rounded-md text-xs"
                    onClick={() => setMessagePeriodFilter('2weeks')}
                    title="Ближайшие 2 недели"
                  >
                    2 недели
                  </Button>
                  {workspace?.startDate && workspace?.endDate && (
                    <Button
                      variant={messagePeriodFilter === 'intensive' ? 'default' : 'outline'}
                      size="sm"
                      className="h-8 rounded-md text-xs"
                      onClick={() => setMessagePeriodFilter('intensive')}
                      title={`${new Date(workspace.startDate).toLocaleDateString('ru-RU')} – ${new Date(workspace.endDate).toLocaleDateString('ru-RU')}`}
                    >
                      Период интенсива
                    </Button>
                  )}
                </div>
              </div>
            </div>
            {messages.length === 0 ? (
              <EmptyState
                icon={<MessageSquare className="w-8 h-8" />}
                title="Нет сообщений"
                description="Запланируйте первое отложенное сообщение для этого пространства"
                children={
                  <Button
                    className="mt-4 rounded-lg gap-2 shadow-sm"
                    size="sm"
                    onClick={() => {
                      if (channels.length === 1) {
                        handleChannelSelect(channels[0])
                      } else if (channels.length > 1) {
                        setActiveTab('channels')
                        toast.info('Выберите канал для создания сообщения')
                      } else {
                        toast.error('Нет каналов — перезагрузите список каналов или проверьте подключение')
                      }
                    }}
                  >
                    <Plus className="w-4 h-4" />
                    Запланировать первое
                  </Button>
                }
              />
            ) : (
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                {/* Список каналов с сообщениями */}
                <Card className="lg:col-span-1 border-muted/70">
                  <CardContent className="p-4">
                    <h3 className="font-semibold text-sm mb-4 text-muted-foreground uppercase tracking-wide">
                      Каналы с сообщениями
                    </h3>
                    <VirtualList
                      items={channelsWithMessages}
                      height="min(50vh, 400px)"
                      estimateSize={52}
                      getItemKey={(c: any) => c.channelId}
                      renderItem={(channel: any) => (
                        <div className="pb-2">
                          <button
                            onClick={() => setSelectedMessageChannelId(channel.channelId)}
                            className={`w-full text-left p-3 rounded-lg transition-all ${
                              selectedMessageChannelId === channel.channelId
                                ? 'bg-primary/10 border border-primary/20 text-primary'
                                : 'hover:bg-muted/50 border border-transparent'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2 min-w-0 flex-1">
                                <Hash className="w-4 h-4 shrink-0" />
                                <span className="font-medium text-sm truncate">
                                  {channel.channelName}
                                </span>
                              </div>
                              <Badge variant="secondary" className="ml-2 text-xs shrink-0">
                                {channel.messageCount}
                              </Badge>
                            </div>
                          </button>
                        </div>
                      )}
                    />
                  </CardContent>
                </Card>

                {/* История сообщений выбранного канала */}
                <div className="lg:col-span-2">
                  {selectedMessageChannelId ? (
                    <div className="rounded-lg border border-muted/70 bg-card/50 backdrop-blur-sm">
                      <CompactMessages
                        messages={filteredMessagesByChannel}
                        onEdit={handleEditMessage}
                        onDelete={handleDeleteMessage}
                        onRetry={handleRetryMessage}
                        initialStatusFilter={activeTab === 'messages' ? messageFilterFromStats : null}
                      />
                    </div>
                  ) : (
                    <Card className="border-dashed border-muted/70">
                      <CardContent className="py-16 text-center">
                        <MessageSquare className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
                        <p className="text-muted-foreground font-medium">
                          Выберите канал для просмотра истории сообщений
                        </p>
                      </CardContent>
                    </Card>
                  )}
                </div>
              </div>
            )}
          </TabsContent>

          {/* Шаблоны анонсов (ADM/SUP/ADMIN) — в стиле result-ai.tech: табы по дням, канал выделен, сворачиваемые дни */}
          {(currentUserRole === 'ADM' || currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (
          <TabsContent value="templates" className="space-y-6 mt-6">
            <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-4 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
                <p className="text-sm text-muted-foreground">
                  Канал и примерное время указаны в каждом шаблоне. Копируйте текст и вставьте в запланированное сообщение в нужный канал (#adm / #announcements). Свои шаблоны можно редактировать на странице <Link href="/dashboard/templates" className="text-primary underline font-medium">Шаблоны</Link> → вкладка «Мои шаблоны».
                </p>
              </div>
            </Card>

            {workspaceMyTemplates.length > 0 && (() => {
              const dayWeekdays = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'] as const
              const getMyDayLabel = (day: number) =>
                day === 0 ? 'Без дня' : `День ${day} (${dayWeekdays[(day - 1) % 7]})`
              const MY_NO_DAY = 0
              const myGrouped = workspaceMyTemplates.reduce<Record<number, typeof workspaceMyTemplates>>((acc, t) => {
                const day = t.intensiveDay ?? MY_NO_DAY
                if (!acc[day]) acc[day] = []
                acc[day].push(t)
                return acc
              }, {})
              const myDays = [...new Set(workspaceMyTemplates.map((t) => t.intensiveDay ?? MY_NO_DAY))].sort(
                (a, b) => (a === MY_NO_DAY ? 1 : b === MY_NO_DAY ? -1 : a - b)
              )
              const renderMyTemplateRow = (t: (typeof workspaceMyTemplates)[0]) => {
                const tagColors = getChannelTagColors(t.channel)
                return (
                  <div key={t.id} className="rounded-xl border border-border/70 bg-muted/5 hover:bg-muted/10 transition-colors overflow-hidden">
                    <div
                      className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-wrap"
                      onClick={() => setWorkspaceTemplatesOpenIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(t.id)) next.delete(t.id)
                        else next.add(t.id)
                        return next
                      })}
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg">
                        {workspaceTemplatesOpenIds.has(t.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <span className="text-muted-foreground tabular-nums w-12 shrink-0 text-sm">~{t.time}</span>
                      <div className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border-l-4 pl-2 pr-2.5 py-1 shrink-0 min-w-0",
                        tagColors.bar,
                        tagColors.bg,
                        tagColors.text
                      )}>
                        <Hash className="w-3.5 h-3.5 opacity-80" />
                        <span className="font-medium text-xs truncate">#{t.channel}</span>
                      </div>
                      <span className="flex-1 truncate text-sm font-medium">{t.title || '(без названия)'}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-lg border-border/80"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(t.body).then(() => {
                            setTemplateCopiedBody(t.body)
                            toast.success('Текст скопирован. Выберите канал — текст подставится в форму сообщения.')
                          })
                        }}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Копировать
                      </Button>
                    </div>
                    {workspaceTemplatesOpenIds.has(t.id) && (
                      <div className="px-4 pb-4 pt-0 pl-14">
                        <pre className="text-xs rounded-xl p-4 bg-muted/30 overflow-x-auto whitespace-pre-wrap font-sans border border-border/60">
                          {t.body}
                        </pre>
                        <Button variant="ghost" size="sm" className="mt-2 rounded-lg" onClick={() => { navigator.clipboard.writeText(t.body); setTemplateCopiedBody(t.body); toast.success('Текст скопирован.'); }}>
                          <Copy className="h-4 w-4 mr-1" />
                          Копировать текст
                        </Button>
                      </div>
                    )}
                  </div>
                )
              }
              return (
                <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
                  <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60 flex flex-wrap items-center justify-between gap-3">
                    <h3 className="text-base font-semibold text-foreground tracking-tight">Мои шаблоны</h3>
                    <Link href="/dashboard/templates" className="text-sm text-primary hover:underline font-medium">
                      Редактировать на странице Шаблоны
                    </Link>
                  </div>
                  <CardContent className="p-4">
                    <div className="rounded-xl bg-muted/30 p-1.5 border border-border/60 mb-4">
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          onClick={() => setWorkspaceMyTemplatesSelectedDay('all')}
                          className={cn(
                            "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                            workspaceMyTemplatesSelectedDay === 'all' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                          )}
                        >
                          Все дни
                        </button>
                        {myDays.map((day) => (
                          <button
                            key={day}
                            type="button"
                            onClick={() => setWorkspaceMyTemplatesSelectedDay(day)}
                            className={cn(
                              "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                              workspaceMyTemplatesSelectedDay === day ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            {getMyDayLabel(day)}
                          </button>
                        ))}
                      </div>
                    </div>
                    {workspaceMyTemplatesSelectedDay === 'all' ? (
                      <div className="space-y-3">
                        {myDays.map((day) => {
                          const collapsed = workspaceMyTemplatesDayCollapsed.has(day)
                          const items = (myGrouped[day] ?? []).sort((a, b) => a.time.localeCompare(b.time))
                          return (
                            <div key={day} className="rounded-xl border border-border/70 bg-muted/5 overflow-hidden">
                              <button
                                type="button"
                                className="w-full flex items-center justify-between gap-2 px-4 py-3 font-medium text-sm hover:bg-muted/20 transition-colors"
                                onClick={() => setWorkspaceMyTemplatesDayCollapsed((s) => {
                                  const next = new Set(s)
                                  if (next.has(day)) next.delete(day)
                                  else next.add(day)
                                  return next
                                })}
                              >
                                <span>{getMyDayLabel(day)}</span>
                                <span className="text-muted-foreground text-xs">{items.length} анонсов</span>
                                {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                              </button>
                              {!collapsed && (
                                <div className="px-2 pb-2 pt-0 space-y-2">
                                  {items.map((t) => renderMyTemplateRow(t))}
                                </div>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        {(myGrouped[workspaceMyTemplatesSelectedDay] ?? [])
                          .sort((a, b) => a.time.localeCompare(b.time))
                          .map((t) => renderMyTemplateRow(t))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              )
            })()}

            {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && workspaceAdmTemplates.length > 0 && (
              <div className="rounded-xl bg-muted/30 p-1.5 border border-border/60 w-fit">
                <div className="flex gap-1">
                  <button
                    type="button"
                    onClick={() => setWorkspaceShowAdmTemplates(false)}
                    className={cn(
                      "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                      !workspaceShowAdmTemplates ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Свои (SUP)
                  </button>
                  <button
                    type="button"
                    onClick={() => setWorkspaceShowAdmTemplates(true)}
                    className={cn(
                      "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                      workspaceShowAdmTemplates ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                    )}
                  >
                    Шаблоны ADM
                  </button>
                </div>
              </div>
            )}

            {workspaceTemplatesLoading ? (
              <div className="flex items-center justify-center py-12">
                <Spinner className="h-8 w-8 text-muted-foreground" />
              </div>
            ) : (() => {
              const list = (currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && workspaceShowAdmTemplates ? workspaceAdmTemplates : workspaceTemplates
              const filteredList = list
              const grouped = filteredList.reduce<Record<number, typeof list>>((acc, t) => {
                if (!acc[t.intensiveDay]) acc[t.intensiveDay] = []
                acc[t.intensiveDay].push(t)
                return acc
              }, {})
              const days = Object.keys(grouped).map(Number).sort((a, b) => a - b)
              const renderSupAdmRow = (t: (typeof list)[0]) => {
                const tagColors = getChannelTagColors(t.channel)
                return (
                  <div key={t.id} className="rounded-xl border border-border/70 bg-muted/5 hover:bg-muted/10 transition-colors overflow-hidden">
                    <div
                      className="flex items-center gap-2 px-4 py-3 cursor-pointer flex-wrap"
                      onClick={() => setWorkspaceTemplatesOpenIds((prev) => {
                        const next = new Set(prev)
                        if (next.has(t.id)) next.delete(t.id)
                        else next.add(t.id)
                        return next
                      })}
                    >
                      <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0 rounded-lg">
                        {workspaceTemplatesOpenIds.has(t.id) ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                      </Button>
                      <span className="text-muted-foreground tabular-nums w-12 shrink-0 text-sm">~{t.time}</span>
                      <div className={cn(
                        "inline-flex items-center gap-1.5 rounded-lg border-l-4 pl-2 pr-2.5 py-1 shrink-0 min-w-0",
                        tagColors.bar,
                        tagColors.bg,
                        tagColors.text
                      )}>
                        <Hash className="w-3.5 h-3.5 opacity-80" />
                        <span className="font-medium text-xs truncate">#{t.channel}</span>
                      </div>
                      {t.audience === 'mk' && <Badge variant="secondary" className="shrink-0 rounded-full text-xs">МК</Badge>}
                      <span className="flex-1 truncate text-sm font-medium">{t.title ?? t.dayLabel}</span>
                      <Button
                        variant="outline"
                        size="sm"
                        className="shrink-0 rounded-lg border-border/80"
                        onClick={(e) => {
                          e.stopPropagation()
                          navigator.clipboard.writeText(t.body).then(() => {
                            setTemplateCopiedBody(t.body)
                            toast.success('Текст скопирован. Выберите канал — текст подставится в форму сообщения.')
                          })
                        }}
                      >
                        <Copy className="h-4 w-4 mr-1" />
                        Копировать
                      </Button>
                    </div>
                    {workspaceTemplatesOpenIds.has(t.id) && (
                      <div className="px-4 pb-4 pt-0 pl-14">
                        <pre className="text-xs rounded-xl p-4 bg-muted/30 overflow-x-auto whitespace-pre-wrap font-sans border border-border/60">
                          {t.body}
                        </pre>
                        <Button variant="ghost" size="sm" className="mt-2 rounded-lg" onClick={() => { navigator.clipboard.writeText(t.body); setTemplateCopiedBody(t.body); toast.success('Текст скопирован.'); }}>
                          <Copy className="h-4 w-4 mr-1" />
                          Копировать текст
                        </Button>
                      </div>
                    )}
                  </div>
                )
              }
              return (
                <div className="space-y-4">
                  {filteredList.length === 0 ? (
                    <p className="text-center text-muted-foreground py-8">Нет шаблонов.</p>
                  ) : (
                    <>
                      <div className="rounded-xl bg-muted/30 p-1.5 border border-border/60">
                        <div className="flex flex-wrap gap-1">
                          <button
                            type="button"
                            onClick={() => setWorkspaceTemplatesSelectedDay('all')}
                            className={cn(
                              "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                              workspaceTemplatesSelectedDay === 'all' ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                            )}
                          >
                            Все дни
                          </button>
                          {days.map((day) => (
                            <button
                              key={day}
                              type="button"
                              onClick={() => setWorkspaceTemplatesSelectedDay(day)}
                              className={cn(
                                "px-3 py-2 text-sm font-medium rounded-lg transition-colors",
                                workspaceTemplatesSelectedDay === day ? "bg-background shadow-sm text-foreground" : "text-muted-foreground hover:text-foreground"
                              )}
                            >
                              День {day}
                            </button>
                          ))}
                        </div>
                      </div>
                      {workspaceTemplatesSelectedDay === 'all' ? (
                        <div className="space-y-3">
                          {days.map((day) => {
                            const collapsed = workspaceTemplatesDayCollapsed.has(day)
                            const items = (grouped[day] ?? []).sort((a, b) => a.time.localeCompare(b.time) || (a.audience === 'mk' ? 1 : 0) - (b.audience === 'mk' ? 1 : 0))
                            return (
                              <div key={day} className="rounded-xl border border-border/70 bg-muted/5 overflow-hidden">
                                <button
                                  type="button"
                                  className="w-full flex items-center justify-between gap-2 px-4 py-3 font-medium text-sm hover:bg-muted/20 transition-colors"
                                  onClick={() => setWorkspaceTemplatesDayCollapsed((s) => {
                                    const next = new Set(s)
                                    if (next.has(day)) next.delete(day)
                                    else next.add(day)
                                    return next
                                  })}
                                >
                                  <span>День {day} — {grouped[day][0]?.dayLabel ?? ''}</span>
                                  <span className="text-muted-foreground text-xs">{items.length} анонсов</span>
                                  {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
                                </button>
                                {!collapsed && (
                                  <div className="px-2 pb-2 pt-0 space-y-2">
                                    {items.map((t) => renderSupAdmRow(t))}
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      ) : (
                        <div className="space-y-2">
                          {(grouped[workspaceTemplatesSelectedDay] ?? [])
                            .sort((a, b) => a.time.localeCompare(b.time) || (a.audience === 'mk' ? 1 : 0) - (b.audience === 'mk' ? 1 : 0))
                            .map((t) => renderSupAdmRow(t))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            })()}
          </TabsContent>
          )}

          {/* Emoji Import Tab — в стиле result-ai.tech */}
          {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (
          <TabsContent value="emoji-import" className="space-y-5 mt-6">
            <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
                <h3 className="text-base font-semibold text-foreground tracking-tight">Массовый импорт кастомных эмодзи</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Загрузка эмодзи из YAML-каталога в Rocket.Chat этого пространства. Уже существующие эмодзи пропускаются. Укажите учётные данные администратора Rocket.Chat — система проверит их перед импортом.
                </p>
              </div>
              <CardContent className="p-6 space-y-5">
                {lastEmojiImportStatus && (
                  <div className="rounded-xl border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-4 space-y-2">
                    <p className="font-medium text-sm text-green-800 dark:text-green-200">Последний успешный импорт</p>
                    <p className="text-xs text-green-700 dark:text-green-300">
                      {new Date(lastEmojiImportStatus.date).toLocaleString('ru-RU')} — успешно загружено: {lastEmojiImportStatus.uploaded}, пропущено (уже есть): {lastEmojiImportStatus.skipped}
                      {lastEmojiImportStatus.errorsCount > 0 && `, с ошибками: ${lastEmojiImportStatus.errorsCount}`}
                    </p>
                    {lastEmojiImportStatus.errors && lastEmojiImportStatus.errors.length > 0 && (
                      <div className="mt-2 pt-2 border-t border-green-200 dark:border-green-800">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs text-green-800 dark:text-green-200"
                            onClick={() => setLastEmojiErrorsExpanded(!lastEmojiErrorsExpanded)}
                          >
                            {lastEmojiErrorsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            С ошибками ({lastEmojiImportStatus.errors.length})
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              navigator.clipboard.writeText(lastEmojiImportStatus.errors!.join('\n'))
                              toast.success('Список ошибок скопирован')
                            }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Скопировать
                          </Button>
                        </div>
                        {lastEmojiErrorsExpanded && (
                          <ul className="text-xs text-green-700 dark:text-green-300 max-h-24 overflow-y-auto space-y-0.5 list-disc list-inside mt-1">
                            {lastEmojiImportStatus.errors!.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {emojiImportInterrupted && (
                  <div className="rounded-xl border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950/30 p-4 space-y-2">
                    <p className="font-medium text-sm text-amber-800 dark:text-amber-200">Импорт был прерван перезагрузкой</p>
                    <p className="text-xs text-amber-700 dark:text-amber-300">
                      Последнее состояние: обработано {emojiImportInterrupted.current} из {emojiImportInterrupted.total} (осталось {emojiImportInterrupted.total - emojiImportInterrupted.current}). Загружено {emojiImportInterrupted.uploaded}, пропущено {emojiImportInterrupted.skipped}, ошибок {emojiImportInterrupted.errorsCount}. Запустите импорт снова — уже загруженные эмодзи будут пропущены.
                    </p>
                    <Button variant="outline" size="sm" onClick={dismissInterrupted} className="mt-2">
                      Понятно
                    </Button>
                  </div>
                )}

                {emojiImporting && emojiImportProgress && (
                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <p className="font-medium text-sm">Идёт импорт</p>
                      <span className="text-sm font-semibold text-primary tabular-nums">
                        {emojiImportProgress.total ? Math.round((100 * emojiImportProgress.current) / emojiImportProgress.total) : 0}%
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Обработано {emojiImportProgress.current} из {emojiImportProgress.total} · осталось {emojiImportProgress.total - emojiImportProgress.current}
                    </p>
                    <div className="flex gap-4 text-xs text-muted-foreground">
                      <span>Загружено: {emojiImportProgress.uploaded}</span>
                      <span>Пропущено: {emojiImportProgress.skipped}</span>
                      <span>Ошибок: {emojiImportProgress.errorsCount}</span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all duration-300"
                        style={{ width: emojiImportProgress.total ? `${(100 * emojiImportProgress.current) / emojiImportProgress.total}%` : '0%' }}
                      />
                    </div>
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-xs text-amber-600 dark:text-amber-400 font-medium">
                        Не перезагружайте страницу во время импорта.
                      </p>
                      <Button type="button" variant="outline" size="sm" className="shrink-0" onClick={cancelEmojiImport}>
                        Отмена
                      </Button>
                    </div>
                  </div>
                )}

                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor="emoji-admin-username" className="cursor-help">Логин администратора Rocket.Chat</Label>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Логин учётной записи администратора RC на этом сервере — нужен для импорта эмодзи в каталог.
                      </TooltipContent>
                    </Tooltip>
                    <Input
                      id="emoji-admin-username"
                      type="text"
                      placeholder="admin"
                      value={emojiAdminUsername}
                      onChange={(e) => setEmojiAdminUsername(e.target.value)}
                      disabled={emojiImporting}
                      className="bg-background rounded-lg border-border/80"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="emoji-admin-password">Пароль администратора</Label>
                    <Input
                      id="emoji-admin-password"
                      type="password"
                      placeholder="••••••••"
                      value={emojiAdminPassword}
                      onChange={(e) => setEmojiAdminPassword(e.target.value)}
                      disabled={emojiImporting}
                      className="bg-background rounded-lg border-border/80"
                    />
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="emoji-yaml-url">URL каталога (YAML)</Label>
                  <Input
                    id="emoji-yaml-url"
                    type="url"
                    placeholder={DEFAULT_EMOJI_YAML_URL}
                    value={emojiYamlUrl}
                    onChange={(e) => setEmojiYamlUrl(e.target.value)}
                    disabled={emojiImporting}
                    className="bg-background font-mono text-sm rounded-lg border-border/80"
                  />
                  {emojiYamlUrl.trim() !== '' && emojiYamlUrl.trim() !== DEFAULT_EMOJI_YAML_URL && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">Используется нестандартный каталог</p>
                  )}
                </div>

                {emojiPreview && (
                  <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-2">
                    <p className="font-medium text-sm">Проверка каталога</p>
                    <p className="text-sm text-muted-foreground flex items-center gap-2 flex-wrap">
                      В каталоге <strong>{emojiPreview.total}</strong> эмодзи.
                      {emojiPreview.names.length > 0 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => setEmojiPreviewListVisible(!emojiPreviewListVisible)}
                        >
                          {emojiPreviewListVisible ? 'Скрыть список' : 'Показать имена'}
                        </Button>
                      )}
                    </p>
                    {emojiPreviewListVisible && emojiPreview.names.length > 0 && (
                      <ul className="text-xs font-mono text-muted-foreground max-h-32 overflow-y-auto flex flex-wrap gap-1">
                        {emojiPreview.names.map((name, i) => (
                          <li key={i} className="bg-muted/50 px-1.5 py-0.5 rounded">{name}</li>
                        ))}
                        {emojiPreview.total > emojiPreview.names.length && (
                          <li className="text-muted-foreground">… и ещё {emojiPreview.total - emojiPreview.names.length}</li>
                        )}
                      </ul>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    onClick={runEmojiPreview}
                    disabled={emojiPreviewLoading || emojiImporting}
                    className="gap-2 rounded-lg border-border/80 hover:bg-muted/50"
                  >
                    {emojiPreviewLoading ? <Spinner className="w-4 h-4" /> : null}
                    Проверить каталог
                  </Button>
                  <Button
                    onClick={openEmojiConfirm}
                    disabled={emojiImporting}
                    className="gap-2 rounded-lg shadow-sm"
                  >
                    {emojiImporting ? (
                      <>
                        <Spinner className="w-4 h-4" />
                        Импорт…
                      </>
                    ) : (
                      <>
                        <Upload className="w-4 h-4" />
                        Запустить импорт
                      </>
                    )}
                  </Button>
                </div>

                <AlertDialog open={emojiConfirmOpen} onOpenChange={setEmojiConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Запустить импорт эмодзи?</AlertDialogTitle>
                      <AlertDialogDescription>
                        {emojiPreview
                          ? `В каталоге ${emojiPreview.total} эмодзи. Будут загружены в Rocket.Chat этого пространства. Уже существующие эмодзи будут пропущены.`
                          : 'Будет загружен YAML по указанному URL и все эмодзи загружены в Rocket.Chat. Уже существующие эмодзи будут пропущены.'}
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction onClick={() => runEmojiImport()}>
                        Импортировать
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {emojiImportResult && (
                  <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-2">
                    <p className="font-medium text-sm">Результат импорта</p>
                    <p className="text-sm text-muted-foreground">
                      Успешно загружено: <strong>{emojiImportResult.uploaded}</strong>, пропущено (уже есть): <strong>{emojiImportResult.skipped}</strong>
                      {emojiImportResult.errors && emojiImportResult.errors.length > 0 && (
                        <>, с ошибками: <strong>{emojiImportResult.errors.length}</strong></>
                      )}
                    </p>
                    {emojiImportResult.errors && emojiImportResult.errors.length > 0 && (
                      <div className="mt-2">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => setEmojiResultErrorsExpanded(!emojiResultErrorsExpanded)}
                          >
                            {emojiResultErrorsExpanded ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                            Ошибки ({emojiImportResult.errors.length})
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-7 text-xs gap-1"
                            onClick={() => {
                              navigator.clipboard.writeText(emojiImportResult.errors!.join('\n'))
                              toast.success('Список ошибок скопирован')
                            }}
                          >
                            <Copy className="w-3.5 h-3.5" />
                            Скопировать
                          </Button>
                        </div>
                        {emojiResultErrorsExpanded && (
                          <ul className="text-xs text-muted-foreground max-h-32 overflow-y-auto space-y-0.5 mt-1 list-disc list-inside">
                            {emojiImportResult.errors.map((err, i) => (
                              <li key={i}>{err}</li>
                            ))}
                          </ul>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}

          {/* Добавление пользователей Tab — в стиле result-ai.tech */}
          {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN') && (
          <TabsContent value="users-add" className="space-y-5 mt-6">
            <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
              <div className="px-6 py-5 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
                <h3 className="text-base font-semibold text-foreground tracking-tight">Добавление пользователей в Rocket.Chat</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Вставьте список логинов (по одному на строку). Для каждого будет создан пользователь: email = логин@student.21-school.ru, пароль = логин, смена пароля при первом входе включена. Максимум 100 пользователей за запрос.
                </p>
              </div>
              <CardContent className="p-6 space-y-5">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor="users-admin-username" className="cursor-help">Логин администратора Rocket.Chat</Label>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Учётная запись администратора RC на этом сервере — нужна для создания пользователей и назначения ролей.
                      </TooltipContent>
                    </Tooltip>
                    <Input
                      id="users-admin-username"
                      type="text"
                      placeholder="admin"
                      value={usersAddAdminUsername}
                      onChange={(e) => setUsersAddAdminUsername(e.target.value)}
                      disabled={usersAdding}
                      className="bg-background rounded-lg border-border/80"
                    />
                  </div>
                  <div className="space-y-2">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Label htmlFor="users-admin-password" className="cursor-help">Пароль администратора</Label>
                      </TooltipTrigger>
                      <TooltipContent side="top" className="max-w-xs">
                        Пароль от учётной записи администратора RC — используется только для API при создании пользователей.
                      </TooltipContent>
                    </Tooltip>
                    <Input
                      id="users-admin-password"
                      type="password"
                      placeholder="••••••••"
                      value={usersAddAdminPassword}
                      onChange={(e) => setUsersAddAdminPassword(e.target.value)}
                      disabled={usersAdding}
                      className="bg-background rounded-lg border-border/80"
                    />
                  </div>
                </div>

                {previewLogins === null ? (
                  <>
                    <div className="space-y-2">
                      <Label htmlFor="users-logins">Список логинов (по одному на строку)</Label>
                      <Textarea
                        id="users-logins"
                        placeholder={'wrightag\nuser2\nuser3'}
                        value={usersLogins}
                        onChange={(e) => setUsersLogins(e.target.value)}
                        disabled={usersAdding}
                        className="min-h-[120px] font-mono text-sm bg-background rounded-lg border-border/80"
                        rows={6}
                      />
                      <p className="text-xs text-muted-foreground">
                        Почта: логин@student.21-school.ru. Пароль равен логину. При первом входе пользователь сменит пароль.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={openPreview} disabled={usersAdding} variant="outline" className="gap-2 rounded-lg border-border/80 hover:bg-muted/50">
                        Предпросмотр
                      </Button>
                    </div>
                  </>
                ) : (
                  <>
                    <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-2">
                      <p className="font-medium text-sm">
                        Будет создано пользователей: <strong>{previewLogins.length}</strong>
                      </p>
                      <div className="max-h-48 overflow-y-auto">
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="border-b border-border/70">
                              <th className="text-left py-1.5 font-medium">Логин</th>
                              <th className="text-left py-1.5 font-medium">Почта</th>
                            </tr>
                          </thead>
                          <tbody>
                            {previewLogins.map((login, i) => (
                              <tr key={i} className="border-b border-border/30">
                                <td className="py-1 font-mono">{login}</td>
                                <td className="py-1 text-muted-foreground">{login}@student.21-school.ru</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => setPreviewLogins(null)} variant="outline" disabled={usersAdding} className="rounded-lg border-border/80 hover:bg-muted/50">
                        Назад
                      </Button>
                      <Button onClick={startAddWithConfirm} disabled={usersAdding} className="gap-2 rounded-lg shadow-sm">
                        Создать
                      </Button>
                    </div>
                  </>
                )}

                <div className="grid gap-4 sm:grid-cols-2 pt-2 border-t border-border/70">
                  <div className="space-y-2">
                    <Label>Добавить в канал/группу (опционально)</Label>
<Select
                      value={usersAddChannelId ? `${usersAddChannelId}:${usersAddChannelType}` : '__none__'}
                      onValueChange={(v) => {
                        if (!v || v === '__none__') {
                          setUsersAddChannelId('')
                          return
                        }
                        const [id, t] = v.split(':')
                        setUsersAddChannelId(id)
                        setUsersAddChannelType((t as 'c' | 'p') || 'c')
                      }}
                      disabled={usersAdding}
                    >
                      <SelectTrigger className="bg-background rounded-lg border-border/80">
                        <SelectValue placeholder="Не добавлять" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Не добавлять</SelectItem>
                        {(channels as { id?: string; name?: string; type?: string }[]).map((ch) => {
                          const id = ch.id ?? ''
                          const t = (ch.type === 'p' ? 'p' : 'c') as 'c' | 'p'
                          const name = ch.name ?? ''
                          return (
                            <SelectItem key={id} value={`${id}:${t}`}>
                              {name} {t === 'p' ? '(группа)' : '(канал)'}
                            </SelectItem>
                          )
                        })}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label>Роль (опционально)</Label>
                    <div className="flex gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={loadUsersRoles}
                        disabled={usersRolesLoading || !usersAddAdminUsername.trim() || !usersAddAdminPassword}
                      >
                        {usersRolesLoading ? <Spinner className="w-3.5 h-3.5" /> : 'Загрузить роли'}
                      </Button>
                      <Select value={usersAddRoleId || '__none__'} onValueChange={(v) => setUsersAddRoleId(v === '__none__' ? '' : v)} disabled={usersAdding}>
                        <SelectTrigger className="bg-background flex-1 rounded-lg border-border/80">
                          <SelectValue placeholder="Без роли" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Без роли</SelectItem>
                          {usersRolesList.map((r) => (
                            <SelectItem key={r._id} value={r._id}>
                              {r.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Если пользователь уже существует</Label>
                  <Select value={usersIfUserExists} onValueChange={(v: 'skip' | 'reset_password') => setUsersIfUserExists(v)} disabled={usersAdding}>
                    <SelectTrigger className="bg-background w-full sm:w-64 rounded-lg border-border/80">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="skip">Пропускать</SelectItem>
                      <SelectItem value="reset_password">Сбросить пароль (скоро)</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                {(addUsersProgress || usersRetryProgress) && (
                  <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-2">
                    <div className="flex items-center justify-between gap-2 flex-wrap">
                      <p className="text-sm font-medium">
                        {addUsersProgress
                          ? `Добавлено ${addUsersProgress.current} из ${addUsersProgress.total}… (успешно: ${addUsersProgress.added}, ошибок: ${addUsersProgress.errors}, пропущено: ${addUsersProgress.skipped})`
                          : `Повтор: ${usersRetryProgress?.current ?? 0} из ${usersRetryProgress?.total ?? 0}…`}
                      </p>
                      <span className="text-sm font-semibold text-primary tabular-nums">
                        {Math.round(((addUsersProgress?.current ?? usersRetryProgress?.current ?? 0) / Math.max(1, addUsersProgress?.total ?? usersRetryProgress?.total ?? 1)) * 100)}%
                      </span>
                    </div>
                    <div className="h-2 rounded-full bg-muted overflow-hidden">
                      <div
                        className="h-full bg-primary transition-all"
                        style={{
                          width: `${((addUsersProgress?.current ?? usersRetryProgress?.current ?? 0) / Math.max(1, addUsersProgress?.total ?? usersRetryProgress?.total ?? 1)) * 100}%`,
                        }}
                      />
                    </div>
                    {addUsersProgress && usersAdding && (
                      <Button type="button" variant="outline" size="sm" className="mt-1" onClick={cancelAddUsers}>
                        Отмена
                      </Button>
                    )}
                  </div>
                )}

                <AlertDialog open={addConfirmOpen} onOpenChange={setAddConfirmOpen}>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Создать пользователей?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Будет создано {pendingAddLogins?.length ?? 0} пользователей в Rocket.Chat. Продолжить?
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Отмена</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => pendingAddLogins?.length && runAddUsers(pendingAddLogins)}
                      >
                        Создать
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>

                {addUsersResults && addUsersResults.length > 0 && (
                  <div className="rounded-xl border border-border/70 bg-muted/10 p-4 space-y-2">
                    <p className="font-medium text-sm">Результат по пользователям</p>
                    <ul className="space-y-1.5 max-h-40 overflow-y-auto">
                      {addUsersResults.map((r, i) => (
                        <li key={i} className="flex items-center gap-2 text-sm">
                          <span className="font-mono">{r.login}</span>
                          {r.status === 'ADDED' && <Badge className="bg-green-600">Добавлен</Badge>}
                          {r.status === 'ERROR' && <Badge variant="destructive">Ошибка</Badge>}
                          {r.status === 'ALREADY_EXISTS' && <Badge variant="secondary">Уже существует</Badge>}
                          {r.error && <span className="text-xs text-muted-foreground truncate">{r.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {(addedUsersList.length > 0 || addUsersResults?.length) && (
                  <>
                    <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-border/70">
                      <p className="font-medium text-sm">Добавленные пользователи</p>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={runRefreshLogin}
                        disabled={usersRefreshLoading || !usersAddAdminUsername.trim() || !usersAddAdminPassword}
                        className="gap-1.5"
                      >
                        {usersRefreshLoading ? <Spinner className="w-3.5 h-3.5" /> : <LogIn className="w-3.5 h-3.5" />}
                        Обновить статусы входа
                      </Button>
                      {failedUsersCount > 0 && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={runRetryFailed}
                          disabled={usersRetryFailedLoading || !usersAddAdminUsername.trim() || !usersAddAdminPassword}
                          className="gap-1.5"
                        >
                          {usersRetryFailedLoading ? <Spinner className="w-3.5 h-3.5" /> : <RotateCcw className="w-3.5 h-3.5" />}
                          Повторить для ошибочных ({failedUsersCount})
                        </Button>
                      )}
                    </div>
                    <div className="space-y-2">
                      <div className="flex flex-wrap gap-2 items-center">
                        <Input
                          placeholder="Поиск по логину или почте…"
                          value={usersTableSearch}
                          onChange={(e) => setUsersTableSearch(e.target.value)}
                          className="max-w-xs h-9"
                        />
                        <Select value={usersTableFilter} onValueChange={(v: typeof usersTableFilter) => setUsersTableFilter(v)}>
                          <SelectTrigger className="w-[180px] h-9">
                            <SelectValue placeholder="Фильтр" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="all">Все</SelectItem>
                            <SelectItem value="ADDED">Добавлено</SelectItem>
                            <SelectItem value="ERROR">Ошибка</SelectItem>
                            <SelectItem value="ALREADY_EXISTS">Уже существует</SelectItem>
                            <SelectItem value="never_logged">Ни разу не входили</SelectItem>
                          </SelectContent>
                        </Select>
                        <Select value={usersTableSort} onValueChange={(v: typeof usersTableSort) => setUsersTableSort(v)}>
                          <SelectTrigger className="w-[200px] h-9">
                            <SelectValue placeholder="Сортировка" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="addedAt">По дате добавления</SelectItem>
                            <SelectItem value="lastLoginAt">По последнему входу</SelectItem>
                            <SelectItem value="status">По статусу</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="rounded-xl border border-border/70 overflow-hidden">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b border-border/70 bg-muted/20">
                            <th className="text-left p-3 font-medium">Логин</th>
                            <th className="text-left p-3 font-medium">Почта</th>
                            <th className="text-left p-3 font-medium">Статус</th>
                            <th className="text-left p-3 font-medium">Вход в систему</th>
                            <th className="text-left p-3 font-medium w-10"></th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredAndSortedUsers.map((u) => (
                            <tr key={u.id} className="border-b border-border/30">
                              <td className="p-3 font-mono">{u.username}</td>
                              <td className="p-3 text-muted-foreground">{u.email}</td>
                              <td className="p-3">
                                {u.status === 'ADDED' && <Badge className="bg-green-600">Добавлен</Badge>}
                                {u.status === 'ERROR' && <Badge variant="destructive">Ошибка</Badge>}
                                {u.status === 'ALREADY_EXISTS' && <Badge variant="secondary">Уже существует</Badge>}
                                {u.errorMessage && <span className="ml-1 text-xs text-muted-foreground">({u.errorMessage})</span>}
                              </td>
                              <td className="p-3">
                                {u.lastLoginAt ? (
                                  <span className="text-green-600 dark:text-green-400">Входил {new Date(u.lastLoginAt).toLocaleString('ru-RU')}</span>
                                ) : (
                                  <span className="text-muted-foreground">Не входил</span>
                                )}
                              </td>
                              <td className="p-3">
                                <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => removeAddedUser(u.id)} title="Убрать из списка">
                                  <Trash2 className="w-4 h-4" />
                                </Button>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
          )}
        </Tabs>
          </div>
        </Card>

        {/* Message Dialog */}
        {showMessageDialog && selectedChannel && (
          <MessageDialog
            open={showMessageDialog}
            onOpenChange={(open) => {
              setShowMessageDialog(open)
              if (!open) {
                setScheduleFromTemplate(null)
                setTemplateCopiedBody(null)
              }
            }}
            workspaceId={workspace?.id ?? workspaceId}
            channelId={selectedChannel.id}
            channelName={selectedChannel.name || selectedChannel.displayName}
            editingMessage={editingMessage}
            onSuccess={loadData}
            initialMessage={scheduleFromTemplate?.body ?? templateCopiedBody ?? undefined}
            initialTime={scheduleFromTemplate?.time}
            initialDate={scheduleFromTemplate?.date}
            currentUserRole={currentUserRole}
          />
        )}
      </div>
    </div>
  )
}