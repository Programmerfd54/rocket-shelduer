import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { timingSafeEqualString } from '@/lib/http-security';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health-check для мониторинга и оркестрации (Docker, K8s).
 * GET /api/health — проверяет доступность приложения и БД. Версии/секреты не отдаются.
 * Если задан HEALTH_CHECK_SECRET — нужен заголовок `X-Health-Secret: <secret>`
 * (предпочтительно — не попадает в access-логи) или legacy `?secret=<secret>`.
 * Без секрета отвечает как раньше (только status/db/latencyMs — ничего чувствительного), чтобы не ломать
 * существующий мониторинг; рекомендуется задать HEALTH_CHECK_SECRET.
 */
function providedSecret(request: NextRequest): string | null {
  const header = request.headers.get('x-health-secret');
  if (header) return header.trim();
  const auth = request.headers.get('authorization');
  const m = auth ? /^Bearer\s+(.+)$/i.exec(auth.trim()) : null;
  if (m) return m[1].trim();
  return request.nextUrl.searchParams.get('secret');
}

export async function GET(request: NextRequest) {
  const healthSecret = process.env.HEALTH_CHECK_SECRET;
  if (healthSecret && !timingSafeEqualString(providedSecret(request), healthSecret)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const start = Date.now();
  const result: { status: 'ok' | 'degraded'; db: 'ok' | 'error'; latencyMs?: number } = {
    status: 'ok',
    db: 'ok',
  };

  try {
    await prisma.$queryRaw`SELECT 1`;
    result.latencyMs = Date.now() - start;
  } catch {
    result.db = 'error';
    result.status = 'degraded';
    result.latencyMs = Date.now() - start;
    return NextResponse.json(result, { status: 503, headers: { 'Cache-Control': 'no-store' } });
  }

  return NextResponse.json(result, { headers: { 'Cache-Control': 'no-store' } });
}
