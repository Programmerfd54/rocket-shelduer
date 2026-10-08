import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isUserEffectivelyBlocked } from '@/lib/auth';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';

/** Поля пространства для ответа (без authToken / encryptedPassword / userId_RC). */
const WORKSPACE_PUBLIC_SELECT = {
  id: true,
  workspaceName: true,
  workspaceUrl: true,
  username: true,
  rcAuthMethod: true,
  has2FA: true,
  isActive: true,
  lastConnected: true,
  color: true,
  startDate: true,
  endDate: true,
  isArchived: true,
  archivedAt: true,
  archiveDeleteAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'workspace:archive');
    const { id } = await params;
    if (isUnsafeId(id)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id,
        userId: user.id,
      },
      select: { id: true, workspaceName: true, isArchived: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (workspace.isArchived) {
      return NextResponse.json(
        { error: 'Workspace already archived' },
        { status: 400 }
      );
    }

    // Архивируем на 2 недели
    const archivedAt = new Date();
    const archiveDeleteAt = new Date(archivedAt.getTime() + 14 * 24 * 60 * 60 * 1000);

    const updatedWorkspace = await prisma.workspaceConnection.update({
      where: { id },
      data: {
        isArchived: true,
        isActive: false,
        archivedAt,
        archiveDeleteAt,
      },
      select: WORKSPACE_PUBLIC_SELECT,
    });

    // Отменяем все pending сообщения
    await prisma.scheduledMessage.updateMany({
      where: {
        workspaceId: id,
        status: 'PENDING',
      },
      data: {
        status: 'CANCELLED',
      },
    });

    // Логируем
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_ARCHIVED',
        entityType: 'workspace',
        entityId: id,
        details: JSON.stringify({
          workspaceName: workspace.workspaceName,
          archiveDeleteAt: archiveDeleteAt.toISOString(),
        }),
      },
    });

    return NextResponse.json({
      success: true,
      workspace: updatedWorkspace,
      message: `Workspace archived. Will be deleted on ${archiveDeleteAt.toLocaleDateString('ru-RU')}`,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Archive workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to archive workspace' },
      { status: 500 }
    );
  }
}

// Разархивировать
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'workspace:archive:restore');
    if (isUserEffectivelyBlocked(user)) {
      return NextResponse.json(
        { error: 'Заблокированный пользователь не может восстанавливать пространства из архива.' },
        { status: 403 }
      );
    }
    const { id } = await params;
    if (isUnsafeId(id)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id,
        userId: user.id,
      },
      select: { id: true, workspaceName: true, isArchived: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (!workspace.isArchived) {
      return NextResponse.json(
        { error: 'Workspace is not archived' },
        { status: 400 }
      );
    }

    const updatedWorkspace = await prisma.workspaceConnection.update({
      where: { id },
      data: {
        isArchived: false,
        isActive: true,
        archivedAt: null,
        archiveDeleteAt: null,
      },
      select: WORKSPACE_PUBLIC_SELECT,
    });

    // Логируем
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_UNARCHIVED',
        entityType: 'workspace',
        entityId: id,
        details: JSON.stringify({
          workspaceName: workspace.workspaceName,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      workspace: updatedWorkspace,
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Unarchive workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to unarchive workspace' },
      { status: 500 }
    );
  }
}