'use client'

import { useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Link2, Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { DatePicker } from '@/components/ui/date-picker'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { CopyButton } from '@/components/common/CopyButton'
import { inviteAssignableRoles, type AppRole } from '@/lib/roles'

type Mode = 'invite' | 'create'
type PasswordMode = 'generate' | 'login' | 'manual'
type FieldErrors = Partial<Record<string, string>>

const ROLE_OPTIONS: Record<string, { label: string; hint: string }> = {
  SUP: { label: 'SUP — поддержка', hint: 'Управляет пользователями ADM и MEMBER, видит журнал действий.' },
  ADM: { label: 'ADM — администратор пространств', hint: 'Работает с назначенными пространствами и шаблонами.' },
  MEMBER: { label: 'MEMBER — участник', hint: 'Планирует сообщения в своих пространствах.' },
}

const VALIDITY_OPTIONS = [
  { value: '1', label: '1 час' },
  { value: '24', label: '24 часа' },
  { value: '72', label: '3 дня' },
  { value: '168', label: '7 дней' },
]

const PASSWORD_MODES: { value: PasswordMode; label: string; hint: string }[] = [
  { value: 'generate', label: 'Сгенерировать временный', hint: 'Пароль покажем один раз; при первом входе пользователь задаст свой.' },
  { value: 'login', label: 'Пароль = логин', hint: 'При первом входе пользователь обязан сменить пароль.' },
  { value: 'manual', label: 'Задать вручную', hint: 'Не короче 8 символов. Смена при входе не требуется.' },
]

type InviteResult = { link: string; expiresAt: string; role: string; email: string | null }
type CreateResult = { email: string; role: string; temporaryPassword: string | null; passwordMode: PasswordMode }

function todayIso(): string {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

const initialForm = {
  role: 'MEMBER' as AppRole,
  email: '',
  name: '',
  username: '',
  validity: '1',
  passwordMode: 'generate' as PasswordMode,
  password: '',
  isVolunteer: false,
  volunteerExpiresAt: '',
  volunteerIntensive: '',
}

/**
 * «Добавить пользователя»: приглашение по ссылке или создание учётной записи сразу.
 * Доступные роли зависят от роли текущего пользователя (lib/roles → inviteAssignableRoles).
 */
export function AddUserDialog({
  open,
  onOpenChange,
  actorRole,
  onCreated,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  actorRole: string
  onCreated?: () => void
}) {
  const roles = useMemo(() => inviteAssignableRoles(actorRole), [actorRole])
  const [mode, setMode] = useState<Mode>('invite')
  const [form, setForm] = useState(initialForm)
  const [errors, setErrors] = useState<FieldErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [inviteResult, setInviteResult] = useState<InviteResult | null>(null)
  const [createResult, setCreateResult] = useState<CreateResult | null>(null)

  useEffect(() => {
    if (!open) {
      setMode('invite')
      setForm({ ...initialForm, role: roles.includes('MEMBER') ? 'MEMBER' : (roles[0] ?? 'MEMBER') })
      setErrors({})
      setInviteResult(null)
      setCreateResult(null)
      setSubmitting(false)
    }
  }, [open, roles])

  const set = <K extends keyof typeof initialForm>(key: K, value: (typeof initialForm)[K]) => {
    setForm((f) => ({ ...f, [key]: value }))
    setErrors((e) => {
      if (!e[key as string]) return e
      const next = { ...e }
      delete next[key as string]
      return next
    })
  }

  const validate = (): FieldErrors => {
    const e: FieldErrors = {}
    if (!roles.includes(form.role)) e.role = 'Выберите роль'
    const login = form.email.trim()
    if (mode === 'create') {
      if (!login) e.email = 'Укажите логин'
      else if (login.length < 2) e.email = 'Логин — не короче 2 символов'
      else if (/\s/.test(login)) e.email = 'Логин не должен содержать пробелов'
      if (form.username.trim() && !/^[a-zA-Z0-9._-]+$/.test(form.username.trim())) {
        e.username = 'Только латиница, цифры, точка, дефис и подчёркивание'
      }
      if (form.passwordMode === 'manual' && form.password.length < 8) e.password = 'Пароль — не короче 8 символов'
    } else if (login && /\s/.test(login)) {
      e.email = 'Логин не должен содержать пробелов'
    }
    if (form.role === 'MEMBER' && form.isVolunteer) {
      if (!form.volunteerExpiresAt) e.volunteerExpiresAt = 'Укажите дату окончания доступа'
      else if (form.volunteerExpiresAt < todayIso()) e.volunteerExpiresAt = 'Дата должна быть не раньше сегодняшней'
      if (form.volunteerIntensive.trim().length > 50) e.volunteerIntensive = 'Не длиннее 50 символов'
    }
    return e
  }

  const formErrors = validate()
  const formValid = Object.keys(formErrors).length === 0

  const requestSubmit = () => {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length > 0) return
    if (form.role === 'SUP') {
      setConfirmOpen(true)
      return
    }
    void submit()
  }

  const volunteerPayload = () =>
    form.role === 'MEMBER' && form.isVolunteer
      ? { volunteerExpiresAt: form.volunteerExpiresAt, volunteerIntensive: form.volunteerIntensive.trim() || null }
      : {}

  const submit = async () => {
    setSubmitting(true)
    const toastId = toast.loading(mode === 'invite' ? 'Создаём ссылку…' : 'Создаём пользователя…')
    try {
      const res =
        mode === 'invite'
          ? await fetch('/api/admin/invite', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                role: form.role,
                email: form.email.trim() || null,
                expiresInHours: Number(form.validity),
                ...volunteerPayload(),
              }),
            })
          : await fetch('/api/admin/users', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                email: form.email.trim(),
                name: form.name.trim() || null,
                username: form.username.trim() || null,
                role: form.role,
                passwordMode: form.passwordMode,
                password: form.passwordMode === 'manual' ? form.password : null,
                ...volunteerPayload(),
              }),
            })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        if (data?.fieldErrors && typeof data.fieldErrors === 'object') setErrors(data.fieldErrors)
        toast.error(data?.error || 'Не удалось выполнить действие', {
          id: toastId,
          description: 'Проверьте поля формы и попробуйте ещё раз.',
        })
        return
      }
      if (mode === 'invite') {
        setInviteResult({ link: data.link, expiresAt: data.expiresAt, role: data.role, email: data.email ?? null })
        toast.success('Ссылка-приглашение создана', {
          id: toastId,
          description: `Действует до ${formatDateTime(data.expiresAt)}`,
        })
        try {
          await navigator.clipboard.writeText(data.link)
          toast.success('Ссылка скопирована в буфер обмена')
        } catch {
          /* копирование вручную кнопкой */
        }
      } else {
        setCreateResult({
          email: data.user?.email ?? form.email.trim().toLowerCase(),
          role: data.user?.role ?? form.role,
          temporaryPassword: data.temporaryPassword ?? null,
          passwordMode: form.passwordMode,
        })
        toast.success('Пользователь создан', { id: toastId, description: data.user?.email })
      }
      onCreated?.()
    } catch {
      toast.error('Ошибка сети', { id: toastId, description: 'Проверьте подключение и повторите.' })
    } finally {
      setSubmitting(false)
    }
  }

  const resetForAnother = () => {
    setInviteResult(null)
    setCreateResult(null)
    setForm((f) => ({ ...initialForm, role: f.role }))
    setErrors({})
  }

  const showResult = inviteResult || createResult
  const roleHint = ROLE_OPTIONS[form.role]?.hint

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Добавить пользователя</DialogTitle>
            <DialogDescription>
              {showResult
                ? 'Готово. Передайте данные пользователю — повторно они показаны не будут.'
                : 'Отправьте ссылку-приглашение или сразу создайте учётную запись.'}
            </DialogDescription>
          </DialogHeader>

          {inviteResult ? (
            <div className="space-y-4">
              <Field label="Ссылка-приглашение" hint={`Действует до ${formatDateTime(inviteResult.expiresAt)}. Ссылка одноразовая — после регистрации перестанет работать.`}>
                <div className="flex items-center gap-2">
                  <Input readOnly value={inviteResult.link} className="font-mono text-xs" aria-label="Ссылка-приглашение" onFocus={(e) => e.currentTarget.select()} />
                  <CopyButton text={inviteResult.link} successMessage="Ссылка скопирована" variant="outline" size="icon" aria-label="Копировать ссылку" />
                </div>
              </Field>
              <p className="text-sm text-muted-foreground">
                Роль: <span className="font-medium text-foreground">{inviteResult.role}</span>
                {inviteResult.email && (
                  <>
                    {' '}· логин: <span className="font-mono text-foreground">{inviteResult.email}</span>
                  </>
                )}
              </p>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={resetForAnother}>
                  Создать ещё
                </Button>
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Готово
                </Button>
              </DialogFooter>
            </div>
          ) : createResult ? (
            <div className="space-y-4">
              <p className="text-sm">
                Создан пользователь <span className="font-mono font-medium">{createResult.email}</span> с ролью{' '}
                <span className="font-medium">{createResult.role}</span>.
              </p>
              {createResult.temporaryPassword ? (
                <Field label="Временный пароль" hint="При первом входе пользователь задаст свой пароль.">
                  <div className="flex items-center gap-2">
                    <Input readOnly value={createResult.temporaryPassword} className="font-mono" aria-label="Временный пароль" onFocus={(e) => e.currentTarget.select()} />
                    <CopyButton text={createResult.temporaryPassword} successMessage="Пароль скопирован" variant="outline" size="icon" aria-label="Копировать пароль" />
                  </div>
                </Field>
              ) : createResult.passwordMode === 'login' ? (
                <p className="text-sm text-muted-foreground">Пароль совпадает с логином. При первом входе система попросит его сменить.</p>
              ) : (
                <p className="text-sm text-muted-foreground">Пароль задан вручную — передайте его пользователю безопасным способом.</p>
              )}
              <DialogFooter>
                <Button type="button" variant="outline" onClick={resetForAnother}>
                  Создать ещё
                </Button>
                <Button type="button" onClick={() => onOpenChange(false)}>
                  Готово
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <form
              className="space-y-4"
              noValidate
              onSubmit={(e) => {
                e.preventDefault()
                requestSubmit()
              }}
            >
              <Tabs value={mode} onValueChange={(v) => { setMode(v as Mode); setErrors({}) }}>
                <TabsList className="w-full">
                  <TabsTrigger value="invite" className="flex-1 gap-1.5">
                    <Link2 className="size-4" aria-hidden />
                    По ссылке
                  </TabsTrigger>
                  <TabsTrigger value="create" className="flex-1 gap-1.5">
                    <UserPlus className="size-4" aria-hidden />
                    Создать сразу
                  </TabsTrigger>
                </TabsList>
              </Tabs>

              <Field label="Роль" htmlFor="add-user-role" required hint={roleHint} error={errors.role}>
                <Select value={form.role} onValueChange={(v) => set('role', v as AppRole)}>
                  <SelectTrigger id="add-user-role" className="w-full" aria-invalid={!!errors.role}>
                    <SelectValue placeholder="Выберите роль" />
                  </SelectTrigger>
                  <SelectContent>
                    {roles.map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_OPTIONS[r]?.label ?? r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>

              {mode === 'invite' ? (
                <div className="grid gap-4 sm:grid-cols-[1fr_9rem]">
                  <Field
                    label="Логин (подсказка)"
                    htmlFor="add-user-email"
                    hint="Необязательно: подставится в форму регистрации."
                    error={errors.email}
                  >
                    <Input
                      id="add-user-email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="i.ivanov"
                      autoComplete="off"
                      className="font-mono"
                      aria-invalid={!!errors.email}
                    />
                  </Field>
                  <Field label="Ссылка действует" htmlFor="add-user-validity">
                    <Select value={form.validity} onValueChange={(v) => set('validity', v)}>
                      <SelectTrigger id="add-user-validity" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {VALIDITY_OPTIONS.map((o) => (
                          <SelectItem key={o.value} value={o.value}>
                            {o.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                </div>
              ) : (
                <>
                  <Field label="Логин" htmlFor="add-user-email" required hint="Используется для входа." error={errors.email}>
                    <Input
                      id="add-user-email"
                      value={form.email}
                      onChange={(e) => set('email', e.target.value)}
                      placeholder="i.ivanov"
                      autoComplete="off"
                      className="font-mono"
                      aria-invalid={!!errors.email}
                    />
                  </Field>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Имя" htmlFor="add-user-name" error={errors.name}>
                      <Input id="add-user-name" value={form.name} onChange={(e) => set('name', e.target.value)} placeholder="Иван Иванов" />
                    </Field>
                    <Field label="Username" htmlFor="add-user-username" hint="Необязательно" error={errors.username}>
                      <Input
                        id="add-user-username"
                        value={form.username}
                        onChange={(e) => set('username', e.target.value)}
                        placeholder="ivanov"
                        className="font-mono"
                        aria-invalid={!!errors.username}
                      />
                    </Field>
                  </div>
                  <Field
                    label="Пароль"
                    htmlFor="add-user-password-mode"
                    hint={PASSWORD_MODES.find((m) => m.value === form.passwordMode)?.hint}
                  >
                    <Select value={form.passwordMode} onValueChange={(v) => set('passwordMode', v as PasswordMode)}>
                      <SelectTrigger id="add-user-password-mode" className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {PASSWORD_MODES.map((m) => (
                          <SelectItem key={m.value} value={m.value}>
                            {m.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  {form.passwordMode === 'manual' && (
                    <Field label="Новый пароль" htmlFor="add-user-password" required error={errors.password}>
                      <PasswordInput
                        id="add-user-password"
                        value={form.password}
                        onChange={(e) => set('password', e.target.value)}
                        autoComplete="new-password"
                        aria-invalid={!!errors.password}
                      />
                    </Field>
                  )}
                </>
              )}

              {form.role === 'MEMBER' && (
                <div className="space-y-3 rounded-md border p-3">
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="add-user-volunteer"
                      checked={form.isVolunteer}
                      onCheckedChange={(c) => set('isVolunteer', c === true)}
                      className="mt-0.5"
                    />
                    <div className="space-y-0.5">
                      <Label htmlFor="add-user-volunteer" className="text-sm font-medium">
                        Волонтёр с ограниченным сроком доступа
                      </Label>
                      <p className="text-xs text-muted-foreground">После даты окончания вход будет закрыт.</p>
                    </div>
                  </div>
                  {form.isVolunteer && (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <Field label="Доступ до" htmlFor="add-user-vol-expires" required error={errors.volunteerExpiresAt}>
                        <DatePicker
                          id="add-user-vol-expires"
                          value={form.volunteerExpiresAt}
                          onChange={(v) => set('volunteerExpiresAt', v)}
                          min={todayIso()}
                          invalid={!!errors.volunteerExpiresAt}
                        />
                      </Field>
                      <Field label="Интенсив" htmlFor="add-user-vol-intensive" hint="Например, feb-26" error={errors.volunteerIntensive}>
                        <Input
                          id="add-user-vol-intensive"
                          value={form.volunteerIntensive}
                          onChange={(e) => set('volunteerIntensive', e.target.value)}
                          placeholder="feb-26"
                        />
                      </Field>
                    </div>
                  )}
                </div>
              )}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>
                  Отмена
                </Button>
                <Button type="submit" disabled={submitting || !formValid}>
                  {submitting && <Loader2 className="size-4 animate-spin" aria-hidden />}
                  {mode === 'invite' ? 'Создать ссылку' : 'Создать пользователя'}
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Выдать роль SUP?</AlertDialogTitle>
            <AlertDialogDescription>
              {mode === 'invite'
                ? 'Тот, кто зарегистрируется по ссылке, получит роль SUP: управление пользователями ADM и MEMBER и доступ к журналу действий.'
                : `Пользователь ${form.email.trim() || ''} получит роль SUP: управление пользователями ADM и MEMBER и доступ к журналу действий.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                setConfirmOpen(false)
                void submit()
              }}
            >
              Продолжить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
