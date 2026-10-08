"use client"

import { useRef, useState, type ComponentProps } from 'react'
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { PasswordInput } from "@/components/ui/password-input"
import { DatePicker } from "@/components/ui/date-picker"
import { Field } from "@/components/ui/field"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { toast } from 'sonner'
import { Plus, CircleHelp, CircleAlert, TriangleAlert, Loader2 } from 'lucide-react'
import { checkWorkspaceUrl, checkDateRange } from '@/lib/workspace-validation'

interface WorkspaceDialogProps {
  onSuccess: () => void
  userRole?: string
  /** Заблокированный VOL с уже одним пространством не может добавить ещё */
  disableAddButton?: boolean
  /** Подсказка при неактивной кнопке */
  disabledReason?: string
  triggerClassName?: string
  triggerVariant?: ComponentProps<typeof Button>['variant']
  triggerSize?: ComponentProps<typeof Button>['size']
  triggerLabel?: string
  /** Без кнопки — открытие с родителя */
  hideTrigger?: boolean
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

const EMPTY_FORM = {
  workspaceName: '',
  workspaceUrl: '',
  username: '',
  password: '',
  personalToken: '',
  rcUserId: '',
  has2FA: false,
  startDate: '',
  endDate: '',
}

type FieldKey = 'workspaceName' | 'workspaceUrl' | 'username' | 'password' | 'rcUserId' | 'personalToken' | 'totpCode' | 'endDate'

export function WorkspaceDialog({
  onSuccess,
  disableAddButton = false,
  disabledReason,
  triggerClassName,
  triggerVariant,
  triggerSize = 'sm',
  triggerLabel = 'Добавить пространство',
  hideTrigger = false,
  open: controlledOpen,
  onOpenChange: onControlledOpenChange,
}: WorkspaceDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = controlledOpen !== undefined && onControlledOpenChange !== undefined
  const open = isControlled ? controlledOpen! : internalOpen
  const setDialogOpen = (v: boolean) => {
    if (isControlled) onControlledOpenChange!(v)
    else setInternalOpen(v)
  }
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState(EMPTY_FORM)
  const [authMethod, setAuthMethod] = useState<'password' | 'personal_token'>('password')
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const totpRef = useRef<HTMLInputElement>(null)

  const touch = (k: FieldKey) => setTouched((t) => ({ ...t, [k]: true }))

  // Ошибки по полям (показываются после ухода из поля или попытки отправки)
  const urlCheck = checkWorkspaceUrl(formData.workspaceUrl)
  const showTotp = authMethod === 'password' && (needsTotp || formData.has2FA)
  const errors: Partial<Record<FieldKey, string>> = {
    workspaceName: !formData.workspaceName.trim() ? 'Введите название пространства' : undefined,
    workspaceUrl: urlCheck.error,
    username: !formData.username.trim()
      ? authMethod === 'password'
        ? 'Введите логин Rocket.Chat'
        : 'Введите логин Rocket.Chat (username)'
      : undefined,
    password: authMethod === 'password' && !formData.password ? 'Введите пароль' : undefined,
    rcUserId: authMethod === 'personal_token' && !formData.rcUserId.trim() ? 'Укажите User ID из профиля Rocket.Chat' : undefined,
    personalToken: authMethod === 'personal_token' && !formData.personalToken.trim() ? 'Вставьте личный токен доступа' : undefined,
    totpCode: needsTotp && authMethod === 'password' && !totpCode.trim() ? 'Введите код из приложения-аутентификатора' : undefined,
    endDate: checkDateRange(formData.startDate, formData.endDate),
  }
  const visibleError = (k: FieldKey) => (touched[k] ? errors[k] : undefined)

  const resetAll = () => {
    setFormData(EMPTY_FORM)
    setAuthMethod('password')
    setTotpCode('')
    setNeedsTotp(false)
    setTouched({})
    setFormError(null)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const relevant: FieldKey[] =
      authMethod === 'password'
        ? ['workspaceName', 'workspaceUrl', 'username', 'password', 'totpCode', 'endDate']
        : ['workspaceName', 'workspaceUrl', 'username', 'rcUserId', 'personalToken', 'endDate']
    setTouched((t) => ({ ...t, ...Object.fromEntries(relevant.map((k) => [k, true])) }))

    const firstInvalid = relevant.find((k) => errors[k])
    if (firstInvalid) {
      toast.error('Проверьте форму', { description: 'Исправьте поля, отмеченные красным.' })
      if (firstInvalid === 'totpCode') totpRef.current?.focus()
      else document.getElementById(firstInvalid)?.focus()
      return
    }

    setIsSubmitting(true)
    const toastId = toast.loading('Подключаемся к Rocket.Chat…')

    try {
      const body: Record<string, unknown> = {
        workspaceName: formData.workspaceName.trim(),
        workspaceUrl: formData.workspaceUrl.trim(),
        username: formData.username.trim(),
        has2FA: formData.has2FA,
        startDate: formData.startDate,
        endDate: formData.endDate,
        authMethod,
      }
      if (authMethod === 'password') {
        body.password = formData.password
        if (totpCode.trim()) body.totpCode = totpCode.trim()
      } else {
        body.personalToken = formData.personalToken.trim()
        body.rcUserId = formData.rcUserId.trim()
      }

      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })

      const data = await response.json()

      if (response.status === 400 && data.requiresTotp) {
        setNeedsTotp(true)
        toast.message('Нужен код 2FA', {
          id: toastId,
          description: 'Введите 6 цифр из приложения-аутентификатора и нажмите «Подключить» снова.',
        })
        setTimeout(() => totpRef.current?.focus(), 50)
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to connect workspace')
      }

      resetAll()
      setDialogOpen(false)
      toast.success('Пространство подключено', {
        id: toastId,
        description: 'Теперь в нём можно планировать сообщения.',
      })
      onSuccess()
    } catch (error) {
      const message = (error instanceof Error && error.message) || 'Ошибка при подключении пространства'
      setFormError(message)
      toast.error('Не удалось подключить пространство', {
        id: toastId,
        description: message,
      })
    } finally {
      setIsSubmitting(false)
    }
  }

  const urlHint = urlCheck.warning
    ? urlCheck.warning
    : 'Для 21-school добавьте путь /rocketchat, например https://rocketchat-yar-mar-26.21-school.ru/rocketchat'

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isControlled && disableAddButton) return
        if (!o && isSubmitting) return
        setDialogOpen(o)
        if (!o) {
          setNeedsTotp(false)
          setTotpCode('')
          setAuthMethod('password')
          setTouched({})
          setFormError(null)
        }
      }}
    >
      {!hideTrigger && (
        <DialogTrigger asChild>
          <Button
            size={triggerSize}
            variant={triggerVariant}
            className={triggerClassName}
            disabled={disableAddButton}
            title={disableAddButton ? disabledReason : undefined}
          >
            <Plus aria-hidden />
            {triggerLabel}
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[560px]">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader className="border-b px-5 py-4 sm:px-6">
            <DialogTitle>Добавить пространство</DialogTitle>
            <DialogDescription>
              Подключите пространство Rocket.Chat, чтобы планировать в нём отложенные сообщения.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-5 py-5 sm:px-6">
            {formError && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>
                  <p>{formError}</p>
                  <p className="text-xs opacity-90">Проверьте адрес и данные для входа и попробуйте ещё раз.</p>
                </AlertDescription>
              </Alert>
            )}

            <p className="flex items-start gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs text-muted-foreground">
              <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden />
              <span>
                Под тестовыми пользователями можно заходить только с разрешения администратора. Подключение с
                учётными данными, уже используемыми другим пользователем, запрещено.
              </span>
            </p>

            {/* 1. Пространство */}
            <fieldset className="space-y-4" disabled={isSubmitting}>
              <legend className="mb-3 text-sm font-semibold">1. Пространство</legend>

              <Field label="Название" htmlFor="workspaceName" required error={visibleError('workspaceName')}>
                <Input
                  id="workspaceName"
                  value={formData.workspaceName}
                  onChange={(e) => setFormData({ ...formData, workspaceName: e.target.value })}
                  onBlur={() => touch('workspaceName')}
                  aria-invalid={!!visibleError('workspaceName')}
                  placeholder="Например, Интенсив март 2026"
                  autoComplete="off"
                />
              </Field>

              <Field
                label="Адрес сервера (URL)"
                htmlFor="workspaceUrl"
                required
                error={visibleError('workspaceUrl')}
                hint={urlHint}
              >
                <Input
                  id="workspaceUrl"
                  type="url"
                  inputMode="url"
                  value={formData.workspaceUrl}
                  onChange={(e) => setFormData({ ...formData, workspaceUrl: e.target.value })}
                  onBlur={() => touch('workspaceUrl')}
                  aria-invalid={!!visibleError('workspaceUrl')}
                  placeholder="https://rocketchat.example.com"
                  className="font-mono text-[13px]"
                  autoComplete="off"
                  spellCheck={false}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Дата начала" htmlFor="startDate" hint="Необязательно">
                  <DatePicker
                    id="startDate"
                    value={formData.startDate}
                    onChange={(v) => setFormData((f) => ({ ...f, startDate: v }))}
                    shortcuts={false}
                    clearable
                  />
                </Field>
                <Field
                  label="Дата окончания"
                  htmlFor="endDate"
                  hint="Необязательно"
                  error={errors.endDate}
                >
                  <DatePicker
                    id="endDate"
                    value={formData.endDate}
                    onChange={(v) => {
                      setFormData((f) => ({ ...f, endDate: v }))
                      touch('endDate')
                    }}
                    min={formData.startDate || undefined}
                    shortcuts={false}
                    clearable
                    invalid={!!errors.endDate}
                  />
                </Field>
              </div>
            </fieldset>

            {/* 2. Вход в Rocket.Chat */}
            <fieldset className="space-y-4" disabled={isSubmitting}>
              <legend className="mb-3 flex items-center gap-1.5 text-sm font-semibold">
                2. Вход в Rocket.Chat
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      type="button"
                      className="inline-flex rounded-sm text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                      aria-label="Чем отличаются LDAP и токен"
                    >
                      <CircleHelp className="size-4 shrink-0" aria-hidden />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" align="start" className="max-w-sm space-y-2 text-left">
                    <p>
                      <strong>LDAP / пароль</strong> — как в веб-клиенте Rocket.Chat: логин и пароль от учётной записи
                      (в том числе LDAP). Если включена 2FA, может понадобиться одноразовый код.
                    </p>
                    <p>
                      <strong>Личный токен</strong> — создаётся в Rocket.Chat в разделе «Токены для личного доступа».
                      Нужны токен и ваш User ID из профиля. При выпуске токена можно разрешить использование без 2FA.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </legend>

              <Field label="Логин в Rocket.Chat" htmlFor="username" required error={visibleError('username')}>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  onBlur={() => touch('username')}
                  aria-invalid={!!visibleError('username')}
                  placeholder="Ваш логин"
                  autoComplete="off"
                />
              </Field>

              <Tabs
                value={authMethod}
                onValueChange={(v) => {
                  const m = v as 'password' | 'personal_token'
                  setAuthMethod(m)
                  setNeedsTotp(false)
                  setFormError(null)
                  if (m === 'personal_token') setTotpCode('')
                }}
                className="w-full"
              >
                <TabsList className="grid h-auto w-full grid-cols-2 p-1">
                  <TabsTrigger value="password">LDAP / пароль</TabsTrigger>
                  <TabsTrigger value="personal_token">Личный токен</TabsTrigger>
                </TabsList>
                <TabsContent value="password" className="mt-4 space-y-4 outline-none">
                  <Field
                    label="Пароль"
                    htmlFor="password"
                    required
                    error={visibleError('password')}
                    hint="Пароль хранится в зашифрованном виде и нужен только для подключения к Rocket.Chat."
                  >
                    <PasswordInput
                      id="password"
                      value={formData.password}
                      onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                      onBlur={() => touch('password')}
                      aria-invalid={!!visibleError('password')}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </Field>

                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="has2FA"
                      checked={formData.has2FA}
                      onCheckedChange={(checked) => setFormData({ ...formData, has2FA: checked === true })}
                    />
                    <Label htmlFor="has2FA" className="cursor-pointer text-sm font-normal leading-snug">
                      В Rocket.Chat включена двухфакторная аутентификация
                    </Label>
                  </div>

                  {showTotp && (
                    <Field
                      label="Код 2FA"
                      htmlFor="totpCode"
                      error={visibleError('totpCode')}
                      hint="Код из приложения-аутентификатора. Если Rocket.Chat его запросил, введите код и снова нажмите «Подключить»."
                    >
                      <Input
                        id="totpCode"
                        ref={totpRef}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        onBlur={() => touch('totpCode')}
                        aria-invalid={!!visibleError('totpCode')}
                        className="max-w-[160px] font-mono tracking-widest"
                      />
                    </Field>
                  )}
                </TabsContent>
                <TabsContent value="personal_token" className="mt-4 space-y-4 outline-none">
                  <Field
                    label="User ID в Rocket.Chat"
                    htmlFor="rcUserId"
                    required
                    error={visibleError('rcUserId')}
                    hint="Профиль → «Мой аккаунт» → идентификатор пользователя. Без него токен не сработает."
                  >
                    <Input
                      id="rcUserId"
                      value={formData.rcUserId}
                      onChange={(e) => setFormData({ ...formData, rcUserId: e.target.value })}
                      onBlur={() => touch('rcUserId')}
                      aria-invalid={!!visibleError('rcUserId')}
                      placeholder="Например, aBcD1234eFgH5678"
                      className="font-mono text-[13px]"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Личный токен доступа"
                    htmlFor="personalToken"
                    required
                    error={visibleError('personalToken')}
                    hint="Создаётся в разделе «Токены для личного доступа» в Rocket.Chat."
                  >
                    <PasswordInput
                      id="personalToken"
                      value={formData.personalToken}
                      onChange={(e) => setFormData({ ...formData, personalToken: e.target.value })}
                      onBlur={() => touch('personalToken')}
                      aria-invalid={!!visibleError('personalToken')}
                      placeholder="Вставьте токен"
                      className="font-mono text-[13px]"
                      autoComplete="off"
                    />
                  </Field>
                </TabsContent>
              </Tabs>
            </fieldset>
          </div>

          <DialogFooter className="border-t bg-muted/30 px-5 py-3 sm:px-6">
            <Button
              type="button"
              variant="outline"
              onClick={() => setDialogOpen(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
              {isSubmitting ? 'Подключение…' : 'Подключить'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
