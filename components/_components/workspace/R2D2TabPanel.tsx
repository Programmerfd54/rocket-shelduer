'use client'

import { useState, useCallback, useMemo } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Textarea } from '@/components/ui/textarea'
import { Section } from '@/components/common/Section'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import {
  Loader2,
  UserMinus,
  UserPlus,
  DoorOpen,
  DoorClosed,
  Search,
  ShieldAlert,
  UserCheck,
  Eye,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type R2ResultRow = { username?: string; login?: string; ok: boolean; error?: string; rcUserId?: string }

type AuthMode = 'admin' | 'workspace'

type BulkAction = 'deactivate' | 'activate' | 'invite' | 'kick'

const MAX_CREATE_USERS = 100
const EMAIL_DOMAIN_PREVIEW = '@student.21-school.ru'

function parseLogins(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean)
}

function countDuplicates(list: string[]): number {
  return list.length - new Set(list.map((s) => s.toLowerCase())).size
}

function isValidRegex(src: string): boolean {
  try {
    new RegExp(src)
    return true
  } catch {
    return false
  }
}

/** Счётчик под списком логинов: «Логинов: N» + предупреждение о повторах. */
function LoginsCounter({ logins, max }: { logins: string[]; max?: number }) {
  if (logins.length === 0) return null
  const dup = countDuplicates(logins)
  const over = max !== undefined && logins.length > max
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
      <span>
        Логинов: <span className={cn('font-medium tabular-nums text-foreground', over && 'text-destructive')}>{logins.length}</span>
        {max !== undefined && <> из {max}</>}
      </span>
      {dup > 0 && <Badge variant="warning">Повторов: {dup}</Badge>}
    </div>
  )
}

/**
 * R2D2: массовые операции через Rocket.Chat REST API.
 * Режим «подключение пространства» — без отправки кредов админа (токен из сохранённого подключения).
 * Режим «администратор RC» — логин/пароль (и при необходимости 2FA).
 */
