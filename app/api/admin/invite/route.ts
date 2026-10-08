import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isForbiddenError } from '@/lib/auth';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { inviteAssignableRoles } from '@/lib/roles';
import { inviteBodySchema, zodErrorBody } from '@/lib/admin-user-schemas';
import { generateInviteToken } from '@/lib/invite-token';

/**
 * POST — ссылка-приглашение на регистрацию.
 * Lead_SUP: роли SUP / ADM / MEMBER. SUP: ADM / MEMBER.
 * Body: { role, email?, volunteerExpiresAt?, volunteerIntensive?, expiresInHours? (1 | 24 | 72 | 168, по умолчанию 1) }
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    if (!canPerformAction(user, 'admin:invite')) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    const raw = await request.json().catch(() => null);
    const parsed = inviteBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json(zodErrorBody(parsed.error), { status: 400 });
    }
    const { role, email, expiresInHours } = parsed.data;

    const allowed = inviteAssignableRoles(user.role);
    if (!allowed.includes(role)) {
      return NextResponse.json(
        { error: `Вы не можете приглашать с ролью ${role}`, fieldErrors: { role: 'Роль недоступна для вашей учётной записи' } },
        { status: 403 }
      );
    }

    const isMember = role === 'MEMBER';
    const volunteerExpiresAt = isMember ? parsed.data.volunteerExpiresAt : null;
    const volunteerIntensive = isMember && volunteerExpiresAt ? parsed.data.volunteerIntensive : null;

    const emailHint = email ? email.toLowerCase() : null;
    if (emailHint) {
      const existing = await prisma.user.findUnique({ where: { email: emailHint }, select: { id: true } });
      if (existing) {
        return NextResponse.json(
          { error: 'Пользователь с таким логином уже существует', fieldErrors: { email: 'Логин уже занят' } },
          { status: 409 }
        );
      }
    }

    // В БД — только sha256 токена; сырой токен уходит один раз в этой ссылке
    const { raw: token, stored: storedToken } = generateInviteToken();
    const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000);

    await prisma.inviteToken.create({
      data: {
        token: storedToken,
        createdById: user.id,
        role,
        email: emailHint,
        volunteerExpiresAt,
        volunteerIntensive,
        expiresAt,
      },
    });

    const origin =
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      'http://localhost:3000';
    const link = `${origin.replace(/\/+$/, '')}/register/invite/${token}`;

    return NextResponse.json({
      success: true,
      link,
      token,
      expiresAt: expiresAt.toISOString(),
      expiresInHours,
      role,
      email: emailHint,
      volunteerExpiresAt: volunteerExpiresAt?.toISOString() ?? null,
      volunteerIntensive,
    });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    console.error('Create invite error:', e);
    return NextResponse.json({ error: 'Ошибка создания приглашения' }, { status: 500 });
  }
}
