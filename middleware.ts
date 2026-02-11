import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

// Глобальный rate limit для API: макс запросов с одного IP за окно (1 мин)
const API_RATE_WINDOW_MS = 60 * 1000;
const API_RATE_MAX = 300;
const apiRateMap = new Map<string, { count: number; resetAt: number }>();

function getApiRateKey(request: NextRequest): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  const ip = forwarded ? forwarded.split(',')[0]?.trim() : null;
  return ip || request.headers.get('x-real-ip') || null;
}

function isApiRateLimited(key: string | null): boolean {
  if (!key) return false;
  const now = Date.now();
  const entry = apiRateMap.get(key);
  if (!entry) {
    apiRateMap.set(key, { count: 1, resetAt: now + API_RATE_WINDOW_MS });
    return false;
  }
  if (now >= entry.resetAt) {
    apiRateMap.set(key, { count: 1, resetAt: now + API_RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > API_RATE_MAX;
}

function getAllowedOrigins(request: NextRequest): string[] {
  const origin = request.nextUrl.origin;
  const envOrigin = process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL;
  const allowed = [origin];
  if (envOrigin) {
    const base = envOrigin.startsWith('http') ? envOrigin : `https://${envOrigin}`;
    allowed.push(base.replace(/\/$/, ''));
  }
  return allowed;
}

function isOriginAllowed(request: NextRequest, origin: string | null): boolean {
  if (!origin) return true;
  const allowed = getAllowedOrigins(request);
  return allowed.some((a) => origin === a || origin === a + '/' || a.startsWith(origin));
}

export function middleware(request: NextRequest) {
  const token = request.cookies.get('auth-token')?.value;
  const { pathname } = request.nextUrl;
  const response = NextResponse.next();

  // Security headers для всех ответов (защита от XSS, clickjacking, MIME-sniffing, утечки referrer)
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), interest-cohort=()');
  response.headers.set('X-DNS-Prefetch-Control', 'off');
  // CSP: разрешаем только свои скрипты и стили, запрещаем inline eval и недоверенные источники
  response.headers.set(
    'Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: blob:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'"
  );
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
  }

  if (pathname.startsWith('/api')) {
    const rateKey = getApiRateKey(request);
    if (isApiRateLimited(rateKey)) {
      return new NextResponse(
        JSON.stringify({ error: 'Too many requests' }),
        { status: 429, headers: { 'Content-Type': 'application/json' } }
      );
    }
    const origin = request.headers.get('origin');
    if (origin && isOriginAllowed(request, origin)) {
      response.headers.set('Access-Control-Allow-Origin', origin);
    }
    response.headers.set('Access-Control-Allow-Credentials', 'true');
    response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
    response.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (request.method === 'OPTIONS') {
      return new NextResponse(null, { status: 204, headers: response.headers });
    }

    if (STATE_CHANGING_METHODS.includes(request.method)) {
      const reqOrigin = request.headers.get('origin');
      const referer = request.headers.get('referer');
      const allowed = getAllowedOrigins(request);
      const originOk = !reqOrigin || allowed.some((a) => reqOrigin === a || reqOrigin.startsWith(a + '/'));
      const refererOk = !referer || allowed.some((a) => referer.startsWith(a + '/') || referer.startsWith(a + '?'));
      if (reqOrigin || referer) {
        if (!originOk && !refererOk) {
          return new NextResponse(JSON.stringify({ error: 'Invalid origin' }), {
            status: 403,
            headers: { 'Content-Type': 'application/json' },
          });
        }
      }
    }
  } else {
    let isAuthenticated = false;
    if (token) {
      try {
        isAuthenticated = token.length > 0;
      } catch {
        isAuthenticated = false;
      }
    }
    if (!isAuthenticated && pathname.startsWith('/dashboard')) {
      return NextResponse.redirect(new URL('/login', request.url));
    }
  }

  return response;
}

export const config = {
  matcher: [
    '/api/:path*',
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
