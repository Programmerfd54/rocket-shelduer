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

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (targetUser.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can unblock ADMIN users' },
        { status: 403 }
      );
    }

    if (!targetUser.isBlocked) {
      return NextResponse.json(
        { error: 'User is not blocked' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id },
      data: {
        isBlocked: false,
        blockedAt: null,
        blockedReason: null,
        blockedById: null,
      },
    });

    await createActivityLog(
      currentUser.id,
      'USER_UNBLOCKED',
      { targetUserId: id },
      'User',
      id,
      request
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unblock user error:', error);
    return NextResponse.json(
      { error: 'Failed to unblock user' },
      { status: 500 }
    );
  }
}
