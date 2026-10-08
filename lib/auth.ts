import { cookies, headers } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from './prisma';
import { logSecurityEvent, SecurityEventType } from './security';
import {
  AUTH_COOKIE_HOST,
  AUTH_COOKIE_LEGACY,
  DEVICE_COOKIE_HOST,
  DEVICE_COOKIE_LEGACY,
  authCookieName,
  createFixedWindowLimiter,
  deviceCookieName,
  getClientIpFromHeaders,
  isSecureCookieMode,
  readCookiePreferHost,
  resolveJwtSecret,
} from './http-security';

/**
 * Аутентификация: пароли только хешируются (bcrypt 12 раундов).
 * Хеш и исходный пароль никогда не возвращаются в ответах и не логируются.
 *
 * Сессия = подписанный JWT (HS256, exp) в httpOnly-cookie + запись Session в БД.
 * JWT без sessionId не принимается: каждую сессию можно отозвать (logout, «выйти везде»,
 * смена/сброс пароля). Сессия привязана к device-id cookie, отпечатку и User-Agent.
 */
// Имена cookie: в production с Secure — __Host-auth-token / __Host-device-id, иначе auth-token / device-id.
// Чтение — оба имени (новое первым), см. readAuthCookie/readDeviceCookie.
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year
const JWT_ALGORITHM = 'HS256' as const;

/** Максимальная длина пароля (bcrypt учитывает только первые 72 байта; длинные строки — лишняя нагрузка). */
export const MAX_PASSWORD_LENGTH = 256;
export const MIN_PASSWORD_LENGTH = 8;

let warnedWeakSecret = false;

function getJwtSecret(): string {
  const secret = resolveJwtSecret(process.env);
  if (!secret) {
    throw new Error(
      'JWT_SECRET is not set (or is a known placeholder in production). Set a long random JWT_SECRET.'
    );
  }
  if (!warnedWeakSecret && (secret === 'your-secret-key' || secret.length < 32)) {
    warnedWeakSecret = true;
    console.warn('[auth] JWT_SECRET is weak (placeholder or < 32 chars). Use `openssl rand -base64 32`.');
  }
  return secret;
}

function getCookieSecureFlag(): boolean {
  return isSecureCookieMode(process.env);
}

type CookieStore = Awaited<ReturnType<typeof cookies>>;

/** JWT из cookie: __Host-auth-token, затем legacy auth-token. */
export function readAuthCookie(cookieStore: Pick<CookieStore, 'get'>): string | undefined {
  return readCookiePreferHost((n) => cookieStore.get(n)?.value, AUTH_COOKIE_HOST, AUTH_COOKIE_LEGACY);
}

function readDeviceCookie(cookieStore: Pick<CookieStore, 'get'>): string | undefined {
  return readCookiePreferHost((n) => cookieStore.get(n)?.value, DEVICE_COOKIE_HOST, DEVICE_COOKIE_LEGACY);
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length || bufA.length === 0) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

export function getSessionFingerprint(h: Headers): string {
  const ua = h.get('user-agent') ?? '';
  const lang = h.get('accept-language') ?? '';
  const chUa = h.get('sec-ch-ua') ?? '';
  const chPlatform = h.get('sec-ch-ua-platform') ?? '';
  const chMobile = h.get('sec-ch-ua-mobile') ?? '';
  const raw = `${ua}|${lang}|${chUa}|${chPlatform}|${chMobile}`.slice(0, 2000);
  return sha256Hex(raw);
}

export function hashDeviceId(deviceId: string): string {
  return sha256Hex(deviceId);
}

export interface JWTPayload {
  userId: string;
  email: string;
  role: string;
  sessionId?: string;
  /** Требуется смена временного пароля: middleware пропускает только auth-эндпоинты. */
  pwc?: boolean;
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  if (typeof password !== 'string' || password.length > MAX_PASSWORD_LENGTH) return false;
  return bcrypt.compare(password, hashedPassword);
}

let dummyHashPromise: Promise<string> | null = null;

