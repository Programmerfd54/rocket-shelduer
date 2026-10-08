import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { requireWorkspaceTabAccess } from '@/lib/workspace-tab-access';
import { getSafeErrorMessage } from '@/lib/security';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';

/** GET — проверить, что канал существует (rooms.info). */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (!canPerformAction(user, 'workspace:space-settings')) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const { id: workspaceId } = await params;
    const tabAccess = await requireWorkspaceTabAccess(user, workspaceId, 'spaceSettings');
    if (!tabAccess.ok) return tabAccess.response;
    const { searchParams } = new URL(request.url);
    const roomId = searchParams.get('roomId');

    if (!roomId) {
      return NextResponse.json({ error: 'Укажите roomId' }, { status: 400 });
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({ error: 'Подключитесь к пространству' });
    }

    const rc = new RocketChatClient(effective.workspaceUrl);
    const { room, error } = await rc.getRoomInfo(
      effective.authToken,
      effective.userId_RC,
      roomId
    );

    if (error || !room) {
      return NextResponse.json({ exists: false, error: error || 'Канал не найден' });
    }

    return NextResponse.json({
      exists: true,
      room: {
        id: room._id,
        name: room.name,
        topic: room.topic,
        description: room.description,
        ts: room.ts,
        default: room.default,
        readOnly: room.ro,
      },
    });
  } catch (error) {
    console.error('Check channel error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка') },
      { status: 500 }
    );
  }
}
