import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { createActivityLog } from '@/app/api/activity/route';

export async function POST(request: Request) {
  try {
    const currentUser = await requireAuth();

    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const userIds = Array.isArray(body.userIds) ? body.userIds : [];
    const addDays = typeof body.addDays === 'number' ? body.addDays : 30;

    if (userIds.length === 0) {
      return NextResponse.json(
        { error: 'Select at least one user' },
        { status: 400 }
      );
    }

    const targetUsers = await prisma.user.findMany({
      where: { id: { in: userIds }, role: 'VOL' },
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
