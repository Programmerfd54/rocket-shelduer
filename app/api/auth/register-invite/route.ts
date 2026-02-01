import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, generateToken, setAuthCookie } from '@/lib/auth';
import { getClientIp, isAuthEndpointRateLimited, recordAuthEndpointHit, logSecurityEvent, SecurityEventType } from '@/lib/security';

const DEFAULT_SESSION_MINUTES = 60 * 24 * 7; // 7 days

/** POST — регистрация по токену приглашения. Body: { token, login, password, confirmPassword, name } */
export async function POST(request: Request) {
  const ip = getClientIp(request);
  const userAgent = request.headers.get('user-agent') ?? undefined;
  if (isAuthEndpointRateLimited(ip ?? null)) {
    await logSecurityEvent({
      type: SecurityEventType.AUTH_RATE_LIMIT,
      path: '/api/auth/register-invite',
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
    const { token, login, password, confirmPassword, name } = body;

    if (!token?.trim() || !login?.trim() || !password) {
      return NextResponse.json(
        { error: 'Укажите токен приглашения, логин и пароль' },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'Пароли не совпадают' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Пароль должен быть не менее 8 символов' },
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

    const invite = await prisma.inviteToken.findUnique({
      where: { token: String(token).trim() },
    });

    if (!invite) {
      return NextResponse.json(
        { error: 'Приглашение не найдено' },
        { status: 404 }
      );
    }

    if (new Date() > invite.expiresAt) {
      return NextResponse.json(
        { error: 'Срок действия приглашения истёк' },
        { status: 410 }
      );
    }

    const loginNorm = String(login).trim().toLowerCase();
    const existing = await prisma.user.findUnique({
      where: { email: loginNorm },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Пользователь с таким логином уже зарегистрирован' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    const user = await prisma.user.create({
      data: {
        email: loginNorm,
        password: hashedPassword,
        name: name?.trim() || null,
        role: invite.role,
      },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
      },
    });

    await prisma.inviteToken.delete({
      where: { id: invite.id },
    });

    const expiresAt = new Date(Date.now() + DEFAULT_SESSION_MINUTES * 60 * 1000);
    const session = await prisma.session.create({
      data: {
        userId: user.id,
        userAgent: userAgent?.slice(0, 500) ?? null,
        expiresAt,
      },
    });

    const authToken = generateToken(
      {
        userId: user.id,
        email: user.email,
        role: user.role,
        sessionId: session.id,
      },
      DEFAULT_SESSION_MINUTES * 60
    );
    await setAuthCookie(authToken, DEFAULT_SESSION_MINUTES * 60);

    return NextResponse.json({
      success: true,
      user,
      token: authToken,
    });
  } catch (error) {
    console.error('Register invite error:', error);
    return NextResponse.json(
      { error: 'Ошибка регистрации' },
      { status: 500 }
    );
  }
}
