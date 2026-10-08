import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';
import {
  AUTH_COOKIE_HOST,
  AUTH_COOKIE_LEGACY,
  buildAllowedOrigins,
  buildPageCsp,
  checkCsrf,
  createFixedWindowLimiter,
  generateCspNonce,
  getClientIpFromHeaders,
  isApiCacheablePath,
  isOriginAllowed,
  isPasswordChangeExemptPath,
  isProtectedUploadPath,
  readCookiePreferHost,
  resolveJwtSecret,
  API_CSP,
} from '@/lib/http-security';

// Глобальный rate limit для API: макс запросов с одного IP за окно (1 мин).
// IP определяется с учётом TRUSTED_PROXY_HOPS (см. lib/http-security.ts), карта ограничена по размеру.
// Счётчик живёт в памяти процесса (на каждую реплику свой) — общий лимит задаётся в nginx (limit_req),
// см. deploy/nginx-example.conf.
const apiLimiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 300, maxKeys: 20_000 });

const IS_PROD = process.env.NODE_ENV === 'production';

/** Заголовки для всех ответов (страницы, API, загрузки). CSP и Cache-Control — отдельно по типу ответа. */
const BASE_SECURITY_HEADERS: Record<string, string> = {
  // SAMEORIGIN: в iframe можно встраивать только со своего же origin
  'X-Frame-Options': 'SAMEORIGIN',
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy':
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), serial=(), bluetooth=(), browsing-topics=()',
  'X-DNS-Prefetch-Control': 'off',
  'X-Permitted-Cross-Domain-Policies': 'none',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
  'Origin-Agent-Cluster': '?1',
};

function applyBaseHeaders(res: NextResponse): NextResponse {
  for (const [k, v] of Object.entries(BASE_SECURITY_HEADERS)) res.headers.set(k, v);
  if (IS_PROD) {
    res.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }
  return res;
}

/** API-ответы: JSON/файлы не исполняются как документ; по умолчанию не кэшируются (персональные данные). */
function applyApiHeaders(res: NextResponse, pathname: string): NextResponse {
  applyBaseHeaders(res);
  res.headers.set('Content-Security-Policy', API_CSP);
  // Заголовок middleware имеет приоритет над заголовком route handler'а (Next не перезаписывает уже
  // выставленные), поэтому маршруты со своим кэшированием (картинки эмодзи) исключены.
  if (!isApiCacheablePath(pathname)) res.headers.set('Cache-Control', 'no-store');
  return res;
}

function jsonError(
  status: number,
  body: Record<string, unknown>,
  pathname: string,
  extraHeaders?: Record<string, string>
) {
  const res = new NextResponse(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...(extraHeaders ?? {}) },
  });
  return applyApiHeaders(res, pathname);
}

type TokenClaims = { sessionId?: string; pwc?: boolean };

/** Проверка JWT в Edge (без Prisma). Секрет без значения по умолчанию: не задан → токен невалиден. */
async function verifyTokenEdge(token: string): Promise<TokenClaims | null> {
  const secret = resolveJwtSecret(process.env);
  if (!secret) return null;
  try {
    const key = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, key, { algorithms: ['HS256'] });
    // Токены без привязки к сессии (Session) не принимаются — их нельзя отозвать
    if (typeof payload.sessionId !== 'string' || !payload.sessionId) return null;
    return { sessionId: payload.sessionId, pwc: payload.pwc === true };
  } catch {
    return null;
  }
}

