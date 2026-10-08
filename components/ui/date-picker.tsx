"use client"

import * as React from "react"
import {
  addDays,
  addMonths,
  addYears,
  endOfMonth,
  format,
  isSameDay,
  isSameMonth,
  startOfMonth,
  startOfWeek,
} from "date-fns"
import { ru } from "date-fns/locale"
import { CalendarDays, ChevronLeft, ChevronRight, X } from "lucide-react"

import { cn } from "@/lib/utils"
import { parseYmd, toYmd } from "@/lib/schedule-datetime"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * DatePicker — выбор даты без нативного <input type="date">.
 * Значение: строка 'yyyy-MM-dd' (или '' если пусто) — прямая замена value/onChange у input[type=date].
 */
export interface DatePickerProps {
  value: string
  onChange: (value: string) => void
  /** Минимальная дата 'yyyy-MM-dd' (включительно) */
  min?: string
  /** Максимальная дата 'yyyy-MM-dd' (включительно) */
  max?: string
  placeholder?: string
  disabled?: boolean
  id?: string
  /** Красная рамка (ошибка валидации) */
  invalid?: boolean
  className?: string
  /** Быстрые кнопки «Сегодня / Завтра / Через неделю» (по умолчанию включены) */
  shortcuts?: boolean
  /** Показать кнопку «Очистить» (для необязательных дат) */
  clearable?: boolean
  "aria-describedby"?: string
  "aria-label"?: string
}

const WEEKDAYS = ["пн", "вт", "ср", "чт", "пт", "сб", "вс"]
const POPOVER_CLASS =
  "z-50 w-auto rounded-md border bg-popover p-3 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"

type Mode = "days" | "months" | "years"

function capitalize(s: string) {
  return s ? s[0].toUpperCase() + s.slice(1) : s
}

function clampYmd(ymd: string, min?: string, max?: string) {
  if (min && ymd < min) return min
  if (max && ymd > max) return max
  return ymd
}

