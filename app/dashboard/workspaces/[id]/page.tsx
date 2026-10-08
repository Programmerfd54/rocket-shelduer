"use client"

import { useState, useEffect, useCallback, useMemo } from 'react'
import Link from 'next/link'
import { useParams, useRouter } from 'next/navigation'
import { Calendar, ClipboardList, FileText, Hash, MessageSquare, Search, ServerCog, Smile, Trophy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent } from '@/components/ui/tabs'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import MessageDialog from '@/components/_components/message-dialog'
import TemplateSendDialog, { type PlanSendTarget, type TemplateSendTarget } from '@/components/_components/TemplateSendDialog'
import { copyToClipboard } from '@/lib/clipboard'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Section } from '@/components/common/Section'
import { PageContainer } from '@/components/common/PageHeader'
import { PageLoading } from '@/components/common/PageLoading'
import { WorkspaceEditDialog } from '@/components/common/WorkspaceEditDialog'
import { AccountsAndStatusTab } from '@/components/_components/workspace/AccountsAndStatusTab'
import { SpaceSettingsTab } from '@/components/_components/workspace/SpaceSettingsTab'
import { EmojiManagePanel } from '@/components/_components/workspace/EmojiManagePanel'
import { WorkspaceCalendar } from '@/components/_components/workspace/WorkspaceCalendar'
import { LdapSmtpSettingsTab } from '@/components/_components/workspace/LdapSmtpSettingsTab'
import { ReactionsRatingTab } from '@/components/_components/workspace/ReactionsRatingTab'
import { isStudentIntensiveWorkspaceUrl, isStudentRcHostStrict } from '@/lib/workspace-url-flags'
import { AddUsersSection } from '@/components/_components/workspace-page/AddUsersSection'
import { ChannelsTab } from '@/components/_components/workspace-page/ChannelsTab'
import { ConfirmAssignmentDialog } from '@/components/_components/workspace-page/ConfirmAssignmentDialog'
import { EmojiImportSection } from '@/components/_components/workspace-page/EmojiImportSection'
import { IntensiveFilterChip, MessagesTab, type IntensiveFilterChipProps } from '@/components/_components/workspace-page/MessagesTab'
import { TemplatesTab } from '@/components/_components/workspace-page/TemplatesTab'
import { useAddUsers } from '@/components/_components/workspace-page/useAddUsers'
import { useEmojiImport } from '@/components/_components/workspace-page/useEmojiImport'
import { useMessagesView } from '@/components/_components/workspace-page/useMessagesView'
import { WorkspaceAssignments } from '@/components/_components/workspace-page/WorkspaceAssignments'
import { WorkspaceBanners } from '@/components/_components/workspace-page/WorkspaceBanners'
import { WorkspaceHeader } from '@/components/_components/workspace-page/WorkspaceHeader'
import { WorkspaceStats } from '@/components/_components/workspace-page/WorkspaceStats'
import { WorkspaceTabsNav, type WorkspaceTabItem } from '@/components/_components/workspace-page/WorkspaceTabsNav'
import { useIntensiveContext, useIntensivePlan } from '@/components/_components/workspace-page/useIntensiveContext'
import { planScheduleAvailability } from '@/components/_components/workspace-page/IntensivePlanView'
import { WorkspaceMessageSheet } from '@/components/_components/workspace-page/WorkspaceMessageSheet'
import { IntensiveSelector } from '@/components/intensives/shared/IntensiveSelector'
import { PlanItemDetailsSheet } from '@/components/intensives/shared/PlanItemDetailsSheet'
import type { PlanItemRowHandlers } from '@/components/intensives/shared/PlanItemRow'
import type { QueueMessage } from '@/components/dashboard/types'

type ExternalStatus = 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'

type ActionLogEntry = { userName: string | null; userEmail: string; rcUsername?: string; at: string }

export default function WorkspaceDetailPage() {
  const params = useParams()
  return <WorkspaceDetailContent key={params.id as string} />
}

