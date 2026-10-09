/**
 * Защита от SSRF: блокировка внутренних и опасных URL.
 *
 * - isSsrfUrl / assertSafeWorkspaceUrl — синхронная проверка строки URL (схема, имя хоста, IP-литерал).
 *   Используется при добавлении/изменении workspaceUrl.
 * - assertSafeOutboundUrl — то же + DNS-резолв хоста: имя, указывающее на внутренний адрес
 *   (127.0.0.1.nip.io, внутренний DNS и т.п.), тоже блокируется.
 * - safeFetch — fetch для серверных запросов к Rocket.Chat: проверяет каждый URL (включая цели
 *   редиректов), сам проходит редиректы и не пересылает токены RC на другой origin.
 * - getSsrfSafeDispatcher / createSsrfSafeLookup — проверка адреса в момент подключения сокета
 *   (undici Agent с собственным lookup): закрывает DNS rebinding между проверкой и fetch (TOCTOU).
 *   safeFetch всегда передаёт этот диспетчер.
 *
 * 6to4 (2002::/16), Teredo (2001::/32) и NAT64 (64:ff9b::/96, 64:ff9b:1::/48) классифицируются
 * не мягче встроенного IPv4-адреса.
 *
 * Всегда блокируются: loopback, link-local (в т.ч. облачные metadata 169.254.169.254),
 * 0.0.0.0/8, multicast/reserved, IPv6 ::/::1/fe80::/ff00::, IPv4-mapped варианты.
 * Частные сети (RFC1918, CGNAT 100.64/10, IPv6 ULA fc00::/7) тоже блокируются, но конкретные
 * хосты можно разрешить через env SSRF_ALLOWED_HOSTS="rc.corp.example,10.0.0.5"
 * (например, Rocket.Chat во внутренней сети / за VPN).
 */

import { isIP } from 'node:net';
import { lookup as dnsLookupCb } from 'node:dns';
import { lookup } from 'node:dns/promises';
import { Agent, type Dispatcher } from 'undici';

const BLOCKED_HOSTNAMES = new Set([
  'localhost',
  'metadata',
  'metadata.google.internal',
  'instance-data',
  'instance-data.ec2.internal',
]);

type Cidr = { base: bigint; bits: number; size: 32 | 128 };

function ipv4ToBigInt(ip: string): bigint | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let n = BigInt(0);
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null;
    const v = Number(p);
    if (v > 255) return null;
    n = (n << BigInt(8)) + BigInt(v);
  }
  return n;
}

function ipv6ToBigInt(ip: string): bigint | null {
  let addr = ip.toLowerCase();
  const zone = addr.indexOf('%');
  if (zone >= 0) addr = addr.slice(0, zone);
  // Хвост в виде IPv4 (::ffff:1.2.3.4)
  const lastColon = addr.lastIndexOf(':');
  const tail = addr.slice(lastColon + 1);
  if (tail.includes('.')) {
    const v4 = ipv4ToBigInt(tail);
    if (v4 == null) return null;
    const hi = (v4 >> BigInt(16)).toString(16);
    const lo = (v4 & BigInt(0xffff)).toString(16);
    addr = `${addr.slice(0, lastColon + 1)}${hi}:${lo}`;
  }
  const halves = addr.split('::');
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(':') : [];
  const rest = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - head.length - rest.length;
  if (halves.length === 1 && missing !== 0) return null;
  if (missing < 0) return null;
  const groups = [...head, ...Array(halves.length === 2 ? missing : 0).fill('0'), ...rest];
  if (groups.length !== 8) return null;
  let n = BigInt(0);
  for (const g of groups) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    n = (n << BigInt(16)) + BigInt(parseInt(g, 16));
  }
  return n;
}

function cidr(spec: string): Cidr {
  const [ip, bitsRaw] = spec.split('/');
  const v4 = ip.includes(':') ? null : ipv4ToBigInt(ip);
  const size: 32 | 128 = v4 != null ? 32 : 128;
  const base = v4 != null ? v4 : ipv6ToBigInt(ip);
  if (base == null) throw new Error(`Bad CIDR ${spec}`);
  return { base, bits: Number(bitsRaw), size };
}

