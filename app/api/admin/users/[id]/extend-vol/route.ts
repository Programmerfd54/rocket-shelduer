import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/app/api/activity/route';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';

/** Число дней продления: целое 1..3650 (по умолчанию 30). null — некорректное значение. */
function parseAddDays(value: unknown): number | null {
  if (value === undefined || value === null) return 30;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) return null;
  return value;
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;

    if (!canPerformAction(currentUser, 'admin:users:extend-vol')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const body = await request.json().catch(() => ({}));
    const addDays = parseAddDays(body?.addDays);
    if (addDays == null) {
      return NextResponse.json({ error: 'addDays: целое число от 1 до 3650' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, volunteerExpiresAt: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (targetUser.role !== 'MEMBER' || !targetUser.volunteerExpiresAt) {
      return NextResponse.json(
        { error: 'User is not a volunteer' },
        { status: 400 }
      );
    }

    const now = new Date();
    const base = targetUser.volunteerExpiresAt && targetUser.volunteerExpiresAt > now
      ? targetUser.volunteerExpiresAt
      : now;
    const newExpiresAt = new Date(base);
    newExpiresAt.setDate(newExpiresAt.getDate() + addDays);

    await prisma.user.update({
      where: { id },
      data: {
        volunteerExpiresAt: newExpiresAt,
        isBlocked: false,
        blockedAt: null,
        blockedReason: null,
        blockedById: null,
      },
    });

    await createActivityLog(
      currentUser.id,
      'ADMIN_ACTION',
      { action: 'extend_vol', targetUserId: id, addDays, newExpiresAt: newExpiresAt.toISOString() },
      'User',
      id,
      request
    );

    return NextResponse.json({
      success: true,
      volunteerExpiresAt: newExpiresAt.toISOString(),
    });
  } catch (error) {
    console.error('Extend VOL error:', error);
    return NextResponse.json(
      { error: 'Failed to extend access' },
      { status: 500 }
    );
  }
}
