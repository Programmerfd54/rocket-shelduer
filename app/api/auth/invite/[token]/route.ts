import { NextResponse } from 'next/server';
import { findInviteByRawToken } from '@/lib/invite-token';
import { getClientIp, isInviteTokenRateLimited } from '@/lib/security';

/** GET — проверить токен приглашения. Возвращает role, email (если задан) и срок доступа волонтёра (для MEMBER). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const ip = getClientIp(request);
    if (isInviteTokenRateLimited(ip)) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
    }
    const { token } = await params;
    if (!token?.trim()) {
      return NextResponse.json({ error: 'Токен не указан' }, { status: 400 });
    }
    if (token.length > 256) {
      return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 });
    }

    // По хешу токена (новые приглашения) или по сырому значению (старые)
    const invite = await findInviteByRawToken(token);

    if (!invite) {
      return NextResponse.json({ error: 'Приглашение не найдено' }, { status: 404 });
    }

    if (new Date() > invite.expiresAt) {
      return NextResponse.json({ error: 'Срок действия приглашения истёк' }, { status: 410 });
    }

    return NextResponse.json({
      valid: true,
      role: invite.role,
      email: invite.email ?? undefined,
      expiresAt: invite.expiresAt.toISOString(),
      volunteerExpiresAt: invite.volunteerExpiresAt?.toISOString() ?? undefined,
      volunteerIntensive: invite.volunteerIntensive ?? undefined,
    });
  } catch (error) {
    console.error('Invite token check error:', error);
    return NextResponse.json(
      { error: 'Ошибка проверки приглашения' },
      { status: 500 }
    );
  }
}