function inCidr(n: bigint, size: 32 | 128, range: Cidr): boolean {
  if (range.size !== size) return false;
  const shift = BigInt(size - range.bits);
  return n >> shift === range.base >> shift;
}

/** Никогда не допустимы (даже через SSRF_ALLOWED_HOSTS). */
const ALWAYS_BLOCKED = [
  '0.0.0.0/8',
  '127.0.0.0/8',
  '169.254.0.0/16', // link-local, cloud metadata
  '192.0.0.0/24',
  '224.0.0.0/4', // multicast
  '240.0.0.0/4', // reserved + broadcast
  '::/128',
  '::1/128',
  '100::/64', // discard-only
  '2001:db8::/32', // documentation, не маршрутизируется
  'fe80::/10',
  'fec0::/10', // устаревшие site-local
  'ff00::/8',
].map(cidr);

/** Частные сети: блокируются, если хост не указан в SSRF_ALLOWED_HOSTS. */
const PRIVATE_RANGES = [
  '10.0.0.0/8',
  '172.16.0.0/12',
  '192.168.0.0/16',
  '100.64.0.0/10', // CGNAT (в т.ч. 100.100.100.200 — metadata Alibaba)
  '198.18.0.0/15',
  'fc00::/7', // IPv6 ULA
  '64:ff9b::/96', // NAT64 (well-known prefix) — может маппиться на внутренние IPv4
  '64:ff9b:1::/48', // NAT64 local-use (RFC 8215)
].map(cidr);

const MAPPED_V4 = cidr('::ffff:0:0/96');
const COMPAT_V4 = cidr('::/96');
/** 6to4 (RFC 3056): 2002:AABB:CCDD::/48 → IPv4 AA.BB.CC.DD (биты 16..47). */
const SIX_TO_FOUR = cidr('2002::/16');
/** Teredo (RFC 4380): 2001:0000::/32; IPv4 сервера — биты 32..63, IPv4 клиента — младшие 32 бита XOR 0xffffffff. */
const TEREDO = cidr('2001::/32');
const NAT64_WKP = cidr('64:ff9b::/96');

const V4_MASK = BigInt(0xffffffff);

export type AddressClass = 'public' | 'private' | 'blocked' | 'invalid';

const CLASS_RANK: Record<AddressClass, number> = { public: 0, private: 1, blocked: 2, invalid: 3 };

/** Более строгий из двух классов. */
function stricter(a: AddressClass, b: AddressClass): AddressClass {
  return CLASS_RANK[a] >= CLASS_RANK[b] ? a : b;
}

function classifyNumeric(n: bigint, size: 32 | 128): AddressClass {
  if (ALWAYS_BLOCKED.some((r) => inCidr(n, size, r))) return 'blocked';
  if (PRIVATE_RANGES.some((r) => inCidr(n, size, r))) return 'private';
  return 'public';
}

/** Классифицирует IP-адрес (IPv4 или IPv6, без скобок). */
export function classifyIp(address: string): AddressClass {
  const raw = address.replace(/^\[|\]$/g, '');
  const family = isIP(raw.split('%')[0]);
  if (family === 0) return 'invalid';
  if (family === 4) {
    const n = ipv4ToBigInt(raw);
    return n == null ? 'invalid' : classifyNumeric(n, 32);
  }
  const n = ipv6ToBigInt(raw);
  if (n == null) return 'invalid';
  // IPv4-mapped (::ffff:a.b.c.d) и устаревший IPv4-compatible (::a.b.c.d) — проверяем как IPv4
  if (inCidr(n, 128, MAPPED_V4) || (inCidr(n, 128, COMPAT_V4) && n > BigInt(1))) {
    return classifyNumeric(n & V4_MASK, 32);
  }
  let cls = classifyNumeric(n, 128);
  // Туннельные/трансляционные префиксы со встроенным IPv4: адрес не лучше встроенного IPv4.
  if (inCidr(n, 128, SIX_TO_FOUR)) {
    cls = stricter(cls, classifyNumeric((n >> BigInt(80)) & V4_MASK, 32));
  } else if (inCidr(n, 128, TEREDO)) {
    // Teredo в DNS легитимного сервера не встречается — минимум «private»
    const server = classifyNumeric((n >> BigInt(64)) & V4_MASK, 32);
    const client = classifyNumeric(~n & V4_MASK, 32);
    cls = stricter(stricter(cls, 'private'), stricter(server, client));
  } else if (inCidr(n, 128, NAT64_WKP)) {
    cls = stricter(cls, classifyNumeric(n & V4_MASK, 32));
  }
  return cls;
}

