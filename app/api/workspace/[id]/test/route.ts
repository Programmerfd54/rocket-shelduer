import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { tryRefreshRcSession } from '@/lib/rc-session-refresh';
import { rcNotConnectedResponse, rcUnauthorizedResponse } from '@/lib/rc-http';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    let workspace = await prisma.workspaceConnection.findFirst({
      where: { id, userId: user.id },
      select: { id: true },
    });
    if (!workspace) {
      const assignment = await prisma.workspaceAdminAssignment.findFirst({
        where: { workspaceId: id, userId: user.id },
      });
      if (assignment) workspace = await prisma.workspaceConnection.findUnique({ where: { id }, select: { id: true } });
    }

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, id);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse();
    }

    const rcClient = new RocketChatClient(effective.workspaceUrl);
    let isConnected = await rcClient.testConnection(
      effective.authToken,
      effective.userId_RC
    );
    if (!isConnected) {
      // Сессия истекла — один повторный вход по сохранённому паролю (логин/пароль без 2FA, раз в 30 минут)
      const refreshed = await tryRefreshRcSession(effective.id);
      if (refreshed) isConnected = await rcClient.testConnection(refreshed.authToken, refreshed.userId_RC);
    }

    if (!isConnected) {
      await prisma.workspaceConnection.update({
        where: { id: effective.id },
        data: { isActive: false },
      });

      return rcUnauthorizedResponse(
        'Connection test failed. Please re-authenticate.' 
      );
    }

    await prisma.workspaceConnection.update({
      where: { id: effective.id },
      data: {
        isActive: true,
        lastConnected: new Date(),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Connection test successful',
    });
  } catch (error) {
    console.error('Test connection error:', error);
    return NextResponse.json(
      { error: 'Failed to test connection' },
      { status: 500 }
    );
  }
}