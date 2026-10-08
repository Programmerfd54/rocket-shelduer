import { describe, it, expect } from 'vitest'
import { buildSendTimeline, TIMELINE_STORAGE_NOTE } from '../send-timeline'

const NOW = new Date('2026-10-07T12:00:00.000Z')
const base = {
  createdAt: '2026-10-06T09:00:00.000Z',
  scheduledFor: '2026-10-07T10:00:00.000Z',
  updatedAt: '2026-10-07T10:01:00.000Z',
  scheduledBy: { name: 'Анна' },
  user: { name: 'Борис' },
}

describe('buildSendTimeline', () => {
  it('SENT: создано → назначено → отправлено со ссылкой', () => {
    const { events, note } = buildSendTimeline(
      { ...base, status: 'SENT', sentAt: '2026-10-07T10:00:05.000Z', rcPermalink: 'https://c.example/channel/g?msg=1' },
      NOW,
    )
    expect(events.map((e) => e.key)).toEqual(['created', 'scheduled', 'sent'])
    expect(events[0]).toMatchObject({ label: 'Запланировано', detail: 'Запланировал(а): Анна', state: 'done' })
    expect(events[2]).toMatchObject({ label: 'Отправлено', at: '2026-10-07T10:00:05.000Z', link: 'https://c.example/channel/g?msg=1' })
    expect(note).toBe(TIMELINE_STORAGE_NOTE)
  })

  it('SENT без ссылки: link = null; без sentAt время не выдумывается', () => {
    const { events } = buildSendTimeline({ ...base, status: 'SENT', sentAt: null }, NOW)
    expect(events[2]).toMatchObject({ key: 'sent', at: null, link: null })
  })

  it('PENDING в будущем: «Назначено на» — впереди, итоговых событий и заметки нет', () => {
    const { events, note } = buildSendTimeline(
      { ...base, status: 'PENDING', scheduledFor: '2026-10-08T10:00:00.000Z', sentAt: '2026-10-07T11:59:00.000Z' },
      NOW,
    )
    expect(events.map((e) => e.key)).toEqual(['created', 'scheduled'])
    expect(events[1].state).toBe('upcoming')
    expect(note).toBeNull()
  })

  it('PENDING: sentAt (отметка «взято в работу») не превращается в «Отправлено»', () => {
    const { events } = buildSendTimeline({ ...base, status: 'PENDING', sentAt: '2026-10-07T11:59:00.000Z' }, NOW)
    expect(events.some((e) => e.key === 'sent')).toBe(false)
    expect(events[1].state).toBe('done') // время прошло
  })

  it('FAILED: ошибка очищается от токенов, время — updatedAt', () => {
    const { events, note } = buildSendTimeline(
      { ...base, status: 'FAILED', error: 'Request failed: authToken=abcdef123456 denied' },
      NOW,
    )
    const failed = events[events.length - 1]
    expect(failed).toMatchObject({ key: 'failed', label: 'Ошибка', at: base.updatedAt, tone: 'danger' })
    expect(failed.detail).not.toContain('abcdef123456')
    expect(failed.detail).toContain('denied')
    expect(note).toBe(TIMELINE_STORAGE_NOTE)
  })

  it('FAILED без текста ошибки: честная формулировка', () => {
    const { events } = buildSendTimeline({ ...base, status: 'FAILED', error: null }, NOW)
    expect(events[events.length - 1].detail).toBe('Причина в данных не указана.')
  })

  it('CANCELLED: событие по updatedAt, без заметки', () => {
    const { events, note } = buildSendTimeline({ ...base, status: 'CANCELLED' }, NOW)
    expect(events[events.length - 1]).toMatchObject({ key: 'cancelled', label: 'Отменено', at: base.updatedAt })
    expect(note).toBeNull()
  })

  it('нет createdAt / некорректные даты: событий нет, а не «Invalid Date»', () => {
    const { events } = buildSendTimeline({ status: 'PENDING', createdAt: null, scheduledFor: 'oops' }, NOW)
    expect(events).toEqual([])
  })

  it('автор: при отсутствии scheduledBy берётся владелец, без обоих — без деталей', () => {
    expect(buildSendTimeline({ ...base, scheduledBy: null, status: 'PENDING' }, NOW).events[0].detail).toBe('Запланировал(а): Борис')
    expect(buildSendTimeline({ ...base, scheduledBy: null, user: null, status: 'PENDING' }, NOW).events[0].detail).toBeNull()
  })
})
