import type { ReactNode } from 'react'
import { cn } from '@/lib/utils'

/**
 * Единый заголовок страницы: [хлебные крошки] → название + описание слева, действия справа.
 * Использовать на всех страницах /dashboard/* вместо самодельных «hero»-блоков.
 */
export function PageHeader({
  title,
  description,
  actions,
  breadcrumbs,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  actions?: ReactNode
  breadcrumbs?: ReactNode
  className?: string
}) {
  return (
    <header className={cn('space-y-3 pb-5', className)}>
      {breadcrumbs}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <h1 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">{title}</h1>
          {description && <p className="max-w-2xl text-sm text-muted-foreground text-pretty">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </header>
  )
}

/** Контейнер страницы: единая максимальная ширина и вертикальный ритм. */
export function PageContainer({
  children,
  className,
  size = 'default',
}: {
  children: ReactNode
  className?: string
  size?: 'narrow' | 'default' | 'wide'
}) {
  return (
    <div
      className={cn(
        'mx-auto w-full py-6 lg:py-8',
        size === 'narrow' && 'max-w-3xl',
        size === 'default' && 'max-w-5xl',
        size === 'wide' && 'max-w-7xl',
        className,
      )}
    >
      {children}
    </div>
  )
}
