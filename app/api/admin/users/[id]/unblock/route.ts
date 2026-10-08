import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/app/api/activity/route';
import { canPerformAction } from '@/lib/permissions';
import { canManageUserWithRole } from '@/lib/roles';
import { isUnsafeId } from '@/lib/security';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;

    if (!canPerformAction(currentUser, 'admin:users:block')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true, isBlocked: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    if (
      !canManageUserWithRole(currentUser.role, targetUser.role)
    ) {
      return NextResponse.json(
        { error: 'Недостаточно прав для разблокировки этого пользователя' },
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
