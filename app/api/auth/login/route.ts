import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { verifyPassword, generateToken, setAuthCookie, isUserEffectivelyBlocked } from '@/lib/auth';
import {
  logSecurityEvent,
  getClientIp,
  isSuspiciousInput,
  isLoginRateLimited,
  isAuthEndpointRateLimited,
  recordAuthEndpointHit,
  SecurityEventType,
} from '@/lib/security';

const DEFAULT_SESSION_MINUTES = 60 * 24 * 7; // 7 days

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
  recordAuthEndpointHit(ip ?? null);

  try {
    const body = await request.json();
    const login = (body.login ?? body.email)?.trim();
    const password = body.password;

    if (!login || !password) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль' },
        { status: 400 }
      );
    }

    if (isSuspiciousInput(login) || isSuspiciousInput(password)) {
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы в поле входа',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
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

    const user = await prisma.user.findUnique({
      where: { email: login.toLowerCase() },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        password: true,
        isBlocked: true,
        volunteerExpiresAt: true,
        avatarUrl: true,
        restrictedFeatures: true,
        sessionDurationMinutes: true,
      },
    });

    if (!user) {
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Пользователь не найден',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    const isValidPassword = await verifyPassword(password, user.password);

    if (!isValidPassword) {
      await logSecurityEvent({
        type: SecurityEventType.LOGIN_FAILED,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Неверный пароль',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Неверный логин или пароль' },
        { status: 401 }
      );
    }

    if (isUserEffectivelyBlocked({
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
    })) {
      await logSecurityEvent({
        type: SecurityEventType.BLOCKED_USER_LOGIN,
        path: '/api/auth/login',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Вход заблокированного или просроченного пользователя',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Account is blocked or access has expired. Contact administrator.' },
        { status: 403 }
      );
    }

    const sessionMinutes = user.sessionDurationMinutes ?? DEFAULT_SESSION_MINUTES;
    const expiresAt = new Date(Date.now() + sessionMinutes * 60 * 1000);

    const session = await prisma.session.create({
      data: {
        userId: user.id,
        userAgent: userAgent?.slice(0, 500) ?? null,
        expiresAt,
      },
    });

    const token = generateToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role as string,
        sessionId: session.id,
      },
      sessionMinutes * 60
    );

    await setAuthCookie(token, sessionMinutes * 60);

    await prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return NextResponse.json({
      success: true,
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role,
      },
      token,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to login' },
      { status: 500 }
    );
  }
}