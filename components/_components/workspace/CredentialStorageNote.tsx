import { ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Как хранятся креды Rocket.Chat (показывается в формах подключения пространства). */
export const RC_PASSWORD_STORAGE_NOTE =
  'Пароль хранится в зашифрованном виде (AES-256-GCM) и используется только для автоматического обновления сессии Rocket.Chat; рекомендуем личный токен — тогда пароль не нужен.'

export const RC_TOKEN_RECOMMENDATION =
  'Личный токен можно в любой момент отозвать в Rocket.Chat («Мой аккаунт» → «Токены для личного доступа») — доступ планировщика сразу прекратится, пароль менять не нужно.'

export function CredentialStorageNote({ method, className }: { method: 'password' | 'personal_token'; className?: string }) {
  return (
    <p className={cn('flex gap-2 rounded-md border bg-muted/40 px-3 py-2 text-xs leading-relaxed text-muted-foreground', className)}>
      <ShieldCheck className="mt-0.5 size-3.5 shrink-0" aria-hidden />
      <span>{method === 'password' ? RC_PASSWORD_STORAGE_NOTE : RC_TOKEN_RECOMMENDATION}</span>
    </p>
  )
}
