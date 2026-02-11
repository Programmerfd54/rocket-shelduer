import prisma from './prisma';

/** Типы событий безопасности для логов */
export const SecurityEventType = {
  LOGIN_FAILED: 'LOGIN_FAILED',
  LOGIN_RATE_LIMIT: 'LOGIN_RATE_LIMIT',
  AUTH_RATE_LIMIT: 'AUTH_RATE_LIMIT',
  INVALID_TOKEN: 'INVALID_TOKEN',
  UNAUTHORIZED_ACCESS: 'UNAUTHORIZED_ACCESS',
  SUSPICIOUS_INPUT: 'SUSPICIOUS_INPUT',
  REGISTER_FAILED: 'REGISTER_FAILED',
  WORKSPACE_AUTH_FAILED: 'WORKSPACE_AUTH_FAILED',
  PATH_TRAVERSAL_ATTEMPT: 'PATH_TRAVERSAL_ATTEMPT',
  BLOCKED_USER_LOGIN: 'BLOCKED_USER_LOGIN',
  SESSION_HIJACK_ATTEMPT: 'SESSION_HIJACK_ATTEMPT',
} as const;

export type SecurityEventTypeValue = (typeof SecurityEventType)[keyof typeof SecurityEventType];

export interface LogSecurityEventParams {
  type: string;
  path?: string | null;
  method?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  details?: string | null;
  blocked?: boolean;
  userId?: string | null;
}

/** Логирование события безопасности (без паролей и секретов). */
export async function logSecurityEvent(params: LogSecurityEventParams): Promise<void> {
  try {
    await prisma.securityEvent.create({
      data: {
        type: params.type,
        path: params.path ?? null,
        method: params.method ?? null,
        ipAddress: params.ipAddress ?? null,
        userAgent: params.userAgent?.slice(0, 500) ?? null,
        details: params.details ?? null,
        blocked: params.blocked ?? true,
        userId: params.userId ?? null,
      },
    });
  } catch (err) {
    console.error('Failed to log security event:', err);
  }
}

/**
 * Проверка на path traversal (.., абсолютные пути).
 * Использовать для любых id/параметров, которые подставляются в пути или запросы.
 */
export function isPathTraversal(value: string | null | undefined): boolean {
  if (value == null || typeof value !== 'string') return false;
  const s = value.trim();
  if (s.includes('..') || s.startsWith('/') || /^[a-zA-Z]:\\/.test(s)) return true;
  return false;
}

/**
 * Безопасная проверка строки для использования как id (cuid, uuid и т.д.).
 * Отклоняет path traversal и слишком длинные/неожиданные значения.
 */
const SAFE_ID_MAX_LENGTH = 100;
export function isUnsafeId(value: string | null | undefined): boolean {
  if (value == null || typeof value !== 'string') return true;
  const s = value.trim();
  if (s.length === 0 || s.length > SAFE_ID_MAX_LENGTH) return true;
  if (isPathTraversal(s)) return true;
  if (/[\s<>"']/.test(s)) return true;
  return false;
}


/** Подозрительные паттерны: SQL-подобные конструкции, теги скриптов, опасные символы. */
const SUSPICIOUS_PATTERNS = [
  /(\b(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|EXEC|EXECUTE|SCRIPT|JAVASCRIPT|ON\s*ERROR)\b)/i,
  /<script\b/i,
  /javascript\s*:/i,
  /on\w+\s*=\s*["']/i,
  /(\%27|\'|\;\-\-|\/\*|\*\/|@@|@\w+\s*=)/i,
  /(\bOR\b\s+\d+\s*=\s*\d+|\bAND\b\s+\d+\s*=\s*\d+)/i,
  /(\bUNION\s+ALL\s+SELECT\b)/i,
  /(\bSLEEP\s*\(|\bBENCHMARK\s*\()/i,
];

/**
 * Проверка строки на подозрительное содержимое (SQL-инъекция, XSS и т.п.).
 * Не хранит и не логирует сами значения — только факт проверки.
 */
export function isSuspiciousInput(value: string | null | undefined): boolean {
  if (value == null || typeof value !== 'string') return false;
  const normalized = value.trim();
  if (normalized.length === 0) return false;
  return SUSPICIOUS_PATTERNS.some((re) => re.test(normalized));
}

/** Максимум неудачных попыток входа с одного IP за окно. */
const LOGIN_RATE_LIMIT_COUNT = 10;
/** Окно в минутах. */
const LOGIN_RATE_LIMIT_WINDOW_MINUTES = 15;

/**
 * Проверка лимита неудачных попыток входа по IP.
 * Возвращает true, если лимит превышен (нужно отклонить запрос).
 */
export async function isLoginRateLimited(ipAddress: string | null): Promise<boolean> {
  if (!ipAddress?.trim()) return false;
  const since = new Date(Date.now() - LOGIN_RATE_LIMIT_WINDOW_MINUTES * 60 * 1000);
  const count = await prisma.securityEvent.count({
    where: {
      type: SecurityEventType.LOGIN_FAILED,
      ipAddress: ipAddress.trim(),
      createdAt: { gte: since },
    },
  });
  return count >= LOGIN_RATE_LIMIT_COUNT;
}

/** Получить IP из запроса (учёт X-Forwarded-For за прокси). */
export function getClientIp(request: Request): string | null {
  const forwarded = request.headers.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return request.headers.get('x-real-ip') ?? null;
}

/** In-memory rate limit для /api/auth/*: 60 запросов в минуту с одного IP. */
const AUTH_RATE_WINDOW_MS = 60 * 1000;
const AUTH_RATE_MAX = 60;
const authRateMap = new Map<string, { count: number; resetAt: number }>();

export function isAuthEndpointRateLimited(ip: string | null): boolean {
  if (!ip?.trim()) return false;
  const key = ip.trim();
  const now = Date.now();
  const entry = authRateMap.get(key);
  if (!entry) {
    authRateMap.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return false;
  }
  if (now >= entry.resetAt) {
    authRateMap.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return false;
  }
  entry.count++;
  return entry.count > AUTH_RATE_MAX;
}

export function recordAuthEndpointHit(ip: string | null): void {
  if (!ip?.trim()) return;
  const key = ip.trim();
  const now = Date.now();
  const entry = authRateMap.get(key);
  if (!entry) {
    authRateMap.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return;
  }
  if (now >= entry.resetAt) {
    authRateMap.set(key, { count: 1, resetAt: now + AUTH_RATE_WINDOW_MS });
    return;
  }
  entry.count++;
}