/**
 * Выполняет bcrypt-сравнение с фиктивным хешем: время ответа «пользователь не найден»
 * совпадает со временем «неверный пароль» (защита от перечисления логинов по времени).
 */
export async function burnPasswordCheck(password: unknown): Promise<void> {
  dummyHashPromise ??= bcrypt.hash(crypto.randomBytes(16).toString('hex'), 12);
  const hash = await dummyHashPromise;
  const p = typeof password === 'string' ? password.slice(0, MAX_PASSWORD_LENGTH) : '';
  await bcrypt.compare(p, hash);
}

/**
 * Серверная проверка нового пароля (дублирует клиентскую, клиенту не доверяем).
 * identifiers — логин/email/username: пароль не может совпадать с ними (после сброса пароль = логин).
 * Возвращает текст ошибки или null.
 */
export async function validateNewPassword(
  password: unknown,
  identifiers: Array<string | null | undefined> = []
): Promise<string | null> {
  if (typeof password !== 'string' || password.length < MIN_PASSWORD_LENGTH) {
    return 'Пароль должен содержать минимум 8 символов';
  }
  if (password.length > MAX_PASSWORD_LENGTH) {
    return `Пароль слишком длинный (максимум ${MAX_PASSWORD_LENGTH} символов)`;
  }
  const { checkPasswordStrength } = await import('@/lib/utils');
  const strength = checkPasswordStrength(password);
  if (!strength.valid || strength.strength === 'weak') {
    return 'Пароль слишком простой: используйте буквы разного регистра, цифры и спецсимволы';
  }
  const lower = password.trim().toLowerCase();
  for (const id of identifiers) {
    if (!id) continue;
    const v = id.trim().toLowerCase();
    if (!v) continue;
    const local = v.includes('@') ? v.split('@')[0] : v;
    if (lower === v || (local && lower === local)) {
      return 'Пароль не должен совпадать с логином';
    }
  }
  return null;
}

/** expiresInSeconds: длительность сессии в секундах (по умолчанию 7 дней) */
export function generateToken(payload: JWTPayload, expiresInSeconds?: number): string {
  const expiresIn = expiresInSeconds ?? 60 * 60 * 24 * 7; // 7 days
  const claims: JWTPayload = {
    userId: payload.userId,
    email: payload.email,
    role: payload.role,
    ...(payload.sessionId ? { sessionId: payload.sessionId } : {}),
    ...(payload.pwc ? { pwc: true } : {}),
  };
  return jwt.sign(claims, getJwtSecret(), { expiresIn, algorithm: JWT_ALGORITHM });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    const decoded = jwt.verify(token, getJwtSecret(), { algorithms: [JWT_ALGORITHM] });
    if (!decoded || typeof decoded !== 'object' || typeof decoded.userId !== 'string') return null;
    return decoded as unknown as JWTPayload;
  } catch {
    return null;
  }
}

