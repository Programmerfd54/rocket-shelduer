import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { connectionAad, decryptAuthToken } from '@/lib/encryption';
import { tryRefreshRcSession } from '@/lib/rc-session-refresh';
import { RocketChatClient } from '@/lib/rocketchat';

/** SUP может проверить подключение любого workspace (в т.ч. другого пользователя). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { workspaceId } = await params;
    if (isUnsafeId(workspaceId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    if (currentUser.role !== 'SUP' && currentUser.role !== 'LEAD_SUP') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { id: true, userId: true, workspaceUrl: true, authToken: true, userId_RC: true },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    let decryptedToken = decryptAuthToken(workspace.authToken, connectionAad(workspace.userId));
    let rcUserId = workspace.userId_RC;
    // Токен не читается — одна попытка восстановить сессию по сохранённому паролю (логин/пароль без 2FA)
    if (!decryptedToken) {
      const refreshed = await tryRefreshRcSession(workspace.id);
      if (refreshed) {
        decryptedToken = refreshed.authToken;
        rcUserId = refreshed.userId_RC;
      }
    }
    if (!decryptedToken || !rcUserId) {
      return NextResponse.json(
        { ok: false, error: 'Workspace not authenticated' },
        { status: 200 }
      );
    }

    const rcClient = new RocketChatClient(workspace.workspaceUrl);
    let isConnected = await rcClient.testConnection(decryptedToken, rcUserId);
    if (!isConnected) {
      // Сессия истекла — один повторный вход по сохранённому паролю (не чаще раза в 30 минут)
      const refreshed = await tryRefreshRcSession(workspace.id);
      if (refreshed) isConnected = await rcClient.testConnection(refreshed.authToken, refreshed.userId_RC);
    }

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
