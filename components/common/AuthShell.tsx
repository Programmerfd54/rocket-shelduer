import type { ReactNode } from 'react'
import { Send } from 'lucide-react'

/** Каркас страниц входа / регистрации / сброса пароля: по центру, плоская карточка. */
export function AuthShell({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description?: ReactNode
  children: ReactNode
  footer?: ReactNode
}) {
  return (
    <div className="auth-canvas flex min-h-screen flex-col items-center justify-center px-4 py-10">
      <div className="w-full max-w-[380px]">
        <div className="mb-6 flex items-center gap-2.5">
          <span className="flex h-8 w-8 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Send className="h-4 w-4" strokeWidth={2} aria-hidden />
          </span>
          <span className="text-sm font-semibold tracking-tight">RC Scheduler</span>
        </div>
        <div className="rounded-lg border bg-card p-6 sm:p-7">
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          <div className="mt-6">{children}</div>
        </div>
        {footer && <div className="mt-4 text-center text-sm text-muted-foreground">{footer}</div>}
      </div>
    </div>
  )
}
