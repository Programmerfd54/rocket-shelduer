/**
 * Чистые (edge-совместимые, без Node API и Prisma) хелперы безопасности HTTP:
 * определение IP клиента за прокси, in-memory rate limit, allow-list Origin/CSRF,
 * сравнение секретов за постоянное время, проверка JWT-секрета.
 * Используются и в middleware.ts (Edge runtime), и в route handlers (Node).
 */

type EnvLike = Record<string, string | undefined>;

/* ------------------------------------------------------------------ */
/* IP клиента                                                          */
/* ------------------------------------------------------------------ */

const MAX_TRUSTED_PROXY_HOPS = 10;

/**
 * TRUSTED_PROXY_HOPS — сколько доверенных обратных прокси стоит перед приложением.
 * По умолчанию 1 (nginx/Caddy на том же хосте). Клиент IP берётся как N-я запись
 * X-Forwarded-For СПРАВА: её дописал ближайший доверенный прокси, подделать её клиент не может
 * (в отличие от первой записи слева, которую клиент присылает сам).
 * Cloudflare → nginx → app: TRUSTED_PROXY_HOPS=2.
 */
export function parseTrustedProxyHops(raw: string | undefined): number {
  if (raw == null || raw.trim() === '') return 1;
  const n = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(n) || n < 1) return 1;
  return Math.min(n, MAX_TRUSTED_PROXY_HOPS);
}

/** Грубая проверка формата IPv4/IPv6 (без порта) — отбрасывает мусор и попытки инъекций в логи. */
export function looksLikeIp(value: string): boolean {
  if (!value || value.length > 64) return false;
  return /^[0-9a-fA-F:.]+$/.test(value) && /[.:]/.test(value);
}

function stripPortAndBrackets(value: string): string {
  let v = value.trim();
  // [2001:db8::1]:443 → 2001:db8::1
  const bracket = /^\[([^\]]+)\](?::\d+)?$/.exec(v);
  if (bracket) return bracket[1];
  // 203.0.113.5:1234 → 203.0.113.5 (только IPv4 с одним двоеточием)
  if (/^\d{1,3}(\.\d{1,3}){3}:\d+$/.test(v)) v = v.slice(0, v.lastIndexOf(':'));
  return v;
}

/**
 * IP клиента из заголовков с учётом доверенных прокси.
 * Порядок: X-Forwarded-For (N-я запись справа) → X-Real-IP → null.
 */
