/**
 * Чистые хелперы для выбора даты/времени отправки сообщений:
 * 'yyyy-MM-dd' и 'HH:mm' (локальное время браузера, как в message-dialog),
 * маска времени, расчёт даты по дню интенсива, проверка «в прошлом».
 * Без зависимостей от React — легко тестируются.
 */
import { format } from 'date-fns'
import { ru } from 'date-fns/locale'

const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const TIME_RE = /^(\d{1,2}):(\d{2})$/

/* ───────────── Даты 'yyyy-MM-dd' ───────────── */

/** 'yyyy-MM-dd' → Date (локальная полночь) или null, если строка некорректна */
export function parseYmd(s: string | null | undefined): Date | null {
  if (!s) return null
  const m = YMD_RE.exec(s.trim())
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  const date = new Date(y, mo - 1, d)
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null
  return date
}

/** Date → 'yyyy-MM-dd' (локальные компоненты) */
export function toYmd(d: Date): string {
  const y = String(d.getFullYear()).padStart(4, '0')
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/** Прибавить дни к 'yyyy-MM-dd' (через UTC — без сдвигов из-за перехода на летнее время) */
export function addDaysToYmd(ymd: string, days: number): string | null {
  const m = YMD_RE.exec(ymd.trim())
  if (!m) return null
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + days)
  const d = new Date(t)
  const y = String(d.getUTCFullYear()).padStart(4, '0')
  return `${y}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
}

/** Разница в днях между двумя 'yyyy-MM-dd' (b − a) */
export function diffDaysYmd(a: string, b: string): number | null {
  const ma = YMD_RE.exec(a.trim())
  const mb = YMD_RE.exec(b.trim())
  if (!ma || !mb) return null
  const ta = Date.UTC(Number(ma[1]), Number(ma[2]) - 1, Number(ma[3]))
  const tb = Date.UTC(Number(mb[1]), Number(mb[2]) - 1, Number(mb[3]))
  return Math.round((tb - ta) / 86_400_000)
}

/**
 * Дата начала интенсива из API приходит как ISO ('2026-10-05T00:00:00.000Z'):
 * в базе это UTC-полночь выбранной даты, поэтому календарную дату берём из UTC-части.
 */
export function startDateToYmd(startDate: string | Date | null | undefined): string | null {
  if (!startDate) return null
  if (startDate instanceof Date) {
    if (Number.isNaN(startDate.getTime())) return null
    return `${String(startDate.getUTCFullYear()).padStart(4, '0')}-${String(startDate.getUTCMonth() + 1).padStart(2, '0')}-${String(startDate.getUTCDate()).padStart(2, '0')}`
  }
  const head = startDate.trim().slice(0, 10)
  if (YMD_RE.test(head) && parseYmd(head)) return head
  const d = new Date(startDate)
  return Number.isNaN(d.getTime()) ? null : startDateToYmd(d)
}

/** День интенсива шаблона → корректное целое число 1…60 или null */
export function normalizeIntensiveDay(day: number | null | undefined): number | null {
  if (day == null || !Number.isFinite(day)) return null
  const n = Math.trunc(day)
  return n >= 1 && n <= 60 ? n : null
}

/**
 * Дата отправки = дата старта интенсива + (день − 1).
 * Нет даты старта или дня → null.
 */
export function computeSuggestedSendDate(
  startDate: string | Date | null | undefined,
  intensiveDay: number | null | undefined,
): string | null {
  const start = startDateToYmd(startDate)
  const day = normalizeIntensiveDay(intensiveDay)
  if (!start || day == null) return null
  return addDaysToYmd(start, day - 1)
}

/** Номер дня интенсива для выбранной даты (1 = день старта) или null, если до старта / нет старта */
export function intensiveDayOfDate(
  startDate: string | Date | null | undefined,
  ymd: string | null | undefined,
): number | null {
  const start = startDateToYmd(startDate)
  if (!start || !ymd) return null
  const diff = diffDaysYmd(start, ymd)
  if (diff == null || diff < 0) return null
  return diff + 1
}

/* ───────────── Время 'HH:mm' ───────────── */

/** '9:5' → null, '9:05' → '09:05', '24:00' → null */
export function parseTime(time: string | null | undefined): string | null {
  if (!time) return null
  const m = TIME_RE.exec(time.trim())
  if (!m) return null
  const h = Number(m[1])
  const min = Number(m[2])
  if (h < 0 || h > 23 || min < 0 || min > 59) return null
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`
}