function allowedHosts(): Set<string> {
  const raw = process.env.SSRF_ALLOWED_HOSTS ?? '';
  return new Set(
    raw
      .split(',')
      .map((h) => h.trim().toLowerCase().replace(/^\[|\]$/g, ''))
      .filter(Boolean)
  );
}

function isHostAllowlisted(host: string): boolean {
  return allowedHosts().has(host.toLowerCase().replace(/^\[|\]$/g, ''));
}

/** Разбор URL + проверка схемы. null — URL недопустим. */
function parseHttpUrl(url: string | null | undefined): URL | null {
  if (!url || typeof url !== 'string') return null;
  let parsed: URL;
  try {
    parsed = new URL(url.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
  if (parsed.username || parsed.password) return null; // креды в URL не принимаем
  if (!parsed.hostname) return null;
  return parsed;
}

/**
 * Проверяет URL на SSRF (без DNS). Возвращает true, если URL опасен (внутренний/локальный/некорректный).
 */
export function isSsrfUrl(url: string | null | undefined): boolean {
  const parsed = parseHttpUrl(url);
  if (!parsed) return true;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host) return true;
  const allowlisted = isHostAllowlisted(host);

  const ipClass = classifyIp(host);
  if (ipClass === 'blocked') return true;
  if (ipClass === 'private') return !allowlisted;
  if (ipClass === 'public') return false;

  // Имя хоста
  if (BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) return true;
  if (host.endsWith('.local') && !allowlisted) return true;
  return false;
}

/**
 * Безопасная проверка workspaceUrl. Выбрасывает, если SSRF.
 */
export function assertSafeWorkspaceUrl(url: string | null | undefined): void {
  if (isSsrfUrl(url)) {
    throw new Error('Invalid workspace URL: internal or private addresses are not allowed');
  }
}

export class SsrfBlockedError extends Error {
  /** Код для сетевого стека (undici прокидывает ошибку lookup в error.cause). */
  readonly code = 'ESSRFBLOCKED';
  constructor(
    message = 'Outbound request blocked: internal or private addresses are not allowed. ' +
      'Если Rocket.Chat находится во внутренней сети/VPN — добавьте его хост в SSRF_ALLOWED_HOSTS в .env и перезапустите приложение.'
  ) {
    super(message);
    this.name = 'SsrfBlockedError';
  }
}

/* ------------------------------------------------------------------ */
/* Проверка в момент подключения (защита от DNS rebinding / TOCTOU)     */
/* ------------------------------------------------------------------ */

export type ResolvedAddress = { address: string; family: number };
/** Резолв всех адресов имени (A + AAAA). В тестах подменяется — без реального DNS. */
export type AddressResolver = (hostname: string) => Promise<ResolvedAddress[]>;

const systemAddressResolver: AddressResolver = (hostname) =>
  new Promise((resolve, reject) => {
    dnsLookupCb(hostname, { all: true, verbatim: true }, (err, addresses) => {
      if (err) reject(err);
      else resolve(addresses.map((a) => ({ address: a.address, family: a.family })));
    });
  });

export interface ConnectGuardOptions {
  /** Разрешены ли частные адреса для этого имени хоста (по умолчанию — SSRF_ALLOWED_HOSTS). */
  allowPrivateHost?: (hostname: string) => boolean;
  /** Доп. проверка каждого адреса (true — адрес допустим). Применяется поверх classifyIp. */
  isAddressAllowed?: (address: string) => boolean;
  resolver?: AddressResolver;
}

/**
 * Проверяет ВСЕ адреса, полученные при резолве, по тем же правилам, что и assertSafeOutboundUrl.
 * Хотя бы один запрещённый адрес → SsrfBlockedError (как и при предварительной проверке).
 * Возвращает список, к которому разрешено подключаться.
 */
export function vetResolvedAddresses(
  hostname: string,
  addresses: ResolvedAddress[],
  opts: Pick<ConnectGuardOptions, 'allowPrivateHost' | 'isAddressAllowed'> = {}
): ResolvedAddress[] {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (!host || BLOCKED_HOSTNAMES.has(host) || host.endsWith('.localhost')) throw new SsrfBlockedError();
  if (!addresses.length) throw new SsrfBlockedError('Outbound request blocked: host has no addresses');
  const allowPrivate = (opts.allowPrivateHost ?? isHostAllowlisted)(host);
  for (const a of addresses) {
    const cls = classifyIp(a.address);
    if (cls === 'blocked' || cls === 'invalid') throw new SsrfBlockedError();
    if (cls === 'private' && !allowPrivate) throw new SsrfBlockedError();
    if (opts.isAddressAllowed && !opts.isAddressAllowed(a.address)) throw new SsrfBlockedError();
  }
  return addresses.map((a) => ({ address: a.address, family: a.family === 6 || isIP(a.address) === 6 ? 6 : 4 }));
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | ResolvedAddress[],
  family?: number
) => void;

/**
 * Функция `lookup` для net/tls.connect: резолвит имя, проверяет каждый адрес и отдаёт сокету
 * только проверенные адреса. Сокет подключается ровно к тому IP, который прошёл проверку,
 * поэтому повторный резолв (DNS rebinding между проверкой и подключением) невозможен.
 */
export function createSsrfSafeLookup(opts: ConnectGuardOptions = {}) {
  const resolve = opts.resolver ?? systemAddressResolver;
  return function ssrfSafeLookup(
    hostname: string,
    options: { all?: boolean; family?: number | string } | number | LookupCallback,
    callback?: LookupCallback
  ): void {
    let cb = callback;
    let o: { all?: boolean; family?: number | string } = {};
    if (typeof options === 'function') cb = options;
    else if (typeof options === 'number') o = { family: options };
    else if (options) o = options;
    const done = cb!;
    const literal = isIP(hostname.replace(/^\[|\]$/g, ''));
    const pending: Promise<ResolvedAddress[]> = literal
      ? Promise.resolve([{ address: hostname.replace(/^\[|\]$/g, ''), family: literal }])
      : resolve(hostname);
    pending
      .then((addrs) => {
        let list = vetResolvedAddresses(hostname, addrs, opts);
        const fam = o.family === 'IPv4' ? 4 : o.family === 'IPv6' ? 6 : Number(o.family) || 0;
        if (fam === 4 || fam === 6) list = list.filter((a) => a.family === fam);
        if (!list.length) {
          const e: NodeJS.ErrnoException = new Error(`getaddrinfo ENOTFOUND ${hostname}`);
          e.code = 'ENOTFOUND';
          throw e;
        }
        if (o.all) done(null, list);
        else done(null, list[0].address, list[0].family);
      })
      .catch((err: NodeJS.ErrnoException) => done(err, o.all ? [] : '', undefined));
  };
}

/** undici-диспетчер, который проверяет адрес в момент подключения (см. createSsrfSafeLookup). */
export function createSsrfSafeDispatcher(opts: ConnectGuardOptions = {}): Dispatcher {
  return new Agent({
    connect: { lookup: createSsrfSafeLookup(opts) as never, timeout: 15_000 },
  });
}

let rcDispatcher: Dispatcher | null = null;

/**
 * Общий диспетчер для запросов к Rocket.Chat (safeFetch): частные адреса разрешены только
 * для хостов из SSRF_ALLOWED_HOSTS, loopback/link-local/metadata — никогда.
 */
export function getSsrfSafeDispatcher(): Dispatcher {
  rcDispatcher ??= createSsrfSafeDispatcher();
  return rcDispatcher;
}

type Resolver = (host: string) => Promise<string[]>;

const DNS_TIMEOUT_MS = 3000;
const DNS_CACHE_TTL_MS = 60_000;
const dnsCache = new Map<string, { addresses: string[]; expiresAt: number }>();

const defaultResolver: Resolver = async (host) => {
  const cached = dnsCache.get(host);
  if (cached && cached.expiresAt > Date.now()) return cached.addresses;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([
      lookup(host, { all: true, verbatim: true }),
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error('DNS timeout')), DNS_TIMEOUT_MS);
      }),
    ]);
    const addresses = result.map((r) => r.address);
    dnsCache.set(host, { addresses, expiresAt: Date.now() + DNS_CACHE_TTL_MS });
    if (dnsCache.size > 1000) dnsCache.delete(dnsCache.keys().next().value as string);
    return addresses;
  } finally {
    if (timer) clearTimeout(timer);
  }
};