export function getClientIpFromHeaders(h: Headers, env: EnvLike = process.env): string | null {
  const hops = parseTrustedProxyHops(env.TRUSTED_PROXY_HOPS);
  const xff = h.get('x-forwarded-for');
  if (xff) {
    const parts = xff
      .split(',')
      .map((p) => stripPortAndBrackets(p))
      .filter(Boolean);
    if (parts.length > 0) {
      const idx = Math.max(0, parts.length - hops);
      const candidate = parts[idx];
      if (candidate && looksLikeIp(candidate)) return candidate;
    }
  }
  const real = h.get('x-real-ip');
  if (real) {
    const candidate = stripPortAndBrackets(real);
    if (looksLikeIp(candidate)) return candidate;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Rate limit (fixed window, in-memory, с ограничением памяти)          */
/* ------------------------------------------------------------------ */

export interface FixedWindowLimiter {
  /** Засчитать попытку; true — лимит превышен (запрос нужно отклонить). */
  hit(key: string | null | undefined, now?: number): boolean;
  /** Проверить без засчитывания; true — лимит уже исчерпан. */
  isLimited(key: string | null | undefined, now?: number): boolean;
  /** Сбросить счётчик ключа (например, после успешного входа). */
  reset(key: string | null | undefined): void;
  /** Текущее число ключей (для тестов/мониторинга). */
  size(): number;
}

export function createFixedWindowLimiter(opts: {
  windowMs: number;
  max: number;
  /** Защита от роста памяти при переборе ключей (подделанные IP и т.п.). */
  maxKeys?: number;
}): FixedWindowLimiter {
  const { windowMs, max } = opts;
  const maxKeys = opts.maxKeys ?? 10_000;
  const map = new Map<string, { count: number; resetAt: number }>();

  function prune(now: number) {
    if (map.size <= maxKeys) return;
    for (const [k, v] of map) {
      if (now >= v.resetAt) map.delete(k);
    }
    // Всё ещё слишком много — удаляем самые старые (Map хранит порядок вставки)
    while (map.size > maxKeys) {
      const first = map.keys().next();
      if (first.done) break;
      map.delete(first.value);
    }
  }

  function normalize(key: string | null | undefined): string | null {
    if (key == null) return null;
    const k = String(key).trim();
    return k ? k : null;
  }

  return {
    hit(rawKey, now = Date.now()) {
      const key = normalize(rawKey);
      if (!key) return false;
      const entry = map.get(key);
      if (!entry || now >= entry.resetAt) {
        map.delete(key);
        map.set(key, { count: 1, resetAt: now + windowMs });
        prune(now);
        return 1 > max;
      }
      entry.count++;
      return entry.count > max;
    },
    isLimited(rawKey, now = Date.now()) {
      const key = normalize(rawKey);
      if (!key) return false;
      const entry = map.get(key);
      if (!entry || now >= entry.resetAt) return false;
      return entry.count >= max;
    },
    reset(rawKey) {
      const key = normalize(rawKey);
      if (key) map.delete(key);
    },
    size() {
      return map.size;
    },
  };
}

/* ------------------------------------------------------------------ */
/* Origin allow-list и CSRF                                            */
/* ------------------------------------------------------------------ */

/** Нормализует значение Origin/URL до "scheme://host[:port]". Только http/https; "null" → null. */
export function normalizeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  const v = value.trim();
  if (!v || v === 'null') return null;
  try {
    const u = new URL(v.includes('://') ? v : `https://${v}`);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
    return u.origin;
  } catch {
    return null;
  }
}

/**
 * Разрешённые origin'ы (точное совпадение):
 *  - origin самого запроса (request.nextUrl.origin);
 *  - "<X-Forwarded-Proto>://<Host>" — за TLS-терминирующим прокси;
 *  - APP_URL / NEXT_PUBLIC_APP_URL;
 *  - CORS_ALLOWED_ORIGINS (через запятую) — опционально.
 * Заголовки Host/X-Forwarded-Proto не помогают CSRF-атакующему: браузер жертвы шлёт настоящий Host.
 */
export function buildAllowedOrigins(params: {
  requestOrigin?: string | null;
  host?: string | null;
  forwardedProto?: string | null;
  env?: EnvLike;
}): Set<string> {
  const env = params.env ?? process.env;
  const out = new Set<string>();
  const add = (v: string | null | undefined) => {
    const o = normalizeOrigin(v);
    if (o) out.add(o);
  };
  add(params.requestOrigin);
  if (params.host) {
    const proto = (params.forwardedProto ?? '').split(',')[0]?.trim().toLowerCase();
    if (proto === 'http' || proto === 'https') add(`${proto}://${params.host}`);
  }
  add(env.APP_URL);
  add(env.NEXT_PUBLIC_APP_URL);
  for (const o of (env.CORS_ALLOWED_ORIGINS ?? '').split(',')) add(o);
  return out;
}

/** Точное сравнение Origin с allow-list (никаких startsWith). */
export function isOriginAllowed(origin: string | null | undefined, allowed: Set<string>): boolean {
  const o = normalizeOrigin(origin);
  return o != null && allowed.has(o);
}

export const STATE_CHANGING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * CSRF-проверка для изменяющих запросов.
 *  - Есть Origin → он обязан быть в allow-list ("null" — отказ). Referer при этом не учитывается.
 *  - Нет Origin, есть Referer → origin Referer'а обязан быть в allow-list.
 *  - Нет обоих: если Sec-Fetch-Site говорит о кросс-сайтовом запросе — отказ;
 *    иначе пропускаем (не браузер: curl, cron, мониторинг — у них нет «чужих» cookie).
 */
export function checkCsrf(params: {
  method: string;
  origin: string | null;
  referer: string | null;
  secFetchSite: string | null;
  allowed: Set<string>;
}): { ok: true } | { ok: false; reason: string } {
  if (!STATE_CHANGING_METHODS.has(params.method.toUpperCase())) return { ok: true };
  // Sec-Fetch-Site — «запрещённый» заголовок: страница не может его подделать. same-origin означает, что запрос
  // сделан самой нашей страницей, даже если прокси не передал X-Forwarded-Proto и строка Origin
  // (https://host) не совпала с тем, что видит контейнер (http://host).
  if (params.secFetchSite?.toLowerCase() === 'same-origin') return { ok: true };
  if (params.origin != null && params.origin !== '') {
    return isOriginAllowed(params.origin, params.allowed)
      ? { ok: true }
      : { ok: false, reason: 'origin' };
  }
  if (params.referer) {
    return isOriginAllowed(params.referer, params.allowed)
      ? { ok: true }
      : { ok: false, reason: 'referer' };
  }
  const site = params.secFetchSite?.toLowerCase();
  if (site && site !== 'same-origin' && site !== 'none') {
    return { ok: false, reason: 'sec-fetch-site' };
  }
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Секреты                                                             */
/* ------------------------------------------------------------------ */

/** Сравнение строк за время, не зависящее от позиции первого несовпадения. */
export function timingSafeEqualString(a: string | null | undefined, b: string | null | undefined): boolean {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const len = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let i = 0; i < len; i++) {
    const ca = i < a.length ? a.charCodeAt(i) : 0;
    const cb = i < b.length ? b.charCodeAt(i) : 0;
    diff |= ca ^ cb;
  }
  return diff === 0;
}

/** Известные «секреты-заглушки» из примеров/старых версий — недопустимы в production. */
export const KNOWN_WEAK_SECRETS = new Set([
  'your-secret-key',
  'default-secret-key',
  'changeme',
  'change-me',
  'secret',
  'password',
  'jwt-secret',
  'cron-secret',
  'test',
]);

export function isWeakSecret(value: string | null | undefined, minLength = 32): boolean {
  if (!value) return true;
  const v = value.trim();
  return KNOWN_WEAK_SECRETS.has(v.toLowerCase()) || v.length < minLength;
}

/**
 * JWT-секрет: без значения по умолчанию.
 *  - не задан → null (fail closed: токены не выпускаются и не принимаются);
 *  - production + известная заглушка → null.
 * Короткий, но не «заглушечный» секрет в production допускается (обратная совместимость),
 * env.ts выводит предупреждение.
 */
export function resolveJwtSecret(env: EnvLike = process.env): string | null {
  const s = env.JWT_SECRET;
  if (!s || !s.trim()) return null;
  if (env.NODE_ENV === 'production' && KNOWN_WEAK_SECRETS.has(s.trim().toLowerCase())) return null;
  return s;
}

/**
 * Bearer-секрет для служебных эндпоинтов (cron). В production секрет обязателен.
 * Возвращает 'ok' | 'unauthorized' | 'misconfigured'.
 */
export function checkBearerSecret(
  authorizationHeader: string | null,
  secret: string | undefined,
  isProduction: boolean
): 'ok' | 'unauthorized' | 'misconfigured' {
  const s = secret?.trim();
  if (!s) return isProduction ? 'misconfigured' : 'ok';
  if (isProduction && KNOWN_WEAK_SECRETS.has(s.toLowerCase())) return 'misconfigured';
  const header = authorizationHeader?.trim() ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m) return 'unauthorized';
  return timingSafeEqualString(m[1].trim(), s) ? 'ok' : 'unauthorized';
}

