import { NextRequest, NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Health-check для мониторинга и оркестрации (Docker, K8s).
 * GET /api/health — проверяет доступность приложения и БД.
 * В production можно требовать ?secret=HEALTH_CHECK_SECRET (задать в .env).
 */
export async function GET(request: NextRequest) {
  const healthSecret = process.env.HEALTH_CHECK_SECRET;
  if (healthSecret) {
    const provided = request.nextUrl.searchParams.get('secret');
    if (provided !== healthSecret) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
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
    return NextResponse.json(result, { status: 503 });
  }

  return NextResponse.json(result);
}
