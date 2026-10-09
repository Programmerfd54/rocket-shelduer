'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { cn } from '@/lib/utils'

export const ARCHIVE_PROMPT_LABEL = 'Не предлагать архивировать это пространство'
export const ARCHIVE_PROMPT_HINT =
  'Скрывает баннеры, напоминания и отметку «Завершённые». Архивировать вручную по-прежнему можно.'

/**
 * Переключатель «Не предлагать архивировать это пространство» (Lead_SUP).
 * Сохраняется сразу отдельным PATCH { suppressArchivePrompt } — не зависит от остальных полей формы.
 */
export function ArchivePromptSwitch({
  workspaceId,
  value,
  onChanged,
  id = 'suppress-archive-prompt',
  className,
  disabled,
}: {
  workspaceId: string
  value: boolean
  onChanged?: (value: boolean) => void
  id?: string
  className?: string
  disabled?: boolean
}) {
  // Локальное значение — для мгновенного отклика; при ошибке возвращаем прежнее
  const [local, setLocal] = useState<{ base: boolean; value: boolean }>({ base: value, value })
  const [saving, setSaving] = useState(false)
  const checked = local.base === value ? local.value : value
  if (local.base !== value && !saving) setLocal({ base: value, value })

  const save = async (next: boolean) => {
    if (saving) return
    const prev = checked
    setLocal({ base: value, value: next })
    setSaving(true)
    try {
      const res = await fetch(`/api/workspace/${encodeURIComponent(workspaceId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ suppressArchivePrompt: next }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(typeof data?.error === 'string' ? data.error : 'Не удалось сохранить настройку')
      toast.success(next ? 'Архивирование больше не предлагается' : 'Предложение архивировать включено', {
        description: next ? 'Архивировать вручную по-прежнему можно.' : 'Подсказка появится, когда период пространства закончится.',
      })
      onChanged?.(next)
    } catch (e) {
      setLocal({ base: value, value: prev })
      toast.error('Не удалось сохранить настройку', {
        description: e instanceof Error && e.message !== 'Failed to fetch' ? e.message : 'Проверьте сеть и повторите.',
      })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={cn('flex items-start gap-2.5', className)}>
      <Checkbox
        id={id}
        checked={checked}
        disabled={disabled || saving}
        onCheckedChange={(c) => void save(c === true)}
        aria-describedby={`${id}-hint`}
        className="mt-0.5"
      />
      <div className="min-w-0 space-y-0.5">
        <Label htmlFor={id} className="flex cursor-pointer items-center gap-1.5 text-sm font-normal leading-snug">
          {ARCHIVE_PROMPT_LABEL}
          {saving && <Loader2 className="size-3.5 animate-spin text-muted-foreground" aria-label="Сохранение" />}
        </Label>
        <p id={`${id}-hint`} className="text-xs text-muted-foreground">
          {ARCHIVE_PROMPT_HINT}
        </p>
      </div>
    </div>
  )
}
