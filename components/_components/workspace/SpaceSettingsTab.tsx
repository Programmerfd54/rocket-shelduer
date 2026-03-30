'use client'

import { useState, useEffect } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { R2D2TabPanel } from '@/components/_components/workspace/R2D2TabPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Hash,
  Plus,
  RefreshCw,
  CheckCircle2,
  MessageSquareOff,
  Mail,
  ShieldOff,
  Image,
  FileUp,
  Check,
  AlertTriangle,
  ListOrdered,
} from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

export const CHANNEL_TEMPLATES: { name: string; topic: string; description: string; readOnly?: boolean; isPrivate?: boolean }[] = [
  {
    name: 'announcements',
    topic: 'важные объявления от администрации Школы.',
    description: 'Это единственный канал, в котором участвуют все. Очень удобно для объявлений и бесед, касающихся всей команды.',
    readOnly: true,
  },
  {
    name: 'adm',
    topic: 'административные вопросы',
    description: 'Административные вопросы, связанные с документами, пцр-тестами, организацией работы школы, желанием посетить экскурсию по школе.',
  },
  {
    name: 'general',
    topic: 'для общения по учёбе',
    description: 'Этот канал предназначен для работы над проектом. Проводите собрания, обменивайтесь документами и принимайте решения вместе с командой.',
  },
  {
    name: 'random',
    topic: 'канал на свободные темы',
    description: 'Для чего предназначен этот канал? Да для всего остального. Здесь могут быть корпоративные шутки, смешные картинки и сумасшедшие идеи. Развлекайтесь!',
  },
  {
    name: 'services',
    topic: 'вопросы, связанные с техническим обслуживанием здания школы',
    description: 'Данный канал создан для решения всех вопросов, связанных с техническим обслуживанием здания Школы. Например, разлили воду, внезапно сломался стул, засорился санузел и т.д.',
  },
  {
    name: 'support',
    topic: 'технические вопросы по системе к команде IT-отдела школы',
    description: 'Отвечаем здесь на технические вопросы которые вы + коллеги по интенсиву + google решить не смогли. Например, сеть, учетная запись, не засчитались очки за проект, выскакивает ошибка при входе - iscsi, wifi и т. д.',
    isPrivate: true,
  },
]

interface ChannelInfo {
  id: string
  name: string
  displayName?: string
  type: string
  topic?: string
  description?: string
  ts?: string
  default?: boolean
  readOnly?: boolean
  createdByRcUsername?: string
}

type SettingKey =
  | 'hideSystemMessages'
  | 'threadDefault'
  | 'offlineEmail'
  | 'messageEditDelete'
  | 'avatarSize'
  | 'fileUploadSize'
  | 'permissionCreateC'
  | 'permissionDeleteD'

const RESTRICTED_WORKSPACE_HOST = 'rocketchat-student.21-school.ru'
const STAFF_WORKSPACE_HOST = 'rocketchat-staff.21-school.ru'

interface SettingBlockProps {
  keyId: SettingKey
  stepNumber: number
  workspaceId: string
  icon: React.ReactNode
  title: string
  description: string
  borderColor?: string
  iconBg?: string
  status: 'idle' | 'applied' | 'checking'
  applyLoading: boolean
  checkLoading: boolean
  applier?: CreatorApplier | null
  onApply: () => void
  onCheck: () => void
}

type CreatorApplier = { userName: string | null; userEmail: string; rcUsername?: string; at: string }

function formatCreatorApplier(c: CreatorApplier) {
  const d = new Date(c.at)
  const ts = isNaN(d.getTime()) ? c.at : d.toLocaleString('ru-RU')
  const who = c.rcUsername ? `@${c.rcUsername}` : (c.userName || c.userEmail)
  return `${who} (${ts})`
}

function formatCreatorApplierDate(at: string) {
  const d = new Date(at)
  return isNaN(d.getTime()) ? at : d.toLocaleString('ru-RU')
}

interface SpaceSettingsTabProps {
  workspaceId: string
  workspaceUrl?: string | null
  channels: ChannelInfo[]
  onChannelsRefresh: () => void
  channelCreators?: Record<string, CreatorApplier>
  settingAppliers?: Record<string, CreatorApplier>
  onSpaceSettingsAction?: () => void
  children: React.ReactNode // Блок импорта эмодзи
}

