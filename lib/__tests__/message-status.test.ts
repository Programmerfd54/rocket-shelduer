import { describe, it, expect } from 'vitest'
import {
  getMessageStatusView,
  isPendingOverdue,
  sanitizeErrorReason,
  toTimestamp,
} from '../message-status'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const FUTURE = '2026-10-07T12:30:00.000Z'
const PAST = '2026-10-07T11:00:00.000Z'

describe('getMessageStatusView', () => {
  it('PENDING в будущем — «Запланировано»', () => {
    const v = getMessageStatusView('PENDING', FUTURE, NOW)
    expect(v.key).toBe('scheduled')
    expect(v.label).toBe('Запланировано')
    expect(v.needsAttention).toBe(false)
  })

  it('PENDING с прошедшим временем — «Ожидает отправки · назначенное время прошло»', () => {
    const v = getMessageStatusView('PENDING', PAST, NOW)
    expect(v.key).toBe('overdue')
    expect(v.label).toBe('Ожидает отправки · назначенное время прошло')
    expect(v.shortLabel).toBe('Ожидает отправки')
    expect(v.needsAttention).toBe(true)
    // не обвиняем планировщик
    expect(`${v.label} ${v.description}`.toLowerCase()).not.toMatch(/сбой|cron|крон|планировщик/)
  })

  it('граница: ровно «сейчас» уже считается наступившим временем', () => {
    expect(getMessageStatusView('PENDING', NOW, NOW).key).toBe('overdue')
    expect(getMessageStatusView('PENDING', new Date(NOW.getTime() + 1), NOW).key).toBe('scheduled')
  })

  it('SENT / FAILED / CANCELLED', () => {
    expect(getMessageStatusView('SENT', PAST, NOW).label).toBe('Отправлено')
    const failed = getMessageStatusView('FAILED', PAST, NOW)
    expect(failed.label).toBe('Не отправлено')
    expect(failed.tone).toBe('danger')
    expect(failed.needsAttention).toBe(true)
    expect(getMessageStatusView('CANCELLED', FUTURE, NOW).label).toBe('Отменено')
  })

  it('время не влияет на не-PENDING статусы', () => {
    expect(getMessageStatusView('SENT', FUTURE, NOW).key).toBe('sent')
    expect(getMessageStatusView('FAILED', FUTURE, NOW).key).toBe('failed')
  })

  it('PENDING без корректного времени — «Запланировано» (не выдумываем просрочку)', () => {
    expect(getMessageStatusView('PENDING', null, NOW).key).toBe('scheduled')
    expect(getMessageStatusView('PENDING', 'not-a-date', NOW).key).toBe('scheduled')
  })

  it('неизвестный статус показывается как есть, без «Отправляется/Доставлено/Прочитано»', () => {
    const v = getMessageStatusView('WEIRD', FUTURE, NOW)
    expect(v.key).toBe('unknown')
    expect(v.label).toBe('WEIRD')
    expect(getMessageStatusView(undefined, FUTURE, NOW).label).toBe('Статус неизвестен')
  })

  it('ни один статус не использует запрещённые формулировки', () => {
    const forbidden = /отправляется|доставлено|прочитано/i
    for (const s of ['PENDING', 'SENT', 'FAILED', 'CANCELLED']) {
      for (const t of [FUTURE, PAST]) {
        const v = getMessageStatusView(s, t, NOW)
        expect(`${v.label} ${v.shortLabel} ${v.description}`).not.toMatch(forbidden)
      }
    }
  })
})

describe('isPendingOverdue / toTimestamp', () => {
  it('работает с Date, строкой и числом', () => {
    expect(isPendingOverdue('PENDING', new Date(PAST), NOW)).toBe(true)
    expect(isPendingOverdue('PENDING', PAST, NOW.getTime())).toBe(true)
    expect(isPendingOverdue('SENT', PAST, NOW)).toBe(false)
  })
  it('toTimestamp', () => {
    expect(toTimestamp(null)).toBeNull()
    expect(toTimestamp('')).toBeNull()
    expect(toTimestamp('garbage')).toBeNull()
    expect(toTimestamp(PAST)).toBe(new Date(PAST).getTime())
  })
})

describe('sanitizeErrorReason', () => {
  it('пусто → null', () => {
    expect(sanitizeErrorReason(null)).toBeNull()
    expect(sanitizeErrorReason(undefined)).toBeNull()
    expect(sanitizeErrorReason('   \n ')).toBeNull()
  })

  it('обычный текст остаётся, пробелы схлопываются', () => {
    expect(sanitizeErrorReason('Канал   не найден\n(error-room-not-found)')).toBe('Канал не найден (error-room-not-found)')
  })

  it('вырезает Bearer-токены и пары ключ=значение', () => {
    const out = sanitizeErrorReason(
      'Request failed: Authorization: Bearer abcDEF1234567890abcDEF authToken=SECRET123 password: "hunter2" X-User-Id=abc123',
    )!
    expect(out).not.toMatch(/abcDEF1234567890abcDEF|SECRET123|hunter2|abc123/)
    expect(out).toContain('[скрыто]')
    expect(out).toContain('Request failed')
  })

  it('вырезает длинные токеноподобные строки', () => {
    const token = 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8S9t0'
    const out = sanitizeErrorReason(`Invalid token ${token} for user`)!
    expect(out).not.toContain(token)
    expect(out).toContain('for user')
  })

  it('обрезает длинный текст', () => {
    const out = sanitizeErrorReason('ошибка '.repeat(200))!
    expect(out.length).toBeLessThanOrEqual(400)
    expect(out.endsWith('…')).toBe(true)
  })
})
