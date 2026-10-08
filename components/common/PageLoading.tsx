import { Skeleton } from '@/components/ui/skeleton'
import { PageContainer } from '@/components/common/PageHeader'

type PageLoadingVariant = 'list' | 'cards' | 'table' | 'calendar' | 'detail'

function HeaderPlaceholder({ withAction = true }: { withAction?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-4 pb-5">
      <div className="space-y-2">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-4 w-72 max-w-full" />
      </div>
      {withAction && <Skeleton className="h-8 w-28 shrink-0" />}
    </div>
  )
}

function ListBody() {
  return (
    <div className="divide-y rounded-lg border bg-card">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-4 shrink-0" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-1/3 max-w-[220px]" />
            <Skeleton className="h-3 w-2/3 max-w-[360px]" />
          </div>
          <Skeleton className="h-5 w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

function CardsBody() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-3 rounded-lg border bg-card p-4">
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  )
}

function TableBody() {
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Skeleton className="h-8 w-56 max-w-full" />
        <Skeleton className="h-8 w-28" />
      </div>
      <div className="overflow-hidden rounded-lg border bg-card">
        <div className="flex gap-4 border-b bg-muted/40 px-4 py-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-3 w-24" />
          ))}
        </div>
        <div className="divide-y">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-4 px-4 py-3">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <Skeleton className="h-4 w-40" />
              <Skeleton className="hidden h-4 w-24 sm:block" />
              <Skeleton className="ml-auto h-5 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

function CalendarBody() {
  return (
    <div className="overflow-hidden rounded-lg border bg-card">
      <div className="grid grid-cols-7 border-b bg-muted/40">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="flex justify-center px-2 py-2.5">
            <Skeleton className="h-3 w-6" />
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {Array.from({ length: 35 }).map((_, i) => (
          <div key={i} className="h-20 space-y-2 border-b border-r p-2 last:border-r-0">
            <Skeleton className="h-3 w-4" />
          </div>
        ))}
      </div>
    </div>
  )
}

function DetailBody() {
  return (
    <div className="space-y-4">
      <div className="flex gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24" />
        ))}
      </div>
      <div className="space-y-4 rounded-lg border bg-card p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-full max-w-md" />
        <Skeleton className="h-9 w-32" />
      </div>
    </div>
  )
}

/** Единый скелетон страницы для loading.tsx: заголовок-заглушка + тело по варианту. */
export function PageLoading({ variant = 'list', withAction = true }: { variant?: PageLoadingVariant; withAction?: boolean }) {
  return (
    <PageContainer size={variant === 'table' || variant === 'calendar' ? 'wide' : 'default'}>
      <div role="status" aria-busy="true" aria-label="Загрузка">
        <HeaderPlaceholder withAction={withAction} />
        {variant === 'list' && <ListBody />}
        {variant === 'cards' && <CardsBody />}
        {variant === 'table' && <TableBody />}
        {variant === 'calendar' && <CalendarBody />}
        {variant === 'detail' && <DetailBody />}
      </div>
    </PageContainer>
  )
}
