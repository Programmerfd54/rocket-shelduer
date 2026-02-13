import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';

export async function GET(
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
      if (assignment) {
        workspace = await prisma.workspaceConnection.findUnique({
          where: { id },
        });
      }
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

    try {
      const rcClient = new RocketChatClient(effective.workspaceUrl);
      const channels = await rcClient.getChannels(
        effective.authToken,
        effective.userId_RC
      );

      await prisma.workspaceConnection.update({
        where: { id: effective.id },
        data: { lastConnected: new Date() },
      });

      return NextResponse.json({
        channels: channels.map(ch => ({
          id: ch._id,
          name: ch.name,
          displayName: ch.fname || ch.name,
          type: ch.t,
          messageCount: ch.msgs || 0,
        })),
      });
    } catch (rcError: any) {
      // Логируем детали ошибки
      console.error('Rocket.Chat API error:', {
        message: rcError.message,
        code: rcError.code,
        url: effective.workspaceUrl
      });

      // Проверяем тип ошибки
      if (rcError.message?.includes('fetch failed') || rcError.code === 'ECONNREFUSED') {
        return NextResponse.json(
          { 
            error: 'Не удалось подключиться к Rocket.Chat',
            details: 'Проверьте URL и доступность сервера'
          },
          { status: 503 }
        );
      }

      if (rcError.message?.includes('Unauthorized')) {
        return NextResponse.json(
          { 
            error: 'Ошибка авторизации',
            details: 'Обновите credentials в настройках workspace'
          },
          { status: 401 }
        );
      }

      // Общая ошибка
      return NextResponse.json(
        { 
          error: 'Ошибка получения каналов',
          details: rcError.message || 'Неизвестная ошибка'
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Get channels error:', error);
    return NextResponse.json(
      { 
        error: 'Ошибка сервера',
        details: error.message
      },
      { status: 500 }
    );
  }
}