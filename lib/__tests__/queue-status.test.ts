import { describe, it, expect } from 'vitest'
import {
  CRON_INTERVAL_MS,
  QUEUE_STALE_AFTER_MS,
  computeQueueStatus,
  describeQueueStatus,
  parseHeartbeat,
  serializeHeartbeat,
} from '../queue-status'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms)

describe('computeQueueStatus', () => {
  it('порог = 3 интервала cron', () => {
    expect(QUEUE_STALE_AFTER_MS).toBe(3 * CRON_INTERVAL_MS)
  })

  it('свежий тик не stale', () => {
    expect(computeQueueStatus(ago(30_000), NOW)).toEqual({
      lastTickAt: ago(30_000).toISOString(),
      ageSeconds: 30,
      stale: false,
    })
  })

  it('ровно 3 минуты — ещё не stale, дольше — stale', () => {
    expect(computeQueueStatus(ago(QUEUE_STALE_AFTER_MS), NOW).stale).toBe(false)
    expect(computeQueueStatus(ago(QUEUE_STALE_AFTER_MS + 1000), NOW).stale).toBe(true)
  })

  it('тиков не было → stale без возраста', () => {
    expect(computeQueueStatus(null, NOW)).toEqual({ lastTickAt: null, ageSeconds: null, stale: true })
    expect(computeQueueStatus(new Date('nope'), NOW).stale).toBe(true)
  })

  it('время из будущего (расхождение часов) → возраст 0', () => {
    expect(computeQueueStatus(new Date(NOW.getTime() + 60_000), NOW)).toMatchObject({ ageSeconds: 0, stale: false })
  })
})

describe('heartbeat value', () => {
  it('serialize → parse', () => {
    const at = ago(5000)
    expect(parseHeartbeat(serializeHeartbeat(at, { processed: 3, failed: 1 }))).toEqual({ at, processed: 3, failed: 1 })
  })

  it('принимает просто ISO-строку', () => {
    expect(parseHeartbeat('2026-10-07T11:59:00.000Z')?.at.toISOString()).toBe('2026-10-07T11:59:00.000Z')
  })

  it('мусор → null', () => {
    for (const v of [null, undefined, '', '  ', '{', '{"at":5}', '{"at":"nope"}', 'abc']) {
      expect(parseHeartbeat(v as string | null | undefined)).toBeNull()
    }
  })
})

describe('describeQueueStatus', () => {
  it('нормальное состояние — нейтральный текст', () => {
    expect(describeQueueStatus({ ageSeconds: 130, stale: false })).toEqual({ text: 'Очередь проверена 2 мин назад', tone: 'ok' })
    expect(describeQueueStatus({ ageSeconds: 20, stale: false }).text).toBe('Очередь проверена менее минуты назад')
  })

  it('stale — предупреждение словами', () => {
    expect(describeQueueStatus({ ageSeconds: 600, stale: true })).toEqual({
      text: 'Очередь не проверялась 10 мин — проверьте cron',
      tone: 'warning',
    })
  })

  it('тиков не было — предупреждение', () => {
    expect(describeQueueStatus({ ageSeconds: null, stale: true }).tone).toBe('warning')
  })
})
