"use client"

import { useState, useEffect } from 'react'
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
import { Settings, Loader2, Archive, CircleHelp, CircleAlert } from 'lucide-react'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { checkWorkspaceUrl, checkDateRange } from '@/lib/workspace-validation'

interface WorkspaceEditDialogProps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  workspace: any
  onSuccess: () => void
  /** Внешнее управление открытием (например, кнопка «Настройки» на карточке в списке) */
  open?: boolean
  onOpenChange?: (open: boolean) => void
}

type FieldKey = 'workspaceName' | 'workspaceUrl' | 'username' | 'rcUserId' | 'endDate'

function toYmd(value: unknown): string {
  return value ? new Date(value as string).toISOString().split('T')[0] : ''
}

export function WorkspaceEditDialog({
  workspace,
  onSuccess,
  open: openProp,
  onOpenChange: onOpenChangeProp,
}: WorkspaceEditDialogProps) {
  const [internalOpen, setInternalOpen] = useState(false)
  const isControlled = openProp !== undefined
  const open = isControlled ? openProp : internalOpen
  const setOpen = (next: boolean) => {
    if (isControlled) onOpenChangeProp?.(next)
    else setInternalOpen(next)
  }
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [credentialTab, setCredentialTab] = useState<'password' | 'personal_token'>(() =>
    workspace.rcAuthMethod === 'personal_token' ? 'personal_token' : 'password'
  )
  const [totpCode, setTotpCode] = useState('')
  const [needsTotp, setNeedsTotp] = useState(false)
  const [touched, setTouched] = useState<Partial<Record<FieldKey, boolean>>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [formData, setFormData] = useState({
    workspaceName: workspace.workspaceName,
    workspaceUrl: workspace.workspaceUrl,
    username: workspace.username,
    password: '',
    personalToken: '',
    rcUserId: workspace.userId_RC ?? '',
    has2FA: workspace.has2FA,
    startDate: toYmd(workspace.startDate),
    endDate: toYmd(workspace.endDate),
  })

  useEffect(() => {
    setFormData({
      workspaceName: workspace.workspaceName,
      workspaceUrl: workspace.workspaceUrl,
      username: workspace.username,
      password: '',
      personalToken: '',
      rcUserId: workspace.userId_RC ?? '',
      has2FA: workspace.has2FA,
      startDate: toYmd(workspace.startDate),
      endDate: toYmd(workspace.endDate),
    })
    setTotpCode('')
    setNeedsTotp(false)
    setTouched({})
    setFormError(null)
    setCredentialTab(workspace.rcAuthMethod === 'personal_token' ? 'personal_token' : 'password')
  }, [
    workspace.id,
    workspace.workspaceName,
    workspace.workspaceUrl,
    workspace.username,
    workspace.has2FA,
    workspace.rcAuthMethod,
    workspace.userId_RC,
    workspace.startDate,
    workspace.endDate,
  ])

  const touch = (k: FieldKey) => setTouched((t) => ({ ...t, [k]: true }))

  const tokenNew = formData.personalToken.trim()
  const passNew = formData.password
  const effectiveUserId = (formData.rcUserId.trim() || workspace.userId_RC || '').trim()
  const urlCheck = checkWorkspaceUrl(formData.workspaceUrl)

  const errors: Partial<Record<FieldKey, string>> = {
    workspaceName: !formData.workspaceName.trim() ? 'Введите название пространства' : undefined,
    workspaceUrl: urlCheck.error,
    username: !formData.username.trim() ? 'Введите логин Rocket.Chat' : undefined,
    rcUserId: tokenNew && !effectiveUserId ? 'Укажите User ID Rocket.Chat для проверки токена' : undefined,
    endDate: checkDateRange(formData.startDate, formData.endDate),
  }
  const bothSecrets = !!tokenNew && !!passNew
  const visibleError = (k: FieldKey) => (touched[k] ? errors[k] : undefined)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setFormError(null)

    const keys: FieldKey[] = ['workspaceName', 'workspaceUrl', 'username', 'rcUserId', 'endDate']
    setTouched(Object.fromEntries(keys.map((k) => [k, true])))

    if (bothSecrets) {
      const msg = 'Укажите либо новый пароль, либо новый личный токен — не оба сразу.'
      setFormError(msg)
      toast.error('Проверьте форму', { description: msg })
      return
    }
    const firstInvalid = keys.find((k) => errors[k])
    if (firstInvalid) {
      toast.error('Проверьте форму', { description: 'Исправьте поля, отмеченные красным.' })
      const idMap: Record<FieldKey, string> = {
        workspaceName: 'workspaceName',
        workspaceUrl: 'workspaceUrl',
        username: 'username',
        rcUserId: 'edit-rcuid',
        endDate: 'endDate',
      }
      if (firstInvalid === 'rcUserId') setCredentialTab('personal_token')
      setTimeout(() => document.getElementById(idMap[firstInvalid])?.focus(), 50)
      return
    }

    setIsSubmitting(true)

    try {
      const updateData: Record<string, unknown> = {
        workspaceName: formData.workspaceName.trim(),
        workspaceUrl: formData.workspaceUrl.trim(),
        username: formData.username.trim(),
        has2FA: formData.has2FA,
      }

      if (tokenNew) {
        updateData.personalToken = tokenNew
        updateData.rcUserId = effectiveUserId
      } else if (passNew) {
        updateData.password = passNew
        if (totpCode.trim()) updateData.totpCode = totpCode.trim()
      }

      // Добавляем даты интенсива
      if (formData.startDate) {
        updateData.startDate = formData.startDate
      }
      if (formData.endDate) {
        updateData.endDate = formData.endDate
      }

      const response = await fetch(`/api/workspace/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      const data = await response.json()

      if (response.status === 400 && data.requiresTotp) {
        setNeedsTotp(true)
        toast.message('Нужен код 2FA', {
          description: 'Введите код из приложения-аутентификатора и снова нажмите «Сохранить».',
        })
        return
      }

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update workspace')
      }

      setOpen(false)
      setTotpCode('')
      setNeedsTotp(false)
      toast.success('Изменения сохранены', { description: `Пространство «${formData.workspaceName.trim()}» обновлено.` })
      onSuccess()
    } catch (error) {
      const message = (error instanceof Error && error.message) || 'Ошибка обновления'
      setFormError(message)
      toast.error('Не удалось сохранить изменения', { description: message })
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleArchive = async () => {
    setIsArchiving(true)
    try {
      const response = await fetch(`/api/workspace/${workspace.id}/archive`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to archive workspace')
      }

      setShowArchiveDialog(false)
      setOpen(false)
      toast.success('Пространство заархивировано', {
        description: 'Оно будет удалено через 2 недели. Вы можете восстановить его в разделе Архивы.'
      })
      onSuccess()
    } catch (error) {
      toast.error('Не удалось заархивировать пространство', {
        description: (error instanceof Error && error.message) || 'Повторите попытку позже.',
      })
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && isSubmitting) return
        setOpen(next)
        if (!next) {
          setTotpCode('')
          setNeedsTotp(false)
          setTouched({})
          setFormError(null)
          setCredentialTab(workspace.rcAuthMethod === 'personal_token' ? 'personal_token' : 'password')
        }
      }}
    >
      {!isControlled && (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm">
            <Settings aria-hidden />
            Настройки
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-h-[92vh] gap-0 overflow-y-auto p-0 sm:max-w-[540px]">
        <form onSubmit={handleSubmit} noValidate>
          <DialogHeader className="border-b px-5 py-4 sm:px-6">
            <DialogTitle>Настройки пространства</DialogTitle>
            <DialogDescription>
              Название, адрес, даты интенсива и данные для входа в Rocket.Chat.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-6 px-5 py-5 sm:px-6">
            {formError && (
              <Alert variant="destructive">
                <CircleAlert aria-hidden />
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <fieldset className="space-y-4" disabled={isSubmitting}>
              <legend className="mb-3 text-sm font-semibold">Пространство</legend>

              <Field label="Название" htmlFor="workspaceName" required error={visibleError('workspaceName')}>
                <Input
                  id="workspaceName"
                  value={formData.workspaceName}
                  onChange={(e) => setFormData({ ...formData, workspaceName: e.target.value })}
                  onBlur={() => touch('workspaceName')}
                  aria-invalid={!!visibleError('workspaceName')}
                  placeholder="Моё пространство"
                />
              </Field>

              <Field
                label="Адрес сервера (URL)"
                htmlFor="workspaceUrl"
                required
                error={visibleError('workspaceUrl')}
                hint={urlCheck.warning}
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
                  spellCheck={false}
                />
              </Field>

              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Начало интенсива" htmlFor="startDate">
                  <DatePicker
                    id="startDate"
                    value={formData.startDate}
                    onChange={(v) => setFormData((f) => ({ ...f, startDate: v }))}
                    shortcuts={false}
                  />
                </Field>
                <Field label="Окончание интенсива" htmlFor="endDate" error={errors.endDate}>
                  <DatePicker
                    id="endDate"
                    value={formData.endDate}
                    onChange={(v) => setFormData((f) => ({ ...f, endDate: v }))}
                    min={formData.startDate || undefined}
                    shortcuts={false}
                    invalid={!!errors.endDate}
                  />
                </Field>
              </div>
            </fieldset>

            <fieldset className="space-y-4" disabled={isSubmitting}>
              <legend className="mb-1 flex items-center gap-1.5 text-sm font-semibold">
                Вход в Rocket.Chat
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
                      <strong>LDAP / пароль</strong> — новый пароль от Rocket.Chat (как в веб-клиенте). При 2FA в
                      Rocket.Chat может понадобиться код после сохранения.
                    </p>
                    <p>
                      <strong>Личный токен</strong> — новый токен из «Токены для личного доступа» и User ID из
                      профиля. Не заполняйте пароль и токен в одном сохранении.
                    </p>
                  </TooltipContent>
                </Tooltip>
              </legend>

              <p className="text-[13px] text-muted-foreground">
                Сейчас вход выполняется через{' '}
                <span className="font-medium text-foreground">
                  {workspace.rcAuthMethod === 'personal_token' ? 'личный токен' : 'логин и пароль (LDAP)'}
                </span>
                . Чтобы сменить данные, заполните одну из вкладок; пустые поля оставляют всё как есть.
              </p>

              <Field label="Логин в Rocket.Chat" htmlFor="username" required error={visibleError('username')}>
                <Input
                  id="username"
                  value={formData.username}
                  onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                  onBlur={() => touch('username')}
                  aria-invalid={!!visibleError('username')}
                  placeholder="username"
                  autoComplete="off"
                />
              </Field>

              <Tabs
                value={credentialTab}
                onValueChange={(v) => {
                  const t = v as 'password' | 'personal_token'
                  setCredentialTab(t)
                  if (needsTotp) setNeedsTotp(false)
                  if (t === 'personal_token') setTotpCode('')
                }}
                className="w-full"
              >
                <TabsList className="grid h-auto w-full grid-cols-2 p-1">
                  <TabsTrigger value="password">LDAP / пароль</TabsTrigger>
                  <TabsTrigger value="personal_token">Личный токен</TabsTrigger>
                </TabsList>
                <TabsContent value="password" className="mt-4 space-y-4 outline-none">
                  <Field
                    label="Новый пароль (LDAP)"
                    htmlFor="edit-password"
                    hint="Оставьте пустым, если пароль не меняете."
                  >
                    <PasswordInput
                      id="edit-password"
                      value={formData.password}
                      onChange={(e) => {
                        setFormData({ ...formData, password: e.target.value })
                        if (needsTotp) setNeedsTotp(false)
                      }}
                      placeholder="••••••••"
                      autoComplete="new-password"
                    />
                  </Field>
                  {(needsTotp || (formData.password.length > 0 && formData.has2FA)) && (
                    <Field label="Код 2FA" htmlFor="edit-totp" hint="Если Rocket.Chat запросит второй фактор.">
                      <Input
                        id="edit-totp"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        placeholder="000000"
                        value={totpCode}
                        onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 8))}
                        className="max-w-[160px] font-mono tracking-widest"
                      />
                    </Field>
                  )}
                  {((workspace.rcAuthMethod !== 'personal_token' || formData.password.length > 0) &&
                    !formData.personalToken.trim()) && (
                    <div className="flex items-center gap-2">
                      <Checkbox
                        id="has2FA"
                        checked={formData.has2FA}
                        onCheckedChange={(checked) => setFormData({ ...formData, has2FA: checked === true })}
                      />
                      <Label htmlFor="has2FA" className="cursor-pointer text-sm font-normal">
                        В Rocket.Chat включена двухфакторная аутентификация
                      </Label>
                    </div>
                  )}
                </TabsContent>
                <TabsContent value="personal_token" className="mt-4 space-y-4 outline-none">
                  <Field
                    label="User ID Rocket.Chat"
                    htmlFor="edit-rcuid"
                    required={!!tokenNew}
                    error={visibleError('rcUserId')}
                    hint="Из профиля Rocket.Chat. Нужен, если вы меняете токен."
                  >
                    <Input
                      id="edit-rcuid"
                      value={formData.rcUserId}
                      onChange={(e) => setFormData({ ...formData, rcUserId: e.target.value })}
                      onBlur={() => touch('rcUserId')}
                      aria-invalid={!!visibleError('rcUserId')}
                      placeholder="Из профиля Rocket.Chat"
                      className="font-mono text-[13px]"
                      autoComplete="off"
                      spellCheck={false}
                    />
                  </Field>
                  <Field
                    label="Новый личный токен"
                    htmlFor="edit-pat"
                    hint="После сохранения способ входа станет «личный токен»; 2FA в планировщике для этого подключения отключается."
                  >
                    <PasswordInput
                      id="edit-pat"
                      value={formData.personalToken}
                      onChange={(e) => setFormData({ ...formData, personalToken: e.target.value })}
                      placeholder="Токен личного доступа"
                      className="font-mono text-[13px]"
                      autoComplete="off"
                    />
                  </Field>
                </TabsContent>
              </Tabs>

              {bothSecrets && (
                <p role="alert" className="text-xs text-destructive">
                  Заполнены и пароль, и токен. Оставьте что-то одно.
                </p>
              )}
            </fieldset>
          </div>

          <DialogFooter className="flex-col gap-2 border-t bg-muted/30 px-5 py-3 sm:flex-row sm:items-center sm:px-6">
            {!workspace.isArchived && (
              <Button
                type="button"
                variant="ghost"
                onClick={() => setShowArchiveDialog(true)}
                disabled={isSubmitting}
                className="w-full text-destructive hover:bg-destructive/10 hover:text-destructive sm:mr-auto sm:w-auto"
              >
                <Archive aria-hidden />
                Архивировать
              </Button>
            )}
            <div className="flex gap-2 sm:ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
                className="flex-1 sm:flex-none"
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting} className="flex-1 sm:flex-none">
                {isSubmitting && <Loader2 className="animate-spin" aria-hidden />}
                {isSubmitting ? 'Сохранение…' : 'Сохранить'}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>

      <ConfirmDialog
        open={showArchiveDialog}
        onOpenChange={setShowArchiveDialog}
        title="Архивировать пространство?"
        description={
          <>
            Пространство <strong className="font-medium text-foreground">{workspace.workspaceName}</strong> будет
            перемещено в архив.
          </>
        }
        confirmLabel={isArchiving ? 'Архивация…' : 'В архив'}
        destructive
        loading={isArchiving}
        onConfirm={handleArchive}
      >
        <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
          <li>Все запланированные сообщения будут отменены.</li>
          <li>Пространство станет недоступным для использования.</li>
          <li>
            Через 2 недели данные будут <strong className="font-medium text-foreground">безвозвратно удалены</strong>,
            включая историю сообщений и каналов.
          </li>
          <li>До этого срока пространство можно восстановить в разделе «Архивы».</li>
        </ul>
      </ConfirmDialog>
    </Dialog>
  )
}
