"use client"

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Spinner } from '@/components/ui/spinner'

type Method = 'password' | 'personal_token'

/**
 * Подключение для пользователя, назначенного на пространство без своего входа в Rocket.Chat.
 * Закрыть нельзя: нужно либо подтвердить подключение, либо отказаться от назначения.
 */
export function ConfirmAssignmentDialog({
  open,
  workspaceId,
  leaving,
  onClose,
  onLeave,
}: {
  open: boolean
  workspaceId: string
  /** Идёт отказ от назначения (запрос выполняет родитель) */
  leaving: boolean
  onClose: () => void
  onLeave: () => void
}) {
  const router = useRouter()
  const [method, setMethod] = useState<Method>('password')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [token, setToken] = useState('')
  const [rcUserId, setRcUserId] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!open) return
    setMethod('password')
    setUsername('')
    setPassword('')
    setToken('')
    setRcUserId('')
    setSubmitted(false)
  }, [open])

  const errors = {
    username: !username.trim() ? 'Укажите логин Rocket.Chat.' : '',
    password: method === 'password' && !password ? 'Укажите пароль.' : '',
    rcUserId: method === 'personal_token' && !rcUserId.trim() ? 'Укажите User ID из профиля Rocket.Chat.' : '',
    token: method === 'personal_token' && !token.trim() ? 'Укажите личный токен доступа.' : '',
  }
  const valid = !errors.username && !errors.password && !errors.rcUserId && !errors.token
  const show = (key: keyof typeof errors) => (submitted ? errors[key] : '')
  const busy = loading || leaving

  const submit = async () => {
    setSubmitted(true)
    if (!valid) return
    setLoading(true)
    const toastId = 'confirm-assignment'
    toast.loading('Подключаемся к Rocket.Chat…', { id: toastId })
    try {
      const body =
        method === 'password'
          ? { username: username.trim(), password }
          : { authMethod: 'personal_token' as const, username: username.trim(), personalToken: token.trim(), rcUserId: rcUserId.trim() }
      const res = await fetch(`/api/workspace/${workspaceId}/confirm-assignment`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.workspaceId) {
        toast.success('Подключение создано', { id: toastId })
        onClose()
        router.push(`/dashboard/workspaces/${data.workspaceId}`)
      } else {
        toast.error(data.error || 'Не удалось подключиться', {
          id: toastId,
          description: 'Проверьте логин и пароль (или токен) и повторите попытку.',
        })
      }
    } catch {
      toast.error('Не удалось подключиться', { id: toastId, description: 'Проверьте сеть и VPN, затем повторите.' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={() => {}}>
      <DialogContent
        className="w-[calc(100%-2rem)] max-w-md min-w-0"
        showCloseButton={false}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Подключитесь к пространству</DialogTitle>
          <DialogDescription>
            Вас назначили на это пространство. Войдите в Rocket.Chat логином и паролем (как в веб-клиенте, в том числе LDAP) или личным токеном — будет создано ваше подключение. Если хотите добавить пространство сами, откажитесь от назначения.
          </DialogDescription>
        </DialogHeader>

        <form
          className="min-w-0 space-y-4"
          onSubmit={(e) => {
            e.preventDefault()
            void submit()
          }}
        >
          <div role="group" aria-label="Способ входа" className="flex flex-wrap gap-1.5">
            <Button type="button" size="sm" variant={method === 'password' ? 'default' : 'outline'} aria-pressed={method === 'password'} onClick={() => setMethod('password')}>
              Логин и пароль
            </Button>
            <Button type="button" size="sm" variant={method === 'personal_token' ? 'default' : 'outline'} aria-pressed={method === 'personal_token'} onClick={() => setMethod('personal_token')}>
              Личный токен
            </Button>
          </div>

          <Field
            label={method === 'personal_token' ? 'Логин Rocket.Chat (для отображения)' : 'Логин Rocket.Chat'}
            htmlFor="confirm-assignment-username"
            required
            error={show('username')}
          >
            <Input
              id="confirm-assignment-username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="ваш логин"
              autoComplete="username"
              aria-invalid={!!show('username')}
              disabled={busy}
            />
          </Field>

          {method === 'password' ? (
            <Field label="Пароль" htmlFor="confirm-assignment-password" required error={show('password')}>
              <Input
                id="confirm-assignment-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="current-password"
                aria-invalid={!!show('password')}
                disabled={busy}
              />
            </Field>
          ) : (
            <>
              <Field
                label="User ID Rocket.Chat"
                htmlFor="confirm-assignment-rcuid"
                required
                error={show('rcUserId')}
                hint="Профиль → «Мой идентификатор пользователя»."
              >
                <Input
                  id="confirm-assignment-rcuid"
                  value={rcUserId}
                  onChange={(e) => setRcUserId(e.target.value)}
                  className="font-mono"
                  autoComplete="off"
                  aria-invalid={!!show('rcUserId')}
                  disabled={busy}
                />
              </Field>
              <Field
                label="Личный токен доступа"
                htmlFor="confirm-assignment-pat"
                required
                error={show('token')}
                hint="Профиль → «Личные токены доступа»."
              >
                <Input
                  id="confirm-assignment-pat"
                  type="password"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="font-mono"
                  autoComplete="off"
                  aria-invalid={!!show('token')}
                  disabled={busy}
                />
              </Field>
            </>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-between">
            <Button type="button" variant="outline" disabled={busy} onClick={onLeave}>
              {leaving && <Spinner />}
              Я сам добавлю пространство
            </Button>
            <Button type="submit" disabled={busy}>
              {loading && <Spinner />}
              Подтвердить назначение
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