/**
 * Маска ввода времени. Принимает любую строку (ввод/вставка), оставляет цифры и
 * сама ставит ':' и нули: '9' → '09:', '930' → '09:30', '25' → '02:5', '09:7' → '09:07'.
 * `prev` — предыдущее значение поля: при удалении ':' в конце не возвращается.
 */
export function maskTimeInput(raw: string, prev = ''): string {
  const digits = raw.replace(/\D/g, '').slice(0, 4)
  if (!digits) return ''
  const deleting = raw.length < prev.length

  let hh: string
  let rest: string
  const d0 = digits[0]
  if (d0 > '2') {
    hh = `0${d0}`
    rest = digits.slice(1)
  } else if (digits.length >= 2) {
    const d1 = digits[1]
    if (d0 === '2' && d1 > '3') {
      hh = `0${d0}`
      rest = digits.slice(1)
    } else {
      hh = d0 + d1
      rest = digits.slice(2)
    }
  } else {
    return d0
  }

  let mm = ''
  if (rest.length > 0) {
    mm = rest[0] > '5' ? `0${rest[0]}` : rest.slice(0, 2)
  }
  if (!mm && deleting) return hh
  return `${hh}:${mm}`
}

/** Что показать/вернуть при потере фокуса: 'HH' / 'HH:' → 'HH:00', иначе как есть */
export function completeTimeOnBlur(text: string): string {
  const t = text.trim()
  if (/^\d{2}:?$/.test(t)) return `${t.slice(0, 2)}:00`
  return t
}

/** Слоты времени с шагом `stepMinutes`, начиная с `min` ('HH:mm'), включительно */
export function buildTimeSlots(stepMinutes = 15, min?: string | null): string[] {
  const step = Math.max(1, Math.min(720, Math.floor(stepMinutes) || 15))
  const minM = timeToMinutes(min ?? undefined) ?? 0
  const out: string[] = []
  for (let t = 0; t < 24 * 60; t += step) {
    if (t < minM) continue
    out.push(minutesToTime(t))
  }
  return out
}

export function timeToMinutes(time: string | null | undefined): number | null {
  const p = parseTime(time)
  if (!p) return null
  return Number(p.slice(0, 2)) * 60 + Number(p.slice(3, 5))
}

