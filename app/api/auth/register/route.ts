import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, createSessionAndSetCookie, validateNewPassword } from '@/lib/auth';
import {
  logSecurityEvent,
  getClientIp,
  isSuspiciousInput,
  isAuthEndpointRateLimited,
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

  try {
    if (process.env.ALLOW_PUBLIC_REGISTER !== 'true') {
      await logSecurityEvent({
        type: SecurityEventType.UNAUTHORIZED_ACCESS,
        path: '/api/auth/register',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Попытка публичной регистрации при выключенной регистрации',
        blocked: true,
      });
      return NextResponse.json(
        { error: 'Публичная регистрация отключена' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => null);
    const email = typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = body?.password;
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : null;
    const role = 'MEMBER';

    if (!email || typeof password !== 'string' || !password || email.length > 254 || /\s/.test(email)) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (isSuspiciousInput(email) || isSuspiciousInput(name)) {
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

    const passwordError = await validateNewPassword(password, [email]);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
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
        role: role || 'MEMBER',
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    await createSessionAndSetCookie({
      user: { id: user.id, email: user.email, role: user.role },
      sessionMinutes: DEFAULT_SESSION_MINUTES,
      requestHeaders: request.headers,
      ip,
    });

    return NextResponse.json({
      success: true,
      user,
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to register user' },
      { status: 500 }
    );
  }
}
