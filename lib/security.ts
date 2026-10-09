import crypto from 'crypto';
import prisma from './prisma';
import {
  checkBearerSecret,
  createFixedWindowLimiter,
  getClientIpFromHeaders,
} from './http-security';
import { redactString, safeErrorForLog } from './sensitive-data';

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
        path: params.path != null ? redactString(params.path).slice(0, 500) : null,
        method: params.method?.slice(0, 16) ?? null,
        ipAddress: params.ipAddress?.slice(0, 64) ?? null,
        userAgent: params.userAgent?.slice(0, 500) ?? null,
        // details могут содержать текст ошибки Rocket.Chat/Prisma — секреты вырезаются до записи в БД
        details: params.details != null ? redactString(params.details).slice(0, 2000) : null,
        blocked: params.blocked ?? true,
        userId: params.userId ?? null,
      },
    });
  } catch (err) {
    console.error('Failed to log security event:', safeErrorForLog(err));
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

/** id общего шаблона из lib/templates-data (напр. d1-09), не cuid */
export function isValidOfficialTemplateId(value: string | null | undefined): boolean {
  if (value == null || typeof value !== 'string') return false;
  const s = value.trim();
  if (s.length === 0 || s.length > 80) return false;
  if (isPathTraversal(s)) return false;
  return /^[a-zA-Z0-9._-]+$/.test(s);
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

/**
 * Безопасное сообщение об ошибке для ответов API.
 * В production возвращает fallback, в dev — message из Error (если есть).
 */
export function getSafeErrorMessage(error: unknown, fallback: string): string {
  if (process.env.NODE_ENV !== 'production') {
    return error instanceof Error ? error.message : fallback;
  }
  return fallback;
}

/**
 * IP клиента из запроса с учётом доверенных прокси (TRUSTED_PROXY_HOPS, по умолчанию 1):
 * берётся запись X-Forwarded-For, дописанная ближайшим доверенным прокси, а не первая (её подделывает клиент).
 */
export function getClientIp(request: Request): string | null {
  return getClientIpFromHeaders(request.headers);
}

/**
 * In-memory rate limit для /api/auth/*: 60 запросов в минуту с одного IP (на процесс).
 * Это грубый фильтр от флуда; перебор паролей ограничивают счётчики в БД (isLoginRateLimited,
 * isAccountLoginLocked), общий для реплик лимит запросов — nginx limit_req (deploy/nginx-example.conf).
 */
const authLimiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 60 });

export function isAuthEndpointRateLimited(ip: string | null): boolean {
  return authLimiter.hit(ip);
}

/** @deprecated Учёт уже выполняет isAuthEndpointRateLimited; оставлено для совместимости вызовов. */
export function recordAuthEndpointHit(ip: string | null): void {
  void ip;
}

/** Rate limit для invite token: 30 проверок в минуту с одного IP. */
const inviteLimiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 30 });

export function isInviteTokenRateLimited(ip: string | null): boolean {
  return inviteLimiter.hit(ip ? `invite:${ip}` : null);
}

/**
 * Лимит неудачных входов на учётную запись (по введённому логину, независимо от того,
 * существует ли пользователь — чтобы лимит не раскрывал наличие аккаунта).
 * 10 неудач за 15 минут → вход по этому логину временно отклоняется (429).
 * Защищает от перебора пароля с множества IP (ротация X-Forwarded-For, ботнет).
 *
 * Счётчик — в БД (события LOGIN_FAILED с меткой учётной записи в details), поэтому общий для всех
 * реплик и переживает перезапуск. In-memory счётчик — только запасной вариант при ошибке БД.
 * Сам логин не хранится: метка — HMAC (логин мог быть введён вместо пароля).
 */
