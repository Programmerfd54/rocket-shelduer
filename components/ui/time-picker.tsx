"use client"

import * as React from "react"
import { Clock } from "lucide-react"

import { cn } from "@/lib/utils"
import {
  buildTimeSlots,
  completeTimeOnBlur,
  maskTimeInput,
  minutesToTime,
  parseTime,
  timeToMinutes,
} from "@/lib/schedule-datetime"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

/**
 * TimePicker — поле времени с маской HH:mm и списком слотов.
 * Значение: 'HH:mm' (или '' если пусто). onChange вызывается только для полностью
 * корректного значения (или пустой строки); незавершённый ввод остаётся в поле.
 */
export interface TimePickerProps {
  value: string
  onChange: (value: string) => void
  /** Шаг слотов в списке, минут (по умолчанию 15) */
  step?: number
  /** Минимальное время 'HH:mm' для списка слотов и быстрых кнопок */
  min?: string
  /** Быстрые кнопки; [] — скрыть */
  quickTimes?: string[]
  disabled?: boolean
  id?: string
  /** Красная рамка (ошибка валидации снаружи) */
  invalid?: boolean
  className?: string
  placeholder?: string
  "aria-describedby"?: string
}

const DEFAULT_QUICK = ["09:00", "12:00", "15:00", "18:00"]
const POPOVER_CLASS =
  "z-50 w-44 rounded-md border bg-popover p-2 text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"

