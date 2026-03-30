'use client'

import { useState, useCallback } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Bot,
  Loader2,
  Users,
  UserMinus,
  UserPlus,
  DoorOpen,
  DoorClosed,
  Search,
  ShieldAlert,
  KeyRound,
  ChevronDown,
  UserCheck,
  Eye,
  Hash,
} from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

type R2ResultRow = { username?: string; login?: string; ok: boolean; error?: string; rcUserId?: string }

type AuthMode = 'admin' | 'workspace'

const MAX_CREATE_USERS = 100
const EMAIL_DOMAIN_PREVIEW = '@student.21-school.ru'

function parseLogins(text: string): string[] {
  return text
    .split(/[\n,;]+/)
    .map((s) => s.trim().replace(/^@/, ''))
    .filter(Boolean)
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

  const run = useCallback(
    async (action: string, payload: Record<string, unknown> = {}) => {
      setLoading(action)
      setBatchResult(null)
      try {
        const authBody: Record<string, unknown> = { action, ...payload }

        if (authMode === 'admin') {
          const u = adminUsername.trim()
          const p = adminPassword
          if (!u || !p) {
            toast.error('Укажите логин и пароль администратора RC или переключитесь на «Подключение пространства».')
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
              description: 'Введите код из приложения-аутентификатора и повторите.',
            })
          } else if (res.status === 401) {
            toast.error(data.error || 'Ошибка входа в Rocket.Chat', {
              description:
                authMode === 'admin'
                  ? 'Проверьте пароль и 2FA или переключитесь на вход по подключению пространства.'
                  : 'Подключите пространство в настройках или войдите под админом RC.',
            })
          } else {
            toast.error(data.error || `Ошибка (${res.status})`)
          }
          return null
        }
        return data
      } catch (e: unknown) {
        toast.error(e instanceof Error ? e.message : 'Сеть')
        return null
      } finally {
        setLoading(null)
      }
    },
    [workspaceId, authMode, adminUsername, adminPassword, totpCode]
  )

  const onLostUsers = async () => {
    const data = await run('lost_users')
    if (data?.users) {
      setLostUsers(data.users)
      toast.success(`Найдено: ${data.users.length}`)
    }
  }

  const onBadNicknames = async () => {
    const data = await run('bad_nicknames', { pattern: patternBadNick.trim() || undefined })
    if (data?.users) {
      setBadUsers(data.users)
      toast.success(`Не по шаблону: ${data.users.length}`)
    }
  }

  const openCreatePreview = () => {
    const logins = parseLogins(identifiersCreate)
    if (logins.length === 0) {
      toast.error('Введите хотя бы один логин (по одному на строку)')
      return
    }
    if (logins.length > MAX_CREATE_USERS) {
      toast.error(`Максимум ${MAX_CREATE_USERS} пользователей за один запрос`)
      return
    }
    setCreatePreviewLogins(logins)
  }

  const onCreateUsersConfirm = async () => {
    if (!createPreviewLogins?.length) return
    const data = await run('create_users', { identifiers: createPreviewLogins.join('\n') })
    if (data?.results) {
      setBatchResult(data.results)
      const ok = data.results.filter((r: R2ResultRow) => r.ok).length
      toast.success(`Создано: ${ok} из ${data.results.length}`)
      setCreatePreviewLogins(null)
    }
  }

  const onDeactivate = async () => {
    const data = await run('deactivate_users', { identifiers: identifiersStatus.trim() })
    if (data?.results) {
      setBatchResult(data.results)
      toast.message('Готово', { description: `Успешно: ${data.results.filter((r: R2ResultRow) => r.ok).length}` })
    }
  }

  const onActivate = async () => {
    const data = await run('activate_users', { identifiers: identifiersStatus.trim() })
    if (data?.results) {
      setBatchResult(data.results)
      toast.message('Готово', { description: `Успешно: ${data.results.filter((r: R2ResultRow) => r.ok).length}` })
    }
  }

  const onInvite = async () => {
    const data = await run('invite_to_room', {
      channelName: channelName.trim(),
      identifiers: identifiersRoom.trim(),
    })
    if (data?.results) {
      setBatchResult(data.results)
      toast.success('Приглашения отправлены (см. результат)')
    }
  }

  const onKick = async () => {
    const data = await run('kick_from_room', {
      channelName: channelName.trim(),
      identifiers: identifiersRoom.trim(),
    })
    if (data?.results) {
      setBatchResult(data.results)
      toast.success('Исключение выполнено')
    }
  }

  const cardClass = cn(
    'rounded-xl border border-border/80 bg-card/80 backdrop-blur-sm shadow-[0_1px_2px_rgba(0,0,0,0.04)]',
    variant === 'embedded' && 'border-cyan-500/20'
  )

  const detailsClass =
    'group rounded-xl border border-border/60 bg-card/50 open:border-border open:bg-card/80 transition-colors'
  const summaryClass =
    'flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 font-medium text-sm text-foreground [&::-webkit-details-marker]:hidden'

  return (
    <div className={cn('space-y-4', variant === 'embedded' && 'space-y-3')}>
      <Card className={cn('rounded-2xl border-cyan-500/20 bg-gradient-to-br from-cyan-500/[0.07] via-background to-background overflow-hidden', cardClass)}>
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2 flex-wrap">
            <Bot className="h-5 w-5 text-cyan-600 dark:text-cyan-400" />
            <CardTitle className="text-lg tracking-tight">R2D2</CardTitle>
            <Badge variant="secondary" className="bg-cyan-500/15 text-cyan-800 dark:text-cyan-200 border-cyan-500/25">
              Rocket.Chat API
            </Badge>
          </div>
          <CardDescription className="text-sm leading-relaxed">
            Каждый блок ниже — отдельная операция со своими полями. Сначала выберите, как авторизоваться в RC: сохранённое
            подключение к пространству или логин администратора.
          </CardDescription>
        </CardHeader>
      </Card>

      <details className={detailsClass} open>
        <summary className={summaryClass}>
          <span className="flex items-center gap-2">
            <KeyRound className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            Как войти в Rocket.Chat
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-4 px-4 pb-4 pt-0 border-t border-border/40">
          <div className="grid gap-3 sm:grid-cols-2" role="radiogroup" aria-label="Способ входа в Rocket.Chat">
            <button
              type="button"
              aria-pressed={authMode === 'workspace'}
              onClick={() => setAuthMode('workspace')}
              className={cn(
                'flex text-left items-start gap-3 rounded-xl border p-3 transition-colors',
                authMode === 'workspace' ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'border-border/60 hover:bg-muted/30'
              )}
            >
              <span
                className={cn(
                  'mt-1 h-4 w-4 shrink-0 rounded-full border-2',
                  authMode === 'workspace' ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                )}
                aria-hidden
              />
              <div>
                <span className="text-sm font-medium">Подключение пространства</span>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Токен из вашего сохранённого входа в RC (как в других вкладках). Пароль админа на сервер не отправляется.
                </p>
              </div>
            </button>
            <button
              type="button"
              aria-pressed={authMode === 'admin'}
              onClick={() => setAuthMode('admin')}
              className={cn(
                'flex text-left items-start gap-3 rounded-xl border p-3 transition-colors',
                authMode === 'admin' ? 'border-primary/40 bg-primary/5 ring-1 ring-primary/20' : 'border-border/60 hover:bg-muted/30'
              )}
            >
              <span
                className={cn(
                  'mt-1 h-4 w-4 shrink-0 rounded-full border-2',
                  authMode === 'admin' ? 'border-primary bg-primary' : 'border-muted-foreground/40'
                )}
                aria-hidden
              />
              <div>
                <span className="text-sm font-medium">Администратор RC</span>
                <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
                  Логин и пароль администратора — полные права API, как во вкладке «Состояние входа».
                </p>
              </div>
            </button>
          </div>

          {authMode === 'admin' && (
            <div className="grid gap-3 sm:grid-cols-2 rounded-xl border border-border/50 bg-muted/20 p-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Логин</Label>
                <Input
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  placeholder="admin"
                  className="h-9 font-mono text-sm"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Пароль</Label>
                <Input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="h-9"
                  autoComplete="off"
                />
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs">Код 2FA (если включён на аккаунте)</Label>
                <Input
                  inputMode="numeric"
                  value={totpCode}
                  onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder="000000"
                  className="h-9 font-mono tracking-widest max-w-[12rem]"
                />
              </div>
            </div>
          )}
        </CardContent>
      </details>

      <details className={detailsClass} open>
        <summary className={summaryClass}>
          <span className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            Аналитика: потеряшки
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-3 px-4 pb-4 pt-0 border-t border-border/40">
          <p className="text-xs text-muted-foreground">Пользователи без lastLogin в RC.</p>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start gap-2 sm:w-auto"
            disabled={loading !== null}
            onClick={onLostUsers}
          >
            {loading === 'lost_users' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Users className="h-4 w-4" />}
            Найти потеряшек
          </Button>
          {lostUsers && lostUsers.length > 0 && (
            <div className="max-h-40 overflow-auto rounded-lg border border-border/60 bg-muted/20 p-2 text-xs font-mono">
              {lostUsers.map((u) => (
                <div key={u.id}>
                  @{u.username ?? u.id} {u.lastLogin ? `last: ${u.lastLogin}` : ''}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </details>

      <details className={detailsClass} open>
        <summary className={summaryClass}>
          <span className="flex items-center gap-2">
            <ShieldAlert className="h-4 w-4 text-muted-foreground" />
            Аналитика: ники вне шаблона
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-3 px-4 pb-4 pt-0 border-t border-border/40">
          <div className="space-y-1.5">
            <Label className="text-xs">Regex «валидного» логина (остальные попадут в список)</Label>
            <Input value={patternBadNick} onChange={(e) => setPatternBadNick(e.target.value)} className="font-mono text-xs h-9" />
          </div>
          <Button
            type="button"
            variant="secondary"
            className="w-full justify-start gap-2 sm:w-auto"
            disabled={loading !== null}
            onClick={onBadNicknames}
          >
            {loading === 'bad_nicknames' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShieldAlert className="h-4 w-4" />}
            Проверить ники
          </Button>
          {badUsers && badUsers.length > 0 && (
            <div className="max-h-32 overflow-auto rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 text-xs font-mono">
              {badUsers.map((u) => (
                <div key={u.id}>@{u.username ?? u.id}</div>
              ))}
            </div>
          )}
        </CardContent>
      </details>

      <details className={detailsClass} open>
        <summary className={summaryClass}>
          <span className="flex items-center gap-2">
            <UserPlus className="h-4 w-4 text-rose-600 dark:text-rose-400" />
            Добавление пользователей в Rocket.Chat
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-4 px-4 pb-4 pt-0 border-t border-border/40">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Вставьте список логинов (по одному на строку). Для каждого будет создан пользователь: email = логин{EMAIL_DOMAIN_PREVIEW}, пароль = логин,
            смена пароля при первом входе включена. Максимум {MAX_CREATE_USERS} пользователей за запрос.
          </p>

          {createPreviewLogins === null ? (
            <>
              <div className="rounded-xl border border-blue-500/35 bg-blue-500/[0.06] dark:bg-blue-500/10 p-4 space-y-2">
                <Label htmlFor="r2-create-logins" className="flex items-center gap-2 text-sm font-medium">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400">
                    <Users className="w-4 h-4" />
                  </span>
                  Список логинов (по одному на строку)
                </Label>
                <Textarea
                  id="r2-create-logins"
                  placeholder={'wrightag\nuser2\nuser3'}
                  value={identifiersCreate}
                  onChange={(e) => setIdentifiersCreate(e.target.value)}
                  disabled={loading !== null}
                  className="min-h-[120px] font-mono text-sm bg-background rounded-lg border border-blue-400/30 focus-visible:ring-blue-500/30"
                  rows={6}
                />
                <p className="text-xs text-muted-foreground">
                  Почта: логин{EMAIL_DOMAIN_PREVIEW}. Пароль равен логину. При первом входе пользователь сменит пароль.
                </p>
                {identifiersCreate.trim() && (
                  <p className="text-xs font-medium text-muted-foreground">
                    В списке:{' '}
                    <span className="tabular-nums text-foreground">{parseLogins(identifiersCreate).length}</span> / {MAX_CREATE_USERS}
                  </p>
                )}
              </div>
              <Button
                type="button"
                variant="outline"
                onClick={openCreatePreview}
                disabled={loading !== null}
                className="gap-2 rounded-lg border-blue-400/40 hover:bg-blue-500/10"
              >
                <Eye className="w-4 h-4" />
                Предпросмотр
              </Button>
            </>
          ) : (
            <>
              <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/[0.06] dark:bg-emerald-500/10 p-4 space-y-2">
                <p className="font-medium text-sm">
                  Будет создано пользователей: <strong>{createPreviewLogins.length}</strong>
                </p>
                <div className="max-h-48 overflow-y-auto rounded-lg border border-border/50 bg-background/80">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border/60 bg-muted/30">
                        <th className="text-left py-2 px-3 font-medium">Логин</th>
                        <th className="text-left py-2 px-3 font-medium">Почта</th>
                      </tr>
                    </thead>
                    <tbody>
                      {createPreviewLogins.map((login, i) => (
                        <tr key={`${login}-${i}`} className="border-b border-border/30 last:border-0">
                          <td className="py-1.5 px-3 font-mono">{login}</td>
                          <td className="py-1.5 px-3 text-muted-foreground">
                            {login}
                            {EMAIL_DOMAIN_PREVIEW}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setCreatePreviewLogins(null)}
                  disabled={loading !== null}
                  className="rounded-lg"
                >
                  Назад
                </Button>
                <Button type="button" onClick={onCreateUsersConfirm} disabled={loading !== null} className="gap-2 rounded-lg shadow-sm">
                  {loading === 'create_users' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                  Создать
                </Button>
              </div>
            </>
          )}
        </CardContent>
      </details>

      <details className={detailsClass} open>
        <summary className={summaryClass}>
          <span className="flex items-center gap-2">
            <UserCheck className="h-4 w-4 text-muted-foreground" />
            Активация и деактивация
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-3 px-4 pb-4 pt-0 border-t border-border/40">
          <p className="text-xs text-muted-foreground">Только логины, отдельно от создания и от комнат.</p>
          <Textarea
            placeholder="user_one&#10;user_two"
            value={identifiersStatus}
            onChange={(e) => setIdentifiersStatus(e.target.value)}
            rows={5}
            className="font-mono text-xs resize-y min-h-[100px]"
          />
          <div className="flex flex-wrap gap-2">
            <Button type="button" size="sm" variant="outline" onClick={onDeactivate} disabled={loading !== null}>
              {loading === 'deactivate_users' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />}
              Деактивировать
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={onActivate} disabled={loading !== null}>
              {loading === 'activate_users' ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserCheck className="h-4 w-4" />}
              Активировать
            </Button>
          </div>
        </CardContent>
      </details>

      <details className={detailsClass} open>
        <summary className={summaryClass}>
          <span className="flex items-center gap-2">
            <DoorOpen className="h-4 w-4 text-violet-600 dark:text-violet-400" />
            Комнаты и участники
          </span>
          <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
        </summary>
        <CardContent className="space-y-4 px-4 pb-4 pt-0 border-t border-border/40">
          <div>
            <h3 className="text-sm font-semibold text-foreground">Управление составом канала</h3>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">
              Укажите канал <span className="font-medium text-foreground">без символа #</span> (открытый или тот, к которому у API есть доступ). Ниже —
              логины пользователей Rocket.Chat, по одному на строку. Операции выполняются через REST API от имени выбранного выше способа входа.
            </p>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.05] dark:bg-violet-500/10 p-4 space-y-2">
              <Label htmlFor="r2-room-channel" className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-700 dark:text-violet-300">
                  <Hash className="w-4 h-4" />
                </span>
                Канал
              </Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground font-mono text-sm pointer-events-none">#</span>
                <Input
                  id="r2-room-channel"
                  value={channelName}
                  onChange={(e) => setChannelName(e.target.value.replace(/^#/, ''))}
                  placeholder="support"
                  className="font-mono pl-7"
                  disabled={loading !== null}
                />
              </div>
              <p className="text-[11px] text-muted-foreground leading-snug">
                Символ # вводить не нужен — он показан для наглядности. Имя должно совпадать с каналом в RC.
              </p>
            </div>

            <div className="rounded-xl border border-blue-500/35 bg-blue-500/[0.06] dark:bg-blue-500/10 p-4 space-y-2 lg:min-h-[140px] flex flex-col">
              <Label htmlFor="r2-room-users" className="flex items-center gap-2 text-sm font-medium">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400">
                  <Users className="w-4 h-4" />
                </span>
                Логины в канал / из канала
              </Label>
              <Textarea
                id="r2-room-users"
                placeholder={'user_one\nuser_two'}
                value={identifiersRoom}
                onChange={(e) => setIdentifiersRoom(e.target.value)}
                rows={5}
                disabled={loading !== null}
                className="font-mono text-sm flex-1 min-h-[100px] bg-background rounded-lg border border-blue-400/30"
              />
              <p className="text-[11px] text-muted-foreground">Только логины RC, по одному на строку.</p>
            </div>
          </div>

          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 rounded-xl border border-border/50 bg-muted/30 px-4 py-3">
            <p className="text-xs text-muted-foreground max-w-xl">
              <span className="font-medium text-foreground">В комнату</span> — пригласить в канал.{' '}
              <span className="font-medium text-foreground">Из комнаты</span> — исключить из канала (если бот/админ имеет права).
            </p>
            <div className="flex flex-wrap gap-2 shrink-0">
              <Button type="button" variant="default" onClick={onInvite} disabled={loading !== null} className="gap-2">
                {loading === 'invite_to_room' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorOpen className="h-4 w-4" />}
                В комнату
              </Button>
              <Button type="button" variant="outline" onClick={onKick} disabled={loading !== null} className="gap-2">
                {loading === 'kick_from_room' ? <Loader2 className="h-4 w-4 animate-spin" /> : <DoorClosed className="h-4 w-4" />}
                Из комнаты
              </Button>
            </div>
          </div>
        </CardContent>
      </details>

      {batchResult && batchResult.length > 0 && (
        <Card className={cardClass}>
          <CardHeader className="pb-2">
            <CardTitle className="text-sm">Результат последней пакетной операции</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="max-h-56 overflow-auto rounded-lg border border-border/60 text-xs font-mono divide-y divide-border/40">
              {batchResult.map((r, i) => (
                <div key={i} className="py-1.5 px-2 flex justify-between gap-2">
                  <span>{r.username ?? r.login}</span>
                  <span className={r.ok ? 'text-emerald-600' : 'text-destructive'}>{r.ok ? 'ok' : r.error}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
