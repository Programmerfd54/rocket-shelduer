/**
 * Чистые функции раскладки годового календаря. Без React и без часовых поясов:
 * даты интенсивов — календарные 'YYYY-MM-DD' (в поясе самого интенсива), считаем только по календарю.
 */
import type { IntensiveSummary } from '@/lib/intensives/types'

export const LANE_H = 44
export const BAR_H = 36
export const ROW_PAD = 8
export const MIN_BAR_W = 8
const LABEL_GAP = 8
const LANE_GAP = 8

const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек']
export const MONTH_HEADERS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек']

function parse(ymd: string): { y: number; m: number; d: number } {
  const [y, m, d] = ymd.split('-').map(Number)
  return { y, m, d }
}

function utcMs(ymd: string): number {
  const { y, m, d } = parse(ymd)
  return Date.UTC(y, m - 1, d)
}

const DAY_MS = 86_400_000

/** Разница в календарных днях b − a. */
export function diffYmd(a: string, b: string): number {
  return Math.round((utcMs(b) - utcMs(a)) / DAY_MS)
}

/** Локальная дата браузера → 'YYYY-MM-DD' (для «сегодня» на шкале). */
export function localYmd(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

export function daysInYear(year: number): number {
  return (Date.UTC(year + 1, 0, 1) - Date.UTC(year, 0, 1)) / DAY_MS
}

/** Номер дня в году (0 = 1 января); может быть <0 или ≥ N, если дата вне года. */
export function dayIndexInYear(ymd: string, year: number): number {
  return diffYmd(`${year}-01-01`, ymd)
}

export interface ClippedSpan {
  /** Первый видимый день (индекс в году, включительно) */
  startIdx: number
  /** Последний видимый день (индекс в году, включительно) */
  endIdx: number
  continuesFromPrev: boolean
  continuesToNext: boolean
}

/** Обрезает период по границам года; null — период не пересекает год. */
export function clipToYear(start: string, end: string, year: number): ClippedSpan | null {
  const n = daysInYear(year)
  const s = dayIndexInYear(start, year)
  const e = dayIndexInYear(end, year)
  if (e < 0 || s > n - 1) return null
  return {
    startIdx: Math.max(0, s),
    endIdx: Math.min(n - 1, e),
    continuesFromPrev: s < 0,
    continuesToNext: e > n - 1,
  }
}

export interface MonthSpan {
  month: number
  startIdx: number
  days: number
}

export function monthSpans(year: number): MonthSpan[] {
  const out: MonthSpan[] = []
  let idx = 0
  for (let m = 0; m < 12; m++) {
    const days = new Date(Date.UTC(year, m + 1, 0)).getUTCDate()
    out.push({ month: m, startIdx: idx, days })
    idx += days
  }
  return out
}

/** '12–25 окт' / '28 окт – 3 ноя' / '28 дек 2026 – 10 янв 2027' (для подписей на полосе). */
export function formatRangeShort(start: string, end: string): string {
  const a = parse(start)
  const b = parse(end)
  if (a.y !== b.y) return `${a.d} ${MONTHS_SHORT[a.m - 1]} ${a.y} – ${b.d} ${MONTHS_SHORT[b.m - 1]} ${b.y}`
  if (a.m === b.m) return a.d === b.d ? `${a.d} ${MONTHS_SHORT[a.m - 1]}` : `${a.d}–${b.d} ${MONTHS_SHORT[a.m - 1]}`
  return `${a.d} ${MONTHS_SHORT[a.m - 1]} – ${b.d} ${MONTHS_SHORT[b.m - 1]}`
}

/** Грубая оценка ширины текста text-xs (12px, Inter) в пикселях. */
export function estimateTextWidth(text: string, perChar = 6.4): number {
  return Math.ceil(text.length * perChar)
}

/* ───────────── Группировка ───────────── */

export interface OrgRow {
  orgSpaceId: string
  orgSpaceName: string
  items: IntensiveSummary[]
}

export function groupByOrgSpace(list: IntensiveSummary[]): OrgRow[] {
  const map = new Map<string, OrgRow>()
  for (const it of list) {
    let row = map.get(it.orgSpace.id)
    if (!row) {
      row = { orgSpaceId: it.orgSpace.id, orgSpaceName: it.orgSpace.name, items: [] }
      map.set(it.orgSpace.id, row)
    }
    row.items.push(it)
  }
  const rows = Array.from(map.values())
  rows.forEach((r) => r.items.sort((a, b) => a.startDate.localeCompare(b.startDate) || a.endDate.localeCompare(b.endDate)))
  rows.sort((a, b) => a.orgSpaceName.localeCompare(b.orgSpaceName, 'ru'))
  return rows
}

export interface MonthGroup {
  /** 'prev' — начались в прошлом году; иначе номер месяца 0..11 */
  key: 'prev' | number
  items: IntensiveSummary[]
}

/** Группы по месяцу начала внутри года; начавшиеся раньше — отдельной первой группой. */
export function groupByStartMonth(list: IntensiveSummary[], year: number): MonthGroup[] {
  const prev: IntensiveSummary[] = []
  const months: IntensiveSummary[][] = Array.from({ length: 12 }, () => [])
  for (const it of list) {
    const s = dayIndexInYear(it.startDate, year)
    if (s < 0) prev.push(it)
    else months[parse(it.startDate).m - 1].push(it)
  }
  const sortFn = (a: IntensiveSummary, b: IntensiveSummary) =>
    a.startDate.localeCompare(b.startDate) || a.orgSpace.name.localeCompare(b.orgSpace.name, 'ru')
  const out: MonthGroup[] = []
  if (prev.length) out.push({ key: 'prev', items: prev.sort(sortFn) })
  months.forEach((items, m) => {
    if (items.length) out.push({ key: m, items: items.sort(sortFn) })
  })
  return out
}

/* ───────────── Раскладка полос ───────────── */

export interface BarGeometry {
  id: string
  /** Левый край и ширина самой полосы, px */
  barLeft: number
  barWidth: number
  /** Где подпись: внутри полосы, справа, слева */
  labelMode: 'inside' | 'right' | 'left'
  /** Ширина подписи вне полосы, px (для inside = 0) */
  labelWidth: number
  /** Полный занимаемый отрезок (полоса + подпись), px */
  footLeft: number
  footRight: number
  span: ClippedSpan
}

export interface BarInput {
  id: string
  name: string
  dates: string
  span: ClippedSpan
}

/** Геометрия полос в пикселях при ширине дорожки `trackW`. */
export function computeGeometry(input: BarInput, year: number, trackW: number): BarGeometry {
  const n = daysInYear(year)
  const x0 = (input.span.startIdx / n) * trackW
  const x1 = ((input.span.endIdx + 1) / n) * trackW
  const barWidth = Math.max(MIN_BAR_W, x1 - x0)
  const barLeft = Math.min(x0, Math.max(0, trackW - barWidth))
  const barRight = barLeft + barWidth
  const fullLabel = estimateTextWidth(input.name, 6.8) + 8 + estimateTextWidth(input.dates, 6) + 22 // + иконка статуса
  if (barWidth >= 150) {
    return { id: input.id, barLeft, barWidth, labelMode: 'inside', labelWidth: 0, footLeft: barLeft, footRight: barRight, span: input.span }
  }
  const roomRight = trackW - barRight - LABEL_GAP
  const roomLeft = barLeft - LABEL_GAP
  const side: 'right' | 'left' = roomRight >= Math.min(fullLabel, 130) || roomRight >= roomLeft ? 'right' : 'left'
  const room = Math.max(40, side === 'right' ? roomRight : roomLeft)
  const labelWidth = Math.min(fullLabel, room)
  return {
    id: input.id,
    barLeft,
    barWidth,
    labelMode: side,
    labelWidth,
    footLeft: side === 'left' ? barLeft - LABEL_GAP - labelWidth : barLeft,
    footRight: side === 'right' ? barRight + LABEL_GAP + labelWidth : barRight,
    span: input.span,
  }
}

/** Жадная укладка по дорожкам: полосы с подписями не перекрываются. */
export function packLanes(geoms: BarGeometry[]): { lanes: Map<string, number>; laneCount: number } {
  const sorted = [...geoms].sort((a, b) => a.footLeft - b.footLeft || a.footRight - b.footRight)
  const laneEnds: number[] = []
  const lanes = new Map<string, number>()
  for (const g of sorted) {
    let lane = laneEnds.findIndex((end) => end + LANE_GAP <= g.footLeft)
    if (lane === -1) {
      lane = laneEnds.length
      laneEnds.push(g.footRight)
    } else {
      laneEnds[lane] = g.footRight
    }
    lanes.set(g.id, lane)
  }
  return { lanes, laneCount: Math.max(1, laneEnds.length) }
}

export function rowHeight(laneCount: number): number {
  return laneCount * LANE_H + ROW_PAD * 2 - (LANE_H - BAR_H)
}
