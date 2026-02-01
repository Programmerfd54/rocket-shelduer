import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { createActivityLog } from '@/app/api/activity/route';

const ALLOWED_ROLES = ['USER', 'SUPPORT', 'ADMIN', 'ADM', 'VOL'];

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

    if (currentUser.id === id) {
      return NextResponse.json(
        { error: 'Cannot change your own role' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const { role, volunteerExpiresAt, volunteerIntensive } = body;

    if (!role || !ALLOWED_ROLES.includes(role)) {
      return NextResponse.json(
        { error: 'Invalid role. Allowed: USER, SUPPORT, ADMIN, ADM, VOL' },
        { status: 400 }
      );
    }
    // Только ADMIN может назначать роль ADMIN
    if (role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can assign ADMIN role' },
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

    // Только ADMIN может менять роль пользователя с ролью ADMIN
    if (targetUser.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can modify ADMIN users' },
        { status: 403 }
      );
    }

    const data: Record<string, unknown> = { role };
    if (role === 'VOL') {
      data.volunteerExpiresAt = volunteerExpiresAt
        ? new Date(volunteerExpiresAt)
        : null;
      data.volunteerIntensive =
        volunteerIntensive != null ? String(volunteerIntensive).trim() || null : null;
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
