import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { getSafeErrorMessage } from '@/lib/security';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';

/** POST — установить канал как «по умолчанию» (новые пользователи автоматически присоединятся). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const body = await request.json().catch(() => ({}));
    const roomId = typeof body?.roomId === 'string' ? body.roomId.trim() : '';
    const isPrivate = body?.isPrivate === true;
    const isDefault = body?.default !== false;

    if (!roomId) {
      return NextResponse.json(
        { error: 'Укажите roomId канала' },
        { status: 400 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({
        error: 'Подключитесь к пространству (учётные данные Rocket.Chat)',
      });
    }

    const rc = new RocketChatClient(effective.workspaceUrl);
    // RC имеет только channels.setDefault; groups.setDefault может отсутствовать (404)
    let res = isPrivate ? await rc.setGroupDefault(effective.authToken, effective.userId_RC, roomId, isDefault) : await rc.setChannelDefault(effective.authToken, effective.userId_RC, roomId, isDefault);
    if (!res.ok && isPrivate && (res.error === 'Not Found' || res.error?.includes('404'))) {
      res = await rc.setChannelDefault(effective.authToken, effective.userId_RC, roomId, isDefault);
    }
    if (!res.ok) {
      const errMsg =
        isPrivate && (res.error === 'Not Found' || res.error?.includes('404'))
          ? 'Закрытые каналы не поддерживают статус «по умолчанию» в Rocket.Chat. Используйте публичный канал.'
          : res.error || 'Не удалось установить';
      console.warn('[set-default] RC API error:', { roomId, isPrivate, isDefault, error: res.error });
      return NextResponse.json(
        { error: errMsg },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true, default: isDefault });
  } catch (error) {
    console.error('Set default channel error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка') },
      { status: 500 }
    );
  }
}
