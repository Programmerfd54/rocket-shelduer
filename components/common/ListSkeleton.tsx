"use client"

import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent } from '@/components/ui/card'
import { cn } from '@/lib/utils'

/** Скелетон списка в стиле карточек — единый вид для каналов, сообщений, шаблонов */
export function ListSkeletonCard({
  lines = 3,
  className,
}: {
  lines?: number
  className?: string
}) {
  return (
    <div className={cn('space-y-3', className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <Card
          key={i}
          className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden"
        >
          <CardContent className="p-4 flex items-start gap-3">
            <Skeleton className="h-10 w-10 rounded-lg shrink-0" />
            <div className="flex-1 min-w-0 space-y-2">
              <Skeleton className="h-5 w-3/4 max-w-[200px]" />
              <Skeleton className="h-4 w-full max-w-[280px]" />
              <div className="flex gap-2">
                <Skeleton className="h-6 w-16 rounded-full" />
                <Skeleton className="h-6 w-20 rounded-full" />
              </div>
            </div>
            <Skeleton className="h-9 w-9 rounded-lg shrink-0" />
          </CardContent>
        </Card>
      ))}
    </div>
  )
}

/** Компактный скелетон строки (для таблиц/списков без карточек) */
export function ListSkeletonRow({ rows = 5, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)}>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 py-2">
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
          <Skeleton className="h-4 flex-1 max-w-[180px]" />
          <Skeleton className="h-6 w-14 rounded-full" />
          <Skeleton className="h-8 w-8 rounded-lg shrink-0" />
        </div>
      ))}
    </div>
  )
}

/** Скелетон таблицы (админка: пользователи, аудит и т.д.) */
export function TableSkeleton({
  rows = 8,
  cols = 5,
  className,
}: {
  rows?: number
  cols?: number
  className?: string
}) {
  return (
    <div className={cn('rounded-lg border border-border/80 overflow-hidden', className)}>
      <div className="flex gap-4 p-3 border-b border-border/80 bg-muted/30">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-4 flex-1 min-w-0 max-w-[120px]" />
        ))}
      </div>
      <div className="divide-y divide-border/60">
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="flex gap-4 p-3 items-center">
            {Array.from({ length: cols }).map((_, j) => (
              <Skeleton
                key={j}
                className={cn(
                  'h-4',
                  j === 0 ? 'w-8 rounded-full shrink-0' : 'flex-1 min-w-0 max-w-[160px]'
                )}
              />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
