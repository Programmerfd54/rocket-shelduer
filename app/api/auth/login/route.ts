import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import {
  verifyPassword,
  burnPasswordCheck,
  isUserEffectivelyBlocked,
  createSessionAndSetCookie,
  MAX_PASSWORD_LENGTH,
} from '@/lib/auth';
import {
  logSecurityEvent,
  getClientIp,
  isSuspiciousInput,
  isLoginRateLimited,
  isAuthEndpointRateLimited,
  isAccountLoginLocked,
  accountLoginMarker,
  recordAccountLoginFailure,
  resetAccountLoginFailures,
  SecurityEventType,
} from '@/lib/security';

const DEFAULT_SESSION_MINUTES = 60 * 24 * 7; // 7 days
const MAX_LOGIN_LENGTH = 254;
const GENERIC_LOGIN_ERROR = 'Неверный логин или пароль';

const userSelect = {
  id: true,
  email: true,
  username: true,
  name: true,
  role: true,
  password: true,
  isBlocked: true,
  isActive: true,
  volunteerExpiresAt: true,
  avatarUrl: true,
  restrictedFeatures: true,
  sessionDurationMinutes: true,
  requirePasswordChange: true,
  lastLoginAt: true,
} as const;

export async function POST(request: Request) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? undefined;

  if (isAuthEndpointRateLimited(ip ?? null)) {
    await logSecurityEvent({
      type: SecurityEventType.AUTH_RATE_LIMIT,
      path: '/api/auth/login',
      method: 'POST',
      ipAddress: ip,
      userAgent,
      details: 'Превышен лимит запросов к auth (60/мин)',
      blocked: true,
    });
    return NextResponse.json(
      { error: 'Слишком много запросов. Попробуйте позже.' },
      { status: 429 }
    );
  }

  try {
    const body = await request.json().catch(() => null);
    const rawLogin = body?.login ?? body?.email;
    const login = typeof rawLogin === 'string' ? rawLogin.trim() : '';
    const password = body?.password;

    if (!login || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль' },
        { status: 400 }
      );
    }

    if (login.length > MAX_LOGIN_LENGTH || password.length > MAX_PASSWORD_LENGTH) {
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    // Пароль не проверяем на «подозрительные» символы: он не попадает в SQL/HTML (только bcrypt),
    // а такая проверка запрещала входить с паролями, содержащими кавычки и т.п.
    if (isSuspiciousInput(login)) {
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы в поле входа',
        blocked: true,
      });
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    if (await isLoginRateLimited(ip ?? null)) {
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_RATE_LIMIT,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Превышен лимит неудачных попыток входа',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'Слишком много попыток входа. Попробуйте позже.' },
        { status: 429 }
      );
    }

    // Сначала точное совпадение по логину (email), затем username без учёта регистра —
    // чужой username, совпадающий с вашим логином, не «перехватывает» вход.
    const user =
      (await prisma.user.findUnique({ where: { email: login.toLowerCase() }, select: userSelect })) ??
      (await prisma.user.findFirst({
        where: { username: { equals: login, mode: 'insensitive' } },
        select: userSelect,
      }));

    // Лимит на учётную запись (по введённому логину, одинаково для существующих и несуществующих).
    // Счётчик в БД — общий для всех реплик; успешный вход (lastLoginAt) обнуляет его.
    if (await isAccountLoginLocked(login, user?.lastLoginAt ?? null)) {
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_RATE_LIMIT,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Превышен лимит неудачных попыток входа для учётной записи',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'Слишком много попыток входа. Попробуйте позже.' },
        { status: 429 }
      );
    }

    if (!user) {
      await burnPasswordCheck(password);
      recordAccountLoginFailure(login);
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: `Пользователь не найден ${accountLoginMarker(login)}`,
        blocked: true,
      });
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    const isValidPassword = await verifyPassword(password, user.password);

    if (!isValidPassword) {
      recordAccountLoginFailure(login);
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: `Неверный пароль ${accountLoginMarker(login)}`,
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json({ error: GENERIC_LOGIN_ERROR }, { status: 401 });
    }

    if (
      user.isActive === false ||
      isUserEffectivelyBlocked({
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
        avatarUrl: user.avatarUrl,
        restrictedFeatures: user.restrictedFeatures,
        volunteerExpiresAt: user.volunteerExpiresAt,
        volunteerIntensive: null,
        isBlocked: user.isBlocked,
        blockedAt: null,
        blockedReason: null,
      })
    ) {
      await logSecurityEvent({
        type: SecurityEventType.BLOCKED_USER_LOGIN,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: user.isActive === false
          ? 'Вход деактивированного пользователя'
          : 'Вход заблокированного или просроченного пользователя',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Account is blocked or access has expired. Contact administrator.' },
        { status: 403 }
      );
    }

    resetAccountLoginFailures(login);

    const sessionMinutes = user.sessionDurationMinutes ?? DEFAULT_SESSION_MINUTES;
    await createSessionAndSetCookie({
      user: {
        id: user.id,
        email: user.email,
        role: user.role as string,
        requirePasswordChange: user.requirePasswordChange,
      },
      sessionMinutes,
      requestHeaders: request.headers,
      ip,
    });

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        username: user.username,
        name: user.name,
        role: user.role,
      },
      requirePasswordChange: user.requirePasswordChange === true,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to login' },
      { status: 500 }
    );
  }
}
