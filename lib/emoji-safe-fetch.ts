/**
 * Безопасная загрузка внешних ресурсов для импорта эмодзи (YAML-каталог и картинки по ссылкам из него).
 *
 * URL каталога задаёт пользователь, а ссылки на картинки берутся из стороннего YAML — без проверок это
 * полноценный SSRF: сервер скачал бы http://169.254.169.254/… или http://localhost:…/ и загрузил ответ
 * в Rocket.Chat (которым может управлять атакующий). Здесь:
 *  - только http/https, без userinfo, порты 80/443/8080/8443 или стандартный;
 *  - запрет внутренних адресов: литералы + DNS-резолв всех A/AAAA (IPv4 private/loopback/link-local/CGNAT/…,
 *    IPv6 loopback/ULA/link-local/IPv4-mapped/NAT64);
 *  - редиректы вручную (до 3), каждая цель проверяется заново;
 *  - ограничение размера ответа (по Content-Length и по факту чтения потока) и таймаут.
 *  - DNS rebinding (TOCTOU): запрос идёт через undici-диспетчер, который повторно проверяет каждый адрес
 *    в момент подключения сокета и подключается только к проверенному IP (см. createSsrfSafeLookup).
 */
import { lookup } from 'dns/promises'
import { isIP } from 'net'
import type { Dispatcher } from 'undici'
import { classifyIp, createSsrfSafeDispatcher, isSsrfUrl } from '@/lib/ssrf'

const ALLOWED_PORTS = new Set(['', '80', '443', '8080', '8443'])

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, o) => (acc << 8) + Number(o), 0) >>> 0
}

function inV4Range(ip: string, cidr: string): boolean {
  const [base, bitsStr] = cidr.split('/')
  const bits = Number(bitsStr)
  const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0
  return (ipv4ToInt(ip) & mask) === (ipv4ToInt(base) & mask)
}

const BLOCKED_V4 = [
  '0.0.0.0/8',
  '10.0.0.0/8',
  '100.64.0.0/10',
  '127.0.0.0/8',
  '169.254.0.0/16',
  '172.16.0.0/12',
  '192.0.0.0/24',
  '192.0.2.0/24',
  '192.168.0.0/16',
  '198.18.0.0/15',
  '198.51.100.0/24',
  '203.0.113.0/24',
  '224.0.0.0/4',
  '240.0.0.0/4',
]

