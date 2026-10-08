import { describe, it, expect } from 'vitest'
import {
  filterByView,
  formatDayLabel,
  formatUntil,
  isSameLocalDay,
  parseStoredView,
  pluralRu,
  sortChronological,
  summarizeQueue,
} from '../message-queue'

// Локальные даты: тесты не зависят от пояса машины
const NOW = new Date(2026, 9, 7, 12, 0, 0)
const at = (day: number, h: number, m = 0) => new Date(2026, 9, day, h, m, 0).toISOString()

const msgs = [
  { id: 'b', status: 'PENDING', scheduledFor: at(7, 15) }, // сегодня, будущее
  { id: 'a', status: 'PENDING', scheduledFor: at(7, 9) }, // сегодня, просрочено
  { id: 'c', status: 'PENDING', scheduledFor: at(8, 10) }, // завтра
  { id: 'd', status: 'FAILED', scheduledFor: at(5, 10) }, // ошибка раньше
  { id: 'e', status: 'SENT', scheduledFor: at(7, 8) },
  { id: 'f', status: 'CANCELLED', scheduledFor: at(7, 13) },
]

describe('filterByView', () => {
  it('today: только PENDING сегодняшнего дня, по времени', () => {
    expect(filterByView(msgs, 'today', NOW).map((m) => m.id)).toEqual(['a', 'b'])
  })
  it('queue: все PENDING хронологически', () => {
    expect(filterByView(msgs, 'queue', NOW).map((m) => m.id)).toEqual(['a', 'b', 'c'])
  })
  it('attention: FAILED + просроченные PENDING', () => {
    expect(filterByView(msgs, 'attention', NOW).map((m) => m.id)).toEqual(['d', 'a'])
  })
  it('не мутирует исходный массив', () => {
    const copy = [...msgs]
    filterByView(msgs, 'queue', NOW)
    expect(msgs).toEqual(copy)
  })
})

describe('summarizeQueue', () => {
  it('считает по загруженным данным и находит ближайшее будущее', () => {
    const s = summarizeQueue(msgs, NOW)
    expect(s.pendingTotal).toBe(3)
    expect(s.todayCount).toBe(2)
    expect(s.overdueCount).toBe(1)
    expect(s.failedCount).toBe(1)
    expect(s.next?.id).toBe('b')
  })
  it('пустой список', () => {
    const s = summarizeQueue([], NOW)
    expect(s).toEqual({ pendingTotal: 0, todayCount: 0, overdueCount: 0, failedCount: 0, next: null })
  })
})

describe('sortChronological', () => {
  it('стабилен при равном времени', () => {
    const t = at(7, 10)
    const out = sortChronological([
      { id: 'z', status: 'PENDING', scheduledFor: t },
      { id: 'y', status: 'PENDING', scheduledFor: t },
    ])
    expect(out.map((m) => m.id)).toEqual(['y', 'z'])
  })
})

describe('parseStoredView', () => {
  it('принимает только известные значения', () => {
    expect(parseStoredView('today')).toBe('today')
    expect(parseStoredView('attention')).toBe('attention')
    expect(parseStoredView('all')).toBe('queue')
    expect(parseStoredView(null)).toBe('queue')
    expect(parseStoredView('')).toBe('queue')
  })
})

describe('formatUntil', () => {
  it('минуты, часы, дни, прошлое', () => {
    const now = NOW.getTime()
    expect(formatUntil(now + 25 * 60000, now)).toBe('через 25 мин')
    expect(formatUntil(now + 130 * 60000, now)).toBe('через 2 ч 10 мин')
    expect(formatUntil(now + 120 * 60000, now)).toBe('через 2 ч')
    expect(formatUntil(now + 3 * 86400000, now)).toBe('через 3 дн.')
    expect(formatUntil(now - 1000, now)).toBe('время прошло')
    expect(formatUntil('garbage', now)).toBe('')
  })
})

describe('formatDayLabel / isSameLocalDay', () => {
  it('сегодня / завтра / вчера', () => {
    expect(formatDayLabel(at(7, 20), NOW)).toBe('Сегодня')
    expect(formatDayLabel(at(8, 1), NOW)).toBe('Завтра')
    expect(formatDayLabel(at(6, 23), NOW)).toBe('Вчера')
    expect(formatDayLabel(at(20, 10), NOW)).not.toMatch(/Сегодня|Завтра|Вчера/)
  })
  it('isSameLocalDay устойчив к мусору', () => {
    expect(isSameLocalDay('x', NOW)).toBe(false)
    expect(isSameLocalDay(at(7, 1), at(7, 23))).toBe(true)
  })
})

describe('pluralRu', () => {
  const f = ['сообщение', 'сообщения', 'сообщений'] as const
  it('склоняет', () => {
    expect(pluralRu(1, f)).toBe('сообщение')
    expect(pluralRu(2, f)).toBe('сообщения')
    expect(pluralRu(5, f)).toBe('сообщений')
    expect(pluralRu(11, f)).toBe('сообщений')
    expect(pluralRu(21, f)).toBe('сообщение')
    expect(pluralRu(0, f)).toBe('сообщений')
  })
})
