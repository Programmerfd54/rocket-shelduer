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
      className={cn('flex items-center gap-1 text-[13px] text-muted-foreground flex-wrap', className)}
    >
      {items.map((item, i) => {
        const isLast = i === items.length - 1
        const isCurrent = item.current ?? (isLast && !item.href)
        return (
          <span key={i} className="flex items-center gap-1">
            {i > 0 && (
              <span aria-hidden className="select-none text-muted-foreground/60">
                {separator}
              </span>
            )}
            {isCurrent || !item.href ? (
              <span
                className="font-medium text-foreground truncate max-w-[200px] sm:max-w-none px-1.5 py-0.5"
                title={item.label}
              >
                {item.label}
              </span>
            ) : (
              <Button variant="ghost" size="sm" asChild className="h-7 px-1.5 text-[13px] font-normal text-muted-foreground hover:text-foreground">
                <Link href={item.href}>{item.label}</Link>
              </Button>
            )}
          </span>
        )
      })}
    </nav>
  )
}
