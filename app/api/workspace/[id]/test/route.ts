import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
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

    if (!workspace.authToken || !workspace.userId_RC) {
      return NextResponse.json(
        { error: 'Workspace not authenticated' },
        { status: 401 }
      );
    }

    const rcClient = new RocketChatClient(workspace.workspaceUrl);
    const isConnected = await rcClient.testConnection(
      workspace.authToken,
      workspace.userId_RC
    );

    if (!isConnected) {
      await prisma.workspaceConnection.update({
        where: { id },
        data: { isActive: false },
      });

      return NextResponse.json(
        { error: 'Connection test failed. Please re-authenticate.' },
        { status: 401 }
      );
    }

    await prisma.workspaceConnection.update({
      where: { id },
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