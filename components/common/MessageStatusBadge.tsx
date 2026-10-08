import { Ban, CalendarClock, CircleCheck, CircleHelp, CircleX, ClockAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { cn } from '@/lib/utils'
import { getMessageStatusView, type StatusIconKey } from '@/lib/message-status'

const ICONS: Record<StatusIconKey, typeof CalendarClock> = {
  scheduled: CalendarClock,
  overdue: ClockAlert,
  sent: CircleCheck,
  failed: CircleX,
  cancelled: Ban,
  unknown: CircleHelp,
}

/**
 * Единый бейдж статуса сообщения: иконка + текст (статус не передаётся одним цветом).
 * Формулировки — из lib/message-status.ts. `compact` — короткая подпись для тесных строк
 * (полная остаётся в title и для скринридера).
 */
export function MessageStatusBadge({
  status,
  scheduledFor,
  compact = false,
  now,
  className,
}: {
  status: string | null | undefined
  scheduledFor?: string | number | Date | null
  compact?: boolean
  /** Для тестов/стабильного рендера; по умолчанию — текущее время */
  now?: Date
  className?: string
}) {
  const view = getMessageStatusView(status, scheduledFor, now)
  const Icon = ICONS[view.icon]
  const showShort = compact && view.shortLabel !== view.label
  return (
    <Badge
      variant={view.tone}
      data-status={view.key}
      title={view.description ? `${view.label}. ${view.description}` : view.label}
      className={cn(
        showShort ? '' : 'h-auto max-w-full whitespace-normal py-0.5 text-left leading-snug',
        className,
      )}
    >
      <Icon aria-hidden />
      {showShort ? (
        <>
          <span>{view.shortLabel}</span>
          <span className="sr-only"> · назначенное время прошло</span>
        </>
      ) : (
        <span>{view.label}</span>
      )}
    </Badge>
  )
}
