import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    // Ограничение adminPanel у SUP / Lead_SUP распространяется и на просмотр активности
    if ((currentUser.role === 'SUP' || currentUser.role === 'LEAD_SUP') && !canPerformAction(currentUser, 'admin:users')) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

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

    // SUP / Lead_SUP — шире; ADM — только активность волонтёров (MEMBER + срок)
    if (
      currentUser.role !== 'SUP' &&
      currentUser.role !== 'ADM' &&
      currentUser.role !== 'LEAD_SUP'
    ) {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }
    if (
      currentUser.role === 'ADM' &&
      (user.role !== 'MEMBER' || !user.volunteerExpiresAt)
    ) {
      return NextResponse.json(
        { error: 'ADM может просматривать активность только волонтёров (MEMBER с периодом доступа).' },
        { status: 403 }
      );
    }
    if (
      user.role === 'LEAD_SUP' &&
      currentUser.role !== 'LEAD_SUP'
    ) {
      return NextResponse.json(
        { error: 'Активность Lead_SUP доступна только Lead_SUP.' },
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
      take: 1000,
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
