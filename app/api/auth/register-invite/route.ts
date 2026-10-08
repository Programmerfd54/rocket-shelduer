import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { hashPassword, createSessionAndSetCookie, validateNewPassword } from '@/lib/auth';
import { getClientIp, isAuthEndpointRateLimited, logSecurityEvent, SecurityEventType } from '@/lib/security';
import { findInviteByRawToken, inviteLoginMatches } from '@/lib/invite-token';

const DEFAULT_SESSION_MINUTES = 60 * 24 * 7; // 7 days
const MAX_TOKEN_LENGTH = 256;
const MAX_LOGIN_LENGTH = 254;
/** Роли, которые можно получить по приглашению (LEAD_SUP — никогда, даже если запись в БД подделана). */
const INVITABLE_ROLES = new Set(['SUP', 'ADM', 'MEMBER']);

class InviteGoneError extends Error {}

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

  try {
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token.trim() : '';
    const login = typeof body?.login === 'string' ? body.login.trim() : '';
    const { password, confirmPassword } = body ?? {};
    const name = typeof body?.name === 'string' ? body.name.trim().slice(0, 100) : '';

    if (!token || !login || typeof password !== 'string' || !password) {
      return NextResponse.json(
        { error: 'Укажите токен приглашения, логин и пароль' },
        { status: 400 }
      );
    }

    if (token.length > MAX_TOKEN_LENGTH) {
      return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 });
    }

    if (login.length > MAX_LOGIN_LENGTH || /[\s<>"'`\\\u0000-\u001f]/.test(login)) {
      return NextResponse.json(
        { error: 'Недопустимый логин: без пробелов, кавычек и угловых скобок' },
        { status: 400 }
      );
    }

    if (password !== confirmPassword) {
      return NextResponse.json(
        { error: 'Пароли не совпадают' },
        { status: 400 }
      );
    }

    const loginNorm = login.toLowerCase();
    const passwordError = await validateNewPassword(password, [loginNorm]);
    if (passwordError) {
      return NextResponse.json({ error: passwordError }, { status: 400 });
    }

    const invite = await findInviteByRawToken(token);

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

    // Логин из приглашения (если задан) — обязательный: приглашение выдано конкретному человеку
    if (!inviteLoginMatches(invite.email, loginNorm)) {
      return NextResponse.json(
        { error: 'Это приглашение выдано для другого логина. Используйте логин, указанный в приглашении.' },
        { status: 400 }
      );
    }

    if (!INVITABLE_ROLES.has(invite.role)) {
      await logSecurityEvent({
        type: SecurityEventType.UNAUTHORIZED_ACCESS,
        path: '/api/auth/register-invite',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: `Приглашение с недопустимой ролью ${invite.role}`,
        blocked: true,
      });
      return NextResponse.json({ error: 'Приглашение недействительно' }, { status: 403 });
    }

    const existing = await prisma.user.findFirst({
      where: {
        OR: [
          { email: loginNorm },
          { username: { equals: loginNorm, mode: 'insensitive' } },
        ],
      },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'Пользователь с таким логином уже зарегистрирован' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);

    const isVolunteer = invite.role === 'MEMBER' && invite.volunteerExpiresAt != null;
    let newUser: { id: string; email: string; name: string | null; role: string };
    try {
      newUser = await prisma.$transaction(async (tx) => {
        // Сначала атомарно «гасим» приглашение: из параллельных запросов пройдёт только один
        const consumed = await tx.inviteToken.deleteMany({
          where: { id: invite.id, expiresAt: { gt: new Date() } },
        });
        if (consumed.count !== 1) throw new InviteGoneError();

        return tx.user.create({
          data: {
            email: loginNorm,
            password: hashedPassword,
            name: name || null,
            role: invite.role,
            ...(isVolunteer
              ? {
                  volunteerExpiresAt: invite.volunteerExpiresAt,
                  volunteerIntensive: invite.volunteerIntensive,
                }
              : {}),
          },
          select: {
            id: true,
            email: true,
            name: true,
            role: true,
          },
        });
      });
    } catch (e) {
      if (e instanceof InviteGoneError) {
        return NextResponse.json({ error: 'Приглашение уже использовано или истекло' }, { status: 410 });
      }
      if (e && typeof e === 'object' && (e as { code?: string }).code === 'P2002') {
        return NextResponse.json(
          { error: 'Пользователь с таким логином уже зарегистрирован' },
          { status: 409 }
        );
      }
      throw e;
    }

    await createSessionAndSetCookie({
      user: { id: newUser.id, email: newUser.email, role: newUser.role },
      sessionMinutes: DEFAULT_SESSION_MINUTES,
      requestHeaders: request.headers,
      ip,
    });

    return NextResponse.json({
      success: true,
      user: newUser,
    });
  } catch (error) {
    console.error('Register invite error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json(
      { error: 'Ошибка регистрации' },
      { status: 500 }
    );
  }
}
