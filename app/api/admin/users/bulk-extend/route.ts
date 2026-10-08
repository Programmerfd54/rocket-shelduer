import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/app/api/activity/route';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';

const MAX_BULK_USERS = 500;

/** Число дней продления: целое 1..3650 (по умолчанию 30). null — некорректное значение. */
function parseAddDays(value: unknown): number | null {
  if (value === undefined || value === null) return 30;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 3650) return null;
  return value;
}

export async function POST(request: Request) {
  try {
    const currentUser = await requireAuth();

    if (!canPerformAction(currentUser, 'admin:users:bulk-extend')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const rawIds: unknown[] = Array.isArray(body?.userIds) ? body.userIds : [];
    const userIds = [...new Set(rawIds.filter((v): v is string => typeof v === 'string' && !isUnsafeId(v)))];
    const addDays = parseAddDays(body?.addDays);
    if (addDays == null) {
      return NextResponse.json({ error: 'addDays: целое число от 1 до 3650' }, { status: 400 });
    }

    if (userIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one user' },
        { status: 400 }
      );
    }
    if (userIds.length > MAX_BULK_USERS) {
      return NextResponse.json(
        { error: `Максимум ${MAX_BULK_USERS} пользователей за запрос` },
        { status: 400 }
      );
    }

    const targetUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, role: 'MEMBER', volunteerExpiresAt: { not: null } },
      select: { id: true, volunteerExpiresAt: true },
    });

    const results: { id: string; volunteerExpiresAt: string }[] = [];

    for (const targetUser of targetUsers) {
      const now = new Date();
      const base =
        targetUser.volunteerExpiresAt && targetUser.volunteerExpiresAt > now
          ? targetUser.volunteerExpiresAt
          : now;
      const newExpiresAt = new Date(base);
      newExpiresAt.setDate(newExpiresAt.getDate() + addDays);

      await prisma.user.update({
        where: { id: targetUser.id },
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
        {
          action: 'extend_vol',
          targetUserId: targetUser.id,
          addDays,
          newExpiresAt: newExpiresAt.toISOString(),
        },
        'User',
        targetUser.id,
        request
      );

      results.push({
        id: targetUser.id,
        volunteerExpiresAt: newExpiresAt.toISOString(),
      });
    }

    return NextResponse.json({
      success: true,
      extended: results.length,
      volunteerExpiresAt: results,
    });
  } catch (error) {
    console.error('Bulk extend VOL error:', error);
    return NextResponse.json(
      { error: 'Failed to extend access' },
      { status: 500 }
    );
  }
}