/** maxAgeSeconds: срок жизни cookie в секундах (по умолчанию 7 дней) */
export async function setAuthCookie(token: string, maxAgeSeconds?: number) {
  const cookieStore = await cookies();
  const maxAge = maxAgeSeconds ?? 60 * 60 * 24 * 7; // 7 days
  // В Docker/за прокси по HTTP: задайте COOKIE_SECURE=false, иначе cookie не отправляется и вход «не держится»
  const secure = getCookieSecureFlag();
  const name = authCookieName(process.env);
  cookieStore.set(name, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
  // Переход на __Host-: legacy-cookie больше не нужна (и не должна «перебивать» новую)
  if (name !== AUTH_COOKIE_LEGACY && cookieStore.get(AUTH_COOKIE_LEGACY)) cookieStore.delete(AUTH_COOKIE_LEGACY);
}

function setDeviceCookie(cookieStore: CookieStore, deviceId: string) {
  const name = deviceCookieName(process.env);
  cookieStore.set(name, deviceId, {
    httpOnly: true,
    secure: getCookieSecureFlag(),
    sameSite: 'lax',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  if (name !== DEVICE_COOKIE_LEGACY && cookieStore.get(DEVICE_COOKIE_LEGACY)) cookieStore.delete(DEVICE_COOKIE_LEGACY);
}

export async function ensureDeviceCookie(): Promise<string> {
  const cookieStore = await cookies();
  const existing = readDeviceCookie(cookieStore);
  if (existing) return existing;
  const deviceId = crypto.randomBytes(32).toString('base64url');
  setDeviceCookie(cookieStore, deviceId);
  return deviceId;
}

/**
 * Новый device-id при каждом входе: значение, подброшенное заранее (cookie tossing с соседнего
 * поддомена, общий компьютер), не становится частью новой сессии.
 */
export async function rotateDeviceCookie(): Promise<string> {
  const cookieStore = await cookies();
  const deviceId = crypto.randomBytes(32).toString('base64url');
  setDeviceCookie(cookieStore, deviceId);
  return deviceId;
}

export async function getDeviceCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return readDeviceCookie(cookieStore) ?? null;
}

/** Удаляет auth-cookie под обоими именами (новым __Host- и legacy). */
export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.set(AUTH_COOKIE_LEGACY, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: getCookieSecureFlag() });
  if (getCookieSecureFlag() || cookieStore.get(AUTH_COOKIE_HOST)) {
    // __Host- cookie удаляется только Set-Cookie с Secure и Path=/
    cookieStore.set(AUTH_COOKIE_HOST, '', { path: '/', maxAge: 0, httpOnly: true, sameSite: 'lax', secure: true });
  }
}

/**
 * Создать сессию (Session в БД) и выставить auth-cookie. Срок JWT = срок cookie = Session.expiresAt.
 */
export async function createSessionAndSetCookie(params: {
  user: { id: string; email: string; role: string; requirePasswordChange?: boolean | null };
  sessionMinutes: number;
  requestHeaders: Headers;
  ip: string | null;
}): Promise<{ sessionId: string; expiresAt: Date }> {
  const { user, sessionMinutes, requestHeaders, ip } = params;
  const seconds = Math.max(60, Math.round(sessionMinutes * 60));
  const expiresAt = new Date(Date.now() + seconds * 1000);
  const deviceId = await rotateDeviceCookie();
  const userAgent = requestHeaders.get('user-agent');
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      userAgent: userAgent?.slice(0, 500) ?? null,
      fingerprint: getSessionFingerprint(requestHeaders),
      deviceIdHash: hashDeviceId(deviceId),
      ipAddress: ip,
      expiresAt,
    },
  });
  const token = generateToken(
    {
      userId: user.id,
      email: user.email,
      role: user.role,
      sessionId: session.id,
      pwc: user.requirePasswordChange === true,
    },
    seconds
  );
  await setAuthCookie(token, seconds);
  return { sessionId: session.id, expiresAt };
}

/**
 * Перевыпустить JWT для существующей сессии (например, после установки постоянного пароля —
 * без флага pwc). Срок не продлевается: остаток до Session.expiresAt.
 */
export async function reissueSessionToken(params: {
  user: { id: string; email: string; role: string };
  sessionId: string;
  expiresAt: Date;
  requirePasswordChange: boolean;
}): Promise<void> {
  const seconds = Math.floor((new Date(params.expiresAt).getTime() - Date.now()) / 1000);
  if (seconds <= 0) return;
  const token = generateToken(
    {
      userId: params.user.id,
      email: params.user.email,
      role: params.user.role,
      sessionId: params.sessionId,
      pwc: params.requirePasswordChange,
    },
    seconds
  );
  await setAuthCookie(token, seconds);
}

