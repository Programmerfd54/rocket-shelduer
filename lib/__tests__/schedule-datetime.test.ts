import { describe, it, expect } from 'vitest'
import {
  addDaysToYmd,
  buildScheduledDate,
  buildTimeSlots,
  completeTimeOnBlur,
  collectSendProblems,
  computeSuggestedSendDate,
  diffDaysYmd,
  findChannelByTemplateName,
  formatScheduleShort,
  formatScheduleSummary,
  formatScheduleWithZone,
  getTimeZoneLabel,
  shortOffsetToUtc,
  intensiveDayOfDate,
  isScheduleInPast,
  maskTimeInput,
  parseTime,
  parseYmd,
  pickInitialSchedule,
  startDateToYmd,
  toYmd,
} from '../schedule-datetime'

describe('ymd helpers', () => {
  it('parseYmd валидирует дату', () => {
    expect(parseYmd('2026-10-08')).not.toBeNull()
    expect(parseYmd('2026-02-30')).toBeNull()
    expect(parseYmd('2026-1-8')).toBeNull()
    expect(parseYmd('')).toBeNull()
    expect(parseYmd(null)).toBeNull()
  })

  it('toYmd использует локальные компоненты', () => {
    expect(toYmd(new Date(2026, 9, 8, 23, 59))).toBe('2026-10-08')
  })

  it('addDaysToYmd пересекает месяц и год', () => {
    expect(addDaysToYmd('2026-10-31', 1)).toBe('2026-11-01')
    expect(addDaysToYmd('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDaysToYmd('2026-03-01', -1)).toBe('2026-02-28')
    expect(addDaysToYmd('bad', 1)).toBeNull()
  })

  it('diffDaysYmd', () => {
    expect(diffDaysYmd('2026-10-05', '2026-10-08')).toBe(3)
    expect(diffDaysYmd('2026-10-08', '2026-10-05')).toBe(-3)
  })
})

describe('startDateToYmd', () => {
  it('берёт календарную дату из ISO (UTC-полночь из БД)', () => {
    expect(startDateToYmd('2026-10-05T00:00:00.000Z')).toBe('2026-10-05')
    expect(startDateToYmd('2026-10-05')).toBe('2026-10-05')
    expect(startDateToYmd(new Date('2026-10-05T00:00:00.000Z'))).toBe('2026-10-05')
  })
  it('пустое/некорректное → null', () => {
    expect(startDateToYmd(null)).toBeNull()
    expect(startDateToYmd(undefined)).toBeNull()
    expect(startDateToYmd('')).toBeNull()
    expect(startDateToYmd('не дата')).toBeNull()
  })
})

describe('computeSuggestedSendDate', () => {
  it('день 1 = дата старта', () => {
    expect(computeSuggestedSendDate('2026-10-05T00:00:00.000Z', 1)).toBe('2026-10-05')
  })
  it('день N = старт + (N − 1)', () => {
    expect(computeSuggestedSendDate('2026-10-05T00:00:00.000Z', 3)).toBe('2026-10-07')
    expect(computeSuggestedSendDate('2026-10-28T00:00:00.000Z', 14)).toBe('2026-11-10')
  })
  it('нет старта или дня → null', () => {
    expect(computeSuggestedSendDate(null, 3)).toBeNull()
    expect(computeSuggestedSendDate('2026-10-05T00:00:00.000Z', null)).toBeNull()
    expect(computeSuggestedSendDate('2026-10-05T00:00:00.000Z', undefined)).toBeNull()
    expect(computeSuggestedSendDate('2026-10-05T00:00:00.000Z', 0)).toBeNull()
    expect(computeSuggestedSendDate('2026-10-05T00:00:00.000Z', -2)).toBeNull()
  })
})

describe('intensiveDayOfDate', () => {
  it('считает день интенсива', () => {
    expect(intensiveDayOfDate('2026-10-05T00:00:00.000Z', '2026-10-05')).toBe(1)
    expect(intensiveDayOfDate('2026-10-05T00:00:00.000Z', '2026-10-07')).toBe(3)
  })
  it('до старта → null', () => {
    expect(intensiveDayOfDate('2026-10-05T00:00:00.000Z', '2026-10-04')).toBeNull()
    expect(intensiveDayOfDate(null, '2026-10-04')).toBeNull()
  })
})

describe('parseTime', () => {
  it('нормализует и проверяет диапазон', () => {
    expect(parseTime('9:05')).toBe('09:05')
    expect(parseTime('09:00')).toBe('09:00')
    expect(parseTime('23:59')).toBe('23:59')
    expect(parseTime('24:00')).toBeNull()
    expect(parseTime('12:60')).toBeNull()
    expect(parseTime('12:5')).toBeNull()
    expect(parseTime('')).toBeNull()
  })
})

describe('maskTimeInput', () => {
  it('ставит двоеточие после двух цифр часа', () => {
    expect(maskTimeInput('0')).toBe('0')
    expect(maskTimeInput('09', '0')).toBe('09:')
    expect(maskTimeInput('0930', '09:')).toBe('09:30')
    expect(maskTimeInput('09:3', '09:')).toBe('09:3')
  })
  it('дописывает ноль к часу > 2', () => {
    expect(maskTimeInput('9')).toBe('09:')
    expect(maskTimeInput('93')).toBe('09:3')
  })
  it('невозможный час сдвигается в минуты', () => {
    expect(maskTimeInput('25')).toBe('02:5')
    expect(maskTimeInput('24')).toBe('02:4')
    expect(maskTimeInput('23')).toBe('23:')
  })
  it('минуты > 5 получают ведущий ноль', () => {
    expect(maskTimeInput('09:7')).toBe('09:07')
    expect(maskTimeInput('1260')).toBe('12:06')
  })
  it('вставка: цифры, "9:30", "2359", с мусором', () => {
    expect(maskTimeInput('930')).toBe('09:30')
    expect(maskTimeInput('9:30')).toBe('09:30')
    expect(maskTimeInput('2359')).toBe('23:59')
    expect(maskTimeInput(' 09 : 30 мск')).toBe('09:30')
    expect(maskTimeInput('abc')).toBe('')
  })
  it('обрезает лишние цифры', () => {
    expect(maskTimeInput('123456')).toBe('12:34')
  })
  it('при удалении двоеточие не возвращается', () => {
    expect(maskTimeInput('09', '09:')).toBe('09')
    expect(maskTimeInput('09:3', '09:30')).toBe('09:3')
    expect(maskTimeInput('0', '09')).toBe('0')
  })
})

describe('completeTimeOnBlur', () => {
  it('часы без минут → :00', () => {
    expect(completeTimeOnBlur('09:')).toBe('09:00')
    expect(completeTimeOnBlur('09')).toBe('09:00')
    expect(completeTimeOnBlur('09:3')).toBe('09:3')
    expect(completeTimeOnBlur('')).toBe('')
  })
})

describe('buildTimeSlots', () => {
  it('шаг 15 минут → 96 слотов', () => {
    const s = buildTimeSlots(15)
    expect(s).toHaveLength(96)
    expect(s[0]).toBe('00:00')
    expect(s[95]).toBe('23:45')
  })
  it('учитывает min и шаг', () => {
    expect(buildTimeSlots(30, '22:10')).toEqual(['22:30', '23:00', '23:30'])
    expect(buildTimeSlots(60, '23:00')).toEqual(['23:00'])
  })
})

describe('isScheduleInPast / buildScheduledDate', () => {
  const now = new Date(2026, 9, 7, 12, 0, 0)
  it('прошлое и будущее', () => {
    expect(isScheduleInPast('2026-10-07', '11:59', now)).toBe(true)
    expect(isScheduleInPast('2026-10-07', '12:00', now)).toBe(true)
    expect(isScheduleInPast('2026-10-07', '12:01', now)).toBe(false)
    expect(isScheduleInPast('2026-10-08', '00:00', now)).toBe(false)
  })
  it('запас вперёд (минимум +1 мин)', () => {
    expect(isScheduleInPast('2026-10-07', '12:01', now, 60_000)).toBe(true)
    expect(isScheduleInPast('2026-10-07', '12:02', now, 60_000)).toBe(false)
  })
  it('неполные значения не считаются прошлым', () => {
    expect(isScheduleInPast('', '12:00', now)).toBe(false)
    expect(isScheduleInPast('2026-10-07', '', now)).toBe(false)
  })
  it('buildScheduledDate совпадает с new Date(`${d}T${t}`)', () => {
    const d = buildScheduledDate('2026-10-08', '09:00')!
    expect(d.getTime()).toBe(new Date('2026-10-08T09:00').getTime())
    expect(buildScheduledDate('2026-10-08', '25:00')).toBeNull()
  })
})

describe('форматирование', () => {
  it('summary и short на русском', () => {
    expect(formatScheduleSummary('2026-10-08', '09:00')).toBe('8 октября 2026, 09:00')
    const now = new Date(2026, 9, 7)
    expect(formatScheduleShort('2026-10-08', '09:00', now)).toBe('8 октября, 09:00')
    expect(formatScheduleShort('2027-01-02', '18:30', now)).toBe('2 января 2027, 18:30')
    expect(formatScheduleSummary('', '09:00')).toBeNull()
  })
})

describe('pickInitialSchedule', () => {
  const now = new Date(2026, 9, 7, 12, 0, 0)
  it('старт + день шаблона, время из шаблона', () => {
    expect(
      pickInitialSchedule({ startDate: '2026-10-05T00:00:00.000Z', intensiveDay: 3, templateTime: '9:30', now }),
    ).toEqual({ date: '2026-10-07', time: '09:30', auto: true })
  })
  it('нет старта: сегодня, если время шаблона впереди', () => {
    expect(pickInitialSchedule({ intensiveDay: 3, templateTime: '18:00', now })).toEqual({
      date: '2026-10-07',
      time: '18:00',
      auto: false,
    })
  })
  it('нет старта: завтра, если время уже прошло', () => {
    expect(pickInitialSchedule({ templateTime: '09:21', now })).toEqual({
      date: '2026-10-08',
      time: '09:21',
      auto: false,
    })
  })
  it('нет дня шаблона: ближайший слот', () => {
    expect(
      pickInitialSchedule({ startDate: '2026-10-05T00:00:00.000Z', intensiveDay: null, templateTime: '12:00', now }).auto,
    ).toBe(false)
  })
  it('некорректное время шаблона → 09:00', () => {
    expect(pickInitialSchedule({ templateTime: 'abc', now }).time).toBe('09:00')
  })
})

describe('findChannelByTemplateName', () => {
  const channels = [
    { id: '1', name: 'general', displayName: 'General' },
    { id: '2', name: 'adm-chat', displayName: 'ADM' },
    { id: '3', name: 'announcements', displayName: 'Анонсы' },
  ]
  it('находит без учёта регистра и #', () => {
    expect(findChannelByTemplateName(channels, '#Announcements')?.id).toBe('3')
    expect(findChannelByTemplateName(channels, 'GENERAL')?.id).toBe('1')
  })
  it('сверяет displayName, если по name нет', () => {
    expect(findChannelByTemplateName(channels, 'adm')?.id).toBe('2')
  })
  it('не найден → null', () => {
    expect(findChannelByTemplateName(channels, 'xyz')).toBeNull()
    expect(findChannelByTemplateName(channels, '')).toBeNull()
  })
})

describe('часовой пояс отправки', () => {
  it('shortOffsetToUtc переводит GMT-смещения', () => {
    expect(shortOffsetToUtc('GMT+3')).toBe('UTC+3')
    expect(shortOffsetToUtc('GMT+5:30')).toBe('UTC+5:30')
    expect(shortOffsetToUtc('GMT-4')).toBe('UTC-4')
    expect(shortOffsetToUtc('GMT')).toBe('UTC')
    expect(shortOffsetToUtc('что-то')).toBeNull()
    expect(shortOffsetToUtc(null)).toBeNull()
  })

  it('getTimeZoneLabel: явный пояс', () => {
    const at = new Date('2026-10-07T12:00:00Z')
    const msk = getTimeZoneLabel(at, 'Europe/Moscow')
    expect(msk.offset).toBe('UTC+3')
    expect(msk.label).toBe('Москва, UTC+3')
    expect(getTimeZoneLabel(at, 'Asia/Kolkata').offset).toBe('UTC+5:30')
  })

  it('getTimeZoneLabel учитывает летнее время на дату отправки', () => {
    expect(getTimeZoneLabel(new Date('2026-07-01T12:00:00Z'), 'America/New_York').offset).toBe('UTC-4')
    expect(getTimeZoneLabel(new Date('2026-01-15T12:00:00Z'), 'America/New_York').offset).toBe('UTC-5')
  })

  it('UTC без названия города → только смещение', () => {
    const l = getTimeZoneLabel(new Date('2026-10-07T12:00:00Z'), 'UTC')
    expect(l.city).toBeNull()
    expect(l.label).toBe('UTC')
  })

  it('без явного пояса берётся пояс окружения и не падает', () => {
    const l = getTimeZoneLabel(new Date('2026-10-07T12:00:00Z'))
    expect(l.offset).toMatch(/^UTC([+-]\d{1,2}(:\d{2})?)?$/)
    expect(l.label.endsWith(l.offset)).toBe(true)
  })

  it('formatScheduleWithZone: дата · время · пояс', () => {
    const now = new Date('2026-10-01T10:00:00')
    expect(formatScheduleWithZone('2026-10-07', '14:30', { now, timeZone: 'Europe/Moscow' })).toBe(
      '7 октября, 14:30 · Москва, UTC+3',
    )
    expect(formatScheduleWithZone('2027-01-07', '09:00', { now, timeZone: 'UTC' })).toBe('7 января 2027, 09:00 · UTC')
    expect(formatScheduleWithZone('', '14:30')).toBeNull()
    expect(formatScheduleWithZone('2026-10-07', '99:99')).toBeNull()
  })
})

describe('collectSendProblems', () => {
  const now = new Date('2026-10-07T10:00:00')
  const ok = { channelName: 'объявления', date: '2026-10-08', time: '14:30', sender: '@anna', now }

  it('всё указано → проблем нет', () => {
    expect(collectSendProblems(ok)).toEqual([])
  })

  it('нет канала, даты, времени, отправителя', () => {
    expect(collectSendProblems({ ...ok, channelName: '#', date: '', time: '', sender: null })).toEqual([
      'Не выбран канал',
      'Не выбрана дата',
      'Не указано время',
      'Не определён отправитель',
    ])
  })

  it('время в прошлом', () => {
    expect(collectSendProblems({ ...ok, date: '2026-10-07', time: '09:00' })).toEqual(['Время уже прошло'])
  })

  it('отправитель загружается — не проблема; расписание можно не требовать', () => {
    expect(collectSendProblems({ ...ok, sender: null, senderLoading: true })).toEqual([])
    expect(collectSendProblems({ ...ok, date: '', time: '', requireSchedule: false })).toEqual([])
  })
})
