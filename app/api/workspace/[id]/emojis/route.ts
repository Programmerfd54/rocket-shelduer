import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';

export async function GET(
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

    try {
      const rcClient = new RocketChatClient(workspace.workspaceUrl);
      const emojis = await rcClient.getEmojis(
        workspace.authToken,
        workspace.userId_RC
      );

      return NextResponse.json({
        emojis: emojis.map(emoji => ({
          _id: emoji._id,
          name: emoji.name,
          aliases: emoji.aliases || [],
          extension: emoji.extension || 'png',
          _updatedAt: emoji._updatedAt,
        })),
        workspaceUrl: workspace.workspaceUrl, // Для построения URL изображений
      });
    } catch (rcError: any) {
      console.error('Rocket.Chat emojis error:', rcError);
      // Возвращаем пустой массив если не удалось получить эмодзи
      // Frontend будет использовать стандартные эмодзи
      return NextResponse.json({ emojis: [] });
    }
  } catch (error) {
    console.error('Get emojis error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch emojis' },
      { status: 500 }
    );
  }
}