export function minutesToTime(total: number): string {
  const t = ((Math.round(total) % 1440) + 1440) % 1440
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`
}

/* ───────────── Дата + время ───────────── */

/** Date из локальных 'yyyy-MM-dd' и 'HH:mm' — ровно как `new Date(`${date}T${time}`)` в message-dialog */
export function buildScheduledDate(date: string | null | undefined, time: string | null | undefined): Date | null {
  const d = parseYmd(date)
  const t = parseTime(time)
  if (!d || !t) return null
  const result = new Date(`${toYmd(d)}T${t}`)
  return Number.isNaN(result.getTime()) ? null : result
}

/**
 * Время уже прошло? `minLeadMs` — минимальный запас вперёд (для «не раньше чем через минуту»).
 * Неполные/некорректные значения → false (ошибка «обязательное поле» показывается отдельно).
 */
export function isScheduleInPast(
  date: string | null | undefined,
  time: string | null | undefined,
  now: Date = new Date(),
  minLeadMs = 0,
): boolean {
  const scheduled = buildScheduledDate(date, time)
  if (!scheduled) return false
  return scheduled.getTime() <= now.getTime() + minLeadMs
}

/** '2026-10-08' + '09:00' → '8 октября 2026, 09:00' */
export function formatScheduleSummary(date: string | null | undefined, time: string | null | undefined): string | null {
  const s = buildScheduledDate(date, time)
  if (!s) return null
  return format(s, 'd MMMM yyyy, HH:mm', { locale: ru })
}

/** Для тоста: '8 октября, 09:00' (год — только если не текущий) */
export function formatScheduleShort(
  date: string | null | undefined,
  time: string | null | undefined,
  now: Date = new Date(),
): string | null {
  const s = buildScheduledDate(date, time)
  if (!s) return null
  const pattern = s.getFullYear() === now.getFullYear() ? 'd MMMM, HH:mm' : 'd MMMM yyyy, HH:mm'
  return format(s, pattern, { locale: ru })
}

/** '2026-10-08' → '8 октября 2026' */
export function formatDateLong(date: string | null | undefined): string | null {
  const d = parseYmd(date)
  return d ? format(d, 'd MMMM yyyy', { locale: ru }) : null
}

export interface InitialSchedule {
  date: string
  time: string
  /** true — дата вычислена из даты старта интенсива и дня шаблона */
  auto: boolean
}

/**
 * Начальные дата/время для отправки из шаблона.
 * Есть дата старта и день шаблона → старт + (день − 1) (даже если она уже в прошлом — форма покажет ошибку).
 * Иначе — ближайший слот в будущем: сегодня, если время шаблона ещё впереди (с запасом 1 мин), иначе завтра.
 */
export function pickInitialSchedule(opts: {
  startDate?: string | Date | null
  intensiveDay?: number | null
  templateTime?: string | null
  now?: Date
}): InitialSchedule {
  const now = opts.now ?? new Date()
  const time = parseTime(opts.templateTime) ?? '09:00'
  const suggested = computeSuggestedSendDate(opts.startDate, opts.intensiveDay)
  if (suggested) return { date: suggested, time, auto: true }
  const today = toYmd(now)
  if (!isScheduleInPast(today, time, now, 60_000)) return { date: today, time, auto: false }
  return { date: addDaysToYmd(today, 1) ?? today, time, auto: false }
}

/* ───────────── Каналы ───────────── */

export function normalizeChannelName(name: string | null | undefined): string {
  return (name ?? '').replace(/^#/, '').trim().toLowerCase()
}

/** Найти канал пространства по имени из шаблона ('adm', '#ADM'): сверяем name и displayName */
export function findChannelByTemplateName<T extends { name?: string | null; displayName?: string | null }>(
  channels: readonly T[],
  templateChannel: string | null | undefined,
): T | null {
  const target = normalizeChannelName(templateChannel)
  if (!target) return null
  return (
    channels.find((c) => normalizeChannelName(c.name) === target) ??
    channels.find((c) => normalizeChannelName(c.displayName) === target) ??
    null
  )
}

/* ───────────── Часовой пояс отправки ───────────── */

export interface TimeZoneLabel {
  /** IANA-имя пояса браузера ('Europe/Moscow') или '' если определить не удалось */
  timeZone: string
  /** 'UTC+3', 'UTC+5:30', 'UTC-4', 'UTC' */
  offset: string
  /** Человекочитаемое название (город/регион) на русском или null, если Intl его не знает */
  city: string | null
  /** 'Москва, UTC+3' или просто 'UTC+3' */
  label: string
}

/** IANA-пояс браузера пользователя (то же, в котором строится scheduledFor) */
export function getBrowserTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || ''
  } catch {
    return ''
  }
}

function intlZonePart(
  at: Date,
  timeZone: string | undefined,
  locale: string,
  timeZoneName: Intl.DateTimeFormatOptions['timeZoneName'],
): string | null {
  try {
    const parts = new Intl.DateTimeFormat(locale, { timeZone: timeZone || undefined, timeZoneName }).formatToParts(at)
    return parts.find((p) => p.type === 'timeZoneName')?.value ?? null
  } catch {
    return null
  }
}

/** 'GMT+5:30' / 'GMT-4' / 'GMT' → 'UTC+5:30' / 'UTC-4' / 'UTC'; иначе null */
export function shortOffsetToUtc(gmt: string | null | undefined): string | null {
  if (!gmt) return null
  const t = gmt.trim().replace('−', '-')
  if (/^(GMT|UTC)$/i.test(t)) return 'UTC'
  const m = /^(?:GMT|UTC)([+-])(\d{1,2})(?::?(\d{2}))?$/i.exec(t)
  if (!m) return null
  const mins = m[3] && m[3] !== '00' ? `:${m[3]}` : ''
  return `UTC${m[1]}${Number(m[2])}${mins}`
}

/** Смещение из getTimezoneOffset — запасной вариант, если Intl недоступен */
function offsetFromDate(at: Date): string {
  const total = -at.getTimezoneOffset()
  if (total === 0) return 'UTC'
  const sign = total > 0 ? '+' : '-'
  const abs = Math.abs(total)
  const h = Math.floor(abs / 60)
  const m = abs % 60
  return `UTC${sign}${h}${m ? `:${String(m).padStart(2, '0')}` : ''}`
}

/**
 * Метка часового пояса на момент `at` (смещение учитывает летнее время именно на эту дату).
 * Пояс — `timeZone` или пояс браузера. Название города берётся из Intl (shortGeneric, ru),
 * без собственных таблиц; если Intl отдаёт только «GMT…» — остаётся одно смещение.
 */
export function getTimeZoneLabel(at: Date, timeZone?: string, locale = 'ru'): TimeZoneLabel {
  const zone = timeZone ?? getBrowserTimeZone()
  const offset = shortOffsetToUtc(intlZonePart(at, zone, 'en-US', 'shortOffset')) ?? offsetFromDate(at)
  const rawCity = zone ? intlZonePart(at, zone, locale, 'shortGeneric') : null
  const city = rawCity && !/^(GMT|UTC)/i.test(rawCity.trim()) ? rawCity.trim() : null
  return { timeZone: zone, offset, city, label: city ? `${city}, ${offset}` : offset }
}

/**
 * '7 октября, 14:30 · Москва, UTC+3' — дата/время из полей формы (локальное время браузера,
 * как в buildScheduledDate) + пояс браузера. Нет даты или времени → null.
 */
export function formatScheduleWithZone(
  date: string | null | undefined,
  time: string | null | undefined,
  opts: { now?: Date; timeZone?: string; locale?: string } = {},
): string | null {
  const short = formatScheduleShort(date, time, opts.now)
  const at = buildScheduledDate(date, time)
  if (!short || !at) return null
  return `${short} · ${getTimeZoneLabel(at, opts.timeZone, opts.locale).label}`
}

/* ───────────── Проблемы формы отправки ───────────── */

export interface SendSummaryInput {
  channelName?: string | null
  date?: string | null
  time?: string | null
  /** false — расписание не нужно (редактирование уже отправленного) */
  requireSchedule?: boolean
  sender?: string | null
  /** Отправитель ещё загружается — не считаем его отсутствующим */
  senderLoading?: boolean
  now?: Date
  /** Минимальный запас вперёд, мс (как в форме) */
  minLeadMs?: number
}

/** Список того, что мешает отправке (для блока-сводки). Пустой список — всё указано */
export function collectSendProblems(input: SendSummaryInput): string[] {
  const out: string[] = []
  if (!(input.channelName ?? '').replace(/^#/, '').trim()) out.push('Не выбран канал')
  if (input.requireSchedule !== false) {
    const hasDate = !!parseYmd(input.date)
    const hasTime = !!parseTime(input.time)
    if (!hasDate) out.push('Не выбрана дата')
    if (!hasTime) out.push('Не указано время')
    if (hasDate && hasTime && isScheduleInPast(input.date, input.time, input.now, input.minLeadMs ?? 0)) {
      out.push('Время уже прошло')
    }
  }
  if (!input.senderLoading && !(input.sender ?? '').trim()) out.push('Не определён отправитель')
  return out
}
