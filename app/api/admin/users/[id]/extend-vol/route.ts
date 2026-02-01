import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { createActivityLog } from '@/app/api/activity/route';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;

    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const addDays = typeof body.addDays === 'number' ? body.addDays : 30;

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (targetUser.role !== 'VOL') {
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
