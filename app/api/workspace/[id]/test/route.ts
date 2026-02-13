import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;

    let workspace = await prisma.workspaceConnection.findFirst({
      where: { id, userId: user.id },
    });
    if (!workspace) {
      const assignment = await prisma.workspaceAdminAssignment.findFirst({
        where: { workspaceId: id, userId: user.id },
      });
      if (assignment) workspace = await prisma.workspaceConnection.findUnique({ where: { id } });
    }

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, id);
    if (!effective?.authToken || !effective.userId_RC) {
      return NextResponse.json(
        { error: 'Workspace not authenticated' },
        { status: 401 }
      );
    }

    const rcClient = new RocketChatClient(effective.workspaceUrl);
    const isConnected = await rcClient.testConnection(
      effective.authToken,
      effective.userId_RC
    );

    if (!isConnected) {
      await prisma.workspaceConnection.update({
        where: { id: effective.id },
        data: { isActive: false },
      });

      return NextResponse.json(
        { error: 'Connection test failed. Please re-authenticate.' },
        { status: 401 }
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