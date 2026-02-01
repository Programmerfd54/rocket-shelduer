import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;

    const user = await prisma.user.findUnique({
      where: { id },
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        isActive: true,
        isBlocked: true,
        blockedAt: true,
        blockedReason: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
        lastLoginAt: true,
        createdAt: true,
        avatarUrl: true,
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 404 }
      );
    }

    // SUP — доступ ко всем; ADM — только к пользователям с ролью VOL
    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADM' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    if (currentUser.role === 'ADM' && user.role !== 'VOL') {
      return NextResponse.json(
        { error: 'ADM can view activity only for users with role VOL.' },
        { status: 403 }
      );
    }
    if (user.role === 'ADMIN' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can view ADMIN user activity.' },
        { status: 403 }
      );
    }

    const workspaces = await prisma.workspaceConnection.findMany({
      where: { userId: id },
      select: {
        id: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        isActive: true,
        lastConnected: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const messages = await prisma.scheduledMessage.findMany({
      where: { userId: id },
      include: {
        workspace: {
          select: {
            workspaceName: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const activityLogs = await prisma.activityLog.findMany({
      where: { userId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return NextResponse.json({
      user,
      workspaces,
      messages,
      activityLogs,
    });
  } catch (error) {
    console.error('Get user activity error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch user activity' },
      { status: 500 }
    );
  }
}
