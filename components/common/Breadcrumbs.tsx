"use client"

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

export type BreadcrumbItem = {
  label: string
  href?: string
  /** Текущая страница (не ссылка) */
  current?: boolean
}

interface BreadcrumbsProps {
  items: BreadcrumbItem[]
  className?: string
  /** Разделитель между элементами */
  separator?: React.ReactNode
}

export function Breadcrumbs({ items, className, separator = '/' }: BreadcrumbsProps) {
  return (
    <nav
      aria-label="Хлебные крошки"
      className={cn('flex items-center gap-1.5 text-sm text-muted-foreground flex-wrap', className)}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        const isCurrent = item.current ?? (isLast && !item.href)
        return (
          <span key={i} className="flex items-center gap-1.5">
            {i > 0 && (
              <span aria-hidden className="select-none text-muted-foreground/60">
                {separator}
              </span>
            )}
            {isCurrent || !item.href ? (
              <span
                className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none px-2.5 py-1 rounded-lg bg-muted/30"
                title={item.label}
              >
                {item.label}
              </span>
            ) : (
              <Button variant="ghost" size="sm" asChild className="hover:bg-muted/50 h-8 px-2.5 rounded-lg">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
