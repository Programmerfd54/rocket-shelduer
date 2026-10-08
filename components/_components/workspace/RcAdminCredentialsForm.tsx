"use client"

import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Button } from '@/components/ui/button'
import type { RcAdminCredentials } from '@/lib/rc-admin-credentials'

export function RcAdminCredentialsForm({ value, onChange, disabled }: {
  value: RcAdminCredentials
  onChange: (value: RcAdminCredentials) => void
  disabled?: boolean
}) {
  const update = (field: keyof RcAdminCredentials, text: string) => onChange({ ...value, [field]: text })
  return (
    <div className="space-y-3">
      <div role="group" className="inline-flex flex-wrap gap-1.5" aria-label="Способ входа администратора Rocket.Chat">
        <Button type="button" size="sm" disabled={disabled} variant={value.adminAuthMethod === 'password' ? 'default' : 'outline'}
          aria-pressed={value.adminAuthMethod === 'password'} onClick={() => update('adminAuthMethod', 'password')}>Логин и пароль</Button>
        <Button type="button" size="sm" disabled={disabled} variant={value.adminAuthMethod === 'personal_token' ? 'default' : 'outline'}
          aria-pressed={value.adminAuthMethod === 'personal_token'} onClick={() => update('adminAuthMethod', 'personal_token')}>Личный токен / SSO</Button>
      </div>
      {value.adminAuthMethod === 'password' ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Логин администратора Rocket.Chat" htmlFor="users-admin-username">
              <Input id="users-admin-username" value={value.adminUsername} onChange={event => update('adminUsername', event.target.value)} disabled={disabled} autoComplete="username" />
            </Field>
            <Field label="Пароль Rocket.Chat" htmlFor="users-admin-password">
              <Input id="users-admin-password" type="password" value={value.adminPassword} onChange={event => update('adminPassword', event.target.value)} disabled={disabled} autoComplete="current-password" />
            </Field>
          </div>
          <Field label="Код 2FA, если включён" htmlFor="users-admin-totp" className="sm:max-w-xs">
            <Input id="users-admin-totp" value={value.adminTotpCode} onChange={event => update('adminTotpCode', event.target.value)} disabled={disabled} autoComplete="one-time-code" placeholder="Необязательно" inputMode="numeric" />
          </Field>
          <p className="text-xs text-muted-foreground">Укажите учётные данные этого пространства Rocket.Chat. Если входите через корпоративную кнопку SSO, выберите личный токен.</p>
        </>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="User ID владельца токена" htmlFor="users-admin-user-id">
              <Input id="users-admin-user-id" className="font-mono" value={value.adminUserId} onChange={event => update('adminUserId', event.target.value)} disabled={disabled} autoComplete="off" />
            </Field>
            <Field label="Личный токен доступа" htmlFor="users-admin-token">
              <Input id="users-admin-token" type="password" value={value.adminPersonalToken} onChange={event => update('adminPersonalToken', event.target.value)} disabled={disabled} autoComplete="off" />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">В Rocket.Chat откройте профиль → «Личные токены доступа». Используйте токен и User ID администратора этого пространства.</p>
        </>
      )}
    </div>
  )
}