export const ACCOUNT_LOGIN_WINDOW_MS = 15 * 60 * 1000;
export const ACCOUNT_LOGIN_MAX_FAILURES = 10;
const accountLoginLimiter = createFixedWindowLimiter({
  windowMs: ACCOUNT_LOGIN_WINDOW_MS,
  max: ACCOUNT_LOGIN_MAX_FAILURES,
  maxKeys: 50_000,
});

function accountKey(login: string): string {
  return `acct:${login.trim().toLowerCase()}`;
}

/** Метка учётной записи для details события LOGIN_FAILED (HMAC от логина, без самого логина). */
export function accountLoginMarker(login: string, secret: string | undefined = process.env.JWT_SECRET): string {
  const digest = crypto
    .createHmac('sha256', secret || 'rocketchat-scheduler-account-lock')
    .update(login.trim().toLowerCase())
    .digest('hex')
    .slice(0, 24);
  return `[acct:${digest}]`;
}

/** Начало окна подсчёта: последние 15 минут, но не раньше последнего успешного входа (сброс счётчика). */
export function accountLockWindowStart(now: number, lastSuccessAt?: Date | null): Date {
  const windowStart = new Date(now - ACCOUNT_LOGIN_WINDOW_MS);
  if (lastSuccessAt && new Date(lastSuccessAt).getTime() > windowStart.getTime()) return new Date(lastSuccessAt);
  return windowStart;
}

/**
 * true — по этому логину слишком много неудач (429).
 * lastSuccessAt — время последнего успешного входа найденного пользователя (null для несуществующего).
 */
export async function isAccountLoginLocked(login: string, lastSuccessAt?: Date | null): Promise<boolean> {
  try {
    const count = await prisma.securityEvent.count({
      where: {
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/auth/login',
        createdAt: { gte: accountLockWindowStart(Date.now(), lastSuccessAt) },
        details: { contains: accountLoginMarker(login) },
      },
    });
    return count >= ACCOUNT_LOGIN_MAX_FAILURES;
  } catch {
    return accountLoginLimiter.isLimited(accountKey(login));
  }
}

/** Запасной in-memory учёт (основной — событие LOGIN_FAILED с accountLoginMarker в details). */
export function recordAccountLoginFailure(login: string): void {
  accountLoginLimiter.hit(accountKey(login));
}

export function resetAccountLoginFailures(login: string): void {
  accountLoginLimiter.reset(accountKey(login));
}

/**
 * Перебор текущего пароля в «Настройках» украденной сессией: 5 ошибок за 15 минут на пользователя.
 * Считается по событиям LOGIN_FAILED (path /api/user/password) в БД — общий для всех реплик;
 * in-memory — запасной вариант при ошибке БД.
 */
const CURRENT_PASSWORD_WINDOW_MS = 15 * 60 * 1000;
const CURRENT_PASSWORD_MAX_FAILURES = 5;
const currentPasswordLimiter = createFixedWindowLimiter({
  windowMs: CURRENT_PASSWORD_WINDOW_MS,
  max: CURRENT_PASSWORD_MAX_FAILURES,
});

export async function isCurrentPasswordCheckLocked(userId: string): Promise<boolean> {
  try {
    const count = await prisma.securityEvent.count({
      where: {
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/user/password',
        userId,
        createdAt: { gte: new Date(Date.now() - CURRENT_PASSWORD_WINDOW_MS) },
      },
    });
    return count >= CURRENT_PASSWORD_MAX_FAILURES;
  } catch {
    return currentPasswordLimiter.isLimited(`pwd:${userId}`);
  }
}

export function recordCurrentPasswordFailure(userId: string): void {
  currentPasswordLimiter.hit(`pwd:${userId}`);
}

/**
 * Авторизация служебных cron-эндпоинтов: Authorization: Bearer <CRON_SECRET>.
 * Сравнение за постоянное время; в production CRON_SECRET обязателен и не может быть заглушкой.
 * Возвращает null, если доступ разрешён, иначе { status, error } для ответа.
 */
