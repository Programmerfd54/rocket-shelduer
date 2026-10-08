import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Секция страницы/настроек: заголовок + пояснение слева, содержимое — в плоской карточке с рамкой.
 * Вместо цветных «пастельных» блоков с иконками. `bare` — без рамки (для таблиц/списков во всю ширину).
 */
export function Section({
  title,
  description,
  actions,
  children,
  bare = false,
  className,
  id,
}: {
  title?: ReactNode
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  bare?: boolean
  className?: string
  id?: string
}) {
  return (
    <section id={id} className={cn('space-y-3', className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-0.5">
            {title && <h2 className="text-sm font-semibold text-foreground">{title}</h2>}
            {description && <p className="text-[13px] text-muted-foreground text-pretty">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      {bare ? children : <div className="rounded-lg border bg-card p-4 sm:p-5">{children}</div>}
    </section>
  )
}
