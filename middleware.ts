import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const STATE_CHANGING_METHODS = ['POST', 'PUT', 'PATCH', 'DELETE'];

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

  // Security headers для всех ответов
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');

  if (pathname.startsWith('/api')) {
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