export async function middleware(request: NextRequest) {
  // __Host-auth-token (production, Secure) → legacy auth-token (dev/HTTP и сессии до переименования)
  const token = readCookiePreferHost(
    (n) => request.cookies.get(n)?.value,
    AUTH_COOKIE_HOST,
    AUTH_COOKIE_LEGACY
  );
  const { pathname } = request.nextUrl;

  if (pathname.startsWith('/api')) {
    const clientIp = getClientIpFromHeaders(request.headers);
    if (apiLimiter.hit(clientIp)) {
      return jsonError(429, { error: 'Too many requests' }, pathname, { 'Retry-After': '60' });
    }

    const allowed = buildAllowedOrigins({
      requestOrigin: request.nextUrl.origin,
      host: request.headers.get('host'),
      forwardedProto: request.headers.get('x-forwarded-proto'),
    });
    const origin = request.headers.get('origin');

    // CORS: только точное совпадение с allow-list; для остальных origin заголовки не выставляются
    const corsHeaders: Record<string, string> = { Vary: 'Origin' };
    if (origin && isOriginAllowed(origin, allowed)) {
      corsHeaders['Access-Control-Allow-Origin'] = origin;
      corsHeaders['Access-Control-Allow-Credentials'] = 'true';
      corsHeaders['Access-Control-Allow-Methods'] = 'GET, POST, PUT, PATCH, DELETE, OPTIONS';
      corsHeaders['Access-Control-Allow-Headers'] = 'Content-Type, Authorization, X-Error-Handling';
    }

    if (request.method === 'OPTIONS') {
      return applyApiHeaders(new NextResponse(null, { status: 204, headers: corsHeaders }), pathname);
    }

    const csrf = checkCsrf({
      method: request.method,
      origin,
      referer: request.headers.get('referer'),
      secFetchSite: request.headers.get('sec-fetch-site'),
      allowed,
    });
    if (!csrf.ok) {
      return jsonError(403, { error: 'Invalid origin' }, pathname, { Vary: 'Origin' });
    }

    // Обязательная смена пароля: пока не задан постоянный пароль, доступны только auth-эндпоинты
    if (token && !isPasswordChangeExemptPath(pathname)) {
      const claims = await verifyTokenEdge(token);
      if (claims?.pwc) {
        return jsonError(
          403,
          { error: 'Необходимо сменить пароль', code: 'PASSWORD_CHANGE_REQUIRED' },
          pathname,
          { 'X-Password-Change-Required': '1', ...corsHeaders }
        );
      }
    }

    const response = NextResponse.next();
    for (const [k, v] of Object.entries(corsHeaders)) response.headers.set(k, v);
    return applyApiHeaders(response, pathname);
  }

  let claims: TokenClaims | null = null;
  if (token) claims = await verifyTokenEdge(token);

  // Пользовательские загрузки (/help-uploads/*, /uploads/*): только с валидной сессией, 401 без редиректа.
  // Полная проверка сессии (БД, device-id) и заголовки файла — в /api/uploads/[bucket]/[name]
  // (next.config.ts переписывает эти URL туда; CSP/Cache-Control здесь не ставим — их задаёт обработчик).
  if (isProtectedUploadPath(pathname)) {
    if (!claims) {
      const res = new NextResponse(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
      });
      return applyBaseHeaders(res);
    }
    return applyBaseHeaders(NextResponse.next());
  }

  if (!claims && pathname.startsWith('/dashboard')) {
    return applyBaseHeaders(NextResponse.redirect(new URL('/login', request.url)));
  }
  if (
    claims?.pwc &&
    pathname.startsWith('/dashboard') &&
    pathname !== '/dashboard/change-password'
  ) {
    return applyBaseHeaders(NextResponse.redirect(new URL('/dashboard/change-password', request.url)));
  }

  // Страницы: CSP с nonce на каждый запрос. Next читает nonce из заголовка запроса
  // Content-Security-Policy и проставляет его своим <script>; app/layout.tsx передаёт x-nonce в next-themes.
  const nonce = generateCspNonce();
  const csp = buildPageCsp(nonce, { dev: !IS_PROD });
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);
  requestHeaders.set('Content-Security-Policy', csp);
  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set('Content-Security-Policy', csp);
  return applyBaseHeaders(response);
}

export const config = {
  matcher: [
    '/api/:path*',
    // Загрузки — явно (иначе исключение по расширению .png/.jpg ниже пропустило бы их без проверки)
    '/help-uploads/:path*',
    '/uploads/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|woff2?)$).*)',
  ],
};