export function SpaceSettingsTab({ workspaceId, workspaceUrl, channels, onChannelsRefresh, channelCreators = {}, settingAppliers = {}, onSpaceSettingsAction, children }: SpaceSettingsTabProps) {
  const isStaffWorkspace = Boolean(
    workspaceUrl && workspaceUrl.toLowerCase().includes(STAFF_WORKSPACE_HOST)
  )
  const isStudentRestricted = Boolean(
    workspaceUrl && workspaceUrl.toLowerCase().includes(RESTRICTED_WORKSPACE_HOST)
  )
  const isRestrictedWorkspace = isStudentRestricted || isStaffWorkspace
  /** Скрыть каналы/настройки/импорт (student или staff); R2D2 для staff показываем отдельно. */
  const hideFullSpaceSettings = isStudentRestricted || isStaffWorkspace
  const [channelName, setChannelName] = useState('')
  const [channelTopic, setChannelTopic] = useState('')
  const [channelDescription, setChannelDescription] = useState('')
  const [channelIsPrivate, setChannelIsPrivate] = useState(false)
  const [channelReadOnly, setChannelReadOnly] = useState(false)
  const [channelHideSystemMessages, setChannelHideSystemMessages] = useState(false)
  const [channelDefault, setChannelDefaultCheckbox] = useState(false)
  const [channelCreating, setChannelCreating] = useState(false)
  const [channelCheckLoading, setChannelCheckLoading] = useState<string | null>(null)
  const [channelSetDefaultLoading, setChannelSetDefaultLoading] = useState<string | null>(null)

  const [settingStatus, setSettingStatus] = useState<Record<SettingKey, 'idle' | 'applied' | 'checking'>>({
    hideSystemMessages: 'idle',
    threadDefault: 'idle',
    offlineEmail: 'idle',
    messageEditDelete: 'idle',
    avatarSize: 'idle',
    fileUploadSize: 'idle',
    permissionCreateC: 'idle',
    permissionDeleteD: 'idle',
  })
  const [settingApplyLoading, setSettingApplyLoading] = useState<Record<SettingKey, boolean>>({
    hideSystemMessages: false,
    threadDefault: false,
    offlineEmail: false,
    messageEditDelete: false,
    avatarSize: false,
    fileUploadSize: false,
    permissionCreateC: false,
    permissionDeleteD: false,
  })
  const [settingCheckLoading, setSettingCheckLoading] = useState<Record<SettingKey, boolean>>({
    hideSystemMessages: false,
    threadDefault: false,
    offlineEmail: false,
    messageEditDelete: false,
    avatarSize: false,
    fileUploadSize: false,
    permissionCreateC: false,
    permissionDeleteD: false,
  })

  const applyTemplate = (t: (typeof CHANNEL_TEMPLATES)[0]) => {
    setChannelName(t.name)
    setChannelTopic(t.topic)
    setChannelDescription(t.description)
    setChannelIsPrivate(t.isPrivate ?? false)
    setChannelReadOnly(t.readOnly ?? false)
  }

  const createChannel = async () => {
    const name = channelName.trim().replace(/^#/, '').replace(/\s+/g, '_')
    if (!name) {
      toast.error('Укажите название канала')
      return
    }
    setChannelCreating(true)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/channels/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          topic: channelTopic.trim() || undefined,
          description: channelDescription.trim() || undefined,
          isPrivate: channelIsPrivate,
          readOnly: channelReadOnly,
          hideSystemMessages: channelHideSystemMessages,
          default: channelDefault,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка создания')
      toast.success(`Канал #${name} создан`)
      setChannelName('')
      setChannelTopic('')
      setChannelDescription('')
      onChannelsRefresh()
      onSpaceSettingsAction?.()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка создания канала')
    } finally {
      setChannelCreating(false)
    }
  }

  const checkChannel = async (roomId: string) => {
    setChannelCheckLoading(roomId)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/channels/check?roomId=${encodeURIComponent(roomId)}`)
      const data = await res.json()
      if (data.exists) {
        toast.success(`Канал #${data.room?.name || '?'} найден`)
      } else {
        toast.info(data.error || 'Канал не найден')
      }
      onChannelsRefresh()
    } catch (err: any) {
      toast.error(err.message || 'Ошибка проверки')
    } finally {
      setChannelCheckLoading(null)
    }
  }

  const setExistingChannelDefault = async (ch: ChannelInfo, isDefault: boolean) => {
    setChannelSetDefaultLoading(ch.id)
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/channels/set-default`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ roomId: ch.id, isPrivate: ch.type === 'p', default: isDefault }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      toast.success(isDefault ? 'Канал установлен по умолчанию' : 'С канала снят статус по умолчанию')
      onChannelsRefresh()
    } catch (err: any) {
      toast.error(err.message || 'Не удалось')
    } finally {
      setChannelSetDefaultLoading(null)
    }
  }

  const applySetting = async (key: SettingKey) => {
    setSettingApplyLoading((p) => ({ ...p, [key]: true }))
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setSettingStatus((p) => ({ ...p, [key]: 'applied' }))
      toast.success('Настройка применена')
      onSpaceSettingsAction?.()
    } catch (err: any) {
      toast.error(err.message || 'Не удалось применить')
    } finally {
      setSettingApplyLoading((p) => ({ ...p, [key]: false }))
    }
  }

  const checkSetting = async (key: SettingKey, silent = false) => {
    if (!silent) {
      setSettingStatus((p) => ({ ...p, [key]: 'checking' }))
      setSettingCheckLoading((p) => ({ ...p, [key]: true }))
    }
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/check?key=${encodeURIComponent(key)}`)
      const data = await res.json()
      if (data.applied) {
        setSettingStatus((p) => ({ ...p, [key]: 'applied' }))
        if (!silent) toast.info('Настройка уже активна, повторное нажатие не требуется')
      } else {
        setSettingStatus((p) => ({ ...p, [key]: 'idle' }))
        if (!silent) toast.warning(data.error || 'Настройка не применена')
      }
    } catch (err: any) {
      setSettingStatus((p) => ({ ...p, [key]: 'idle' }))
      if (!silent) toast.error(err.message || 'Ошибка проверки')
    } finally {
      if (!silent) setSettingCheckLoading((p) => ({ ...p, [key]: false }))
    }
  }

  // При загрузке вкладки — проверяем все настройки, чтобы восстановить статусы после перезагрузки
  const settingKeys: SettingKey[] = ['hideSystemMessages', 'threadDefault', 'offlineEmail', 'messageEditDelete', 'avatarSize', 'fileUploadSize', 'permissionCreateC', 'permissionDeleteD']
  const defaultCheckLoading = Object.fromEntries(settingKeys.map((k) => [k, false])) as Record<SettingKey, boolean>
  useEffect(() => {
    if (!workspaceId || isRestrictedWorkspace) return
    let cancelled = false
    const run = async () => {
      setSettingCheckLoading(Object.fromEntries(settingKeys.map((k) => [k, true])) as Record<SettingKey, boolean>)
      await Promise.all(settingKeys.map((key) => checkSetting(key, true)))
      if (!cancelled) {
        setSettingCheckLoading(defaultCheckLoading)
      }
    }
    run()
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- checkSetting stable, run once on mount
  }, [workspaceId, isRestrictedWorkspace])

  const formatTs = (ts?: string) => {
    if (!ts) return '—'
    try {
      const d = new Date(ts)
      return isNaN(d.getTime()) ? ts : d.toLocaleString('ru-RU')
    } catch {
      return ts
    }
  }


  const blockClass = 'rounded-xl border border-border/70 overflow-hidden shadow-sm'
  const headerClass = 'px-3 py-2.5 border-b flex items-start gap-3'

  const appliedCount = Object.values(settingStatus).filter((s) => s === 'applied').length
  const totalSettings = 8

  return (
    <div className="space-y-4">
      {/* Предупреждение: пространство 21-school.ru настраивать нельзя */}
      {isRestrictedWorkspace && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/[0.06] p-4 flex items-start gap-3 shadow-sm ring-1 ring-amber-500/15">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 ring-1 ring-amber-500/20">
            <AlertTriangle className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-800 dark:text-amber-200">Это пространство настраивать нельзя</h3>
            <p className="text-sm text-amber-700 dark:text-amber-300 mt-0.5">
              {isStaffWorkspace ? (
                <>
                  Пространство <span className="font-mono">{STAFF_WORKSPACE_HOST}</span>: массовые настройки и импорт здесь отключены. При необходимости введите одноразовый код 2FA при входе в Rocket.Chat (аутентификатор).
                </>
              ) : (
                <>
                  Пространство <span className="font-mono">{RESTRICTED_WORKSPACE_HOST}</span> — общий сервер Школы 21. Настройки каналов, эмодзи и параметров рабочего пространства здесь недоступны. Используйте собственный инстанс Rocket.Chat для настройки.
                </>
              )}
            </p>
          </div>
        </div>
      )}

      {/* Статус по всем шагам */}
      {!hideFullSpaceSettings && (
        <div className="rounded-2xl border border-border/50 bg-card p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center gap-4 shadow-sm ring-1 ring-border/40">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/20">
            <ListOrdered className="h-6 w-6" />
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-foreground tracking-tight">Прогресс настройки</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Применено: <span className="font-semibold tabular-nums text-foreground">{appliedCount}</span> из {totalSettings} настроек
            </p>
          </div>
          <div className="w-full sm:flex-1 sm:max-w-[220px]">
            <div className="h-2 rounded-full bg-muted overflow-hidden ring-1 ring-border/30">
              <div
                className="h-full rounded-full bg-primary transition-all duration-300"
                style={{ width: `${(appliedCount / totalSettings) * 100}%` }}
              />
            </div>
          </div>
        </div>
      )}

      {/* Подвкладки: каналы / настройки / импорт / R2D2 */}
      {!hideFullSpaceSettings && (
      <>
      <Tabs defaultValue="channels" className="w-full space-y-4">
        {/* ui/tabs задаёт TabsList height: 2.25rem — при padding и min-h триггеров ломается вертикаль; inline-style перебивает класс */}
        <TabsList
          style={{ height: 'auto', minHeight: '2.75rem' }}
          className="grid w-full grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-muted/40 rounded-xl border border-border/50 items-stretch content-stretch ring-1 ring-border/30"
        >
          <TabsTrigger
            value="channels"
            className="rounded-lg text-xs sm:text-sm min-h-10 h-full! box-border px-2.5 py-2 flex items-center justify-center text-center shadow-none data-[state=active]:shadow-sm data-[state=active]:bg-background data-[state=active]:ring-1 data-[state=active]:ring-border/50"
          >
            Каналы
          </TabsTrigger>
          <TabsTrigger
            value="settings"
            className="rounded-lg text-xs sm:text-sm min-h-10 h-full! box-border px-2.5 py-2 flex items-center justify-center text-center shadow-none data-[state=active]:shadow-sm data-[state=active]:bg-background data-[state=active]:ring-1 data-[state=active]:ring-border/50"
          >
            Настройки RC
          </TabsTrigger>
          <TabsTrigger
            value="import"
            className="rounded-lg text-xs sm:text-sm min-h-10 h-full! box-border px-2.5 py-2 flex items-center justify-center text-center shadow-none data-[state=active]:shadow-sm data-[state=active]:bg-background data-[state=active]:ring-1 data-[state=active]:ring-border/50"
          >
            Импорт
          </TabsTrigger>
          <TabsTrigger
            value="r2d2"
            className="rounded-lg text-xs sm:text-sm min-h-10 h-full! box-border px-2.5 py-2 flex items-center justify-center gap-1.5 text-center shadow-none data-[state=active]:shadow-sm data-[state=active]:bg-background data-[state=active]:ring-1 data-[state=active]:ring-border/50"
          >
            <span className="inline-flex items-center gap-1.5 leading-none">
              <span>R2D2</span>
              <Badge
                variant="secondary"
                className="text-[10px] font-medium leading-none px-1.5 py-0.5 h-5 shrink-0 inline-flex items-center justify-center bg-cyan-500/20 text-cyan-800 dark:text-cyan-200 border-0"
              >
                new
              </Badge>
            </span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="mt-0 space-y-4 focus-visible:outline-none">
      <Card className={cn(blockClass, 'border-l-2 border-l-blue-400/50 bg-card')}>
        <div className={cn(headerClass, 'bg-muted/20 border-border/60')}>
          <div className="flex items-center gap-2 shrink-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-blue-500/25 text-blue-700 dark:text-blue-300 font-bold text-xs">
              1
            </span>
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500/15 text-blue-600 dark:text-blue-400">
              <Hash className="h-5 w-5" />
            </div>
          </div>
          <div>
            <h3 className="text-base font-semibold text-foreground tracking-tight">
              Создание каналов
            </h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Создайте каналы в Rocket.Chat с темой и описанием. Открытый/закрытый и readonly задаются при создании. «По умолчанию» — новые пользователи автоматически присоединятся при авторизации.
            </p>
          </div>
        </div>
        <CardContent className="p-3 space-y-4">
          <div className="space-y-2">
            <Label>Шаблон канала</Label>
            <Select onValueChange={(v) => {
              const t = CHANNEL_TEMPLATES.find((x) => x.name === v)
              if (t) applyTemplate(t)
            }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Выберите шаблон или введите вручную" />
              </SelectTrigger>
              <SelectContent>
                {CHANNEL_TEMPLATES.map((t) => (
                  <SelectItem key={t.name} value={t.name}>
                    #{t.name} {t.isPrivate ? '(закрытый)' : ''} {t.readOnly ? '(readonly)' : ''}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="channel-name">Название канала</Label>
              <Input
                id="channel-name"
                placeholder="general"
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                disabled={channelCreating}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Тип</Label>
              <div className="flex items-center gap-4 pt-2">
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={!channelIsPrivate}
                    onCheckedChange={(v) => setChannelIsPrivate(!v)}
                    disabled={channelCreating}
                  />
                  <span className="text-sm">Открытый</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={channelIsPrivate}
                    onCheckedChange={(v) => setChannelIsPrivate(!!v)}
                    disabled={channelCreating}
                  />
                  <span className="text-sm">Закрытый</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={channelReadOnly}
                    onCheckedChange={(v) => setChannelReadOnly(!!v)}
                    disabled={channelCreating}
                  />
                  <span className="text-sm">Readonly</span>
                </label>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-topic">Тема</Label>
            <Input
              id="channel-topic"
              placeholder="Тема канала"
              value={channelTopic}
              onChange={(e) => setChannelTopic(e.target.value)}
              disabled={channelCreating}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="channel-desc">Описание</Label>
            <Textarea
              id="channel-desc"
              placeholder="Описание канала"
              value={channelDescription}
              onChange={(e) => setChannelDescription(e.target.value)}
              disabled={channelCreating}
              rows={3}
              className="resize-none"
            />
          </div>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={channelHideSystemMessages}
              onCheckedChange={(v) => setChannelHideSystemMessages(!!v)}
              disabled={channelCreating}
            />
            <span className="text-sm">Скрыть системные сообщения в пространстве</span>
          </label>

          <label className="flex items-center gap-2 cursor-pointer">
            <Checkbox
              checked={channelDefault}
              onCheckedChange={(v) => setChannelDefaultCheckbox(!!v)}
              disabled={channelCreating}
            />
            <span className="text-sm">По умолчанию — новые пользователи автоматически присоединятся при авторизации</span>
          </label>

          <Button onClick={createChannel} disabled={channelCreating} className="gap-2">
            {channelCreating ? <Spinner className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
            Создать канал
          </Button>

          {/* Список каналов */}
          <div className="space-y-3 pt-4 border-t border-border/60">
            <div className="flex items-center justify-between">
              <Label>Каналы в Rocket.Chat</Label>
              <Button variant="outline" size="sm" onClick={onChannelsRefresh} className="gap-1">
                <RefreshCw className="w-3.5 h-3.5" />
                Обновить
              </Button>
            </div>
            <div className="rounded-xl border border-border/70 divide-y divide-border/50 max-h-64 overflow-y-auto">
              {channels.length === 0 ? (
                <div className="p-4 text-sm text-muted-foreground text-center">Нет каналов или загрузите список</div>
              ) : (
                channels.map((ch) => (
                  <div key={ch.id} className="p-4 flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-medium">#{ch.name || ch.displayName}</span>
                        <span className="text-xs text-muted-foreground">{formatTs(ch.ts)}</span>
                        {(() => {
                          const creator = channelCreators[ch.id] || channelCreators[(ch.name || ch.displayName || '').toLowerCase()];
                          const rcCreator = ch.createdByRcUsername;
                          if (creator) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-medium border border-emerald-400/30"
                                title={formatCreatorApplier(creator)}
                              >
                                создал: {creator.rcUsername ? `@${creator.rcUsername}` : (creator.userName || creator.userEmail)} ({formatCreatorApplierDate(creator.at)})
                              </span>
                            );
                          }
                          if (rcCreator) {
                            return (
                              <span
                                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-muted/50 text-muted-foreground text-xs font-medium border border-border/50"
                                title="Создатель из Rocket.Chat (до внедрения учёта в приложении)"
                              >
                                создал: @{rcCreator}
                              </span>
                            );
                          }
                          return null;
                        })()}
                      </div>
                      {ch.topic && <p className="text-xs text-muted-foreground mt-0.5 truncate" title={ch.topic}>Тема: {ch.topic}</p>}
                      {ch.description && <p className="text-xs text-muted-foreground truncate" title={ch.description}>Описание: {ch.description}</p>}
                      <div className="flex flex-wrap gap-1 mt-1">
                        <BadgePill active={ch.type === 'c'}>Открытый</BadgePill>
                        <BadgePill active={ch.type === 'p'}>Закрытый</BadgePill>
                        <BadgePill active={ch.default}>По умолчанию</BadgePill>
                        <BadgePill active={ch.readOnly}>Readonly</BadgePill>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setExistingChannelDefault(ch, !ch.default)}
                        disabled={channelSetDefaultLoading === ch.id || ch.type === 'p'}
                        className="gap-1"
                        title={
                          ch.type === 'p'
                            ? 'Закрытые каналы не поддерживают статус «по умолчанию» в Rocket.Chat'
                            : ch.default
                              ? 'Снять статус «по умолчанию»'
                              : 'Сделать каналом по умолчанию'
                        }
                      >
                        {channelSetDefaultLoading === ch.id ? <Spinner className="w-4 h-4" /> : null}
                        {ch.default ? 'Снять' : 'По умолчанию'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => checkChannel(ch.id)}
                        disabled={channelCheckLoading === ch.id}
                      >
                        {channelCheckLoading === ch.id ? <Spinner className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        Проверить
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </CardContent>
      </Card>
        </TabsContent>

        <TabsContent value="settings" className="mt-0 space-y-4 focus-visible:outline-none">
      {/* Шаг 2: Скрыть системные сообщения кроме «Пользователь заглушен/не заглушен» */}
      <SettingBlock
        keyId="hideSystemMessages"
        stepNumber={2}
        workspaceId={workspaceId}
        icon={<MessageSquareOff className="h-5 w-5" />}
        title="Скрыть системные сообщения (кроме «Пользователь заглушен/не заглушен»)"
        description="Настройки рабочего пространства → Сообщение → Скрыть Системные Сообщения. Все галочки кроме «Пользователь заглушен/не заглушен»."
        borderColor="border-l-amber-500/60"
        iconBg="bg-amber-500/15 text-amber-600 dark:text-amber-400"
        status={settingStatus.hideSystemMessages}
        applyLoading={settingApplyLoading.hideSystemMessages}
        checkLoading={settingCheckLoading.hideSystemMessages}
        applier={settingAppliers.hideSystemMessages}
        onApply={() => applySetting('hideSystemMessages')}
        onCheck={() => checkSetting('hideSystemMessages')}
      />

      {/* Шаг 3: Отключить отправку первого сообщения с треда в канал */}
      <SettingBlock
        keyId="threadDefault"
        stepNumber={3}
        workspaceId={workspaceId}
        icon={<MessageSquareOff className="h-5 w-5" />}
        title="Убрать галочку «Также отправить сообщение треда в чат»"
        description="Настройки → Учётные записи → Поведение → «Выбрано не по умолчанию». Требуются права администратора RC."
        borderColor="border-l-emerald-500/60"
        iconBg="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
        status={settingStatus.threadDefault}
        applyLoading={settingApplyLoading.threadDefault}
        checkLoading={settingCheckLoading.threadDefault}
        applier={settingAppliers.threadDefault}
        onApply={() => applySetting('threadDefault')}
        onCheck={() => checkSetting('threadDefault')}
      />

      {/* Шаг 4: Отключить офлайн уведомления по Email */}
      <SettingBlock
        keyId="offlineEmail"
        stepNumber={4}
        workspaceId={workspaceId}
        icon={<Mail className="h-5 w-5" />}
        title="Отключить офлайн уведомления по Email"
        description="Настройки пространства → Учётные записи → Настройки пользователя по умолчанию."
        borderColor="border-l-violet-500/60"
        iconBg="bg-violet-500/15 text-violet-600 dark:text-violet-400"
        status={settingStatus.offlineEmail}
        applyLoading={settingApplyLoading.offlineEmail}
        checkLoading={settingCheckLoading.offlineEmail}
        applier={settingAppliers.offlineEmail}
        onApply={() => applySetting('offlineEmail')}
        onCheck={() => checkSetting('offlineEmail')}
      />

      {/* Шаг 5: Запретить удаление и редактирование сообщений */}
      <SettingBlock
        keyId="messageEditDelete"
        stepNumber={5}
        workspaceId={workspaceId}
        icon={<ShieldOff className="h-5 w-5" />}
        title="Запретить удаление и редактирование сообщений"
        description="Настройки рабочего пространства → Сообщение → Разрешить редактирование/удаление — выключить."
        borderColor="border-l-rose-500/60"
        iconBg="bg-rose-500/15 text-rose-600 dark:text-rose-400"
        status={settingStatus.messageEditDelete}
        applyLoading={settingApplyLoading.messageEditDelete}
        checkLoading={settingCheckLoading.messageEditDelete}
        applier={settingAppliers.messageEditDelete}
        onApply={() => applySetting('messageEditDelete')}
        onCheck={() => checkSetting('messageEditDelete')}
      />

      {/* Шаг 6: Размер аватарок до 200 МБ */}
      <SettingBlock
        keyId="avatarSize"
        stepNumber={6}
        workspaceId={workspaceId}
        icon={<Image className="h-5 w-5" />}
        title="Размер аватарок до 200 МБ"
        description="Настройки → Аватар — до 200 МБ."
        borderColor="border-l-cyan-500/60"
        iconBg="bg-cyan-500/15 text-cyan-600 dark:text-cyan-400"
        status={settingStatus.avatarSize}
        applyLoading={settingApplyLoading.avatarSize}
        checkLoading={settingCheckLoading.avatarSize}
        applier={settingAppliers.avatarSize}
        onApply={() => applySetting('avatarSize')}
        onCheck={() => checkSetting('avatarSize')}
      />

      {/* Шаг 7: Размер загрузки файлов 25000000 */}
      <SettingBlock
        keyId="fileUploadSize"
        stepNumber={7}
        workspaceId={workspaceId}
        icon={<FileUp className="h-5 w-5" />}
        title="Размер загрузки файлов — 25000000 байт"
        description="Настройки → Загрузка файлов — 25000000."
        borderColor="border-l-teal-500/60"
        iconBg="bg-teal-500/15 text-teal-600 dark:text-teal-400"
        status={settingStatus.fileUploadSize}
        applyLoading={settingApplyLoading.fileUploadSize}
        checkLoading={settingCheckLoading.fileUploadSize}
        applier={settingAppliers.fileUploadSize}
        onApply={() => applySetting('fileUploadSize')}
        onCheck={() => checkSetting('fileUploadSize')}
      />

      {/* Шаг 8: Права — create-c (убрать user, добавить moderator) */}
      <SettingBlock
        keyId="permissionCreateC"
        stepNumber={8}
        workspaceId={workspaceId}
        icon={<ShieldOff className="h-5 w-5" />}
        title="Создание публичных каналов: убрать у user, добавить moderator"
        description="Права доступа → Создать публичные каналы. User — выключить, Moderator — включить."
        borderColor="border-l-orange-500/60"
        iconBg="bg-orange-500/15 text-orange-600 dark:text-orange-400"
        status={settingStatus.permissionCreateC}
        applyLoading={settingApplyLoading.permissionCreateC}
        checkLoading={settingCheckLoading.permissionCreateC}
        applier={settingAppliers.permissionCreateC}
        onApply={() => applySetting('permissionCreateC')}
        onCheck={() => checkSetting('permissionCreateC')}
      />

      {/* Шаг 9: Права — delete-d (добавить moderator) */}
      <SettingBlock
        keyId="permissionDeleteD"
        stepNumber={9}
        workspaceId={workspaceId}
        icon={<ShieldOff className="h-5 w-5" />}
        title="Удалять личные сообщения: добавить moderator"
        description="Права доступа → Удалять личные сообщения. Moderator — включить."
        borderColor="border-l-orange-500/60"
        iconBg="bg-orange-500/15 text-orange-600 dark:text-orange-400"
        status={settingStatus.permissionDeleteD}
        applyLoading={settingApplyLoading.permissionDeleteD}
        checkLoading={settingCheckLoading.permissionDeleteD}
        applier={settingAppliers.permissionDeleteD}
        onApply={() => applySetting('permissionDeleteD')}
        onCheck={() => checkSetting('permissionDeleteD')}
      />
        </TabsContent>

        <TabsContent value="import" className="mt-0 space-y-4 focus-visible:outline-none">
      {children}
        </TabsContent>

        <TabsContent value="r2d2" className="mt-0 focus-visible:outline-none">
          <R2D2TabPanel workspaceId={workspaceId} />
        </TabsContent>
      </Tabs>
      </>
      )}

      {isStaffWorkspace && (
        <div className="rounded-2xl border border-cyan-500/25 bg-gradient-to-br from-cyan-500/6 to-background p-3 sm:p-4 shadow-sm">
          <R2D2TabPanel workspaceId={workspaceId} variant="embedded" />
        </div>
      )}
    </div>
  )
}

function SettingBlock({
  stepNumber,
  icon,
  title,
  description,
  borderColor = 'border-l-muted',
  iconBg = 'bg-muted/30 text-muted-foreground',
  status,
  applyLoading,
  checkLoading,
  applier,
  onApply,
  onCheck,
}: SettingBlockProps) {
  return (
    <Card className={cn('rounded-xl border border-border/70 overflow-hidden shadow-sm border-l-2 bg-card', borderColor)}>
      <div className={cn('px-3 py-2.5 border-b border-border/60 flex items-start gap-3')}>
        <div className="flex items-center gap-2 shrink-0">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-muted font-bold text-xs text-muted-foreground">
            {stepNumber}
          </span>
          <div className={cn('flex h-10 w-10 shrink-0 items-center justify-center rounded-xl', iconBg)}>
            {icon}
          </div>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={cn(
              'text-xs font-medium px-2 py-0.5 rounded-full',
              status === 'applied' && 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400',
              status === 'checking' && 'bg-amber-500/15 text-amber-600 dark:text-amber-400',
              status === 'idle' && 'bg-muted text-muted-foreground'
            )}>
              {status === 'applied' && 'Применено'}
              {status === 'checking' && 'Проверка...'}
              {status === 'idle' && 'Не применено'}
            </span>
            {applier && (
              <span
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-xs font-medium border border-emerald-400/30"
                title={formatCreatorApplier(applier)}
              >
                применил: {applier.rcUsername ? `@${applier.rcUsername}` : (applier.userName || applier.userEmail)} ({formatCreatorApplierDate(applier.at)})
              </span>
            )}
          </div>
          <h3 className="text-base font-semibold text-foreground tracking-tight mt-1">
            {title}
          </h3>
          <p className="text-sm text-muted-foreground mt-0.5">
            {description}
          </p>
        </div>
      </div>
      <CardContent className="p-3 flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          onClick={onApply}
          disabled={applyLoading || status === 'applied'}
          className="gap-2"
        >
          {applyLoading ? <Spinner className="w-4 h-4" /> : null}
          Применить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCheck}
          disabled={checkLoading}
          className="gap-1.5"
          title="Проверить, что настройка активна"
        >
          {checkLoading ? <Spinner className="w-4 h-4" /> : <Check className="w-4 h-4" />}
          Проверить
        </Button>
      </CardContent>
    </Card>
  )
}

function BadgePill({ active, children }: { active?: boolean; children: React.ReactNode }) {
  if (!active) return null
  return (
    <span className={cn(
      'inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium',
      'bg-muted text-muted-foreground'
    )}>
      {children}
    </span>
  )
}
