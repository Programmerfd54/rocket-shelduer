import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isForbiddenError } from '@/lib/auth';
import { requireSupportOrAdmin } from '@/lib/api-auth';
import { canManageUserWithRole } from '@/lib/roles';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireSupportOrAdmin();
    if (!canPerformAction(user, 'admin:users:edit')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const body = await request.json().catch(() => null);
    const isActive = body?.isActive;
    if (typeof isActive !== 'boolean') {
      return NextResponse.json({ error: 'isActive must be boolean' }, { status: 400 });
    }

    if (user.id === id) {
      return NextResponse.json(
        { error: 'Cannot change your own status' },
        { status: 400 }
      );
    }

    const targetUser = await prisma.user.findUnique({
      where: { id },
      select: { id: true, role: true },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // SUP может менять только ADM / MEMBER; Lead_SUP — любых
    if (
      !canManageUserWithRole(user.role, targetUser.role)
    ) {
      return NextResponse.json(
        { error: 'Cannot modify admin user' },
        { status: 403 }
      );
    }

    await prisma.user.update({
      where: { id },
      data: { isActive },
    });

    // Деактивация: все сессии пользователя больше не действительны
    if (!isActive) {
      await prisma.session.deleteMany({ where: { userId: id } });
    }

    return NextResponse.json({
      success: true,
      message: 'User status updated',
    });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    console.error('Toggle user active error:', e);
    return NextResponse.json({ error: 'Failed to update user status' }, { status: 500 });
  }
}