let resolver: Resolver = defaultResolver;

/** Только для тестов: подменить DNS-резолвер (null — вернуть стандартный). */
export function __setSsrfResolverForTests(fn: Resolver | null): void {
  resolver = fn ?? defaultResolver;
  dnsCache.clear();
}

/**
 * Полная проверка исходящего URL: синхронные правила + DNS. Если имя хоста резолвится
 * хотя бы в один запрещённый адрес — запрос блокируется. Ошибка DNS не блокирует
 * (сам fetch упадёт с ENOTFOUND), чтобы не ломать диагностику сети.
 */
export async function assertSafeOutboundUrl(url: string): Promise<void> {
  if (isSsrfUrl(url)) throw new SsrfBlockedError();
  const parsed = parseHttpUrl(url)!;
  const host = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, '').replace(/\.$/, '');
  if (classifyIp(host) !== 'invalid') return; // IP-литерал уже проверен
  let addresses: string[];
  try {
    addresses = await resolver(host);
  } catch {
    return;
  }
  const allowlisted = isHostAllowlisted(host);
  for (const address of addresses) {
    const cls = classifyIp(address);
    if (cls === 'blocked') throw new SsrfBlockedError();
    if (cls === 'private' && !allowlisted) throw new SsrfBlockedError();
  }
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const MAX_REDIRECTS = 5;
/** Заголовки с учётными данными, которые не уходят на другой origin при редиректе. */
const CREDENTIAL_HEADERS = ['x-auth-token', 'x-user-id', 'authorization', 'cookie'];

