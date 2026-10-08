"use client"

import { useEffect, useMemo, useState } from "react"
import { CalendarClock, CalendarRange, TriangleAlert } from "lucide-react"

import { cn } from "@/lib/utils"
import { collectSendProblems, formatScheduleWithZone } from "@/lib/schedule-datetime"

/**
 * Сводка перед подтверждением отправки: когда (с часовым поясом браузера), в какой канал,
 * от чьего имени и в каком пространстве. Строится только из реальных значений формы;
 * если чего-то не хватает или время в прошлом — показывает предупреждение.
 */
export function SendSummary({
  workspaceName,
  channelName,
  sender,
  senderLoading = false,
  senderNote,
  date,
  time,
  requireSchedule = true,
  minLeadMs = 0,
  intensiveName,
  schedule,
  className,
}: {
  workspaceName?: string | null
  channelName?: string | null
  /** Кто будет автором: «Анна», «@anna». null/пусто — предупреждение (если не senderLoading) */
  sender?: string | null
  senderLoading?: boolean
  /** Пояснение к отправителю, например «выбран вручную» */
  senderNote?: string | null
  /** 'yyyy-MM-dd' и 'HH:mm' — локальные значения формы */
  date?: string | null
  time?: string | null
  /** false — для уже отправленного сообщения время не показываем */
  requireSchedule?: boolean
  minLeadMs?: number
  /** Интенсив, к которому привязывается сообщение (строка «Интенсив: …») */
  intensiveName?: string | null
  /**
   * Готовая подпись времени вместо date/time в поясе браузера — например, в поясе интенсива:
   * «День 2 · 13 октября, 10:00 · Москва». label=null — дата/время не выбраны.
   */
  schedule?: { label: string | null; secondary?: string | null; inPast: boolean }
  className?: string
}) {
  // «Сейчас» обновляем, чтобы предупреждение «время уже прошло» не устаревало
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [])

  const scheduleLabel = schedule?.label ?? null
  const scheduleInPast = schedule?.inPast ?? false
  const hasOverride = !!schedule
  const problems = useMemo(() => {
    if (!hasOverride) {
      return collectSendProblems({ channelName, date, time, requireSchedule, sender, senderLoading, now, minLeadMs })
    }
    // Время задано готовой подписью (пояс интенсива): проверки даты/времени — по ней
    const base = collectSendProblems({ channelName, requireSchedule: false, sender, senderLoading, now })
    const extra: string[] = []
    if (requireSchedule && !scheduleLabel) extra.push("Не выбраны дата и время")
    if (requireSchedule && scheduleLabel && scheduleInPast) extra.push("Время уже прошло")
    return [...extra, ...base]
  }, [hasOverride, channelName, date, time, requireSchedule, sender, senderLoading, now, minLeadMs, scheduleLabel, scheduleInPast])
  const when = requireSchedule ? (hasOverride ? scheduleLabel : formatScheduleWithZone(date, time, { now })) : null
  const channel = (channelName ?? "").replace(/^#/, "").trim()
  const warn = problems.length > 0

  return (
    <section
      aria-label="Сводка отправки"
      className={cn(
        "space-y-2 rounded-md border bg-muted/50 p-3 text-sm",
        warn && "border-warning/50",
        className,
      )}
    >
      <h3 className="text-sm font-semibold">Проверьте перед отправкой</h3>
      <dl className="space-y-1.5">
        {intensiveName && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">Интенсив</dt>
            <CalendarRange className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <dd className="min-w-0 break-words text-foreground">
              <span className="text-muted-foreground">Интенсив: </span>
              <span className="font-medium">{intensiveName}</span>
            </dd>
          </div>
        )}
        {requireSchedule && (
          <div className="flex items-start gap-2">
            <dt className="sr-only">Когда</dt>
            <CalendarClock className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
            <dd className={cn("min-w-0 break-words", when ? "font-medium text-foreground" : "text-muted-foreground")}>
              {when ?? "Дата и время не указаны"}
              {when && schedule?.secondary && (
                <span className="block text-xs font-normal text-muted-foreground">{schedule.secondary}</span>
              )}
            </dd>
          </div>
        )}
        <div className="flex items-start gap-2">
          <dt className="sr-only">Куда и от кого</dt>
          <span className="mt-0.5 size-4 shrink-0 text-center text-muted-foreground" aria-hidden>
            #
          </span>
          <dd className="min-w-0 break-words text-foreground">
            <span className={cn("font-medium", !channel && "font-normal text-muted-foreground")}>
              {channel ? `#${channel}` : "канал не выбран"}
            </span>
            <span className="text-muted-foreground"> · от имени </span>
            {senderLoading && !sender ? (
              <span className="text-muted-foreground">…</span>
            ) : (
              <span className={cn("font-medium", !sender && "font-normal text-muted-foreground")}>
                {sender || "не определён"}
              </span>
            )}
            {senderNote && <span className="text-muted-foreground"> ({senderNote})</span>}
          </dd>
        </div>
        {workspaceName && (
          <p className="pl-6 text-xs text-muted-foreground">
            Пространство: <span className="text-foreground">{workspaceName}</span>
          </p>
        )}
      </dl>
      {warn && (
        <ul role="alert" className="space-y-0.5 border-t pt-2">
          {problems.map((p) => (
            <li key={p} className="flex items-start gap-1.5 text-xs text-foreground">
              <TriangleAlert className="mt-px size-3.5 shrink-0 text-warning" aria-hidden />
              <span>{p}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