export function TimePicker({
  value,
  onChange,
  step = 15,
  min,
  quickTimes = DEFAULT_QUICK,
  disabled,
  id,
  invalid,
  className,
  placeholder = "ЧЧ:ММ",
  "aria-describedby": ariaDescribedBy,
}: TimePickerProps) {
  const [text, setText] = React.useState(value ?? "")
  const [open, setOpen] = React.useState(false)
  const [prevValue, setPrevValue] = React.useState(value ?? "")

  // Внешнее изменение значения (шаблон, сброс формы) → обновить поле.
  // Делаем во время рендера (рекомендуемый React паттерн), а не в эффекте.
  if ((value ?? "") !== prevValue) {
    setPrevValue(value ?? "")
    if ((value ?? "") !== (parseTime(text) ?? "") && !((value ?? "") === "" && text === "")) {
      setText(value ?? "")
    }
  }

  const parsed = parseTime(text)
  const partialInvalid = text !== "" && !parsed
  const isInvalid = !!invalid || partialInvalid
  const minMinutes = timeToMinutes(min)

  const commit = (next: string) => {
    setText(next)
    onChange(next)
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const masked = maskTimeInput(e.target.value, text)
    setText(masked)
    if (masked === "") {
      onChange("")
      return
    }
    const p = masked.length === 5 ? parseTime(masked) : null
    if (p) onChange(p)
  }

  const handleBlur = () => {
    const completed = completeTimeOnBlur(text)
    if (completed !== text) {
      setText(completed)
      const p = parseTime(completed)
      if (p) onChange(p)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    e.preventDefault()
    const base = timeToMinutes(parsed ?? undefined) ?? timeToMinutes(min) ?? 9 * 60
    const dir = e.key === "ArrowUp" ? 1 : -1
    // Привязываем к сетке шага: из 09:21 вверх → 09:30, вниз → 09:15
    const s = Math.max(1, step)
    const snapped = dir > 0 ? (Math.floor(base / s) + 1) * s : (Math.ceil(base / s) - 1) * s
    const next = Math.min(1439, Math.max(minMinutes ?? 0, snapped))
    commit(minutesToTime(next))
  }

  return (
    <Popover modal open={open} onOpenChange={setOpen}>
      <div className={cn("relative", className)}>
        <Input
          id={id}
          type="text"
          inputMode="numeric"
          autoComplete="off"
          maxLength={5}
          placeholder={placeholder}
          disabled={disabled}
          aria-invalid={isInvalid || undefined}
          aria-describedby={ariaDescribedBy}
          value={text}
          onChange={handleChange}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          className="pr-10 tabular-nums"
        />
        <PopoverTrigger asChild>
          <button
            type="button"
            disabled={disabled}
            aria-label="Выбрать время из списка"
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:text-foreground focus-visible:ring-ring/50 focus-visible:ring-[3px] disabled:pointer-events-none disabled:opacity-50"
          >
            <Clock className="size-4" aria-hidden />
          </button>
        </PopoverTrigger>
      </div>
      <PopoverContent align="end" collisionPadding={8} className={POPOVER_CLASS}>
        <SlotList
          current={parsed ?? ""}
          step={step}
          min={min}
          quickTimes={quickTimes}
          onPick={(t) => {
            commit(t)
            setOpen(false)
          }}
        />
      </PopoverContent>
    </Popover>
  )
}

function SlotList({
  current,
  step,
  min,
  quickTimes,
  onPick,
}: {
  current: string
  step: number
  min?: string
  quickTimes: string[]
  onPick: (t: string) => void
}) {
  const listRef = React.useRef<HTMLDivElement>(null)
  const minMinutes = timeToMinutes(min)

  const slots = React.useMemo(() => {
    const base = buildTimeSlots(step)
    if (current && !base.includes(current)) {
      return [...base, current].sort()
    }
    return base
  }, [step, current])

  const activeTime = React.useMemo(() => {
    if (current) return current
    // Нет значения — подсветить ближайший слот к 09:00
    return slots.find((s) => s >= "09:00") ?? slots[0]
  }, [current, slots])

  const isDisabled = (t: string) => minMinutes != null && (timeToMinutes(t) ?? 0) < minMinutes

  // Автопрокрутка к текущему значению и фокус на нём
  React.useLayoutEffect(() => {
    const list = listRef.current
    if (!list) return
    const el = list.querySelector<HTMLElement>('[data-active="true"]')
    if (!el) return
    list.scrollTop = el.offsetTop - list.clientHeight / 2 + el.clientHeight / 2
    el.focus({ preventScroll: true })
  }, [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    const keys = ["ArrowDown", "ArrowUp", "Home", "End", "PageDown", "PageUp"]
    if (!keys.includes(e.key)) return
    const items = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>('button[role="option"]:not([aria-disabled="true"])') ?? [])
    if (!items.length) return
    e.preventDefault()
    const idx = items.indexOf(document.activeElement as HTMLButtonElement)
    let next = idx
    if (e.key === "ArrowDown") next = Math.min(items.length - 1, idx + 1)
    else if (e.key === "ArrowUp") next = Math.max(0, idx - 1)
    else if (e.key === "PageDown") next = Math.min(items.length - 1, idx + 8)
    else if (e.key === "PageUp") next = Math.max(0, idx - 8)
    else if (e.key === "Home") next = 0
    else if (e.key === "End") next = items.length - 1
    items[next]?.focus()
  }

  return (
    <div className="space-y-2">
      {quickTimes.length > 0 && (
        <div className="flex flex-wrap gap-1 border-b pb-2">
          {quickTimes.map((t) => (
            <Button
              key={t}
              type="button"
              variant={t === current ? "secondary" : "outline"}
              size="xs"
              className="h-7 px-2 tabular-nums"
              disabled={isDisabled(t)}
              onClick={() => onPick(t)}
            >
              {t}
            </Button>
          ))}
        </div>
      )}
      <div
        ref={listRef}
        role="listbox"
        aria-label="Время"
        onKeyDown={onKeyDown}
        className="relative max-h-56 overflow-y-auto overscroll-contain"
      >
        {slots.map((t) => {
          const dis = isDisabled(t)
          const selected = t === current
          return (
            <button
              key={t}
              type="button"
              role="option"
              aria-selected={selected}
              aria-disabled={dis || undefined}
              data-active={t === activeTime ? "true" : undefined}
              tabIndex={t === activeTime ? 0 : -1}
              onClick={() => {
                if (!dis) onPick(t)
              }}
              className={cn(
                "flex h-8 w-full items-center rounded-md px-2 text-sm tabular-nums outline-none transition-colors",
                "focus-visible:ring-ring/60 focus-visible:ring-2",
                selected
                  ? "bg-primary font-medium text-primary-foreground"
                  : dis
                    ? "cursor-not-allowed text-muted-foreground/40"
                    : "hover:bg-accent hover:text-accent-foreground",
              )}
            >
              {t}
            </button>
          )
        })}
      </div>
    </div>
  )
}
