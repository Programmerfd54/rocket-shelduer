import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse, rcUnauthorizedResponse } from '@/lib/rc-http';
import { isRcNetworkFailure, rcUnreachableResponse } from '@/lib/rc-network';

export async function GET(
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
      if (assignment) {
        workspace = await prisma.workspaceConnection.findUnique({
          where: { id },
          select: { id: true },
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
      return rcNotConnectedResponse();
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
          topic: ch.topic,
          description: ch.description,
          ts: ch.ts,
          default: ch.default,
          readOnly: ch.ro,
          createdByRcUsername: ch.u?.username,
        })),
      });
    } catch (rcError: unknown) {
      const err = rcError as { message?: string; code?: string };
      console.error('Rocket.Chat API error:', {
        message: err.message,
        code: err.code,
        url: effective.workspaceUrl,
      });

      if (isRcNetworkFailure(rcError)) {
        return rcUnreachableResponse(effective.workspaceUrl, rcError);
      }

      if (err.message?.includes('Unauthorized')) {
        return rcUnauthorizedResponse(
          'Ошибка авторизации',
          'Обновите credentials в настройках workspace'
        );
      }

      return NextResponse.json(
        {
          error: 'Ошибка получения каналов',
          details: getSafeErrorMessage(rcError, 'Неизвестная ошибка'),
        },
        { status: 500 }
      );
    }
  } catch (error: any) {
    console.error('Get channels error:', error);
    return NextResponse.json(
      { 
        error: 'Ошибка сервера',
        details: getSafeErrorMessage(error, 'Internal error')
      },
      { status: 500 }
    );
  }
}