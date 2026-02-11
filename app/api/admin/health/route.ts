import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/** Переменные окружения: ключ и признак «секрет» (маскировать значение). */
const ENV_KEYS: { key: string; optional: boolean; secret: boolean }[] = [
  { key: 'DATABASE_URL', optional: false, secret: true },
  { key: 'JWT_SECRET', optional: false, secret: true },
  { key: 'ENCRYPTION_KEY', optional: true, secret: true },
  { key: 'NEXT_PUBLIC_APP_URL', optional: true, secret: false },
  { key: 'APP_URL', optional: true, secret: false },
  { key: 'CRON_SECRET', optional: true, secret: true },
  { key: 'HEALTH_CHECK_SECRET', optional: true, secret: true },
];

type CheckResult = {
  name: string;
  status: 'ok' | 'error' | 'skip';
  message?: string;
  durationMs?: number;
  valueDisplay?: string;
};

/** Маскирует учётные данные в DATABASE_URL: postgresql://user:pass@host/db → postgresql://***@host/db */
function maskDatabaseUrl(url: string): string {
  const match = url.match(/^(\w+:\/\/)[^@]+@(.+)$/);
  if (match) return `${match[1]}***@${match[2]}`;
  return '***';
}

/** Для секретов возвращает «•••••••• (N символов)». */
function maskSecret(value: string): string {
  return `•••••••• (${value.length} символов)`;
}

/** Возвращает отображаемое значение переменной (полное или замаскированное). */
function getEnvValueDisplay(key: string, value: string | undefined, secret: boolean): string {
  if (!value) return '—';
  if (secret) {
    if (key === 'DATABASE_URL') return maskDatabaseUrl(value);
    return maskSecret(value);
  }
  return value;
}

/**
 * GET /api/admin/health — расширенная проверка для ADMIN.
 * Возвращает: БД + версия, порты, env с реальными значениями (секреты маскируются).
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user || user.role !== 'ADMIN') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const checks: CheckResult[] = [];
  const startedAt = Date.now();
  let dbVersion: string | null = null;

  // 1. База данных + версия
  const dbStart = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    const versionRows = await prisma.$queryRaw<Array<{ version: string }>>`SELECT version() as version`;
    const rawVersion = versionRows?.[0]?.version;
    if (typeof rawVersion === 'string') {
      const match = rawVersion.match(/PostgreSQL (\d+\.?\d*\.?\d*)/i) || rawVersion.match(/(\d+\.\d+)/);
      dbVersion = match ? `PostgreSQL ${match[1]}` : rawVersion.slice(0, 50);
    }
    checks.push({
      name: 'database',
      status: 'ok',
      message: dbVersion ? `${dbVersion} доступна` : 'PostgreSQL доступна',
      durationMs: Date.now() - dbStart,
    });
  } catch (e) {
    checks.push({
      name: 'database',
      status: 'error',
      message: e instanceof Error ? e.message : 'Connection failed',
      durationMs: Date.now() - dbStart,
    });
  }

  // 2. Переменные окружения с отображаемым значением
  for (const { key, optional, secret } of ENV_KEYS) {
    const value = process.env[key];
    const status = value ? 'ok' : (optional ? 'skip' : 'error');
    const message = value ? getEnvValueDisplay(key, value, secret) : (optional ? 'не задана (опционально)' : 'не задана');
    checks.push({
      name: `env.${key}`,
      status,
      message: value ? undefined : (optional ? 'не задана (опционально)' : 'не задана'),
      valueDisplay: value ? getEnvValueDisplay(key, value, secret) : '—',
    });
  }

  // 3. Порт приложения (из env или по умолчанию)
  const appPort = process.env.PORT || process.env.VERCEL_PORT || '3000';
  checks.push({
    name: 'port.application',
    status: 'ok',
    message: `Порт приложения: ${appPort}`,
    valueDisplay: appPort,
  });

  const overallStatus = checks.some((c) => c.status === 'error') ? 'degraded' : 'ok';
  const dbCheck = checks.find((c) => c.name === 'database');
  const dbStatus = dbCheck?.status === 'ok' ? 'ok' : 'error';
  const latencyMs = Date.now() - startedAt;

  return NextResponse.json({
    status: overallStatus,
    db: dbStatus,
    dbVersion: dbVersion ?? undefined,
    latencyMs,
    nodeEnv: process.env.NODE_ENV ?? 'undefined',
    ports: { application: appPort },
    checks,
    timestamp: new Date().toISOString(),
  });
}