function WorkspaceDetailContent() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.id as string

  const [workspace, setWorkspace] = useState<any>(null)
  const [channels, setChannels] = useState<any[]>([])
  const [messages, setMessages] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [externalStatuses, setExternalStatuses] = useState<Record<string, ExternalStatus>>({})
  const [activeTab, setActiveTab] = useState<string>('channels')
  const [currentUserRole, setCurrentUserRole] = useState<string>('MEMBER')
  const [currentUserId, setCurrentUserId] = useState<string | null>(null)
  const [userVolunteerIntensive, setUserVolunteerIntensive] = useState<string | null>(null)
  const [userVolunteerExpiresAt, setUserVolunteerExpiresAt] = useState<string | null>(null)
  /** Волонтёр: MEMBER с периодом (раньше роль VOL). */
  const isVolMember = currentUserRole === 'MEMBER' && !!userVolunteerExpiresAt
  const [checkingConnection, setCheckingConnection] = useState(false)
  const [unarchiveLoading, setUnarchiveLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  /** Ошибка загрузки (сеть, сервер) — показываем баннер с повтором */
  const [loadError, setLoadError] = useState<{ message: string; isNetworkError?: boolean } | null>(null)
  const [messageFilterFromStats, setMessageFilterFromStats] = useState<string | null>(null)
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false)
  const [archiving, setArchiving] = useState(false)
  const [deleteMessageId, setDeleteMessageId] = useState<string | null>(null)
  const [deletingMessage, setDeletingMessage] = useState(false)

  const [leaveAssignmentLoading, setLeaveAssignmentLoading] = useState(false)
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false)
  /** Диалог «Подключиться к пространству» для назначенного без своего подключения */
  const [confirmAssignmentOpen, setConfirmAssignmentOpen] = useState(false)

  const [workspaceActionLog, setWorkspaceActionLog] = useState<{
    lastEmojiImport: Omit<ActionLogEntry, 'rcUsername'> | null
    lastUsersAdd: Omit<ActionLogEntry, 'rcUsername'> | null
    channelCreators: Record<string, ActionLogEntry>
    settingAppliers: Record<string, ActionLogEntry>
  } | null>(null)
  /** Ограничения вкладок для SUP/ADM (от ADMIN). ADMIN всегда все true. */
  const [tabRestrictions, setTabRestrictions] = useState<{ templates: boolean; emojiImport: boolean; usersAdd: boolean } | null>(null)

  // Диалог сообщения
  const [showMessageDialog, setShowMessageDialog] = useState(false)
  const [selectedChannel, setSelectedChannel] = useState<any>(null)
  const [editingMessage, setEditingMessage] = useState<any>(null)
  /** Подстановка из шаблона (страница «Шаблоны» → Запланировать) */
  const [scheduleFromTemplate, setScheduleFromTemplate] = useState<{
    body: string
    time: string
    date?: string
    userTemplateId?: string
  } | null>(null)
  const [channelPickerOpen, setChannelPickerOpen] = useState(false)
  const [channelPickerQuery, setChannelPickerQuery] = useState('')
  /** Текст, скопированный из шаблона на этой странице — подставляется в форму при открытии диалога сообщения */
  const [templateCopiedBody, setTemplateCopiedBody] = useState<string | null>(null)
  /** Шаблон, из которого открыт диалог «Отправить сообщение» */
  const [templateSendTarget, setTemplateSendTarget] = useState<TemplateSendTarget | null>(null)
  /** Настройки пространства, открытые из диалога отправки шаблона (дата начала интенсива) */
  const [templateSettingsOpen, setTemplateSettingsOpen] = useState(false)

  /* ── Интенсив: выбор фиксируется в состоянии страницы и в URL (?intensive=) ── */
  const intensiveCtx = useIntensiveContext(workspaceId)
  const plan = useIntensivePlan(intensiveCtx.selectedId)
  /** Пункт плана, из которого открыта форма планирования */
  const [planSendTarget, setPlanSendTarget] = useState<PlanSendTarget | null>(null)
  /** Пункт плана в панели «Подробности» (берётся из актуальных данных плана) */
  const [planDetailsItemId, setPlanDetailsItemId] = useState<string | null>(null)
  /** Детали существующего сообщения (Открыть сообщение / Посмотреть отправку / Открыть ошибку) */
  const [messageSheet, setMessageSheet] = useState<{ id: string; fallback?: Partial<QueueMessage> } | null>(null)
  /** Чип «Только этого интенсива» на вкладках «Сообщения» и «Календарь» (по умолчанию выключен) */
  const [onlyIntensiveMessages, setOnlyIntensiveMessages] = useState(false)

  const emoji = useEmojiImport(workspaceId)
  const addUsers = useAddUsers(workspaceId)
  const { loadAddedUsers } = addUsers

  const selectedIntensiveId = intensiveCtx.selectedId
  const intensiveOnly = onlyIntensiveMessages && !!selectedIntensiveId
  /** Сообщения для вкладок «Сообщения» и «Календарь» с учётом чипа «Только этого интенсива» */
  const viewMessages = useMemo(
    () => (intensiveOnly ? messages.filter((m: any) => m.intensiveId === selectedIntensiveId) : messages),
    [messages, intensiveOnly, selectedIntensiveId],
  )

  const messagesView = useMessagesView({
    messages: viewMessages,
    externalStatuses,
    startDate: workspace?.startDate,
    endDate: workspace?.endDate,
  })

  /** Вкладка «LDAP / SMTP»: Lead_SUP и SUP (доступ к пространству проверяет API). */
  const showLdapSmtpTab = useMemo(() => {
    if (currentUserRole !== 'LEAD_SUP' && currentUserRole !== 'SUP') return false
    if (!workspace?.workspaceUrl) return false
    return !isStudentIntensiveWorkspaceUrl(workspace.workspaceUrl)
  }, [currentUserRole, workspace?.workspaceUrl])

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        setCurrentUserRole(data?.user?.role ?? 'MEMBER')
        setCurrentUserId(typeof data?.user?.id === 'string' ? data.user.id : null)
        setUserVolunteerIntensive(data?.user?.volunteerIntensive ?? null)
        setUserVolunteerExpiresAt(data?.user?.volunteerExpiresAt ?? null)
      })
      .catch(() => {})
  }, [])

  useEffect(() => {
    if (
      currentUserRole === 'SUP' ||
      currentUserRole === 'ADM' ||
      currentUserRole === 'LEAD_SUP' ||
      currentUserRole === 'MEMBER'
    ) {
      fetch('/api/workspace-tab-restrictions')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) =>
          setTabRestrictions(
            d && typeof d.templates === 'boolean'
              ? d
              : { templates: true, emojiImport: currentUserRole !== 'MEMBER', usersAdd: currentUserRole !== 'MEMBER' },
          ),
        )
        .catch(() =>
          setTabRestrictions({ templates: true, emojiImport: currentUserRole !== 'MEMBER', usersAdd: currentUserRole !== 'MEMBER' }),
        )
      return
    }
    setTabRestrictions(null)
  }, [currentUserRole])

  // Рейтинг реакций — только rocketchat-student.21-school.ru и только для SUP/Lead_SUP/ADM
  const showReactionsTab =
    !!workspace?.workspaceUrl &&
    isStudentRcHostStrict(workspace.workspaceUrl) &&
    ['SUP', 'LEAD_SUP', 'ADM'].includes(currentUserRole)

  const baseAllowedTabs = useMemo(() => {
    const withCal = ['channels', 'messages', 'calendar'] as string[]

    const leadSupAccountsStatus =
      (currentUserRole === 'LEAD_SUP' || currentUserRole === 'SUP') &&
      (!workspace || !!(workspace.workspaceUrl && !isStudentIntensiveWorkspaceUrl(workspace.workspaceUrl)))

    if (currentUserRole === 'LEAD_SUP') {
      if (!tabRestrictions) {
        const t = [...withCal, 'templates', 'emoji-import']
        if (leadSupAccountsStatus) t.push('accounts-status')
        return t
      }
      const t = [...withCal]
      if (tabRestrictions.templates) t.push('templates')
      if (tabRestrictions.emojiImport) t.push('emoji-import')
      if (leadSupAccountsStatus) t.push('accounts-status')
      return t
    }

    if (currentUserRole === 'SUP' || currentUserRole === 'ADM') {
      if (!tabRestrictions) {
        const t = [...withCal, 'templates', 'emoji-import']
        if (currentUserRole === 'ADM' || leadSupAccountsStatus) t.push('accounts-status')
        return t
      }
      const t = [...withCal]
      if (tabRestrictions.templates) t.push('templates')
      if (tabRestrictions.emojiImport) t.push('emoji-import')
      if (currentUserRole === 'ADM' || leadSupAccountsStatus) t.push('accounts-status')
      return t
    }

    if (currentUserRole === 'MEMBER') {
      if (!tabRestrictions) return [...withCal, 'templates']
      const t = [...withCal]
      if (tabRestrictions.templates) t.push('templates')
      return t
    }

    return withCal
  }, [currentUserRole, tabRestrictions, workspace])

  const allowedTabsList = useMemo(() => {
    const t = [...baseAllowedTabs]
    if (showLdapSmtpTab) t.push('ldap-smtp')
    if (showReactionsTab) t.push('reactions')
    return t
  }, [baseAllowedTabs, showLdapSmtpTab, showReactionsTab])

  useEffect(() => {
    if (!allowedTabsList.includes(activeTab)) setActiveTab('channels')
  }, [allowedTabsList, activeTab])

  const refetchActionLog = useCallback(() => {
    const canFetch = currentUserRole === 'SUP' || currentUserRole === 'LEAD_SUP' || currentUserRole === 'ADM'
    if (!workspaceId || !canFetch) return
    fetch(`/api/workspace/${workspaceId}/action-log`)
      .then((r) => r.json())
      .then((data) => {
        const mapUser = (u: { userName?: string | null; userEmail: string; at: string } | null) =>
          u ? { userName: u.userName ?? null, userEmail: u.userEmail, at: u.at } : null
        const mapRecord = (r: Record<string, { userName?: string | null; userEmail: string; rcUsername?: string; at: string }> | undefined) => {
          if (!r) return {}
          const out: Record<string, ActionLogEntry> = {}
          for (const [k, v] of Object.entries(r)) {
            out[k] = { userName: v.userName ?? null, userEmail: v.userEmail, rcUsername: v.rcUsername, at: v.at }
          }
          return out
        }
        setWorkspaceActionLog({
          lastEmojiImport: mapUser(data.lastEmojiImport),
          lastUsersAdd: mapUser(data.lastUsersAdd),
          channelCreators: mapRecord(data.channelCreators),
          settingAppliers: mapRecord(data.settingAppliers),
        })
      })
      .catch(() => {})
  }, [currentUserRole, workspaceId])

  useEffect(() => {
    refetchActionLog()
  }, [refetchActionLog])

  // Обновляем «кто создал/применил» при открытии вкладки настройки пространства — чтобы все видели актуальные данные
  useEffect(() => {
    if (activeTab === 'emoji-import') refetchActionLog()
  }, [activeTab, refetchActionLog])

  useEffect(() => {
    loadData()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceId])

  // Синхронизация вкладки при смене роли или workspace (учитываем ограничения вкладок для SUP/ADM)
  useEffect(() => {
    const savedTab = localStorage.getItem(`activeTab_${workspaceId}`)
    const migrated = savedTab === 'reset-account' || savedTab === 'user-access' ? 'accounts-status' : savedTab
    if (migrated && allowedTabsList.includes(migrated)) {
      setActiveTab(migrated)
    } else if (currentUserRole === 'MEMBER') {
      setActiveTab((prev) =>
        ['emoji-import', 'templates', 'accounts-status', 'ldap-smtp', 'reactions'].includes(prev) ? 'channels' : prev,
      )
    }
  }, [currentUserRole, workspaceId, allowedTabsList])

  // Сохраняем активную вкладку в localStorage
  useEffect(() => {
    if (workspaceId && activeTab) localStorage.setItem(`activeTab_${workspaceId}`, activeTab)
  }, [activeTab, workspaceId])

  // URL hash → tab: #messages, #channels и т.д.
  useEffect(() => {
    const raw = typeof window !== 'undefined' ? window.location.hash.slice(1) : ''
    const hash = raw === 'reset-account' || raw === 'user-access' ? 'accounts-status' : raw
    if (hash && allowedTabsList.includes(hash)) setActiveTab(hash)
  }, [currentUserRole, allowedTabsList])

  /** #вкладка в URL; параметры (например, ?intensive=) сохраняются */
  const replaceTabHash = (value: string) => {
    if (typeof window !== 'undefined') {
      window.history.replaceState(null, '', `${window.location.pathname}${window.location.search}#${value}`)
    }
  }

  const handleTabChange = (value: string) => {
    setActiveTab(value)
    if (value !== 'messages') setMessageFilterFromStats(null)
    replaceTabHash(value)
  }

  // Сброс фильтра из статистики после применения, чтобы не переопределять выбор пользователя
  useEffect(() => {
    if (!messageFilterFromStats || activeTab !== 'messages') return
    const t = setTimeout(() => setMessageFilterFromStats(null), 100)
    return () => clearTimeout(t)
  }, [messageFilterFromStats, activeTab])

  const handleCheckConnection = async () => {
    setCheckingConnection(true)
    toast.loading('Проверка подключения к Rocket.Chat…', { id: 'workspace-test-connection' })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/test`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      toast.dismiss('workspace-test-connection')
      if (res.ok) {
        toast.success('Подключение успешно')
        await loadData()
      } else {
        toast.error(data.error || 'Не удалось проверить подключение', {
          description: 'Проверьте VPN и сеть, затем повторите. Если пароль в Rocket.Chat менялся — обновите его в настройках пространства.',
          action: { label: 'Повторить', onClick: () => handleCheckConnection() },
        })
      }
    } catch {
      toast.dismiss('workspace-test-connection')
      toast.error('Не удалось проверить подключение', {
        description: 'Нет ответа от сервера. Проверьте сеть и повторите.',
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

  const handleUnarchive = async () => {
    if (!workspaceId) return
    setUnarchiveLoading(true)
    const toastId = 'workspace-unarchive'
    toast.loading('Возвращаем из архива…', { id: toastId })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/archive`, { method: 'DELETE' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось вернуть пространство из архива')
      toast.success('Пространство восстановлено из архива', { id: toastId })
      await loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось вернуть пространство из архива', { id: toastId })
    } finally {
      setUnarchiveLoading(false)
    }
  }

  const handleArchive = async () => {
    setArchiving(true)
    const toastId = 'workspace-archive'
    toast.loading('Архивируем пространство…', { id: toastId })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/archive`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось заархивировать пространство')
      toast.success('Пространство заархивировано', {
        id: toastId,
        description: 'Оно будет удалено через 2 недели. Восстановить можно в разделе «Архивы».',
      })
      setArchiveConfirmOpen(false)
      await loadData()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось заархивировать пространство', { id: toastId })
    } finally {
      setArchiving(false)
    }
  }

  const leaveAssignment = async (successMessage: string, onDone?: () => void) => {
    setLeaveAssignmentLoading(true)
    const toastId = 'workspace-leave-assignment'
    toast.loading('Снимаем назначение…', { id: toastId })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/leave-assignment`, { method: 'POST' })
      if (res.ok) {
        toast.success(successMessage, { id: toastId })
        onDone?.()
        router.push('/dashboard/workspaces')
      } else {
        const d = await res.json().catch(() => ({}))
        toast.error(d.error || 'Не удалось отказаться от назначения', { id: toastId })
      }
    } catch {
      toast.error('Не удалось отказаться от назначения', { id: toastId, description: 'Проверьте сеть и повторите.' })
    } finally {
      setLeaveAssignmentLoading(false)
    }
  }

  // Авто-открытие диалога подключения для назначенного без своего подключения
  useEffect(() => {
    if (loading || !workspace) return
    if (workspace.isAssigned && workspace.hasOwnConnection !== true) setConfirmAssignmentOpen(true)
  }, [loading, workspace])

  // Загрузка таблицы добавленных пользователей при открытии вкладок, где она нужна
  useEffect(() => {
    if (activeTab === 'emoji-import' || activeTab === 'accounts-status') loadAddedUsers()
  }, [activeTab, loadAddedUsers])

  // Открытие создания сообщения из шаблона (страница «Шаблоны» → Запланировать)
  useEffect(() => {
    if (!workspaceId || !channels?.length || loading) return
    try {
      const raw = sessionStorage.getItem('schedule-from-template')
      if (!raw) return
      const payload = JSON.parse(raw) as {
        workspaceId: string
        channelId?: string
        channelName?: string
        body: string
        time: string
        date?: string
        userTemplateId?: string
      }
      if (payload.workspaceId !== workspaceId) return
      sessionStorage.removeItem('schedule-from-template')
      const ch = payload.channelId
        ? channels.find((c: any) => (c._id || c.id) === payload.channelId)
        : channels.find((c: any) => (c.name || c.displayName || '').replace(/^#/, '') === (payload.channelName || '').replace(/^#/, ''))
      if (!ch) {
        toast.error('Канал не найден', { description: payload.channelName || payload.channelId || 'Выберите канал вручную' })
        return
      }
      setSelectedChannel({ id: ch._id || ch.id, name: ch.name || ch.displayName })
      setScheduleFromTemplate({
        body: payload.body || '',
        time: payload.time || '09:00',
        date: payload.date,
        userTemplateId: payload.userTemplateId,
      })
      setShowMessageDialog(true)
      setActiveTab('messages')
    } catch {
      sessionStorage.removeItem('schedule-from-template')
    }
  }, [workspaceId, channels, loading])

  useEffect(() => {
    if (!workspace?.endDate) return
    const endDate = new Date(workspace.endDate)
    const daysUntilEnd = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (endDate < new Date() && !workspace.isArchived) {
      toast.warning('Интенсив завершён', {
        description: `Пространство «${workspace.workspaceName}» завершилось ${Math.abs(daysUntilEnd)} дн. назад. Рекомендуем заархивировать его.`,
        duration: 10000,
      })
    } else if (daysUntilEnd > 0 && daysUntilEnd <= 7 && !workspace.isArchived) {
      toast.info('Интенсив скоро завершится', {
        description: `Пространство «${workspace.workspaceName}» завершится через ${daysUntilEnd} дн.`,
        duration: 8000,
      })
    }
  }, [workspace])

  const checkExternalMessageStatuses = async (msgs: any[]) => {
    const toCheck = (msgs || []).filter((m: any) => m.status === 'SENT' && m.messageId_RC) as { id: string }[]
    if (toCheck.length === 0) return
    const newStatuses: Record<string, ExternalStatus> = {}
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
      }),
    )
    setExternalStatuses((prev) => ({ ...prev, ...newStatuses }))
  }

  const loadData = async () => {
    setLoadError(null)
    try {
      const workspaceResponse = await fetch(`/api/workspace/${workspaceId}`)
      if (!workspaceResponse.ok) throw new Error('Workspace not found')
      const workspaceData = await workspaceResponse.json()
      const ws = workspaceData.workspace
      setWorkspace(ws)

      // Назначенный без своего подключения: не запрашиваем каналы/сообщения — показываем диалог «Подключиться»
      if (ws?.isAssigned && ws?.hasOwnConnection !== true) {
        setLoading(false)
        setConfirmAssignmentOpen(true)
        return
      }

      const channelsResponse = await fetch(`/api/workspace/${workspaceId}/channels`)
      if (channelsResponse.ok) {
        const channelsData = await channelsResponse.json()
        setChannels(channelsData.channels)
      } else {
        const errorData = await channelsResponse.json().catch(() => ({}))
        const rcNotConnected =
          errorData.code === 'RC_NOT_CONNECTED' ||
          errorData.error === 'Workspace not authenticated' ||
          channelsResponse.status === 401 ||
          channelsResponse.status === 403
        if (rcNotConnected && ws?.isAssigned) {
          setConfirmAssignmentOpen(true)
          toast.info('Требуется подключение', {
            description: 'Войдите в Rocket.Chat (логин и пароль LDAP или личный токен), чтобы загрузить каналы.',
          })
        } else if (rcNotConnected) {
          toast.error('Нет активного входа в Rocket.Chat', {
            description:
              errorData.error === 'Workspace not authenticated' || errorData.code === 'RC_NOT_CONNECTED'
                ? 'Укажите логин и пароль в настройках пространства или проверьте подключение. После смены пароля в Rocket.Chat войдите заново.'
                : errorData.details || errorData.error || 'Не удалось авторизоваться в Rocket.Chat для этого пространства.',
            action: { label: 'Повторить', onClick: () => loadData() },
          })
        } else if (errorData.code === 'RC_UNREACHABLE' || channelsResponse.status === 503) {
          toast.error(errorData.error || 'Rocket.Chat недоступен', {
            description:
              errorData.details ||
              'Проверьте VPN, сеть и URL сервера. Инстансы школы часто не открываются из домашней сети.',
            duration: 12_000,
            action: { label: 'Повторить', onClick: () => loadData() },
          })
          setLoadError({ message: errorData.error || 'Rocket.Chat недоступен', isNetworkError: true })
        } else {
          toast.error('Не удалось загрузить каналы', {
            description: errorData.details || errorData.error || 'Повторите попытку позже.',
            action: { label: 'Повторить', onClick: () => loadData() },
          })
        }
      }

      const messagesResponse = await fetch(`/api/messages?workspaceId=${workspaceId}`)
      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        const msgs = messagesData.messages
        setMessages(msgs)
        // Проверяем статусы в Rocket.Chat (только для отправленных с messageId_RC)
        checkExternalMessageStatuses(msgs)
      }
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error))
      const msg = err.message || 'Ошибка загрузки'
      const isNetworkError =
        msg.includes('Failed to fetch') ||
        msg.includes('NetworkError') ||
        msg.includes('ERR_NETWORK') ||
        msg.includes('network') ||
        msg.includes('Load failed')

      console.error('Failed to load workspace:', error)
      setLoadError({
        message: isNetworkError ? 'Проверьте подключение к интернету и повторите попытку' : msg,
        isNetworkError,
      })
      toast.error(isNetworkError ? 'Нет подключения' : 'Не удалось загрузить пространство', {
        description: isNetworkError ? 'Проверьте интернет и нажмите «Повторить»' : msg,
        action: { label: 'Повторить', onClick: () => loadData() },
      })
      // Редирект только при 404 (пространство не найдено), не при сетевых ошибках
      if (!isNetworkError && msg.toLowerCase().includes('not found')) {
        router.push('/dashboard/workspaces')
      }
    } finally {
      setLoading(false)
    }
  }

  // Автоповтор при восстановлении сети
  useEffect(() => {
    const onOnline = () => {
      if (loadError?.isNetworkError) {
        setLoadError(null)
        loadData()
      }
    }
    window.addEventListener('online', onOnline)
    return () => window.removeEventListener('online', onOnline)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError?.isNetworkError])

  const handleChannelSelect = (channel: any) => {
    setSelectedChannel(channel)
    setEditingMessage(null)
    setShowMessageDialog(true)
  }

  const openCreateScheduledMessage = () => {
    if (!channels.length) {
      toast.error('Нет каналов', { description: 'Перезагрузите список каналов или проверьте подключение.' })
      return
    }
    if (channels.length === 1) {
      handleChannelSelect(channels[0])
      return
    }
    setChannelPickerQuery('')
    setChannelPickerOpen(true)
  }

  const pickChannelAndOpenDialog = (ch: any) => {
    setChannelPickerOpen(false)
    handleChannelSelect(ch)
  }

  const handleEditMessage = (message: any) => {
    setEditingMessage(message)
    setSelectedChannel({ id: message.channelId, name: message.channelName })
    setShowMessageDialog(true)
  }

  const confirmDeleteMessage = async () => {
    if (!deleteMessageId) return
    setDeletingMessage(true)
    const toastId = 'message-delete'
    toast.loading('Удаляем сообщение…', { id: toastId })
    try {
      const response = await fetch(`/api/messages/${deleteMessageId}`, { method: 'DELETE' })
      if (!response.ok) {
        const d = await response.json().catch(() => ({}))
        throw new Error(d.error || 'Не удалось удалить сообщение')
      }
      if (messageSheet?.id === deleteMessageId) setMessageSheet(null)
      setDeleteMessageId(null)
      await loadData()
      void plan.reload()
      toast.success('Сообщение удалено', { id: toastId })
    } catch (error: any) {
      toast.error(error?.message || 'Не удалось удалить сообщение', { id: toastId, description: 'Повторите попытку.' })
    } finally {
      setDeletingMessage(false)
    }
  }

  const handleRetryMessage = async (messageId: string) => {
    const toastId = `message-retry-${messageId}`
    toast.loading('Ставим сообщение в очередь…', { id: toastId })
    try {
      const res = await fetch(`/api/messages/${messageId}/retry`, { method: 'POST' })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data.error || 'Не удалось повторить отправку')
      await loadData()
      void plan.reload()
      toast.success('Сообщение в очереди — отправка через минуту', { id: toastId })
    } catch (error: any) {
      toast.error(error.message || 'Не удалось повторить отправку', {
        id: toastId,
        description: 'Проверьте подключение к Rocket.Chat и права в канале.',
        action: { label: 'Повторить', onClick: () => handleRetryMessage(messageId) },
        cancel: {
          label: 'Детали',
          onClick: () => {
            setActiveTab('messages')
            setMessageFilterFromStats('FAILED')
            replaceTabHash('messages')
          },
        },
      })
    }
  }

  /** Копирование текста шаблона (статус шаблона не меняется) */
  const copyTemplateBody = useCallback(async (body: string) => {
    const ok = await copyToClipboard(body)
    if (ok) {
      setTemplateCopiedBody(body)
      toast.success('Текст скопирован', { description: 'Выберите канал — текст подставится в форму сообщения.' })
    } else {
      toast.error('Не удалось скопировать текст', { description: 'Разрешите доступ к буферу обмена в браузере.' })
    }
  }, [])

  /** После создания/изменения сообщения: список сообщений пространства + план/прогресс интенсива */
  const reloadMessagesAndPlan = async () => {
    await loadData()
    void plan.reload()
  }

  const selectIntensive = (id: string | null) => {
    setPlanDetailsItemId(null)
    intensiveCtx.select(id)
  }

  const planHandlers: PlanItemRowHandlers = {
    onSchedule: (item, repeat) => {
      const current = plan.data && plan.data.intensive.id === item.intensiveId ? plan.data.intensive : null
      if (!current) {
        toast.error('План ещё загружается', { description: 'Повторите через секунду.' })
        return
      }
      const availability = planScheduleAvailability(current)
      if (!availability.ok) {
        toast.error('Планирование недоступно', { description: availability.reason })
        return
      }
      setPlanDetailsItemId(null)
      setTemplateSendTarget(null)
      setPlanSendTarget({ intensive: current, item, repeat })
    },
    onOpenSend: (_item, send) => {
      setMessageSheet({
        id: send.messageId,
        fallback: {
          status: send.status,
          scheduledFor: send.scheduledFor,
          sentAt: send.sentAt,
          error: send.error,
          channelName: send.channelName,
          workspaceId: send.workspaceId,
        },
      })
    },
    onDetails: (item) => setPlanDetailsItemId(item.id),
    onCopy: async (item) => {
      const ok = await copyToClipboard(item.body)
      if (ok) {
        setTemplateCopiedBody(item.body)
        toast.success('Текст скопирован', { description: 'Прогресс плана не меняется — учитываются только запланированные сообщения.' })
      } else {
        toast.error('Не удалось скопировать текст', { description: 'Разрешите доступ к буферу обмена в браузере.' })
      }
    },
  }

  const intensiveChip: IntensiveFilterChipProps | null = intensiveCtx.selected
    ? { name: intensiveCtx.selected.name, active: intensiveOnly, onChange: setOnlyIntensiveMessages }
    : null

  const stats = useMemo(
    () => ({
      pending: messages.filter((m: any) => m.status === 'PENDING').length,
      sent: messages.filter((m: any) => m.status === 'SENT').length,
      failed: messages.filter((m: any) => m.status === 'FAILED').length,
    }),
    [messages],
  )

  const openMessagesWithFilter = (key: string) => {
    setActiveTab('messages')
    setMessageFilterFromStats(key)
    replaceTabHash('messages')
  }

  if (loading) return <PageLoading variant="detail" />

  if (!workspace && !loadError) return null

  const canSeeAssignments = currentUserRole === 'SUP' || currentUserRole === 'LEAD_SUP' || !!workspace?.isAssigned
  const isMyIntensive =
    isVolMember &&
    !!userVolunteerIntensive &&
    !!workspace?.workspaceUrl?.toLowerCase().includes(userVolunteerIntensive.toLowerCase())
  // usersAdd — ограничение платформы (SystemSetting workspaceTabUsersAddSup); то же правило проверяет сервер
  const canAddUsers =
    (currentUserRole === 'SUP' || currentUserRole === 'LEAD_SUP' || currentUserRole === 'ADM') &&
    tabRestrictions?.usersAdd !== false &&
    !!workspace?.workspaceUrl &&
    !isStudentIntensiveWorkspaceUrl(workspace.workspaceUrl)
  const canSeeActionLog =
    (currentUserRole === 'SUP' || currentUserRole === 'LEAD_SUP' || currentUserRole === 'ADM') &&
    !!workspaceActionLog &&
    (!!workspaceActionLog.lastEmojiImport || !!workspaceActionLog.lastUsersAdd)

  const tabItems: WorkspaceTabItem[] = [
    { value: 'channels', label: 'Каналы', icon: <Hash />, count: channels.length },
    { value: 'messages', label: 'Сообщения', icon: <MessageSquare />, count: messages.length },
    { value: 'calendar', label: 'Календарь', icon: <Calendar /> },
    ...(allowedTabsList.includes('templates') ? [{ value: 'templates', label: 'Шаблоны', icon: <FileText /> }] : []),
    ...(allowedTabsList.includes('emoji-import')
      ? [{ value: 'emoji-import', label: currentUserRole === 'LEAD_SUP' ? 'Настройки системы' : 'Настройка пространства', icon: <Smile /> }]
      : []),
    ...(allowedTabsList.includes('accounts-status') ? [{ value: 'accounts-status', label: 'Сбор и состояние', icon: <ClipboardList /> }] : []),
    ...(allowedTabsList.includes('reactions') ? [{ value: 'reactions', label: 'Рейтинг реакций', icon: <Trophy /> }] : []),
    ...(showLdapSmtpTab ? [{ value: 'ldap-smtp', label: 'LDAP / SMTP', icon: <ServerCog /> }] : []),
  ]

  const pickerChannels = channels.filter((ch: any) =>
    (ch.name || ch.displayName || '').toLowerCase().includes(channelPickerQuery.trim().toLowerCase()),
  )

  return (
    <PageContainer size="wide" className="space-y-5">
      <WorkspaceHeader
        workspace={workspace}
        workspaceId={workspaceId}
        isVolMember={isVolMember}
        isMyIntensive={isMyIntensive}
        volunteerExpiresAt={userVolunteerExpiresAt}
        refreshing={refreshing}
        checkingConnection={checkingConnection}
        onRefresh={handleRefresh}
        onCheckConnection={handleCheckConnection}
        onChanged={loadData}
        onArchiveRequest={() => setArchiveConfirmOpen(true)}
      />

      <WorkspaceBanners
        workspace={workspace}
        loadError={loadError}
        loading={loading}
        isVolMember={isVolMember}
        unarchiveLoading={unarchiveLoading}
        checkingConnection={checkingConnection}
        leaveAssignmentLoading={leaveAssignmentLoading}
        onRetryLoad={loadData}
        onUnarchive={handleUnarchive}
        onCheckConnection={handleCheckConnection}
        onArchiveRequest={() => setArchiveConfirmOpen(true)}
        onLeaveAssignmentRequest={() => setLeaveConfirmOpen(true)}
      />

      {workspace && (
        <>
          <WorkspaceStats
            total={messages.length}
            pending={stats.pending}
            sent={stats.sent}
            failed={stats.failed}
            onSelect={(key) => openMessagesWithFilter(key)}
          />

          {canSeeActionLog && workspaceActionLog && (
            <dl className="flex flex-col gap-1 text-[13px] text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-6">
              {workspaceActionLog.lastEmojiImport && (
                <div className="flex flex-wrap gap-x-1.5">
                  <dt>Последний импорт эмодзи:</dt>
                  <dd className="text-foreground">
                    {workspaceActionLog.lastEmojiImport.userName || workspaceActionLog.lastEmojiImport.userEmail},{' '}
                    {new Date(workspaceActionLog.lastEmojiImport.at).toLocaleString('ru-RU')}
                  </dd>
                </div>
              )}
              {workspaceActionLog.lastUsersAdd && (
                <div className="flex flex-wrap gap-x-1.5">
                  <dt>Последнее добавление пользователей:</dt>
                  <dd className="text-foreground">
                    {workspaceActionLog.lastUsersAdd.userName || workspaceActionLog.lastUsersAdd.userEmail},{' '}
                    {new Date(workspaceActionLog.lastUsersAdd.at).toLocaleString('ru-RU')}
                  </dd>
                </div>
              )}
            </dl>
          )}

          <WorkspaceAssignments workspaceId={workspaceId} currentUserRole={currentUserRole} canSee={canSeeAssignments} />

          {intensiveCtx.featureEnabled === true && (
            <IntensiveSelector
              intensives={intensiveCtx.intensives}
              selected={intensiveCtx.selected}
              onSelect={selectIntensive}
              loading={!intensiveCtx.ready}
              error={intensiveCtx.listError}
              onRetry={intensiveCtx.reloadList}
            />
          )}

          <div className="flex flex-col gap-4 pt-1 lg:flex-row lg:gap-8">
            <WorkspaceTabsNav items={tabItems} active={activeTab} onChange={handleTabChange} />

            <div className="min-w-0 flex-1">
              <Tabs value={activeTab} onValueChange={handleTabChange} className="gap-0">
                <TabsContent value="channels" className="mt-0">
                  <ChannelsTab
                    workspaceId={workspaceId}
                    channels={channels}
                    messages={messages}
                    reloading={refreshing}
                    onReload={handleRefresh}
                    onSelectChannel={handleChannelSelect}
                  />
                </TabsContent>

                <TabsContent value="messages" className="mt-0">
                  <MessagesTab
                    view={messagesView}
                    totalCount={messages.length}
                    isVolMember={isVolMember}
                    hasIntensivePeriod={!!(workspace?.startDate && workspace?.endDate)}
                    intensivePeriodLabel={
                      workspace?.startDate && workspace?.endDate
                        ? `${new Date(workspace.startDate).toLocaleDateString('ru-RU')} – ${new Date(workspace.endDate).toLocaleDateString('ru-RU')}`
                        : ''
                    }
                    initialStatusFilter={activeTab === 'messages' ? messageFilterFromStats : null}
                    intensiveFilter={intensiveChip}
                    onCreate={openCreateScheduledMessage}
                    onEdit={handleEditMessage}
                    onDelete={(id) => setDeleteMessageId(id)}
                    onRetry={handleRetryMessage}
                  />
                </TabsContent>

                <TabsContent value="calendar" className="mt-0">
                  {intensiveChip && (
                    <div className="mb-3">
                      <IntensiveFilterChip {...intensiveChip} />
                    </div>
                  )}
                  <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                    <div className="lg:col-span-1">
                      <WorkspaceCalendar messages={viewMessages} workspaceId={workspaceId} />
                    </div>
                    <Section
                      className="lg:col-span-2"
                      title="Как читать календарь"
                      description="Дни со сообщениями отмечены по статусам. Клик по дню откроет полный календарь с деталями."
                    >
                      <ul className="space-y-1.5 text-sm text-muted-foreground">
                        <li className="flex items-center gap-2"><span className="size-2 rounded-full bg-amber-500" aria-hidden />Ожидает отправки</li>
                        <li className="flex items-center gap-2"><span className="size-2 rounded-full bg-emerald-500" aria-hidden />Отправлено</li>
                        <li className="flex items-center gap-2"><span className="size-2 rounded-full bg-red-500" aria-hidden />Ошибка отправки</li>
                      </ul>
                      <p className="mt-3 text-[13px] text-muted-foreground">
                        Переносить сообщения на другой день можно перетаскиванием в полном календаре.
                      </p>
                      <Button variant="outline" size="sm" className="mt-4" asChild>
                        <Link href={`/dashboard/calendar?workspaceId=${workspaceId}`}>
                          <Calendar />
                          Открыть полный календарь
                        </Link>
                      </Button>
                    </Section>
                  </div>
                </TabsContent>

                {allowedTabsList.includes('templates') && (
                  <TabsContent value="templates" className="mt-0">
                    <TemplatesTab
                      currentUserRole={currentUserRole}
                      messages={messages}
                      onSend={(target) => {
                        setPlanSendTarget(null)
                        setTemplateSendTarget(target)
                      }}
                      onCopyBody={copyTemplateBody}
                      featureEnabled={intensiveCtx.featureEnabled === true}
                      contextReady={intensiveCtx.ready}
                      intensive={intensiveCtx.selected}
                      plan={plan}
                      planHandlers={planHandlers}
                    />
                  </TabsContent>
                )}

                {allowedTabsList.includes('emoji-import') && (
                  <TabsContent value="emoji-import" className="mt-0">
                    <SpaceSettingsTab
                      workspaceId={workspaceId}
                      workspaceUrl={workspace?.workspaceUrl}
                      channels={channels}
                      onChannelsRefresh={loadData}
                      channelCreators={workspaceActionLog?.channelCreators ?? {}}
                      settingAppliers={workspaceActionLog?.settingAppliers ?? {}}
                      onSpaceSettingsAction={refetchActionLog}
                    >
                      {canAddUsers && <AddUsersSection workspaceId={workspaceId} users={addUsers} />}
                      <EmojiImportSection emoji={emoji} />
                      <EmojiManagePanel
                        workspaceId={workspaceId}
                        adminUsername={emoji.adminUsername}
                        adminPassword={emoji.adminPassword}
                        disabled={emoji.importing}
                      />
                    </SpaceSettingsTab>
                  </TabsContent>
                )}

                {allowedTabsList.includes('accounts-status') && (
                  <TabsContent value="accounts-status" className="mt-0">
                    <AccountsAndStatusTab workspaceId={workspaceId} currentUserRole={currentUserRole} />
                  </TabsContent>
                )}

                {allowedTabsList.includes('reactions') && (
                  <TabsContent value="reactions" className="mt-0">
                    <ReactionsRatingTab workspaceId={workspaceId} />
                  </TabsContent>
                )}

                {showLdapSmtpTab && (
                  <TabsContent value="ldap-smtp" className="mt-0">
                    <LdapSmtpSettingsTab workspaceId={workspaceId} />
                  </TabsContent>
                )}
              </Tabs>
            </div>
          </div>
        </>
      )}

      {/* Выбор канала для нового сообщения */}
      <Dialog open={channelPickerOpen} onOpenChange={setChannelPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Выберите канал</DialogTitle>
            <DialogDescription>Куда запланировать отложенное сообщение?</DialogDescription>
          </DialogHeader>
          {channels.length > 8 && (
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                autoFocus
                value={channelPickerQuery}
                onChange={(e) => setChannelPickerQuery(e.target.value)}
                placeholder="Поиск канала…"
                aria-label="Поиск канала"
                className="pl-8"
              />
            </div>
          )}
          <div className="max-h-[min(60vh,360px)] overflow-y-auto rounded-md border">
            {pickerChannels.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-muted-foreground">Каналы не найдены</p>
            ) : (
              pickerChannels.map((ch: any) => (
                <button
                  key={ch._id || ch.id}
                  type="button"
                  onClick={() => pickChannelAndOpenDialog(ch)}
                  className="flex min-h-10 w-full items-center gap-2 border-b px-3 py-2 text-left text-sm outline-none transition-colors last:border-b-0 hover:bg-muted/50 focus-visible:bg-muted/50"
                >
                  <Hash className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{ch.name || ch.displayName}</span>
                </button>
              ))
            )}
          </div>
        </DialogContent>
      </Dialog>

      {workspace && (
        <>
          <TemplateSendDialog
            open={!!templateSendTarget || !!planSendTarget}
            onOpenChange={(open) => {
              if (!open) {
                setTemplateSendTarget(null)
                setPlanSendTarget(null)
              }
            }}
            template={planSendTarget ? null : templateSendTarget}
            plan={planSendTarget}
            workspace={{
              id: workspace.id,
              workspaceUrl: workspace.workspaceUrl,
              workspaceName: workspace.workspaceName,
              username: workspace.username,
              // Личные шаблоны в режиме интенсива: дата дня — от начала выбранного интенсива
              startDate: intensiveCtx.selected?.startDate ?? workspace.startDate,
            }}
            channels={channels}
            onScheduled={reloadMessagesAndPlan}
            onOpenWorkspaceSettings={isVolMember ? undefined : () => setTemplateSettingsOpen(true)}
            onOpenExistingMessage={(id) => setMessageSheet({ id })}
            onPlanChanged={() => void plan.reload()}
          />
          {intensiveCtx.selected && (
            <PlanItemDetailsSheet
              open={!!planDetailsItemId}
              onOpenChange={(open) => {
                if (!open) setPlanDetailsItemId(null)
              }}
              item={plan.data?.items.find((i) => i.id === planDetailsItemId) ?? null}
              intensive={plan.data?.intensive ?? intensiveCtx.selected}
              canSchedule={planScheduleAvailability(plan.data?.intensive ?? intensiveCtx.selected).ok}
              scheduleBlockedReason={planScheduleAvailability(plan.data?.intensive ?? intensiveCtx.selected).reason}
              disabled={!plan.data}
              onSchedule={planHandlers.onSchedule}
              onOpenSend={planHandlers.onOpenSend}
              onCopy={planHandlers.onCopy}
            />
          )}
          <WorkspaceMessageSheet
            messageId={messageSheet?.id ?? null}
            fallback={messageSheet?.fallback}
            messages={messages as QueueMessage[]}
            viewer={currentUserId ? { id: currentUserId, role: currentUserRole } : null}
            busy={deletingMessage}
            onClose={() => setMessageSheet(null)}
            onEdit={(m) => {
              const ownWorkspace = !m.workspaceId || m.workspaceId === workspaceId || m.workspace?.id === workspaceId
              if (!ownWorkspace) {
                const targetId = m.workspace?.id ?? m.workspaceId
                toast.info('Сообщение другого подключения', {
                  description: 'Изменить его можно в том пространстве.',
                  action: targetId ? { label: 'Открыть', onClick: () => router.push(`/dashboard/workspaces/${targetId}`) } : undefined,
                })
                return
              }
              handleEditMessage(m)
            }}
            onRetry={(m) => void handleRetryMessage(m.id)}
            onDelete={(m) => setDeleteMessageId(m.id)}
          />
          {!isVolMember && (
            <WorkspaceEditDialog
              workspace={workspace}
              onSuccess={loadData}
              open={templateSettingsOpen}
              onOpenChange={setTemplateSettingsOpen}
            />
          )}
        </>
      )}

      {workspace && showMessageDialog && selectedChannel && (
        <MessageDialog
          open={showMessageDialog}
          onOpenChange={(open) => {
            setShowMessageDialog(open)
            if (!open) {
              setScheduleFromTemplate(null)
              setTemplateCopiedBody(null)
            }
          }}
          workspaceId={workspace.id}
          channelId={selectedChannel.id}
          channelName={selectedChannel.name || selectedChannel.displayName}
          editingMessage={editingMessage}
          onSuccess={reloadMessagesAndPlan}
          initialMessage={scheduleFromTemplate?.body ?? templateCopiedBody ?? undefined}
          initialTime={scheduleFromTemplate?.time}
          initialDate={scheduleFromTemplate?.date}
          sourceUserTemplateId={scheduleFromTemplate?.userTemplateId}
          currentUserRole={currentUserRole}
          workspaceMessages={messages}
        />
      )}

      <ConfirmAssignmentDialog
        open={confirmAssignmentOpen}
        workspaceId={workspaceId}
        leaving={leaveAssignmentLoading}
        onClose={() => setConfirmAssignmentOpen(false)}
        onLeave={() =>
          leaveAssignment('Назначение снято. Добавьте пространство в списке пространств.', () => setConfirmAssignmentOpen(false))
        }
      />

      <ConfirmDialog
        open={leaveConfirmOpen}
        onOpenChange={setLeaveConfirmOpen}
        title="Отказаться от назначения?"
        description={
          <p>Пространство исчезнет из вашего списка. Вы сможете добавить его сами позже.</p>
        }
        confirmLabel="Отказаться"
        destructive
        loading={leaveAssignmentLoading}
        onConfirm={() => leaveAssignment('Назначение снято', () => setLeaveConfirmOpen(false))}
      />

      <ConfirmDialog
        open={!!deleteMessageId}
        onOpenChange={(open) => !open && setDeleteMessageId(null)}
        title="Удалить сообщение?"
        description={<p>Сообщение будет удалено из очереди отправки. Это действие нельзя отменить.</p>}
        confirmLabel="Удалить"
        destructive
        loading={deletingMessage}
        onConfirm={confirmDeleteMessage}
      />

      <ConfirmDialog
        open={archiveConfirmOpen}
        onOpenChange={setArchiveConfirmOpen}
        title="Архивировать пространство?"
        description={
          <div className="space-y-2">
            <p>
              Пространство <strong>{workspace?.workspaceName}</strong> станет недоступным для работы.
            </p>
            <ul className="list-inside list-disc space-y-1 text-destructive">
              <li>Все запланированные сообщения будут отменены</li>
              <li>Через 2 недели все данные будут безвозвратно удалены</li>
            </ul>
            <p>В течение 2 недель пространство можно восстановить в разделе «Архивы».</p>
          </div>
        }
        confirmLabel="Архивировать"
        destructive
        loading={archiving}
        onConfirm={handleArchive}
      />
    </PageContainer>
  )
}
