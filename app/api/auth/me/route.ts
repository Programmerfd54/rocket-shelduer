import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser, isUserEffectivelyBlocked, reissueSessionToken } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    // Синхронизация флага «нужна смена пароля» в JWT с БД (middleware опирается на флаг в токене):
    // например, админ сбросил пароль при живой сессии или флаг сняли в БД.
    const needsChange = user.requirePasswordChange === true;
    if (user.sessionId && user.sessionExpiresAt && needsChange !== (user.tokenRequiresPasswordChange === true)) {
      await reissueSessionToken({
        user: { id: user.id, email: user.email, role: user.role },
        sessionId: user.sessionId,
        expiresAt: user.sessionExpiresAt,
        requirePasswordChange: needsChange,
      });
    }

    const blocked = isUserEffectivelyBlocked(user);
    let adminContact: string | null = null;
    if (blocked) {
      const row = await prisma.systemSetting.findUnique({
        where: { key: 'adminContact' },
      });
      adminContact = row?.value?.trim() || null;
    }
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { sessionId, sessionExpiresAt, tokenRequiresPasswordChange, ...safeUser } = user;
    return NextResponse.json({
      user: {
        ...safeUser,
        blocked,
        volunteerExpiresAt: user.volunteerExpiresAt?.toISOString() ?? null,
        blockedAt: user.blockedAt?.toISOString() ?? null,
        adminContact,
      },
    });
  } catch {
    return NextResponse.json(
      { error: 'Failed to get user' },
      { status: 500 }
    );
  }
}
