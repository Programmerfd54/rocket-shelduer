import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';

/** SUP может проверить подключение любого workspace (в т.ч. другого пользователя). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { workspaceId } = await params;

    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    if (!workspace.authToken || !workspace.userId_RC) {
      return NextResponse.json(
        { ok: false, error: 'Workspace not authenticated' },
        { status: 200 }
      );
    }

    const rcClient = new RocketChatClient(workspace.workspaceUrl);
    const isConnected = await rcClient.testConnection(
      workspace.authToken,
      workspace.userId_RC
    );

    if (!isConnected) {
      await prisma.workspaceConnection.update({
        where: { id: workspaceId },
        data: { isActive: false },
      });
      return NextResponse.json({
        ok: false,
        error: 'Подключение не удалось. Токен мог истечь.',
      });
    }

    await prisma.workspaceConnection.update({
      where: { id: workspaceId },
      data: {
        isActive: true,
        lastConnected: new Date(),
      },
    });

    return NextResponse.json({
      ok: true,
      message: 'Подключение успешно',
    });
  } catch (error) {
    console.error('Admin workspace check error:', error);
    return NextResponse.json(
      { ok: false, error: 'Ошибка проверки подключения' },
      { status: 500 }
    );
  }
}
