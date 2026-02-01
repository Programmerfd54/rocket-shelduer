import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, generateToken, setAuthCookie } from '@/lib/auth';
import {
  logSecurityEvent,
  getClientIp,
  isSuspiciousInput,
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
      path: '/api/auth/register',
      method: 'POST',
      ipAddress: ip,
      userAgent: request.headers.get('user-agent') ?? undefined,
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
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body.password;
    const name = body.name;
    const role = body.role;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (isSuspiciousInput(email) || isSuspiciousInput(password) || isSuspiciousInput(name)) {
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: '/api/auth/register',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы при регистрации',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }
    const { checkPasswordStrength } = await import('@/lib/utils');
    const strength = checkPasswordStrength(password);
    if (!strength.valid || strength.strength === 'weak') {
      return NextResponse.json(
        { error: strength.message || 'Пароль слишком простой: используйте буквы разного регистра, цифры и спецсимволы' },
        { status: 400 }
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: { email },
    });

    if (existingUser) {
      await logSecurityEvent({
        type: SecurityEventType.REGISTER_FAILED,
        path: '/api/auth/register',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Попытка регистрации с уже занятым email',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email,
        password: hashedPassword,
        name: name || null,
        role: role || 'USER',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    const expiresAt = new Date(Date.now() + DEFAULT_SESSION_MINUTES * 60 * 1000);
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
        role: user.role,
        sessionId: session.id,
      },
      DEFAULT_SESSION_MINUTES * 60
    );

    await setAuthCookie(token, DEFAULT_SESSION_MINUTES * 60);

    return NextResponse.json({
      success: true,
      user,
      token,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to register user' },
      { status: 500 }
    );
  }
}