export function DatePicker({
  value,
  onChange,
  min,
  max,
  placeholder = "Выберите дату",
  disabled,
  id,
  invalid,
  className,
  shortcuts = true,
  clearable = false,
  "aria-describedby": ariaDescribedBy,
  "aria-label": ariaLabel,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false)
  const contentRef = React.useRef<HTMLDivElement>(null)
  const selected = parseYmd(value)

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          id={id}
          disabled={disabled}
          data-invalid={invalid ? "true" : undefined}
          aria-describedby={ariaDescribedBy}
          aria-label={ariaLabel}
          aria-haspopup="dialog"
          className={cn(
            "border-input dark:bg-input/30 flex h-9 w-full min-w-0 items-center gap-2 rounded-md border bg-transparent px-3 text-left text-sm shadow-xs transition-[color,box-shadow] outline-none",
            "focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]",
            "data-[invalid=true]:border-destructive data-[invalid=true]:ring-destructive/20 dark:data-[invalid=true]:ring-destructive/40",
            "disabled:cursor-not-allowed disabled:opacity-50",
            className,
          )}
        >
          <CalendarDays className="size-4 shrink-0 text-muted-foreground" aria-hidden />
          <span className={cn("min-w-0 flex-1 truncate", !selected && "text-muted-foreground")}>
            {selected ? format(selected, "d MMMM yyyy", { locale: ru }) : placeholder}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        ref={contentRef}
        align="start"
        collisionPadding={8}
        className={POPOVER_CLASS}
        onOpenAutoFocus={(e) => {
          // Фокус — на выбранный день (а не на первую кнопку шапки)
          e.preventDefault()
          contentRef.current?.querySelector<HTMLElement>('[data-focus-day="true"]')?.focus()
        }}
      >
        <CalendarPanel
          selected={selected}
          min={min}
          max={max}
          shortcuts={shortcuts}
          clearable={clearable && !!value}
          onPick={(ymd) => {
            onChange(ymd)
            setOpen(false)
          }}
          onClear={() => {
            onChange("")
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

interface PanelProps {
  selected: Date | null
  min?: string
  max?: string
  shortcuts: boolean
  clearable: boolean
  onPick: (ymd: string) => void
  onClear: () => void
}

function CalendarPanel({ selected, min, max, shortcuts, clearable, onPick, onClear }: PanelProps) {
  const today = React.useMemo(() => new Date(), [])
  const todayYmd = toYmd(today)

  const initialFocus = React.useMemo(() => {
    const base = selected ? toYmd(selected) : todayYmd
    return clampYmd(base, min, max)
  }, [selected, todayYmd, min, max])

  const [mode, setMode] = React.useState<Mode>("days")
  const [focusYmd, setFocusYmd] = React.useState(initialFocus)
  const [view, setView] = React.useState<Date>(() => startOfMonth(parseYmd(initialFocus) ?? today))
  const [yearPageStart, setYearPageStart] = React.useState(() => Math.floor(view.getFullYear() / 12) * 12)
  const shouldFocusRef = React.useRef(false)
  const gridRef = React.useRef<HTMLDivElement>(null)

  const isDisabled = React.useCallback(
    (ymd: string) => (!!min && ymd < min) || (!!max && ymd > max),
    [min, max],
  )

  // Сетка 6 недель × 7 дней, понедельник — первый
  const days = React.useMemo(() => {
    const start = startOfWeek(startOfMonth(view), { weekStartsOn: 1 })
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [view])

  React.useEffect(() => {
    if (!shouldFocusRef.current) return
    shouldFocusRef.current = false
    gridRef.current?.querySelector<HTMLElement>('[data-focus-day="true"]')?.focus()
  }, [focusYmd, view])

  const moveFocus = (next: Date) => {
    const ymd = toYmd(next)
    shouldFocusRef.current = true
    setFocusYmd(ymd)
    if (!isSameMonth(next, view)) setView(startOfMonth(next))
  }

  const onGridKeyDown = (e: React.KeyboardEvent) => {
    const cur = parseYmd(focusYmd) ?? today
    let next: Date | null = null
    switch (e.key) {
      case "ArrowLeft":
        next = addDays(cur, -1)
        break
      case "ArrowRight":
        next = addDays(cur, 1)
        break
      case "ArrowUp":
        next = addDays(cur, -7)
        break
      case "ArrowDown":
        next = addDays(cur, 7)
        break
      case "Home":
        next = startOfWeek(cur, { weekStartsOn: 1 })
        break
      case "End":
        next = addDays(startOfWeek(cur, { weekStartsOn: 1 }), 6)
        break
      case "PageUp":
        next = e.shiftKey ? addYears(cur, -1) : addMonths(cur, -1)
        break
      case "PageDown":
        next = e.shiftKey ? addYears(cur, 1) : addMonths(cur, 1)
        break
    }
    if (next) {
      e.preventDefault()
      moveFocus(next)
    }
  }

  const monthLabel = capitalize(format(view, "LLLL yyyy", { locale: ru }))

  const shift = (dir: -1 | 1) => {
    if (mode === "days") setView((v) => addMonths(v, dir))
    else if (mode === "months") setView((v) => addYears(v, dir))
    else setYearPageStart((y) => y + dir * 12)
  }

  const headerLabel =
    mode === "days" ? monthLabel : mode === "months" ? String(view.getFullYear()) : `${yearPageStart}–${yearPageStart + 11}`

  const headerAria =
    mode === "days" ? "Выбрать месяц и год" : mode === "months" ? "Выбрать год" : "Вернуться к выбору месяца"

  const prevAria = mode === "days" ? "Предыдущий месяц" : mode === "months" ? "Предыдущий год" : "Предыдущие годы"
  const nextAria = mode === "days" ? "Следующий месяц" : mode === "months" ? "Следующий год" : "Следующие годы"

  const quick = shortcuts
    ? [
        { label: "Сегодня", ymd: todayYmd },
        { label: "Завтра", ymd: toYmd(addDays(today, 1)) },
        { label: "Через неделю", ymd: toYmd(addDays(today, 7)) },
      ]
    : []

  return (
    <div className="w-[252px] max-w-full select-none">
      <div className="mb-2 flex items-center justify-between gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8"
          aria-label={prevAria}
          onClick={() => shift(-1)}
        >
          <ChevronLeft />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-w-0 flex-1 px-2 text-sm font-semibold"
          aria-label={headerAria}
          aria-live="polite"
          onClick={() => setMode((m) => (m === "days" ? "months" : m === "months" ? "years" : "months"))}
        >
          {headerLabel}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          className="size-8"
          aria-label={nextAria}
          onClick={() => shift(1)}
        >
          <ChevronRight />
        </Button>
      </div>

      {mode === "days" && (
        <div ref={gridRef} role="grid" aria-label={monthLabel} onKeyDown={onGridKeyDown}>
          <div role="row" className="mb-1 grid grid-cols-7">
            {WEEKDAYS.map((d) => (
              <div
                key={d}
                role="columnheader"
                className="flex h-7 items-center justify-center text-xs font-medium text-muted-foreground"
              >
                {d}
              </div>
            ))}
          </div>
          {Array.from({ length: 6 }, (_, w) => (
            <div key={w} role="row" className="grid grid-cols-7">
              {days.slice(w * 7, w * 7 + 7).map((day) => {
                const ymd = toYmd(day)
                const outside = !isSameMonth(day, view)
                const isSel = !!selected && isSameDay(day, selected)
                const isToday = ymd === todayYmd
                const dis = isDisabled(ymd)
                const isFocus = ymd === focusYmd
                return (
                  <div key={ymd} role="gridcell" aria-selected={isSel} className="flex items-center justify-center">
                    <button
                      type="button"
                      tabIndex={isFocus ? 0 : -1}
                      data-focus-day={isFocus ? "true" : undefined}
                      aria-label={format(day, "d MMMM yyyy", { locale: ru })}
                      aria-current={isToday ? "date" : undefined}
                      aria-pressed={isSel}
                      aria-disabled={dis || undefined}
                      onClick={() => {
                        if (!dis) onPick(ymd)
                      }}
                      onFocus={() => setFocusYmd(ymd)}
                      className={cn(
                        "flex size-9 items-center justify-center rounded-md text-sm tabular-nums outline-none transition-colors",
                        "focus-visible:ring-ring/60 focus-visible:ring-2",
                        isSel
                          ? "bg-primary font-medium text-primary-foreground hover:bg-primary/90"
                          : dis
                            ? "cursor-not-allowed text-muted-foreground/40"
                            : cn("hover:bg-accent hover:text-accent-foreground", outside ? "text-muted-foreground/60" : "text-foreground"),
                        isToday && !isSel && "ring-1 ring-inset ring-foreground/40",
                      )}
                    >
                      {day.getDate()}
                    </button>
                  </div>
                )
              })}
            </div>
          ))}
        </div>
      )}

      {mode === "months" && (
        <div className="grid h-[248px] grid-cols-3 grid-rows-4 gap-1">
          {Array.from({ length: 12 }, (_, m) => {
            const first = new Date(view.getFullYear(), m, 1)
            const firstYmd = toYmd(first)
            const lastYmd = toYmd(endOfMonth(first))
            const dis = (!!min && lastYmd < min) || (!!max && firstYmd > max)
            const isCurrent = view.getMonth() === m
            return (
              <button
                key={m}
                type="button"
                disabled={dis}
                aria-pressed={isCurrent}
                onClick={() => {
                  const cur = parseYmd(focusYmd) ?? today
                  const day = Math.min(cur.getDate(), endOfMonth(first).getDate())
                  const nextFocus = clampYmd(toYmd(new Date(view.getFullYear(), m, day)), min, max)
                  setView(startOfMonth(first))
                  setFocusYmd(nextFocus)
                  setMode("days")
                }}
                className={cn(
                  "rounded-md text-sm capitalize outline-none transition-colors focus-visible:ring-ring/60 focus-visible:ring-2",
                  isCurrent ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground",
                  dis && "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
                )}
              >
                {format(first, "LLL", { locale: ru }).replace(".", "")}
              </button>
            )
          })}
        </div>
      )}

      {mode === "years" && (
        <div className="grid h-[248px] grid-cols-3 grid-rows-4 gap-1">
          {Array.from({ length: 12 }, (_, i) => {
            const y = yearPageStart + i
            const dis = (!!min && `${y}-12-31` < min) || (!!max && `${y}-01-01` > max)
            const isCurrent = view.getFullYear() === y
            return (
              <button
                key={y}
                type="button"
                disabled={dis}
                aria-pressed={isCurrent}
                onClick={() => {
                  setView(new Date(y, view.getMonth(), 1))
                  setMode("months")
                }}
                className={cn(
                  "rounded-md text-sm tabular-nums outline-none transition-colors focus-visible:ring-ring/60 focus-visible:ring-2",
                  isCurrent ? "bg-primary font-medium text-primary-foreground" : "hover:bg-accent hover:text-accent-foreground",
                  dis && "cursor-not-allowed text-muted-foreground/40 hover:bg-transparent",
                )}
              >
                {y}
              </button>
            )
          })}
        </div>
      )}

      {(quick.length > 0 || clearable) && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t pt-2">
          {quick.map((q) => (
            <Button
              key={q.label}
              type="button"
              variant="outline"
              size="xs"
              className="h-7 px-2"
              disabled={isDisabled(q.ymd)}
              onClick={() => onPick(q.ymd)}
            >
              {q.label}
            </Button>
          ))}
          {clearable && (
            <Button type="button" variant="ghost" size="xs" className="ml-auto h-7 px-2 text-muted-foreground" onClick={onClear}>
              <X />
              Очистить
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
