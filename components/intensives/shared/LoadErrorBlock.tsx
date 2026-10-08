"use client"

import { CircleAlert, RotateCcw } from 'lucide-react'

import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { cn } from '@/lib/utils'

/** Блок ошибки загрузки с повтором. Ошибка загрузки ≠ «пусто»: показываем отдельно от пустого состояния. */
export function LoadErrorBlock({
  title,
  message,
  onRetry,
  retrying = false,
  className,
}: {
  title: string
  message?: string | null
  onRetry: () => void
  retrying?: boolean
  className?: string
}) {
  return (
    <div role="alert" className={cn('flex flex-col gap-3 rounded-lg border px-4 py-4 sm:flex-row sm:items-center', className)}>
      <CircleAlert className="size-5 shrink-0 text-destructive" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{title}</p>
        {message && <p className="mt-0.5 break-words text-[13px] text-muted-foreground">{message}</p>}
      </div>
      <Button type="button" variant="outline" size="sm" onClick={onRetry} disabled={retrying} className="self-start sm:self-auto">
        {retrying ? <Spinner className="size-4" /> : <RotateCcw aria-hidden />}
        Повторить
      </Button>
    </div>
  )
}