export type CurrentUser = {
  id: string;
  email: string;
  name: string | null;
  role: string;
  avatarUrl: string | null;
  restrictedFeatures: string[];
  volunteerExpiresAt: Date | null;
  volunteerIntensive: string | null;
  isBlocked: boolean;
  blockedAt: Date | null;
  blockedReason: string | null;
  sessionId?: string;
  sessionDurationMinutes?: number | null;
  requirePasswordChange?: boolean;
  /** Срок текущей сессии (для перевыпуска токена). Не отдавать клиенту без необходимости. */
  sessionExpiresAt?: Date;
  /** Флаг pwc в текущем JWT (может отставать от БД — синхронизируется в /api/auth/me). */
  tokenRequiresPasswordChange?: boolean;
};

async function revokeSessionWithEvent(
  sessionId: string,
  userId: string,
  reqHeaders: Headers,
  details: string
): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
  await logSecurityEvent({
    type: SecurityEventType.SESSION_HIJACK_ATTEMPT,
    path: null,
    method: null,
    ipAddress: getClientIpFromHeaders(reqHeaders),
    userAgent: (reqHeaders.get('user-agent') ?? '').trim().slice(0, 500) || undefined,
    details,
    blocked: true,
    userId,
  });
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const cookieStore = await cookies();
    const token = readAuthCookie(cookieStore);
    const deviceId = readDeviceCookie(cookieStore) ?? null;

    if (!token) {
      return null;
    }

    const payload = verifyToken(token);
    // Токены без sessionId (старый формат) не принимаются: их невозможно отозвать
    if (!payload || !payload.sessionId) {
      return null;
    }

    // Проверяем сессию, срок и привязку к устройству/User-Agent (защита от копирования куки в другой браузер)
    const session = await prisma.session.findUnique({
      where: { id: payload.sessionId },
      select: { userId: true, expiresAt: true, userAgent: true, fingerprint: true, deviceIdHash: true, ipAddress: true },
    });
    if (!session || session.userId !== payload.userId || new Date(session.expiresAt) <= new Date()) {
      return null;
    }
    const reqHeaders = await headers();
    const currentUserAgent = (reqHeaders.get('user-agent') ?? '').trim().slice(0, 500);
    const sessionUserAgent = (session.userAgent ?? '').trim();
    const fingerprint = getSessionFingerprint(reqHeaders);
    const deviceHash = deviceId ? sha256Hex(deviceId) : null;

    if (!session.deviceIdHash || !deviceHash || !safeEqualHex(session.deviceIdHash, deviceHash)) {
      await revokeSessionWithEvent(payload.sessionId, payload.userId, reqHeaders, 'Несовпадение device-id для сессии (возможное копирование куки)');
      return null;
    }

    if (!session.fingerprint || !safeEqualHex(session.fingerprint, fingerprint)) {
      await revokeSessionWithEvent(payload.sessionId, payload.userId, reqHeaders, 'Несовпадение отпечатка сессии (возможное копирование куки)');
      return null;
    }

    if (sessionUserAgent && currentUserAgent !== sessionUserAgent) {
      await revokeSessionWithEvent(payload.sessionId, payload.userId, reqHeaders, 'Использование сессии с другим User-Agent (возможное копирование куки)');
      return null;
    }

    if (process.env.SESSION_BIND_IP === 'true' && session.ipAddress) {
      const ip = getClientIpFromHeaders(reqHeaders);
      if (ip && ip !== session.ipAddress) {
        await revokeSessionWithEvent(payload.sessionId, payload.userId, reqHeaders, 'Несовпадение IP у сессии (возможное копирование куки)');
        return null;
      }
    }

    const user = await prisma.user.findUnique({
      where: { id: payload.userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        avatarUrl: true,
        restrictedFeatures: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
        isBlocked: true,
        blockedAt: true,
        blockedReason: true,
        sessionDurationMinutes: true,
        requirePasswordChange: true,
        isActive: true,
      },
    });

    // Деактивированный пользователь (isActive=false) теряет доступ сразу, а не после истечения JWT
    if (!user || user.isActive === false) return null;
    const { isActive: _isActive, ...rest } = user;
    void _isActive;
    return {
      ...rest,
      role: user.role,
      sessionId: payload.sessionId,
      sessionExpiresAt: session.expiresAt,
      tokenRequiresPasswordChange: payload.pwc === true,
    };
  } catch {
    return null;
  }
}

