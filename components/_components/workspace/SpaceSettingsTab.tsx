'use client'

import { useState, useEffect } from 'react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { R2D2TabPanel } from '@/components/_components/workspace/R2D2TabPanel'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Progress } from '@/components/ui/progress'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Checkbox } from '@/components/ui/checkbox'
import { Section } from '@/components/common/Section'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import {
  Hash,
  Plus,
  RefreshCw,
  Check,
  AlertTriangle,
  Settings2,
} from 'lucide-react'
import { toast } from 'sonner'
import { Spinner } from '@/components/ui/spinner'

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
  title: string
  description: string
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
  const [channelApplySettingsLoading, setChannelApplySettingsLoading] = useState<string | null>(null)
  const [channelNameTouched, setChannelNameTouched] = useState(false)
  /** Канал, для которого открыт диалог «Применить настройки». */
  const [applyConfirmChannel, setApplyConfirmChannel] = useState<ChannelInfo | null>(null)
  /** Ожидает подтверждения: включить/выключить скрытие системных сообщений во всём пространстве. */
  const [pendingHideSystem, setPendingHideSystem] = useState<boolean | null>(null)
  const [hideSystemSyncing, setHideSystemSyncing] = useState(false)

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

  const normalizedChannelName = channelName.trim().replace(/^#/, '').replace(/\s+/g, '_')
  const channelNameError = !normalizedChannelName
    ? 'Укажите название канала'
    : /[^\p{L}\p{N}._-]/u.test(normalizedChannelName)
      ? 'Допустимы буквы, цифры, точка, дефис и подчёркивание'
      : normalizedChannelName.length > 100
        ? 'Название не длиннее 100 символов'
        : channels.some((c) => (c.name || '').toLowerCase() === normalizedChannelName.toLowerCase())
          ? `Канал #${normalizedChannelName} уже есть в Rocket.Chat`
          : undefined

  const applyTemplate = (t: (typeof CHANNEL_TEMPLATES)[0]) => {
    setChannelName(t.name)
    setChannelTopic(t.topic)
    setChannelDescription(t.description)
    setChannelIsPrivate(t.isPrivate ?? false)
    setChannelReadOnly(t.readOnly ?? false)
  }

  const syncHideSystemMessagesGlobal = async (hide: boolean) => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          hide ? { key: 'hideSystemMessages' } : { key: 'hideSystemMessages', clear: true }
        ),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (res.status === 403 || data.code === 'RC_SETTINGS_FORBIDDEN') {
          toast.warning(
            data.error ||
              'Нет прав менять глобальный список в Rocket.Chat. Нужен администратор RC или токен с ролью admin.'
          )
          return
        }
        throw new Error(data.error || 'Ошибка синхронизации')
      }
      setSettingStatus((p) => ({ ...p, hideSystemMessages: hide ? 'applied' : 'idle' }))
      if (!hide) toast.success('Список скрытых системных сообщений в RC сброшен')
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось синхронизировать настройку RC')
    }
  }

  const createChannel = async () => {
    const name = normalizedChannelName
    if (channelNameError) {
      setChannelNameTouched(true)
      toast.error(channelNameError)
      return
    }
    setChannelCreating(true)
    const toastId = toast.loading(`Создаём канал #${name}…`)
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
      if (data.warning) {
        toast.warning(data.warning, { duration: 12_000 })
      }
      toast.success(
        data.partial
          ? `Канал #${name} создан с замечаниями — см. предупреждение`
          : `Канал #${name} создан`,
        { id: toastId }
      )
      if (data.partial || data.warning) {
        onChannelsRefresh()
      } else {
        setChannelName('')
        setChannelTopic('')
        setChannelDescription('')
        setChannelNameTouched(false)
        onChannelsRefresh()
      }
      onSpaceSettingsAction?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось создать канал. Повторите попытку.', { id: toastId })
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Ошибка проверки')
    } finally {
      setChannelCheckLoading(null)
    }
  }

  const getSettingsForChannel = (ch: ChannelInfo) => {
    const norm = (ch.name || ch.displayName || '').toLowerCase().replace(/^#/, '').replace(/\s+/g, '_')
    const formNorm = channelName.trim().toLowerCase().replace(/^#/, '').replace(/\s+/g, '_')
    if (formNorm && formNorm === norm) {
      return {
        topic: channelTopic.trim(),
        description: channelDescription.trim(),
        hideSystemMessages: channelHideSystemMessages,
        default: channelDefault,
        readOnly: channelReadOnly,
      }
    }
    const tmpl = CHANNEL_TEMPLATES.find((t) => t.name === norm)
    if (tmpl) {
      return {
        topic: tmpl.topic,
        description: tmpl.description,
        hideSystemMessages: channelHideSystemMessages,
        default: channelDefault,
        readOnly: tmpl.readOnly ?? false,
      }
    }
    return {
      topic: channelTopic.trim(),
      description: channelDescription.trim(),
      hideSystemMessages: channelHideSystemMessages,
      default: channelDefault,
      readOnly: channelReadOnly,
    }
  }

  const applyChannelSettings = async (ch: ChannelInfo) => {
    const settings = getSettingsForChannel(ch)
    setChannelApplySettingsLoading(ch.id)
    const toastId = toast.loading(`Применяем настройки к #${ch.name || ch.displayName}…`)
    try {
      const res = await fetch(
        `/api/workspace/${workspaceId}/space-settings/channels/apply-settings`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            roomId: ch.id,
            isPrivate: ch.type === 'p',
            topic: settings.topic || undefined,
            description: settings.description || undefined,
            hideSystemMessages: settings.hideSystemMessages,
            default: settings.default,
            readOnly: settings.readOnly,
            fillMissingOnly: true,
          }),
        }
      )
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      const applied = (data.applied as string[] | undefined)?.join(', ') || 'настройки'
      const skipped = data.skipped as string[] | undefined
      const detail = skipped?.length
        ? `#${data.roomName || ch.name}: применено (${applied}); пропущено: ${skipped.join(', ')}`
        : `#${data.roomName || ch.name}: настройки применены (${applied})`
      if (data.partial || data.warning) {
        toast.warning(data.warning ? `${detail}. ${data.warning}` : detail, { id: toastId, duration: 12_000 })
      } else {
        toast.success(detail, { id: toastId })
      }
      onChannelsRefresh()
      onSpaceSettingsAction?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось применить настройки', { id: toastId })
    } finally {
      setChannelApplySettingsLoading(null)
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
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось изменить статус «по умолчанию»')
    } finally {
      setChannelSetDefaultLoading(null)
    }
  }

  const applySetting = async (key: SettingKey) => {
    setSettingApplyLoading((p) => ({ ...p, [key]: true }))
    const toastId = toast.loading('Применяем настройку в Rocket.Chat…')
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/space-settings/apply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Ошибка')
      setSettingStatus((p) => ({ ...p, [key]: 'applied' }))
      toast.success('Настройка применена', { id: toastId })
      onSpaceSettingsAction?.()
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось применить настройку. Проверьте права администратора RC.', { id: toastId })
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
    } catch (err: unknown) {
      setSettingStatus((p) => ({ ...p, [key]: 'idle' }))
      if (!silent) toast.error(err instanceof Error ? err.message : 'Ошибка проверки')
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

  const appliedCount = Object.values(settingStatus).filter((s) => s === 'applied').length
  const totalSettings = 8

  const confirmHideSystem = async () => {
    if (pendingHideSystem === null) return
    const hide = pendingHideSystem
    setHideSystemSyncing(true)
    setChannelHideSystemMessages(hide)
    await syncHideSystemMessagesGlobal(hide)
    setHideSystemSyncing(false)
    setPendingHideSystem(null)
  }

  const confirmCh = applyConfirmChannel
  const confirmSettings = confirmCh ? getSettingsForChannel(confirmCh) : null
  const confirmNothingToFill = Boolean(
    confirmCh && confirmSettings && !confirmSettings.topic && !confirmSettings.description && confirmSettings.default === confirmCh.default
  )

  const channelTypeBtn = 'flex-1 sm:flex-none'

  return (
    <div className="space-y-4">
      {/* Предупреждение: пространство 21-school.ru настраивать нельзя */}
      {isRestrictedWorkspace && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border bg-card p-4">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="space-y-1">
            <h3 className="text-sm font-semibold text-foreground">Это пространство настраивать нельзя</h3>
            <p className="text-[13px] text-muted-foreground">
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

      {/* Подвкладки: каналы / настройки / импорт / R2D2 */}
      {!hideFullSpaceSettings && (
      <>
      <Tabs defaultValue="channels" className="w-full space-y-4">
        <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-fit">
          <TabsTrigger value="channels">Каналы</TabsTrigger>
          <TabsTrigger value="settings">
            Настройки RC
            <span className="ml-1 text-xs tabular-nums text-muted-foreground">{appliedCount}/{totalSettings}</span>
          </TabsTrigger>
          <TabsTrigger value="import">Импорт</TabsTrigger>
          <TabsTrigger value="r2d2">
            R2D2
            <Badge variant="info" className="px-1 py-0 text-[10px]">new</Badge>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="channels" className="mt-0 space-y-6 focus-visible:outline-none">
          <Section
            title="Создание канала"
            description="Канал создаётся в Rocket.Chat с темой и описанием. Тип и readonly задаются только при создании."
          >
            <div className="space-y-4">
              <Field label="Шаблон" htmlFor="channel-template" hint="Подставит название, тему, описание и тип — их можно изменить ниже.">
                <Select onValueChange={(v) => {
                  const t = CHANNEL_TEMPLATES.find((x) => x.name === v)
                  if (t) {
                    applyTemplate(t)
                    setChannelNameTouched(false)
                  }
                }}>
                  <SelectTrigger id="channel-template" className="w-full">
                    <SelectValue placeholder="Выберите шаблон или заполните вручную" />
                  </SelectTrigger>
                  <SelectContent>
                    {CHANNEL_TEMPLATES.map((t) => (
                      <SelectItem key={t.name} value={t.name}>
                        #{t.name}{t.isPrivate ? ' · закрытый' : ''}{t.readOnly ? ' · readonly' : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field
                  label="Название канала"
                  htmlFor="channel-name"
                  required
                  error={channelNameTouched ? channelNameError : undefined}
                  hint={normalizedChannelName && !channelNameError ? `Будет создан как #${normalizedChannelName}` : 'Например: general'}
                >
                  <Input
                    id="channel-name"
                    placeholder="general"
                    value={channelName}
                    onChange={(e) => setChannelName(e.target.value)}
                    onBlur={() => setChannelNameTouched(true)}
                    aria-invalid={channelNameTouched && !!channelNameError}
                    disabled={channelCreating}
                    className="font-mono"
                  />
                </Field>
                <Field label="Тип канала">
                  <div className="flex gap-1.5" role="group" aria-label="Тип канала">
                    <Button
                      type="button"
                      size="sm"
                      className={channelTypeBtn}
                      variant={!channelIsPrivate ? 'default' : 'outline'}
                      aria-pressed={!channelIsPrivate}
                      disabled={channelCreating}
                      onClick={() => setChannelIsPrivate(false)}
                    >
                      Открытый
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      className={channelTypeBtn}
                      variant={channelIsPrivate ? 'default' : 'outline'}
                      aria-pressed={channelIsPrivate}
                      disabled={channelCreating}
                      onClick={() => setChannelIsPrivate(true)}
                    >
                      Закрытый
                    </Button>
                  </div>
                </Field>
              </div>

              <Field label="Тема" htmlFor="channel-topic">
                <Input
                  id="channel-topic"
                  placeholder="Тема канала"
                  value={channelTopic}
                  onChange={(e) => setChannelTopic(e.target.value)}
                  disabled={channelCreating}
                />
              </Field>

              <Field label="Описание" htmlFor="channel-desc">
                <Textarea
                  id="channel-desc"
                  placeholder="Описание канала"
                  value={channelDescription}
                  onChange={(e) => setChannelDescription(e.target.value)}
                  disabled={channelCreating}
                  rows={3}
                  className="resize-none"
                />
              </Field>

              <div className="space-y-3 border-t pt-4">
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={channelReadOnly}
                    onCheckedChange={(v) => setChannelReadOnly(!!v)}
                    disabled={channelCreating}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm">Readonly</span>
                    <span className="block text-xs text-muted-foreground">Писать в канал смогут только модераторы и владельцы.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={channelDefault}
                    onCheckedChange={(v) => setChannelDefaultCheckbox(!!v)}
                    disabled={channelCreating}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm">Канал по умолчанию</span>
                    <span className="block text-xs text-muted-foreground">Новые пользователи автоматически присоединятся к нему при авторизации.</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-2.5">
                  <Checkbox
                    className="mt-0.5"
                    checked={channelHideSystemMessages}
                    onCheckedChange={(v) => setPendingHideSystem(!!v)}
                    disabled={channelCreating || hideSystemSyncing}
                  />
                  <span className="space-y-0.5">
                    <span className="block text-sm">Скрыть системные сообщения во всём пространстве</span>
                    <span className="block text-xs text-muted-foreground">
                      Меняет настройку Rocket.Chat сразу, не дожидаясь создания канала: Настройки → Сообщение → «Select messages to hide». При выключении сбрасываются и переключатель, и все пункты списка; для уже созданных каналов — «Применить настройки».
                    </span>
                  </span>
                </label>
              </div>

              <div className="flex justify-end border-t pt-4">
                <Button onClick={createChannel} disabled={channelCreating || (channelNameTouched && !!channelNameError)}>
                  {channelCreating ? <Spinner /> : <Plus />}
                  {channelCreating ? 'Создаём…' : 'Создать канал'}
                </Button>
              </div>
            </div>
          </Section>

          <Section
            title="Каналы в Rocket.Chat"
            description="«Применить настройки» заполнит тему и описание из формы выше (или из шаблона с тем же именем), только если в Rocket.Chat их ещё нет; также применит скрытие системных сообщений и «по умолчанию»."
            actions={
              <Button variant="outline" size="sm" onClick={onChannelsRefresh}>
                <RefreshCw />
                Обновить
              </Button>
            }
            bare
          >
            {channels.length === 0 ? (
              <EmptyState
                icon={<Hash />}
                title="Каналов пока нет"
                description="Создайте первый канал выше или обновите список, если он должен быть."
                action={{ label: 'Обновить список', onClick: onChannelsRefresh }}
              />
            ) : (
              <div className="max-h-[28rem] divide-y overflow-y-auto rounded-lg border bg-card">
                {channels.map((ch) => {
                  const creator = channelCreators[ch.id] || channelCreators[(ch.name || ch.displayName || '').toLowerCase()]
                  const rcCreator = ch.createdByRcUsername
                  return (
                    <div key={ch.id} className="flex flex-col gap-2 p-3 hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="font-mono text-sm font-medium">#{ch.name || ch.displayName}</span>
                          {ch.type === 'p' ? <Badge variant="muted">Закрытый</Badge> : <Badge variant="muted">Открытый</Badge>}
                          {ch.default && <Badge variant="info">По умолчанию</Badge>}
                          {ch.readOnly && <Badge variant="muted">Readonly</Badge>}
                          <span className="text-xs text-muted-foreground">{formatTs(ch.ts)}</span>
                        </div>
                        {ch.topic && <p className="mt-0.5 truncate text-xs text-muted-foreground" title={ch.topic}>Тема: {ch.topic}</p>}
                        {ch.description && <p className="truncate text-xs text-muted-foreground" title={ch.description}>Описание: {ch.description}</p>}
                        {creator ? (
                          <p className="mt-0.5 text-xs text-muted-foreground" title={formatCreatorApplier(creator)}>
                            Создал: {creator.rcUsername ? `@${creator.rcUsername}` : (creator.userName || creator.userEmail)} · {formatCreatorApplierDate(creator.at)}
                          </p>
                        ) : rcCreator ? (
                          <p className="mt-0.5 text-xs text-muted-foreground" title="Создатель из Rocket.Chat (до внедрения учёта в приложении)">
                            Создал: @{rcCreator}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-1 sm:justify-end">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => setApplyConfirmChannel(ch)}
                          disabled={channelApplySettingsLoading === ch.id}
                          title="Тема, описание, скрытие системных сообщений и «по умолчанию» из формы или шаблона"
                        >
                          {channelApplySettingsLoading === ch.id ? <Spinner /> : <Settings2 />}
                          Применить настройки
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setExistingChannelDefault(ch, !ch.default)}
                          disabled={channelSetDefaultLoading === ch.id || ch.type === 'p'}
                          title={
                            ch.type === 'p'
                              ? 'Закрытые каналы не поддерживают статус «по умолчанию» в Rocket.Chat'
                              : ch.default
                                ? 'Снять статус «по умолчанию»'
                                : 'Сделать каналом по умолчанию'
                          }
                        >
                          {channelSetDefaultLoading === ch.id ? <Spinner /> : null}
                          {ch.default ? 'Снять «по умолчанию»' : 'По умолчанию'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => checkChannel(ch.id)}
                          disabled={channelCheckLoading === ch.id}
                          title="Проверить, что канал существует в Rocket.Chat"
                        >
                          {channelCheckLoading === ch.id ? <Spinner /> : <Check />}
                          Проверить
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </Section>
        </TabsContent>

        <TabsContent value="settings" className="mt-0 space-y-4 focus-visible:outline-none">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-4">
            <p className="text-sm text-muted-foreground sm:flex-1">
              Применено <span className="font-medium tabular-nums text-foreground">{appliedCount}</span> из {totalSettings} настроек. Изменения вносятся в Rocket.Chat сразу и действуют на всё пространство; для них нужны права администратора RC.
            </p>
            <Progress
              value={(appliedCount / totalSettings) * 100}
              aria-label="Прогресс настройки пространства"
              className="h-1.5 sm:w-48"
            />
          </div>
          <div className="divide-y overflow-hidden rounded-lg border bg-card">
            {settingBlocks.map((b, i) => (
              <SettingBlock
                key={b.keyId}
                keyId={b.keyId}
                stepNumber={i + 1}
                workspaceId={workspaceId}
                title={b.title}
                description={b.description}
                status={settingStatus[b.keyId]}
                applyLoading={settingApplyLoading[b.keyId]}
                checkLoading={settingCheckLoading[b.keyId]}
                applier={settingAppliers[b.keyId]}
                onApply={() => applySetting(b.keyId)}
                onCheck={() => checkSetting(b.keyId)}
              />
            ))}
          </div>
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
        <div className="rounded-lg border bg-card p-3 sm:p-4">
          <R2D2TabPanel workspaceId={workspaceId} variant="embedded" />
        </div>
      )}

      <ConfirmDialog
        open={pendingHideSystem !== null}
        onOpenChange={(o) => { if (!o) setPendingHideSystem(null) }}
        title={pendingHideSystem ? 'Скрыть системные сообщения?' : 'Вернуть системные сообщения?'}
        confirmLabel={pendingHideSystem ? 'Скрыть' : 'Вернуть'}
        loading={hideSystemSyncing}
        onConfirm={confirmHideSystem}
        description={
          pendingHideSystem
            ? 'В настройках Rocket.Chat будут отмечены типы системных сообщений в списке «Select messages to hide». Это применяется сразу ко всему пространству, а не только к новому каналу.'
            : 'В Rocket.Chat будет сброшен переключатель и все пункты списка «Select messages to hide». Это применяется сразу ко всему пространству. Для уже созданных каналов используйте «Применить настройки».'
        }
      />

      <ConfirmDialog
        open={!!confirmCh}
        onOpenChange={(o) => { if (!o) setApplyConfirmChannel(null) }}
        title={confirmCh ? `Применить настройки к #${confirmCh.name || confirmCh.displayName}?` : 'Применить настройки?'}
        confirmLabel="Применить"
        loading={!!confirmCh && channelApplySettingsLoading === confirmCh.id}
        onConfirm={async () => {
          if (!confirmCh) return
          await applyChannelSettings(confirmCh)
          setApplyConfirmChannel(null)
        }}
        description="В Rocket.Chat будут записаны значения ниже. Тема и описание заполняются только если у канала они ещё пусты."
      >
        {confirmCh && confirmSettings && (
          <dl className="space-y-1.5 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Тема</dt><dd className="min-w-0 break-words">{confirmSettings.topic || '— не задана'}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Описание</dt><dd className="min-w-0 break-words">{confirmSettings.description || '— не задано'}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">По умолчанию</dt><dd>{confirmSettings.default ? 'да' : 'нет'}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Readonly</dt><dd>{confirmSettings.readOnly ? 'да' : 'нет'}</dd></div>
            <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">Скрыть сист.</dt><dd>{confirmSettings.hideSystemMessages ? 'да' : 'нет'}</dd></div>
            {confirmNothingToFill && (
              <p className="pt-1 text-xs text-amber-700 dark:text-amber-300">
                Тема и описание пустые — заполните их в форме или выберите шаблон с тем же именем, что у канала.
              </p>
            )}
          </dl>
        )}
      </ConfirmDialog>
    </div>
  )
}

const settingBlocks: { keyId: SettingKey; title: string; description: string }[] = [
  {
    keyId: 'hideSystemMessages',
    title: 'Скрыть системные сообщения (кроме «Пользователь заглушен/не заглушен»)',
    description: 'Настройки рабочего пространства → Сообщение → Скрыть Системные Сообщения. Все галочки кроме «Пользователь заглушен/не заглушен».',
  },
  {
    keyId: 'threadDefault',
    title: 'Убрать галочку «Также отправить сообщение треда в чат»',
    description: 'Настройки → Учётные записи → Поведение → «Выбрано не по умолчанию». Требуются права администратора RC.',
  },
  {
    keyId: 'offlineEmail',
    title: 'Отключить офлайн уведомления по Email',
    description: 'Настройки пространства → Учётные записи → Настройки пользователя по умолчанию.',
  },
  {
    keyId: 'messageEditDelete',
    title: 'Запретить удаление и редактирование сообщений',
    description: 'Настройки рабочего пространства → Сообщение → Разрешить редактирование/удаление — выключить.',
  },
  {
    keyId: 'avatarSize',
    title: 'Размер аватарок до 200 МБ',
    description: 'Настройки → Аватар — до 200 МБ.',
  },
  {
    keyId: 'fileUploadSize',
    title: 'Размер загрузки файлов — 25000000 байт',
    description: 'Настройки → Загрузка файлов — 25000000.',
  },
  {
    keyId: 'permissionCreateC',
    title: 'Создание публичных каналов: убрать у user, добавить moderator',
    description: 'Права доступа → Создать публичные каналы. User — выключить, Moderator — включить.',
  },
  {
    keyId: 'permissionDeleteD',
    title: 'Удалять личные сообщения: добавить moderator',
    description: 'Права доступа → Удалять личные сообщения. Moderator — включить.',
  },
]

function SettingBlock({
  stepNumber,
  title,
  description,
  status,
  applyLoading,
  checkLoading,
  applier,
  onApply,
  onCheck,
}: SettingBlockProps) {
  const [confirmOpen, setConfirmOpen] = useState(false)
  const checking = status === 'checking' || (checkLoading && status !== 'applied')
  return (
    <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-start sm:gap-4">
      <span className="hidden w-5 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground sm:block" aria-hidden>
        {stepNumber}
      </span>
      <div className="min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-medium text-foreground">{title}</h3>
          {status === 'applied' ? (
            <Badge variant="success">Применено</Badge>
          ) : checking ? (
            <Badge variant="warning">Проверяем…</Badge>
          ) : (
            <Badge variant="muted">Не применено</Badge>
          )}
        </div>
        <p className="text-[13px] text-muted-foreground">{description}</p>
        {applier && (
          <p className="text-xs text-muted-foreground" title={formatCreatorApplier(applier)}>
            Применил: {applier.rcUsername ? `@${applier.rcUsername}` : (applier.userName || applier.userEmail)} · {formatCreatorApplierDate(applier.at)}
          </p>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Button
          size="sm"
          variant={status === 'applied' ? 'outline' : 'default'}
          onClick={() => setConfirmOpen(true)}
          disabled={applyLoading || status === 'applied'}
        >
          {applyLoading ? <Spinner /> : null}
          Применить
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onCheck}
          disabled={checkLoading}
          title="Проверить, что настройка активна"
        >
          {checkLoading ? <Spinner /> : <Check />}
          Проверить
        </Button>
      </div>
      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="Применить настройку в Rocket.Chat?"
        confirmLabel="Применить"
        loading={applyLoading}
        onConfirm={() => {
          setConfirmOpen(false)
          onApply()
        }}
        description={
          <div className="space-y-2">
            <p className="font-medium text-foreground">{title}</p>
            <p>Значение изменится на сервере Rocket.Chat сразу и коснётся всех пользователей пространства. Нужны права администратора RC.</p>
          </div>
        }
      />
    </div>
  )
}
