import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

type NoticeTone = 'neutral' | 'warning' | 'danger' | 'info'

const ICON_TONE: Record<NoticeTone, string> = {
  neutral: 'text-muted-foreground',
  info: 'text-sky-600 dark:text-sky-400',
  warning: 'text-amber-600 dark:text-amber-400',
  danger: 'text-destructive',
}

/**
 * Плоское уведомление над контентом: нейтральный фон, цветной только значок.
 * Заголовок + пояснение слева, действие справа (на узких экранах — снизу).
 */
export function Notice({
  icon,
  title,
  children,
  action,
  tone = 'neutral',
  className,
}: {
  icon: ReactNode
  title: ReactNode
  children?: ReactNode
  action?: ReactNode
  tone?: NoticeTone
  className?: string
}) {
  return (
    <div
      role="status"
      className={cn(
        'flex flex-col gap-3 rounded-lg border bg-card px-4 py-3 sm:flex-row sm:items-start sm:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <span className={cn('mt-0.5 shrink-0 [&>svg]:size-4', ICON_TONE[tone])} aria-hidden>
          {icon}
        </span>
        <div className="min-w-0 space-y-0.5">
          <p className="text-sm font-medium text-foreground">{title}</p>
          {children && <div className="text-[13px] text-muted-foreground text-pretty">{children}</div>}
        </div>
      </div>
      {action && <div className="shrink-0 sm:pl-4">{action}</div>}
    </div>
  )
}
