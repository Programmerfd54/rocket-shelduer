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

    try {
      const rcClient = new RocketChatClient(effective.workspaceUrl);
      const emojis = await rcClient.getEmojis(
        effective.authToken,
        effective.userId_RC
      );

      return NextResponse.json({
        emojis: emojis.map(emoji => ({
          _id: emoji._id,
          name: emoji.name,
          aliases: emoji.aliases || [],
          extension: emoji.extension || 'png',
          _updatedAt: emoji._updatedAt,
        })),
        workspaceUrl: effective.workspaceUrl, // Для построения URL изображений
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
