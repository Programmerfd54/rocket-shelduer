import { cookies, headers } from 'next/headers';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import prisma from './prisma';
import { logSecurityEvent, SecurityEventType } from './security';

/**
 * Аутентификация: пароли только хешируются (bcrypt 12 раундов).
 * Хеш и исходный пароль никогда не возвращаются в ответах и не логируются.
 */
const DEFAULT_JWT_SECRET = 'your-secret-key';
const DEVICE_COOKIE_NAME = 'device-id';
const DEVICE_COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 365; // 1 year

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET || DEFAULT_JWT_SECRET;
  if (process.env.NODE_ENV === 'production' && (secret === DEFAULT_JWT_SECRET || !process.env.JWT_SECRET)) {
    throw new Error('JWT_SECRET must be set in production and must not be the default value.');
  }
  return secret;
}

function getCookieSecureFlag(): boolean {
  return process.env.NODE_ENV === 'production' && process.env.COOKIE_SECURE !== 'false';
}

function sha256Hex(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function safeEqualHex(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'hex');
  const bufB = Buffer.from(b, 'hex');
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function getRequestIpFromHeaders(h: Headers): string | null {
  const forwarded = h.get('x-forwarded-for');
  if (forwarded) {
    const first = forwarded.split(',')[0]?.trim();
    if (first) return first;
  }
  return h.get('x-real-ip') ?? null;
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
}

export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

export async function verifyPassword(password: string, hashedPassword: string): Promise<boolean> {
  return bcrypt.compare(password, hashedPassword);
}

/** expiresInSeconds: длительность сессии в секундах (по умолчанию 7 дней) */
export function generateToken(payload: JWTPayload, expiresInSeconds?: number): string {
  const expiresIn = expiresInSeconds ?? 60 * 60 * 24 * 7; // 7 days
  return jwt.sign(payload, getJwtSecret(), { expiresIn });
}

export function verifyToken(token: string): JWTPayload | null {
  try {
    return jwt.verify(token, getJwtSecret()) as JWTPayload;
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
  cookieStore.set('auth-token', token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge,
    path: '/',
  });
}

export async function ensureDeviceCookie(): Promise<string> {
  const cookieStore = await cookies();
  const existing = cookieStore.get(DEVICE_COOKIE_NAME)?.value;
  if (existing) return existing;
  const deviceId = crypto.randomBytes(32).toString('base64url');
  cookieStore.set(DEVICE_COOKIE_NAME, deviceId, {
    httpOnly: true,
    secure: getCookieSecureFlag(),
    sameSite: 'lax',
    maxAge: DEVICE_COOKIE_MAX_AGE_SECONDS,
    path: '/',
  });
  return deviceId;
}

export async function getDeviceCookie(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(DEVICE_COOKIE_NAME)?.value ?? null;
}

export async function clearAuthCookie() {
  const cookieStore = await cookies();
  cookieStore.delete('auth-token');
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
};

export async function getCurrentUser(): Promise<CurrentUser | null> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    const deviceId = cookieStore.get(DEVICE_COOKIE_NAME)?.value ?? null;

    if (!token) {
      return null;
    }

    const payload = verifyToken(token);
    if (!payload) {
      return null;
    }

    // Если в JWT есть sessionId — проверяем сессию, срок и привязку к User-Agent (защита от копирования куки в другой браузер)
    if (payload.sessionId) {
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
        await prisma.session.deleteMany({ where: { id: payload.sessionId } });
        const ip = getRequestIpFromHeaders(reqHeaders);
        await logSecurityEvent({
          type: SecurityEventType.SESSION_HIJACK_ATTEMPT,
          path: null,
          method: null,
          ipAddress: ip,
          userAgent: currentUserAgent || undefined,
          details: 'Несовпадение device-id для сессии (возможное копирование куки)',
          blocked: true,
          userId: payload.userId,
        });
        return null;
      }

      if (!session.fingerprint || !safeEqualHex(session.fingerprint, fingerprint)) {
        await prisma.session.deleteMany({ where: { id: payload.sessionId } });
        const ip = getRequestIpFromHeaders(reqHeaders);
        await logSecurityEvent({
          type: SecurityEventType.SESSION_HIJACK_ATTEMPT,
          path: null,
          method: null,
          ipAddress: ip,
          userAgent: currentUserAgent || undefined,
          details: 'Несовпадение отпечатка сессии (возможное копирование куки)',
          blocked: true,
          userId: payload.userId,
        });
        return null;
      }

      if (sessionUserAgent && currentUserAgent !== sessionUserAgent) {
        await prisma.session.deleteMany({ where: { id: payload.sessionId } });
        const ip = getRequestIpFromHeaders(reqHeaders);
        await logSecurityEvent({
          type: SecurityEventType.SESSION_HIJACK_ATTEMPT,
          path: null,
          method: null,
          ipAddress: ip,
          userAgent: currentUserAgent || undefined,
          details: 'Использование сессии с другим User-Agent (возможное копирование куки)',
          blocked: true,
          userId: payload.userId,
        });
        return null;
      }

      if (process.env.SESSION_BIND_IP === 'true' && session.ipAddress) {
        const ip = getRequestIpFromHeaders(reqHeaders);
        if (ip && ip !== session.ipAddress) {
          await prisma.session.deleteMany({ where: { id: payload.sessionId } });
          await logSecurityEvent({
            type: SecurityEventType.SESSION_HIJACK_ATTEMPT,
            path: null,
            method: null,
            ipAddress: ip,
            userAgent: currentUserAgent || undefined,
            details: 'Несовпадение IP у сессии (возможное копирование куки)',
            blocked: true,
            userId: payload.userId,
          });
          return null;
        }
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
      },
    });

    if (!user) return null;
    return {
      ...user,
      role: user.role,
      sessionId: payload.sessionId,
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

/** Заблокирован: явно isBlocked админом или (для VOL) истёк срок доступа */
export function isUserEffectivelyBlocked(user: CurrentUser): boolean {
  if (user.isBlocked) return true;
  if (user.role !== 'VOL') return false;
  if (user.volunteerExpiresAt) {
    return new Date() > new Date(user.volunteerExpiresAt);
  }
  return false;
}

export async function requireAuth() {
  const user = await getCurrentUser();
  if (!user) {
    try {
      const h = await headers();
      const ip = h.get('x-forwarded-for')?.split(',')[0]?.trim() ?? h.get('x-real-ip') ?? null;
      await logSecurityEvent({
        type: SecurityEventType.INVALID_TOKEN,
        ipAddress: ip,
        userAgent: h.get('user-agent') ?? undefined,
        details: 'Invalid or expired token',
        blocked: true,
      });
    } catch {
      // ignore logging errors
    }
    throw new Error('Unauthorized');
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
