import * as React from "react"

import { cn } from "@/lib/utils"
import { Label } from "@/components/ui/label"

/**
 * Поле формы: подпись → контрол → подсказка/ошибка.
 * Ошибка важнее подсказки; `aria-describedby` связывает текст с контролом через id.
 */
function Field({
  label,
  htmlFor,
  required,
  hint,
  error,
  className,
  children,
}: {
  label?: React.ReactNode
  htmlFor?: string
  required?: boolean
  hint?: React.ReactNode
  error?: React.ReactNode
  className?: string
  children: React.ReactNode
}) {
  return (
    <div className={cn("space-y-1.5", className)} data-slot="field">
      {label && (
        <Label htmlFor={htmlFor} className="text-[13px] font-medium">
          {label}
          {required && <span className="ml-0.5 text-destructive" aria-hidden>*</span>}
        </Label>
      )}
      {children}
      {error ? (
        <p id={htmlFor ? `${htmlFor}-error` : undefined} role="alert" className="text-xs text-destructive">
          {error}
        </p>
      ) : hint ? (
        <p id={htmlFor ? `${htmlFor}-hint` : undefined} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
    </div>
  )
}

export { Field }
