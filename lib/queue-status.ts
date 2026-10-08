/**
 * Состояние очереди отправки (heartbeat планировщика). Чистые функции без БД — тестируются vitest.
 *
 * Планировщик (scripts/send-scheduled-messages.ts) в конце каждого тика пишет время тика
 * в SystemSetting `cron:lastSendTick`. Если тик не фиксировался дольше 3 интервалов cron —
 * очередь считается непроверяемой (stale). Это состояние сервера, а не браузера пользователя.
 */

/** Ключ в SystemSetting */
export const CRON_LAST_TICK_KEY = 'cron:lastSendTick'
/** Интервал cron (lib/cron.ts: '* * * * *'; внешний cron-контейнер: sleep 60) */
export const CRON_INTERVAL_MS = 60_000
/** Тик не фиксировался дольше 3 интервалов → stale */
export const QUEUE_STALE_AFTER_MS = 3 * CRON_INTERVAL_MS

export interface QueueHeartbeat {
  at: Date
  processed: number | null
  failed: number | null
}

export interface QueueStatus {
  /** ISO-время последнего тика или null, если тиков ещё не было */
  lastTickAt: string | null
  /** Сколько секунд назад был тик (null — тиков не было) */
  ageSeconds: number | null
  stale: boolean
}

/** Значение для SystemSetting: JSON с ISO-временем и итогами тика. */
export function serializeHeartbeat(at: Date, result: { processed?: number; failed?: number } = {}): string {
  return JSON.stringify({ at: at.toISOString(), processed: result.processed ?? 0, failed: result.failed ?? 0 })
}

/** Разбор значения SystemSetting. Допускает и просто ISO-строку. Некорректное → null. */
export function parseHeartbeat(value: string | null | undefined): QueueHeartbeat | null {
  if (typeof value !== 'string' || !value.trim()) return null
  const raw = value.trim()
  let atRaw: unknown = raw
  let processed: number | null = null
  let failed: number | null = null
  if (raw.startsWith('{')) {
    try {
      const obj = JSON.parse(raw) as Record<string, unknown>
      atRaw = obj.at
      processed = typeof obj.processed === 'number' && Number.isFinite(obj.processed) ? obj.processed : null
      failed = typeof obj.failed === 'number' && Number.isFinite(obj.failed) ? obj.failed : null
    } catch {
      return null
    }
  }
  if (typeof atRaw !== 'string') return null
  const at = new Date(atRaw)
  if (Number.isNaN(at.getTime())) return null
  return { at, processed, failed }
}

export function computeQueueStatus(
  lastTickAt: Date | null,
  now: Date | number = new Date(),
  staleAfterMs: number = QUEUE_STALE_AFTER_MS,
): QueueStatus {
  if (!lastTickAt || Number.isNaN(lastTickAt.getTime())) {
    return { lastTickAt: null, ageSeconds: null, stale: true }
  }
  const nowMs = typeof now === 'number' ? now : now.getTime()
  // Часы могут расходиться — «из будущего» считаем нулевым возрастом
  const ageMs = Math.max(0, nowMs - lastTickAt.getTime())
  return {
    lastTickAt: lastTickAt.toISOString(),
    ageSeconds: Math.floor(ageMs / 1000),
    stale: ageMs > staleAfterMs,
  }
}

export interface QueueStatusView {
  text: string
  tone: 'ok' | 'warning'
}

/** Текст для шапки дашборда. Предупреждение — только для stale, и всегда словами, не одним цветом. */
export function describeQueueStatus(status: Pick<QueueStatus, 'ageSeconds' | 'stale'>): QueueStatusView {
  if (status.ageSeconds === null) {
    return { text: 'Очередь ещё не проверялась — проверьте cron', tone: 'warning' }
  }
  const minutes = Math.floor(status.ageSeconds / 60)
  if (status.stale) {
    return { text: `Очередь не проверялась ${minutes} мин — проверьте cron`, tone: 'warning' }
  }
  return {
    text: minutes < 1 ? 'Очередь проверена менее минуты назад' : `Очередь проверена ${minutes} мин назад`,
    tone: 'ok',
  }
}