/**
 * fetch для серверных запросов к внешним (пользовательским) URL.
 * Проверяет каждый URL (включая редиректы) через assertSafeOutboundUrl, ограничивает число
 * редиректов и не пересылает токены Rocket.Chat на другой origin.
 */
export async function safeFetch(input: string | URL, init: RequestInit = {}): Promise<Response> {
  let url = typeof input === 'string' ? input : input.toString();
  let method = (init.method ?? 'GET').toUpperCase();
  let body = init.body;
  let headers = new Headers(init.headers);
  const redirectMode = init.redirect ?? 'follow';

  // Проверка адреса в момент подключения (DNS rebinding); вызывающий может передать свой диспетчер.
  const dispatcher = (init as { dispatcher?: Dispatcher }).dispatcher ?? getSsrfSafeDispatcher();

  for (let hop = 0; ; hop++) {
    await assertSafeOutboundUrl(url);
    const response = await globalThis.fetch(url, {
      ...init,
      method,
      body,
      headers,
      redirect: 'manual',
      dispatcher,
    } as RequestInit);
    const location = response.headers?.get?.('location');
    if (!REDIRECT_STATUSES.has(response.status) || !location || redirectMode === 'manual') {
      return response;
    }
    if (redirectMode === 'error') {
      throw new TypeError('Redirect not allowed');
    }
    if (hop >= MAX_REDIRECTS) {
      throw new TypeError('Too many redirects');
    }
    try {
      await response.body?.cancel();
    } catch {
      /* ignore */
    }
    const next = new URL(location, url);
    if (new URL(url).origin !== next.origin) {
      headers = new Headers(headers);
      for (const h of CREDENTIAL_HEADERS) headers.delete(h);
    }
    if (response.status === 303 || ((response.status === 301 || response.status === 302) && method === 'POST')) {
      method = method === 'HEAD' ? 'HEAD' : 'GET';
      body = undefined;
      headers.delete('content-type');
      headers.delete('content-length');
    }
    url = next.toString();
  }
}