export function R2D2TabPanel({
  workspaceId,
  variant = 'default',
}: {
  workspaceId: string
  variant?: 'default' | 'embedded'
}) {
  const [loading, setLoading] = useState<string | null>(null)
  const [authMode, setAuthMode] = useState<AuthMode>('workspace')
  const [adminUsername, setAdminUsername] = useState('')
  const [adminPassword, setAdminPassword] = useState('')
  const [totpCode, setTotpCode] = useState('')
  const [authTouched, setAuthTouched] = useState(false)

  const [patternBadNick, setPatternBadNick] = useState('^[a-z][a-z0-9]*$')
  const [identifiersCreate, setIdentifiersCreate] = useState('')
  const [identifiersStatus, setIdentifiersStatus] = useState('')
  const [identifiersRoom, setIdentifiersRoom] = useState('')
  const [channelName, setChannelName] = useState('support')

  const [lostUsers, setLostUsers] = useState<{ id: string; username?: string; lastLogin?: string | null }[] | null>(null)
  const [badUsers, setBadUsers] = useState<{ id: string; username?: string }[] | null>(null)
  const [batchResult, setBatchResult] = useState<R2ResultRow[] | null>(null)
  /** Как во вкладке «Импорт»: сначала предпросмотр, затем создание */
  const [createPreviewLogins, setCreatePreviewLogins] = useState<string[] | null>(null)
  const [confirmAction, setConfirmAction] = useState<BulkAction | null>(null)
  const [statusTouched, setStatusTouched] = useState(false)
  const [roomTouched, setRoomTouched] = useState(false)
  const [createTouched, setCreateTouched] = useState(false)

  const run = useCallback(
    async (action: string, payload: Record<string, unknown> = {}, toastId?: string | number) => {
      setLoading(action)
      setBatchResult(null)
      try {
        const authBody: Record<string, unknown> = { action, ...payload }

        if (authMode === 'admin') {
          const u = adminUsername.trim()
          const p = adminPassword
          if (!u || !p) {
            setAuthTouched(true)
            toast.error('Укажите логин и пароль администратора RC или переключитесь на «Подключение пространства».', { id: toastId })
            setLoading(null)
            return null
          }
          authBody.adminUsername = u
          authBody.adminPassword = p
        }

        if (totpCode.trim()) authBody.totpCode = totpCode.trim()

        const res = await fetch(`/api/workspace/${workspaceId}/r2d2`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify(authBody),
        })
        const data = await res.json().catch(() => ({}))
        if (!res.ok) {
          if (data.requiresTotp) {
            toast.error(data.error || 'Нужен код 2FA', {
              id: toastId,
              description: 'Введите код из приложения-аутентификатора и повторите.',
            })
          } else if (res.status === 401) {
            toast.error(data.error || 'Ошибка входа в Rocket.Chat', {
              id: toastId,
              description:
                authMode === 'admin'
                  ? 'Проверьте пароль и 2FA или переключитесь на вход по подключению пространства.'
                  : 'Подключите пространство в настройках или войдите под админом RC.',
            })
          } else {
            toast.error(data.error || `Ошибка (${res.status})`, { id: toastId })
          }
          return null
        }
        return data
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Нет связи с сервером. Повторите попытку.', { id: toastId })
        return null
      } finally {
        setLoading(null)
      }
    },
    [workspaceId, authMode, adminUsername, adminPassword, totpCode]
  )

  const onLostUsers = async () => {
    const id = toast.loading('Ищем пользователей без входа…')
    const data = await run('lost_users', {}, id)
    if (data?.users) {
      setLostUsers(data.users)
      toast.success(`Найдено: ${data.users.length}`, { id })
    } else {
      toast.dismiss(id)
    }
  }

  const badNickRegexError = !isValidRegex(patternBadNick) ? 'Некорректное регулярное выражение' : undefined

  const onBadNicknames = async () => {
    if (badNickRegexError) {
      toast.error(badNickRegexError)
      return
    }
    const id = toast.loading('Проверяем ники…')
    const data = await run('bad_nicknames', { pattern: patternBadNick.trim() || undefined }, id)
    if (data?.users) {
      setBadUsers(data.users)
      toast.success(`Не по шаблону: ${data.users.length}`, { id })
    } else {
      toast.dismiss(id)
    }
  }

  const createLogins = useMemo(() => parseLogins(identifiersCreate), [identifiersCreate])
  const statusLogins = useMemo(() => parseLogins(identifiersStatus), [identifiersStatus])
  const roomLogins = useMemo(() => parseLogins(identifiersRoom), [identifiersRoom])

  const createError = !createTouched
    ? undefined
    : createLogins.length === 0
      ? 'Введите хотя бы один логин'
      : createLogins.length > MAX_CREATE_USERS
        ? `Максимум ${MAX_CREATE_USERS} пользователей за один запрос — сейчас ${createLogins.length}`
        : undefined
  const statusError = statusTouched && statusLogins.length === 0 ? 'Введите хотя бы один логин' : undefined
  const channelError = roomTouched && !channelName.trim() ? 'Укажите название канала' : undefined
  const roomUsersError = roomTouched && roomLogins.length === 0 ? 'Введите хотя бы один логин' : undefined

  const openCreatePreview = () => {
    setCreateTouched(true)
    if (createLogins.length === 0) {
      toast.error('Введите хотя бы один логин (по одному на строку)')
      return
    }
    if (createLogins.length > MAX_CREATE_USERS) {
      toast.error(`Максимум ${MAX_CREATE_USERS} пользователей за один запрос`)
      return
    }
    setCreatePreviewLogins(createLogins)
  }

  const onCreateUsersConfirm = async () => {
    if (!createPreviewLogins?.length) return
    const id = toast.loading(`Создаём пользователей: ${createPreviewLogins.length}…`)
    const data = await run('create_users', { identifiers: createPreviewLogins.join('\n') }, id)
    if (data?.results) {
      setBatchResult(data.results)
      const ok = data.results.filter((r: R2ResultRow) => r.ok).length
      toast.success(`Создано: ${ok} из ${data.results.length}`, { id })
      setCreatePreviewLogins(null)
    } else {
      toast.dismiss(id)
    }
  }

  /** Общая обёртка для пакетных операций: проверка → confirm → loading-toast → итог. */
  const requestBulk = (action: BulkAction) => {
    if (action === 'deactivate' || action === 'activate') {
      setStatusTouched(true)
      if (statusLogins.length === 0) {
        toast.error('Введите хотя бы один логин')
        return
      }
    } else {
      setRoomTouched(true)
      if (!channelName.trim()) {
        toast.error('Укажите название канала')
        return
      }
      if (roomLogins.length === 0) {
        toast.error('Введите хотя бы один логин')
        return
      }
    }
    setConfirmAction(action)
  }

  const summarize = (results: R2ResultRow[]) => {
    const ok = results.filter((r) => r.ok).length
    return { ok, fail: results.length - ok, total: results.length }
  }

  const executeBulk = async () => {
    const action = confirmAction
    if (!action) return
    if (action === 'deactivate' || action === 'activate') {
      const id = toast.loading(action === 'deactivate' ? 'Деактивируем пользователей…' : 'Активируем пользователей…')
      const data = await run(action === 'deactivate' ? 'deactivate_users' : 'activate_users', { identifiers: identifiersStatus.trim() }, id)
      if (data?.results) {
        setBatchResult(data.results)
        const s = summarize(data.results)
        const text = `Успешно: ${s.ok} из ${s.total}${s.fail ? `, с ошибкой: ${s.fail}` : ''}`
        if (s.fail) toast.warning(text, { id })
        else toast.success(text, { id })
      } else {
        toast.dismiss(id)
      }
    } else {
      const isInvite = action === 'invite'
      const id = toast.loading(isInvite ? `Приглашаем в #${channelName.trim()}…` : `Исключаем из #${channelName.trim()}…`)
      const data = await run(
        isInvite ? 'invite_to_room' : 'kick_from_room',
        { channelName: channelName.trim(), identifiers: identifiersRoom.trim() },
        id
      )
      if (data?.results) {
        setBatchResult(data.results)
        const s = summarize(data.results)
        const text = `${isInvite ? 'Приглашены' : 'Исключены'}: ${s.ok} из ${s.total}${s.fail ? `, с ошибкой: ${s.fail}` : ''}`
        if (s.fail) toast.warning(text, { id })
        else toast.success(text, { id })
      } else {
        toast.dismiss(id)
      }
    }
    setConfirmAction(null)
  }

  const busy = loading !== null
  const batchSummary = batchResult ? summarize(batchResult) : null

  const confirmCopy: Record<BulkAction, { title: string; label: string; destructive: boolean; text: string; list: string[] }> = {
    deactivate: {
      title: `Деактивировать пользователей: ${statusLogins.length}`,
      label: 'Деактивировать',
      destructive: true,
      text: 'Пользователи не смогут войти в Rocket.Chat, пока вы их снова не активируете.',
      list: statusLogins,
    },
    activate: {
      title: `Активировать пользователей: ${statusLogins.length}`,
      label: 'Активировать',
      destructive: false,
      text: 'Пользователи снова смогут входить в Rocket.Chat.',
      list: statusLogins,
    },
    invite: {
      title: `Добавить в #${channelName.trim()}: ${roomLogins.length}`,
      label: 'Добавить в канал',
      destructive: false,
      text: `Пользователи будут приглашены в канал #${channelName.trim()}.`,
      list: roomLogins,
    },
    kick: {
      title: `Исключить из #${channelName.trim()}: ${roomLogins.length}`,
      label: 'Исключить из канала',
      destructive: true,
      text: `Пользователи будут исключены из канала #${channelName.trim()} и потеряют к нему доступ.`,
      list: roomLogins,
    },
  }
  const activeCopy = confirmAction ? confirmCopy[confirmAction] : null

  const authOption = (mode: AuthMode, title: string, text: string) => (
    <button
      key={mode}
      type="button"
      role="radio"
      aria-checked={authMode === mode}
      onClick={() => setAuthMode(mode)}
      className={cn(
        'flex items-start gap-3 rounded-lg border p-3 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        authMode === mode ? 'border-primary bg-muted/40' : 'hover:bg-muted/40'
      )}
    >
      <span
        className={cn(
          'mt-0.5 size-4 shrink-0 rounded-full border',
          authMode === mode ? 'border-4 border-primary' : 'border-muted-foreground/40'
        )}
        aria-hidden
      />
      <span>
        <span className="block text-sm font-medium">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{text}</span>
      </span>
    </button>
  )

  return (
    <div className={cn('space-y-6', variant === 'embedded' && 'space-y-4')}>
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-base font-semibold tracking-tight">R2D2</h2>
          <Badge variant="muted">Rocket.Chat API</Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Массовые операции через API Rocket.Chat. Каждый блок ниже — отдельная операция со своими полями. Сначала выберите, как авторизоваться.
        </p>
      </div>

      <Section title="Как войти в Rocket.Chat" description="Способ входа общий для всех операций на этой вкладке.">
        <div className="space-y-4">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Способ входа в Rocket.Chat">
            {authOption('workspace', 'Подключение пространства', 'Токен из вашего сохранённого входа в RC. Пароль админа на сервер не отправляется.')}
            {authOption('admin', 'Администратор RC', 'Логин и пароль администратора — полные права API, как во вкладке «Состояние входа».')}
          </div>

          {authMode === 'admin' && (
            <div className="grid gap-3 border-t pt-4 sm:grid-cols-2">
              <Field label="Логин" htmlFor="r2-admin-username" error={authTouched && !adminUsername.trim() ? 'Укажите логин администратора' : undefined}>
                <Input
                  id="r2-admin-username"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="admin"
                  className="font-mono"
                  autoComplete="off"
                  aria-invalid={authTouched && !adminUsername.trim()}
                />
              </Field>
              <Field label="Пароль" htmlFor="r2-admin-password" error={authTouched && !adminPassword ? 'Укажите пароль администратора' : undefined}>
                <Input
                  id="r2-admin-password"
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={authTouched && !adminPassword}
                />
              </Field>
              <Field label="Код 2FA" htmlFor="r2-admin-totp" hint="Если включён на аккаунте" className="sm:col-span-2">
                <Input
                  id="r2-admin-totp"
                  inputMode="numeric"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="000000"
                  className="max-w-[12rem] font-mono tracking-widest"
                />
              </Field>
            </div>
          )}
        </div>
      </Section>

      <Section
        title="Пользователи без входа"
        description="Аккаунты, у которых в Rocket.Chat нет даты последнего входа (lastLogin)."
        actions={
          <Button type="button" variant="outline" size="sm" disabled={busy} onClick={onLostUsers}>
            {loading === 'lost_users' ? <Loader2 className="animate-spin" /> : <Search />}
            Найти
          </Button>
        }
      >
        {lostUsers === null ? (
          <p className="text-sm text-muted-foreground">Нажмите «Найти», чтобы получить список.</p>
        ) : lostUsers.length === 0 ? (
          <p className="text-sm text-muted-foreground">Таких пользователей нет.</p>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Найдено: <span className="font-medium text-foreground">{lostUsers.length}</span></p>
            <div className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
              {lostUsers.map((u) => (
                <div key={u.id}>
                  @{u.username ?? u.id} {u.lastLogin ? `last: ${u.lastLogin}` : ''}
                </div>
              ))}
            </div>
          </div>
        )}
      </Section>

      <Section
        title="Ники вне шаблона"
        description="Показывает логины, которые не подходят под регулярное выражение «правильного» ника."
      >
        <div className="space-y-3">
          <Field label="Регулярное выражение допустимого логина" htmlFor="r2-bad-pattern" error={badNickRegexError} hint="Всё, что не подходит, попадёт в список.">
            <Input
              id="r2-bad-pattern"
              value={patternBadNick}
              onChange={(e) => setPatternBadNick(e.target.value)}
              aria-invalid={!!badNickRegexError}
              className="font-mono text-sm"
            />
          </Field>
          <Button type="button" variant="outline" size="sm" disabled={busy || !!badNickRegexError} onClick={onBadNicknames}>
            {loading === 'bad_nicknames' ? <Loader2 className="animate-spin" /> : <ShieldAlert />}
            Проверить ники
          </Button>
          {badUsers && (
            badUsers.length === 0 ? (
              <p className="text-sm text-muted-foreground">Все ники соответствуют шаблону.</p>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-muted-foreground">Не по шаблону: <span className="font-medium text-foreground">{badUsers.length}</span></p>
                <div className="max-h-40 overflow-auto rounded-md border bg-muted/30 p-2 font-mono text-xs">
                  {badUsers.map((u) => (
                    <div key={u.id}>@{u.username ?? u.id}</div>
                  ))}
                </div>
              </div>
            )
          )}
        </div>
      </Section>

      <Section
        title="Добавление пользователей"
        description={`Для каждого логина создаётся пользователь: почта — логин${EMAIL_DOMAIN_PREVIEW}, пароль — логин, при первом входе потребуется сменить пароль. До ${MAX_CREATE_USERS} за запрос.`}
      >
        {createPreviewLogins === null ? (
          <div className="space-y-3">
            <Field label="Список логинов" htmlFor="r2-create-logins" required error={createError} hint="По одному на строку.">
              <Textarea
                id="r2-create-logins"
                placeholder={'wrightag\nuser2\nuser3'}
                value={identifiersCreate}
                onChange={(e) => setIdentifiersCreate(e.target.value)}
                onBlur={() => identifiersCreate && setCreateTouched(true)}
                aria-invalid={!!createError}
                disabled={busy}
                className="min-h-[120px] font-mono text-sm"
                rows={6}
              />
              <LoginsCounter logins={createLogins} max={MAX_CREATE_USERS} />
            </Field>
            <Button type="button" variant="outline" size="sm" onClick={openCreatePreview} disabled={busy}>
              <Eye />
              Предпросмотр
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">
              Будет создано пользователей: <span className="font-semibold tabular-nums">{createPreviewLogins.length}</span>. Проверьте список перед созданием.
            </p>
            <div className="max-h-48 overflow-y-auto rounded-md border">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">Логин</th>
                    <th className="px-3 py-1.5 text-left text-xs font-medium text-muted-foreground">Почта</th>
                  </tr>
                </thead>
                <tbody>
                  {createPreviewLogins.map((login, i) => (
                    <tr key={`${login}-${i}`} className="border-t">
                      <td className="px-3 py-1.5 font-mono">{login}</td>
                      <td className="px-3 py-1.5 text-muted-foreground">
                        {login}
                        {EMAIL_DOMAIN_PREVIEW}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" onClick={onCreateUsersConfirm} disabled={busy}>
                {loading === 'create_users' ? <Loader2 className="animate-spin" /> : <UserPlus />}
                Создать ({createPreviewLogins.length})
              </Button>
              <Button type="button" variant="outline" onClick={() => setCreatePreviewLogins(null)} disabled={busy}>
                Назад к списку
              </Button>
            </div>
          </div>
        )}
      </Section>

      <Section title="Активация и деактивация" description="Только логины, отдельно от создания и от каналов.">
        <div className="space-y-3">
          <Field label="Логины" htmlFor="r2-status-logins" required error={statusError} hint="По одному на строку.">
            <Textarea
              id="r2-status-logins"
              placeholder={'user_one\nuser_two'}
              value={identifiersStatus}
              onChange={(e) => setIdentifiersStatus(e.target.value)}
              onBlur={() => identifiersStatus && setStatusTouched(true)}
              aria-invalid={!!statusError}
              rows={5}
              disabled={busy}
              className="min-h-[100px] resize-y font-mono text-sm"
            />
            <LoginsCounter logins={statusLogins} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={() => requestBulk('activate')} disabled={busy}>
              {loading === 'activate_users' ? <Loader2 className="animate-spin" /> : <UserCheck />}
              Активировать
            </Button>
            <Button type="button" size="sm" variant="outline" className="text-destructive hover:text-destructive" onClick={() => requestBulk('deactivate')} disabled={busy}>
              {loading === 'deactivate_users' ? <Loader2 className="animate-spin" /> : <UserMinus />}
              Деактивировать
            </Button>
          </div>
        </div>
      </Section>

      <Section
        title="Состав канала"
        description="Укажите канал без символа # и логины пользователей Rocket.Chat. Операции выполняются через API от имени выбранного выше способа входа."
      >
        <div className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-2">
            <Field label="Канал" htmlFor="r2-room-channel" required error={channelError} hint="Имя должно совпадать с каналом в RC. Символ # вводить не нужно.">
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-mono text-sm text-muted-foreground">#</span>
                <Input
                  id="r2-room-channel"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value.replace(/^#/, ''))}
                  placeholder="support"
                  className="pl-7 font-mono"
                  aria-invalid={!!channelError}
                  disabled={busy}
                />
              </div>
            </Field>
            <Field label="Логины" htmlFor="r2-room-users" required error={roomUsersError} hint="По одному на строку.">
              <Textarea
                id="r2-room-users"
                placeholder={'user_one\nuser_two'}
                value={identifiersRoom}
                onChange={(e) => setIdentifiersRoom(e.target.value)}
                onBlur={() => identifiersRoom && setRoomTouched(true)}
                aria-invalid={!!roomUsersError}
                rows={5}
                disabled={busy}
                className="min-h-[100px] font-mono text-sm"
              />
              <LoginsCounter logins={roomLogins} />
            </Field>
          </div>
          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="max-w-xl text-xs text-muted-foreground">
              <span className="font-medium text-foreground">Добавить в канал</span> — пригласить пользователей.{' '}
              <span className="font-medium text-foreground">Исключить</span> — убрать из канала (нужны права у бота или администратора).
            </p>
            <div className="flex shrink-0 flex-wrap gap-2">
              <Button type="button" onClick={() => requestBulk('invite')} disabled={busy}>
                {loading === 'invite_to_room' ? <Loader2 className="animate-spin" /> : <DoorOpen />}
                Добавить в канал
              </Button>
              <Button type="button" variant="outline" className="text-destructive hover:text-destructive" onClick={() => requestBulk('kick')} disabled={busy}>
                {loading === 'kick_from_room' ? <Loader2 className="animate-spin" /> : <DoorClosed />}
                Исключить
              </Button>
            </div>
          </div>
        </div>
      </Section>

      {batchResult && batchResult.length > 0 && batchSummary && (
        <Section
          title="Результат последней операции"
          description={`Успешно: ${batchSummary.ok} из ${batchSummary.total}${batchSummary.fail ? `, с ошибкой: ${batchSummary.fail}` : ''}`}
          bare
        >
          <div className="max-h-56 divide-y overflow-auto rounded-lg border bg-card text-sm">
            {batchResult.map((r, i) => (
              <div key={i} className="flex items-center justify-between gap-2 px-3 py-1.5">
                <span className="font-mono text-xs">{r.username ?? r.login}</span>
                {r.ok ? <Badge variant="success">Готово</Badge> : <span className="text-xs text-destructive">{r.error ?? 'Ошибка'}</span>}
              </div>
            ))}
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={!!confirmAction}
        onOpenChange={(o) => { if (!o) setConfirmAction(null) }}
        title={activeCopy?.title ?? ''}
        description={activeCopy?.text}
        confirmLabel={activeCopy?.label}
        destructive={activeCopy?.destructive}
        loading={busy}
        onConfirm={executeBulk}
      >
        {activeCopy && (
          <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
            {activeCopy.list.slice(0, 50).join(', ')}
            {activeCopy.list.length > 50 && <span className="text-muted-foreground"> … и ещё {activeCopy.list.length - 50}</span>}
          </div>
        )}
      </ConfirmDialog>
    </div>
  )
}
