import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, isUserEffectivelyBlocked } from '@/lib/auth';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role === 'VOL') {
      return NextResponse.json(
        { error: 'Волонтёр не может архивировать пространство.' },
        { status: 403 }
      );
    }
    const { id } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id,
        userId: user.id,
      },
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
    if (isUserEffectivelyBlocked(user)) {
      return NextResponse.json(
        { error: 'Заблокированный пользователь не может восстанавливать пространства из архива.' },
        { status: 403 }
      );
    }
    if (user.role === 'VOL') {
      return NextResponse.json(
        { error: 'Волонтёр не может управлять архивом.' },
        { status: 403 }
      );
    }
    const { id } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id,
        userId: user.id,
      },
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
    console.error('Unarchive workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to unarchive workspace' },
      { status: 500 }
    );
  }
}