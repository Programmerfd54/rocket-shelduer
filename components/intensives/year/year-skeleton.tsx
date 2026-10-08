"use client"

import { Skeleton } from '@/components/ui/skeleton'
import { MONTH_HEADERS } from './year-layout'

const BARS: { left: number; width: number }[][] = [
  [{ left: 8, width: 12 }, { left: 44, width: 9 }],
  [{ left: 24, width: 14 }],
  [{ left: 60, width: 10 }, { left: 78, width: 8 }],
]

/** Скелетон по форме годовой шкалы (десктоп) и списка (телефон). */
export function YearSkeleton() {
  return (
    <div role="status" aria-busy="true" aria-label="Загрузка годового календаря">
      <div className="hidden overflow-hidden rounded-lg border bg-card lg:block">
        <div className="flex border-b bg-muted/40">
          <div className="flex h-9 w-[168px] shrink-0 items-center border-r px-3">
            <Skeleton className="h-3 w-20" />
          </div>
          <div className="grid h-9 flex-1 grid-cols-12">
            {MONTH_HEADERS.map((m) => (
              <div key={m} className="flex items-center border-l px-2 first:border-l-0">
                <Skeleton className="h-3 w-6" />
              </div>
            ))}
          </div>
        </div>
        {BARS.map((bars, i) => (
          <div key={i} className="flex h-[52px] border-b last:border-b-0">
            <div className="flex w-[168px] shrink-0 flex-col justify-center gap-1.5 border-r px-3">
              <Skeleton className="h-3.5 w-24" />
              <Skeleton className="h-3 w-14" />
            </div>
            <div className="relative flex-1">
              {bars.map((b, j) => (
                <Skeleton key={j} className="absolute top-2 h-9" style={{ left: `${b.left}%`, width: `${b.width}%` }} />
              ))}
            </div>
          </div>
        ))}
      </div>
      <div className="overflow-hidden rounded-lg border bg-card lg:hidden">
        {[1, 2, 3, 4].map((i) => (
          <div key={i} className="space-y-2 border-b px-3 py-3 last:border-b-0">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ))}
      </div>
    </div>
  )
}
