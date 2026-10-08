'use client'

import { useCallback, useState, type ReactNode } from 'react'
import { CalendarOff, Loader2, Lock } from 'lucide-react'
import { Switch } from 'radix-ui'
import { toast } from 'sonner'
import { EmptyState } from '@/components/common/EmptyState'
import { cn } from '@/lib/utils'
import { apiFetch } from '@/lib/intensives/ui'
import { LoadError, errText, useDeferredEffect, useSeq } from './kit'

export type FeatureInfo = { enabled: boolean; canManage: boolean; canManageOrgSpaces: boolean }

/** Переключатель в стиле «тонкий switch» (role=switch, управляется с клавиатуры). */
export function FeatureSwitch({
  checked,
  onCheckedChange,
  disabled,
  busy,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean
  onCheckedChange: (next: boolean) => void
  disabled?: boolean
  busy?: boolean
  id?: string
  'aria-label'?: string
}) {
  return (
    <span className="inline-flex items-center gap-2">
      {busy && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
      <Switch.Root
        id={id}
        aria-label={ariaLabel}
        checked={checked}
        disabled={disabled || busy}
        onCheckedChange={onCheckedChange}
        className={cn(
          'inline-flex h-5 w-9 shrink-0 items-center rounded-full border border-transparent transition-colors outline-none',
          'focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:cursor-not-allowed disabled:opacity-50',
          checked ? 'bg-primary' : 'bg-input',
        )}
      >
        <Switch.Thumb
          className={cn(
            'pointer-events-none block size-4 rounded-full bg-background transition-transform',
            checked ? 'translate-x-[18px]' : 'translate-x-0.5',
          )}
        />
      </Switch.Root>
    </span>
  )
}

/** Записать флаг `feature:intensives`. Возвращает true при успехе (тост показывается здесь). */
export async function setIntensivesFeature(enabled: boolean): Promise<boolean> {
  try {
    await apiFetch('/api/admin/settings', { method: 'PATCH', json: { 'feature:intensives': enabled ? 'true' : 'false' } })
    toast.success(enabled ? 'Интенсивы включены' : 'Интенсивы выключены')
    return true
  } catch (e) {
    toast.error('Не удалось изменить настройку', { description: errText(e) })
    return false
  }
}

/**
 * Обёртка страниц интенсивов: проверяет флаг и права. Пока грузится — `fallback` (скелетон страницы),
 * при выключенном флаге — пустое состояние с переключателем для Lead_SUP.
 */
export function FeatureGate({
  fallback,
  children,
}: {
  fallback: ReactNode
  children: (feature: FeatureInfo) => ReactNode
}) {
  const [feature, setFeature] = useState<FeatureInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [enabling, setEnabling] = useState(false)
  const seq = useSeq()

  const load = useCallback(async () => {
    const token = seq.begin()
    setError(null)
    try {
      const data = await apiFetch<FeatureInfo>('/api/intensives/feature')
      if (seq.isCurrent(token)) setFeature(data)
    } catch (e) {
      if (seq.isCurrent(token)) setError(errText(e))
    }
  }, [seq])

  useDeferredEffect(() => {
    void load()
  }, [load])

  if (error && !feature) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6">
        <LoadError message={error} onRetry={() => void load()} />
      </div>
    )
  }
  if (!feature) return <>{fallback}</>

  if (!feature.enabled) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <EmptyState
          icon={<CalendarOff />}
          title="Интенсивы выключены"
          description="Новый интерфейс интенсивов и годового календаря отключён. Данные не удалены, запланированные сообщения продолжают отправляться."
        >
          {feature.canManage ? (
            <div className="mt-4 flex items-center justify-center gap-3">
              <label htmlFor="intensives-feature-enable" className="text-sm">
                Включить интенсивы
              </label>
              <FeatureSwitch
                id="intensives-feature-enable"
                checked={false}
                busy={enabling}
                onCheckedChange={async () => {
                  setEnabling(true)
                  const ok = await setIntensivesFeature(true)
                  setEnabling(false)
                  if (ok) setFeature({ ...feature, enabled: true })
                }}
              />
            </div>
          ) : (
            <p className="mt-3 text-xs text-muted-foreground">Включить может Lead_SUP в разделе «Настройки».</p>
          )}
        </EmptyState>
      </div>
    )
  }

  if (!feature.canManage) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
        <EmptyState icon={<Lock />} title="Недостаточно прав" description="Управлять интенсивами может только Lead_SUP." />
      </div>
    )
  }

  return <>{children(feature)}</>
}