/** true — адрес внутренний/служебный (к нему ходить нельзя). */
export function isPrivateIp(ip: string): boolean {
  const v = ip.replace(/^\[|\]$/g, '').toLowerCase()
  const fam = isIP(v)
  // Общий классификатор (в т.ч. 6to4/Teredo/NAT64 со встроенным внутренним IPv4) + доп. списки ниже
  if (fam !== 0 && classifyIp(v) !== 'public') return true
  if (fam === 4) return BLOCKED_V4.some((c) => inV4Range(v, c))
  if (fam === 6) {
    if (v === '::' || v === '::1') return true
    // IPv4-mapped / IPv4-compatible (::ffff:127.0.0.1, ::ffff:7f00:1)
    const mapped = v.match(/^::(?:ffff:(?:0:)?)?(\d+\.\d+\.\d+\.\d+)$/)
    if (mapped) return isPrivateIp(mapped[1])
    const mappedHex = v.match(/^::(?:ffff:(?:0:)?)?([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
    if (mappedHex) {
      const hi = parseInt(mappedHex[1], 16)
      const lo = parseInt(mappedHex[2], 16)
      return isPrivateIp(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`)
    }
    const first = parseInt(v.split(':')[0] || '0', 16)
    if ((first & 0xfe00) === 0xfc00) return true // fc00::/7 ULA
    if ((first & 0xffc0) === 0xfe80) return true // fe80::/10 link-local
    if ((first & 0xff00) === 0xff00) return true // multicast
    if (v.startsWith('64:ff9b:')) return true // NAT64
    if (v.startsWith('2001:db8:')) return true // documentation
    return false
  }
  return true // не IP — вызывать только для IP
}

/** Синхронная проверка URL (без DNS): схема, порт, userinfo, литеральные внутренние адреса. */
export function checkPublicHttpUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL
  try {
    u = new URL(String(raw || '').trim())
  } catch {
    return { ok: false, reason: 'Некорректная ссылка' }
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return { ok: false, reason: 'Допустимы только ссылки http(s)' }
  if (u.username || u.password) return { ok: false, reason: 'Ссылка не должна содержать логин/пароль' }
  if (!ALLOWED_PORTS.has(u.port)) return { ok: false, reason: 'Недопустимый порт' }
  if (isSsrfUrl(u.toString())) return { ok: false, reason: 'Внутренние адреса запрещены' }
  const host = u.hostname.replace(/^\[|\]$/g, '')
  if (isIP(host) && isPrivateIp(host)) return { ok: false, reason: 'Внутренние адреса запрещены' }
  if (!isIP(host) && (!host.includes('.') || /\.(local|localhost|internal|lan|home|corp|intranet)$/i.test(host))) {
    return { ok: false, reason: 'Внутренние адреса запрещены' }
  }
  return { ok: true, url: u }
}

/**
 * Диспетчер для импорта эмодзи: в момент подключения допускаются только публичные адреса
 * (SSRF_ALLOWED_HOSTS здесь не действует — ссылки берутся из стороннего YAML).
 */
let publicOnlyDispatcher: Dispatcher | null = null
export function getPublicOnlyDispatcher(): Dispatcher {
  publicOnlyDispatcher ??= createSsrfSafeDispatcher({
    allowPrivateHost: () => false,
    isAddressAllowed: (address) => !isPrivateIp(address),
  })
  return publicOnlyDispatcher
}

type Resolver = (host: string) => Promise<string[]>
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true, verbatim: true })).map((a) => a.address)

/** Полная проверка: синхронная + все резолвленные адреса хоста публичные. */
export async function assertPublicHttpUrl(raw: string, resolve: Resolver = defaultResolver): Promise<URL> {
  const res = checkPublicHttpUrl(raw)
  if (!res.ok) throw new SafeFetchError(res.reason)
  const host = res.url.hostname.replace(/^\[|\]$/g, '')
  if (!isIP(host)) {
    let addrs: string[]
    try {
      addrs = await resolve(host)
    } catch {
      throw new SafeFetchError('Не удалось определить адрес сервера')
    }
    if (!addrs.length || addrs.some((a) => isPrivateIp(a))) throw new SafeFetchError('Внутренние адреса запрещены')
  }
  return res.url
}

export class SafeFetchError extends Error {
  constructor(message: string, public status?: number) {
    super(message)
    this.name = 'SafeFetchError'
  }
}

/** Читает тело ответа, обрывая при превышении maxBytes. */
export async function readBodyLimited(res: Response, maxBytes: number): Promise<Uint8Array> {
  const declared = Number(res.headers.get('content-length') || 0)
  if (declared > maxBytes) throw new SafeFetchError(`Ответ слишком большой (>${Math.round(maxBytes / 1024)} КБ)`)
  if (!res.body) return new Uint8Array(0)
  const reader = res.body.getReader()
  const chunks: Uint8Array[] = []
  let total = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    total += value.byteLength
    if (total > maxBytes) {
      await reader.cancel().catch(() => {})
      throw new SafeFetchError(`Ответ слишком большой (>${Math.round(maxBytes / 1024)} КБ)`)
    }
    chunks.push(value)
  }
  const out = new Uint8Array(total)
  let off = 0
  for (const c of chunks) {
    out.set(c, off)
    off += c.byteLength
  }
  return out
}

export interface SafeFetchResult {
  status: number
  ok: boolean
  statusText: string
  contentType: string
  body: Uint8Array
}

/**
 * GET внешнего ресурса с проверкой SSRF на каждом шаге редиректа и лимитом размера.
 * Бросает SafeFetchError при нарушении политики; HTTP-ошибки возвращает как ok=false.
 */
export async function safeFetchPublic(
  rawUrl: string,
  opts: { maxBytes: number; timeoutMs: number; maxRedirects?: number; resolve?: Resolver; accept?: string }
): Promise<SafeFetchResult> {
  const maxRedirects = opts.maxRedirects ?? 3
  let current = rawUrl
  const signal = AbortSignal.timeout(opts.timeoutMs)
  for (let hop = 0; hop <= maxRedirects; hop++) {
    const url = await assertPublicHttpUrl(current, opts.resolve)
    const res = await fetch(url, {
      redirect: 'manual',
      signal,
      headers: opts.accept ? { Accept: opts.accept } : undefined,
      dispatcher: getPublicOnlyDispatcher(),
    } as RequestInit)
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location')
      await res.body?.cancel().catch(() => {})
      if (!loc) throw new SafeFetchError('Редирект без адреса')
      current = new URL(loc, url).toString()
      continue
    }
    if (!res.ok) {
      await res.body?.cancel().catch(() => {})
      return { status: res.status, ok: false, statusText: res.statusText, contentType: res.headers.get('content-type') || '', body: new Uint8Array(0) }
    }
    const body = await readBodyLimited(res, opts.maxBytes)
    return { status: res.status, ok: true, statusText: res.statusText, contentType: res.headers.get('content-type') || '', body }
  }
  throw new SafeFetchError('Слишком много редиректов')
}