/* ------------------------------------------------------------------ */
/* Имена auth-cookie (__Host- префикс)                                  */
/* ------------------------------------------------------------------ */

export const AUTH_COOKIE_LEGACY = 'auth-token';
export const AUTH_COOKIE_HOST = '__Host-auth-token';
export const DEVICE_COOKIE_LEGACY = 'device-id';
export const DEVICE_COOKIE_HOST = '__Host-device-id';

/**
 * Secure-cookie включены: production и COOKIE_SECURE !== 'false'.
 * Тогда cookie пишутся с префиксом __Host- (браузер принимает их только с Secure, Path=/ и без Domain —
 * соседний поддомен не может подбросить/перезаписать такую cookie: защита от cookie tossing).
 * В dev / по HTTP (COOKIE_SECURE=false) — прежние имена без префикса (__Host- требует Secure).
 */
export function isSecureCookieMode(env: EnvLike = process.env): boolean {
  return env.NODE_ENV === 'production' && env.COOKIE_SECURE !== 'false';
}

export function authCookieName(env: EnvLike = process.env): string {
  return isSecureCookieMode(env) ? AUTH_COOKIE_HOST : AUTH_COOKIE_LEGACY;
}

export function deviceCookieName(env: EnvLike = process.env): string {
  return isSecureCookieMode(env) ? DEVICE_COOKIE_HOST : DEVICE_COOKIE_LEGACY;
}

