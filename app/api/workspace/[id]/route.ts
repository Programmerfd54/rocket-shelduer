import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { encryptPassword } from '@/lib/encryption';
import { logSecurityEvent, getClientIp, isSuspiciousInput, SecurityEventType } from '@/lib/security';

// GET - получить workspace по ID (владелец или ADM с назначением)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        has2FA: true,
        isActive: true,
        lastConnected: true,
        startDate: true,
        endDate: true,
        color: true,
        isArchived: true,
        archivedAt: true,
        archiveDeleteAt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const isOwner = workspace.userId === user.id;
    if (isOwner) {
      const { userId: _u, ...rest } = workspace;
      return NextResponse.json({ workspace: rest });
    }

    // ADM или VOL с назначением на это пространство
    if (user.role === 'ADM' || user.role === 'VOL') {
      const assignment = await prisma.workspaceAdminAssignment.findFirst({
        where: { userId: user.id, workspaceId: id },
      });
      if (assignment) {
        const normalizeUrl = (u: string) => (u || '').trim().replace(/\/+$/, '') || u;
        const norm = normalizeUrl(workspace.workspaceUrl);
        const ownConnection = await prisma.workspaceConnection.findFirst({
          where: {
            userId: user.id,
            OR: [{ workspaceUrl: norm }, { workspaceUrl: norm + '/' }],
          },
          select: { id: true },
        });
        const { userId: _u, ...rest } = workspace;
        return NextResponse.json({
          workspace: { ...rest, isAssigned: true, hasOwnConnection: !!ownConnection },
        });
      }
    }

    return NextResponse.json(
      { error: 'Workspace not found' },
      { status: 404 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch workspace' },
      { status: 500 }
    );
  }
}

// PATCH - обновить workspace
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role === 'VOL') {
      return NextResponse.json(
        { error: 'Волонтёр не может изменять настройки пространства.' },
        { status: 403 }
      );
    }
    const { id } = await params;
    const body = await request.json();

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

    const {
      workspaceName,
      workspaceUrl,
      username,
      password,
      has2FA,
      startDate,
      endDate,
      color,
    } = body;

    if (
      (workspaceUrl && isSuspiciousInput(workspaceUrl)) ||
      (username && isSuspiciousInput(username)) ||
      (password && isSuspiciousInput(password))
    ) {
      const ip = getClientIp(request);
      const userAgent = request.headers.get('user-agent') ?? undefined;
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: `/api/workspace/${id}`,
        method: 'PATCH',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы при обновлении пространства',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }

    // Подготовка данных для обновления
    const updateData: any = {
      workspaceName,
      workspaceUrl,
      username,
      has2FA,
      color,
      updatedAt: new Date(),
    };

    // Обновляем пароль только если он передан
    if (password) {
      updateData.encryptedPassword = encryptPassword(password);
      // Сбрасываем authToken при смене пароля
      updateData.authToken = null;
    }

    // Обновляем даты если переданы
    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }
    if (endDate !== undefined) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }

    const updatedWorkspace = await prisma.workspaceConnection.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        has2FA: true,
        isActive: true,
        lastConnected: true,
        startDate: true,
        endDate: true,
        color: true,
        isArchived: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Логируем действие
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_UPDATED',
        entityType: 'workspace',
        entityId: id,
        details: JSON.stringify({ workspaceName }),
      },
    });

    return NextResponse.json({
      success: true,
      workspace: updatedWorkspace,
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to update workspace' },
      { status: 500 }
    );
  }
}

// DELETE - удалить workspace
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role === 'VOL') {
      return NextResponse.json(
        { error: 'Волонтёр не может удалять пространство.' },
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

    // Удалять можно только заархивированное пространство (досрочное удаление из архива)
    if (!workspace.isArchived) {
      return NextResponse.json(
        { error: 'Сначала заархивируйте пространство. Удаление возможно только из раздела «Архив».' },
        { status: 400 }
      );
    }

    // Удаляем workspace (каскадно удалятся все связанные сообщения)
    await prisma.workspaceConnection.delete({
      where: { id },
    });

    // Логируем
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_DELETED',
        entityType: 'workspace',
        entityId: id,
        details: JSON.stringify({
          workspaceName: workspace.workspaceName,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    console.error('Delete workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to delete workspace' },
      { status: 500 }
    );
  }
}