export function verifyCronRequest(request: Request): { status: number; error: string } | null {
  const result = checkBearerSecret(
    request.headers.get('authorization'),
    process.env.CRON_SECRET,
    process.env.NODE_ENV === 'production'
  );
  if (result === 'ok') return null;
  if (result === 'misconfigured') return { status: 503, error: 'Cron is not configured' };
  return { status: 401, error: 'Unauthorized' };
}

/* ------------------------------------------------------------------ */
/* Подключение пространства Rocket.Chat (логин/пароль или токен)        */
/* ------------------------------------------------------------------ */

/**
 * Лимит попыток проверки учётных данных Rocket.Chat (создание/смена кредов/подтверждение назначения):
 * не более 10 попыток за 15 минут на пользователя и 30 — с одного IP. Иначе приложение можно
 * использовать как прокси для перебора паролей Rocket.Chat (и для блокировки чужих учёток в LDAP).
 * Учёт: in-memory по попыткам + в БД по неудачам (события WORKSPACE_AUTH_FAILED пользователя) —
 * общий для реплик и переживает перезапуск.
 */
export const RC_CONNECT_WINDOW_MS = 15 * 60 * 1000;
export const RC_CONNECT_MAX_PER_USER = 10;
export const RC_CONNECT_MAX_PER_IP = 30;
const rcConnectUserLimiter = createFixedWindowLimiter({ windowMs: RC_CONNECT_WINDOW_MS, max: RC_CONNECT_MAX_PER_USER });
const rcConnectIpLimiter = createFixedWindowLimiter({ windowMs: RC_CONNECT_WINDOW_MS, max: RC_CONNECT_MAX_PER_IP });

export const RC_CONNECT_RATE_LIMIT_MESSAGE =
  'Слишком много попыток подключения к Rocket.Chat. Подождите 15 минут и повторите.';

/**
 * Засчитать попытку проверки кредов RC. true — лимит превышен (ответить 429, к Rocket.Chat не обращаться).
 * Вызывать только когда запрос действительно отправит креды в Rocket.Chat.
 */
export async function hitRcConnectRateLimit(userId: string, ip: string | null): Promise<boolean> {
  const userLimited = rcConnectUserLimiter.hit(`rcconn:u:${userId}`);
  const ipLimited = rcConnectIpLimiter.hit(ip ? `rcconn:ip:${ip}` : null);
  if (userLimited || ipLimited) return true;
  try {
    const failures = await prisma.securityEvent.count({
      where: {
        type: SecurityEventType.WORKSPACE_AUTH_FAILED,
        userId,
        createdAt: { gte: new Date(Date.now() - RC_CONNECT_WINDOW_MS) },
      },
    });
    return failures >= RC_CONNECT_MAX_PER_USER;
  } catch {
    return false;
  }
}

/** Неудачная проверка кредов RC: событие безопасности (без кредов) — учитывается лимитом выше. */
export async function recordRcConnectFailure(params: {
  userId: string;
  request: Request;
  path: string;
  method: string;
  reason: string;
}): Promise<void> {
  await logSecurityEvent({
    type: SecurityEventType.WORKSPACE_AUTH_FAILED,
    path: params.path,
    method: params.method,
    ipAddress: getClientIp(params.request),
    userAgent: params.request.headers.get('user-agent') ?? undefined,
    details: params.reason.slice(0, 300),
    blocked: true,
    userId: params.userId,
  });
}

/** Ошибка сети/недоступности RC (не связана с кредами). */
export function isRcNetworkErrorMessage(message: string): boolean {
  return /fetch failed|timeout|ECONNREFUSED|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|ENOTFOUND|ETIMEDOUT|Network error|Cannot connect/i.test(
    message
  );
}

/** Единое сообщение при отказе входа в RC — не раскрывает, существует ли учётная запись. */
export const RC_LOGIN_FAILED_MESSAGE =
  'Не удалось войти в Rocket.Chat. Проверьте адрес сервера, логин и пароль (или токен и User ID).';