/**
 * Значение cookie: сначала новое имя (__Host-…), затем legacy — сессии, выданные до переименования,
 * продолжают работать до истечения (при следующем входе legacy-cookie удаляется).
 */
export function readCookiePreferHost(
  get: (name: string) => string | undefined | null,
  hostName: string,
  legacyName: string
): string | undefined {
  const primary = get(hostName);
  if (primary) return primary;
  const legacy = get(legacyName);
  return legacy || undefined;
}

/* ------------------------------------------------------------------ */
/* Content-Security-Policy                                             */
/* ------------------------------------------------------------------ */

/** Криптостойкий nonce (128 бит, base64) — новый на каждый запрос страницы. Edge-совместимо. */
export function generateCspNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}

/**
 * CSP страниц: скрипты только с nonce текущего ответа ('strict-dynamic' — скрипты, загруженные ими,
 * т.е. чанки Next, тоже разрешены; 'self' — fallback для браузеров без CSP3). Без 'unsafe-inline'
 * для скриптов: внедрённый через XSS <script>/обработчик onX не исполнится.
 * 'unsafe-eval' — только в dev (React/Next dev-режим использует eval).
 * style-src 'unsafe-inline' оставлен: инлайновые style-атрибуты Radix/Tailwind/framer-motion
 * (нельзя ставить nonce в style-src — тогда браузер игнорирует 'unsafe-inline').
 */
export function buildPageCsp(nonce: string, opts: { dev?: boolean } = {}): string {
  if (!/^[A-Za-z0-9+/=]{16,64}$/.test(nonce)) throw new Error('Invalid CSP nonce');
  const scriptSrc = [`'self'`, `'nonce-${nonce}'`, `'strict-dynamic'`];
  if (opts.dev) scriptSrc.push(`'unsafe-eval'`);
  return [
    `default-src 'self'`,
    `script-src ${scriptSrc.join(' ')}`,
    `style-src 'self' 'unsafe-inline' https://fonts.googleapis.com`,
    `font-src 'self' data: https://fonts.gstatic.com`,
    `img-src 'self' data: blob:`,
    `media-src 'self' blob:`,
    `connect-src 'self'`,
    `worker-src 'self' blob:`,
    `manifest-src 'self'`,
    `object-src 'none'`,
    `frame-src 'self'`,
    `frame-ancestors 'self'`,
    `base-uri 'self'`,
    `form-action 'self'`,
  ].join('; ');
}

/** CSP для ответов API (JSON/файлы): ничего не загружается и не исполняется, во фрейм не встраивается. */
export const API_CSP = "default-src 'none'; frame-ancestors 'none'; sandbox";

/**
 * API-маршруты со своим кэшированием в браузере (картинки эмодзи, список эмодзи, загрузки).
 * Остальным middleware ставит Cache-Control: no-store.
 */
export function isApiCacheablePath(pathname: string): boolean {
  return (
    /^\/api\/workspace\/[^/]+\/emoji-image$/.test(pathname) ||
    /^\/api\/workspace\/[^/]+\/emojis$/.test(pathname) ||
    pathname.startsWith('/api/uploads/')
  );
}

/** Публичные URL пользовательских загрузок, требующие сессии. */
export function isProtectedUploadPath(pathname: string): boolean {
  return (
    pathname === '/help-uploads' ||
    pathname.startsWith('/help-uploads/') ||
    pathname === '/uploads' ||
    pathname.startsWith('/uploads/')
  );
}

/* ------------------------------------------------------------------ */
/* Обязательная смена пароля                                           */
/* ------------------------------------------------------------------ */

/**
 * API, доступные при requirePasswordChange (временный пароль после сброса).
 * Всё остальное — 403 PASSWORD_CHANGE_REQUIRED.
 */
export function isPasswordChangeExemptPath(pathname: string): boolean {
  return (
    pathname.startsWith('/api/auth/') ||
    pathname === '/api/user/set-initial-password' ||
    pathname === '/api/errors/log' ||
    pathname === '/api/health' ||
    pathname.startsWith('/api/cron/')
  );
}