export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.session.deleteMany({ where: { id: sessionId } });
}

export async function deleteAllSessionsExcept(userId: string, exceptSessionId?: string): Promise<number> {
  const where: { userId: string; id?: { not: string } } = { userId };
  if (exceptSessionId) where.id = { not: exceptSessionId };
  const result = await prisma.session.deleteMany({ where });
  return result.count;
}

/** Заблокирован: явно isBlocked админом или (для волонтёра MEMBER) истёк срок доступа */
export function isUserEffectivelyBlocked(user: CurrentUser): boolean {
  if (user.isBlocked) return true;
  if (user.role !== 'MEMBER') return false;
  if (user.volunteerExpiresAt) {
    return new Date() > new Date(user.volunteerExpiresAt);
  }
  return false;
}

/** Не пишем INVALID_TOKEN в БД на каждый анонимный запрос: максимум 20 событий/мин с одного IP. */
const invalidTokenLogLimiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 20 });

/**
 * Требует авторизацию, но допускает пользователя с requirePasswordChange
 * (только для эндпоинтов установки пароля / профиля сессии).
 */
export async function requireAuthAllowPasswordChange() {
  const user = await getCurrentUser();
  if (!user) {
    try {
      const h = await headers();
      const cookieStore = await cookies();
      const hadToken = Boolean(readAuthCookie(cookieStore));
      const ip = getClientIpFromHeaders(h);
      if (hadToken && !invalidTokenLogLimiter.hit(ip ?? 'unknown')) {
        await logSecurityEvent({
          type: SecurityEventType.INVALID_TOKEN,
          ipAddress: ip,
          userAgent: h.get('user-agent') ?? undefined,
          details: 'Invalid or expired token',
          blocked: true,
        });
      }
    } catch {
      // ignore logging errors
    }
    throw new Error('Unauthorized');
  }
  return user;
}

/**
 * Требует авторизацию. Серверные проверки (не только редирект на клиенте):
 *  - временный пароль (requirePasswordChange) → Forbidden, пока не задан постоянный;
 *  - заблокированный пользователь / истёкший срок волонтёра → Forbidden
 *    (ему доступны только /api/auth/me и /api/auth/logout, которые не используют requireAuth).
 */
export async function requireAuth() {
  const user = await requireAuthAllowPasswordChange();
  if (user.requirePasswordChange) {
    throw new Error('Forbidden');
  }
  if (isUserEffectivelyBlocked(user)) {
    throw new Error('Forbidden');
  }
  return user;
}

/** Требует авторизацию и что пользователь не заблокирован (для VOL) */
export async function requireAuthNotBlocked() {
  const user = await requireAuth();
  if (isUserEffectivelyBlocked(user)) {
    throw new Error('BLOCKED');
  }
  return user;
}

/** Проверка: ошибка «Forbidden» от requireAdmin/requireAction. */
export function isForbiddenError(e: unknown): boolean {
  return e instanceof Error && e.message === 'Forbidden';
}

/** Требует роль Lead_SUP (глобальная). Иначе Forbidden. */
export async function requireAdmin() {
  const user = await requireAuth();
  if (user.role !== 'LEAD_SUP') {
    throw new Error('Forbidden');
  }
  return user;
}

/** Требует роль SUP или Lead_SUP. */
export async function requireSupportOrAdmin() {
  const user = await requireAuth();
  if (user.role !== 'SUP' && user.role !== 'LEAD_SUP') {
    throw new Error('Forbidden');
  }
  return user;
}

/** Требует роль SUP, ADM или Lead_SUP. */
export async function requireSupportAdmOrAdmin() {
  const user = await requireAuth();
  if (user.role !== 'SUP' && user.role !== 'ADM' && user.role !== 'LEAD_SUP') {
    throw new Error('Forbidden');
  }
  return user;
}
