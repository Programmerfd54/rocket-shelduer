import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

/** GET — проверить токен приглашения. Возвращает role и email (если задан). */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;
    if (!token?.trim()) {
      return NextResponse.json({ error: 'Токен не указан' }, { status: 400 });
    }

    const invite = await prisma.inviteToken.findUnique({
      where: { token: token.trim() },
      select: { role: true, email: true, expiresAt: true },
    });

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
    });
  } catch (error) {
    console.error('Invite token check error:', error);
    return NextResponse.json(
      { error: 'Ошибка проверки приглашения' },
      { status: 500 }
    );
  }
}
