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

    if (currentUser.id === id) {
      return NextResponse.json(
        { error: 'Cannot block yourself' },
        { status: 400 }
      );
    }

    const body = await request.json();
    const reason = body.reason != null ? String(body.reason).trim() : null;

    const targetUser = await prisma.user.findUnique({
      where: { id },
    });

    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // SUP не может блокировать суперпользователя
    if (targetUser.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Cannot block superuser' },
        { status: 403 }
      );
    }

    if (targetUser.isBlocked) {
      return NextResponse.json(
        { error: 'User is already blocked' },
        { status: 400 }
      );
    }

    await prisma.user.update({
      where: { id },
      data: {
        isBlocked: true,
        blockedAt: new Date(),
        blockedReason: reason,
        blockedById: currentUser.id,
      },
    });

    // При блокировке VOL все его пространства отправляются в архив
    const archivedAt = new Date();
    const archiveDeleteAt = new Date(archivedAt.getTime() + 14 * 24 * 60 * 60 * 1000);
    const userWorkspaces = await prisma.workspaceConnection.findMany({
      where: { userId: id, isArchived: false },
    });

    for (const ws of userWorkspaces) {
      await prisma.workspaceConnection.update({
        where: { id: ws.id },
        data: {
          isArchived: true,
          isActive: false,
          archivedAt,
          archiveDeleteAt,
        },
      });
      await prisma.scheduledMessage.updateMany({
        where: { workspaceId: ws.id, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      });
      await createActivityLog(
        currentUser.id,
        'WORKSPACE_ARCHIVED',
        { workspaceName: ws.workspaceName, targetUserId: id, reason: 'User blocked' },
        'WorkspaceConnection',
        ws.id,
        request
      );
    }

    await createActivityLog(
      currentUser.id,
      'USER_BLOCKED',
      { targetUserId: id, reason },
      'User',
      id,
      request
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Block user error:', error);
    return NextResponse.json(
      { error: 'Failed to block user' },
      { status: 500 }
    );
  }
}
