import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser, isUserEffectivelyBlocked } from '@/lib/auth';

export async function GET() {
  try {
    const user = await getCurrentUser();

    if (!user) {
      return NextResponse.json(
        { error: 'Not authenticated' },
        { status: 401 }
      );
    }

    const blocked = isUserEffectivelyBlocked(user);
    let adminContact: string | null = null;
    if (blocked) {
      const row = await prisma.systemSetting.findUnique({
        where: { key: 'adminContact' },
      });
      adminContact = row?.value?.trim() || null;
    }
    return NextResponse.json({
      user: {
        ...user,
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
