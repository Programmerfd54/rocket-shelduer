import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { createActivityLog } from '@/app/api/activity/route';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';
import { APP_ROLES, canManageUserWithRole, isAppRole, roleChangeAssignableRoles } from '@/lib/roles';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;

    if (!canPerformAction(currentUser, 'admin:users:edit-role')) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    if (currentUser.id === id) {
      return NextResponse.json(
        { error: 'Cannot change your own role' },
        { status: 400 }
      );
    }

    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const body = await request.json().catch(() => ({}));
    const { role, volunteerExpiresAt, volunteerIntensive } = body ?? {};
    if (
      volunteerExpiresAt != null &&
      (typeof volunteerExpiresAt !== 'string' || Number.isNaN(new Date(volunteerExpiresAt).getTime()))
    ) {
      return NextResponse.json({ error: 'Некорректная дата окончания доступа' }, { status: 400 });
    }

    if (!isAppRole(role)) {
      return NextResponse.json(
        { error: `Недопустимая роль. Допустимо: ${APP_ROLES.join(', ')}.` },
        { status: 400 }
      );
    }

    if (!roleChangeAssignableRoles(currentUser.role).includes(role)) {
      return NextResponse.json(
        { error: `Вы не можете назначать роль ${role}` },
        { status: 403 }
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

    if (!canManageUserWithRole(currentUser.role, targetUser.role)) {
      return NextResponse.json(
        { error: 'Недостаточно прав для изменения этого пользователя' },
        { status: 403 }
      );
    }

    const data: Record<string, unknown> = { role };
    if (role === 'MEMBER' && volunteerExpiresAt) {
      data.volunteerExpiresAt = new Date(volunteerExpiresAt);
      data.volunteerIntensive =
        volunteerIntensive != null ? String(volunteerIntensive).trim().slice(0, 50) || null : null;
    } else if (role === 'MEMBER' && body.volunteerExpiresAt === null) {
      data.volunteerExpiresAt = null;
      data.volunteerIntensive = null;
    } else {
      data.volunteerExpiresAt = null;
      data.volunteerIntensive = null;
    }

    const updated = await prisma.user.update({
      where: { id },
      data: data as any,
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
      },
    });

    await createActivityLog(
      currentUser.id,
      'USER_ROLE_CHANGED',
      {
        targetUserId: id,
        previousRole: targetUser.role,
        newRole: role,
        volunteerExpiresAt: data.volunteerExpiresAt,
        volunteerIntensive: data.volunteerIntensive,
      },
      'User',
      id,
      request
    );

    return NextResponse.json({ user: updated });
  } catch (error) {
    console.error('Update role error:', error);
    return NextResponse.json(
      { error: 'Failed to update role' },
      { status: 500 }
    );
  }
}
