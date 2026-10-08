"use client"

import { checkPasswordStrength, cn } from '@/lib/utils'

const LEVELS = {
  weak: { label: 'Слабый', bars: 1, color: 'bg-red-500', text: 'text-red-600 dark:text-red-400' },
  medium: { label: 'Средний', bars: 2, color: 'bg-amber-500', text: 'text-amber-600 dark:text-amber-400' },
  strong: { label: 'Надёжный', bars: 3, color: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
} as const

/** Тонкий индикатор надёжности пароля (3 сегмента) + подсказка. Ничего не рисует для пустого пароля. */
export function PasswordStrength({ password, className }: { password: string; className?: string }) {
  if (!password) return null
  const result = checkPasswordStrength(password)
  const level = LEVELS[result.strength]
  const tooShort = !result.valid
  const bars = tooShort ? 1 : level.bars
  return (
    <div className={cn('space-y-1', className)} aria-live="polite">
      <div className="flex gap-1" aria-hidden>
        {[1, 2, 3].map((i) => (
          <span key={i} className={cn('h-1 flex-1 rounded-full bg-muted', i <= bars && (tooShort ? 'bg-red-500' : level.color))} />
        ))}
      </div>
      <p className={cn('text-xs', tooShort ? 'text-red-600 dark:text-red-400' : level.text)}>
        {tooShort ? result.message : `${level.label} пароль${result.strength === 'strong' ? '' : ' — добавьте заглавные буквы, цифры и символы'}`}
      </p>
    </div>
  )
}
