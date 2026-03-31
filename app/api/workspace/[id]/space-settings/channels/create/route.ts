import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage } from '@/lib/security';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import { applyHideSystemMessages, getHideSystemMessagesValuesAsync } from '@/lib/space-settings-rc';

/** POST — создать канал в Rocket.Chat (публичный или приватный) с topic и description. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const body = await request.json();
    const name = typeof body?.name === 'string' ? body.name.trim().replace(/^#/, '') : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    const isPrivate = body?.isPrivate === true;
    const readOnly = body?.readOnly === true;
    const hideSystemMessages = body?.hideSystemMessages === true;
    const setAsDefault = body?.default === true;

    if (!name || !/^[0-9a-zA-Z\-_.]+$/.test(name.replace(/\s/g, '_'))) {
      return NextResponse.json(
        { error: 'Название канала обязательно. Допустимы буквы, цифры, дефис, подчёркивание.' },
        { status: 400 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({
        error: 'Подключитесь к пространству (учётные данные Rocket.Chat)',
      });
    }

    const baseUrl = effective.workspaceUrl.replace(/\/$/, '');
    if (hideSystemMessages) {
      const res = await applyHideSystemMessages(baseUrl, effective.authToken, effective.userId_RC);
      if (!res.ok) {
        return NextResponse.json(
          { error: res.error || 'Не удалось применить скрытие системных сообщений. Создайте канал без этой опции или примените настройку вручную в RC.' },
          { status: 400 }
        );
      }
    }

    const rc = new RocketChatClient(effective.workspaceUrl);
    const normalizedName = name.replace(/\s+/g, '_');

    const result = isPrivate
      ? await rc.createGroup(effective.authToken, effective.userId_RC, normalizedName, {
          readOnly,
          topic: topic || undefined,
          description: description || undefined,
        })
      : await rc.createChannel(effective.authToken, effective.userId_RC, normalizedName, {
          readOnly,
          topic: topic || undefined,
          description: description || undefined,
        });

    if (result.error) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    if (hideSystemMessages) {
      // systemMessages в комнате — blacklist: скрываем все кроме «Пользователь заглушен/не заглушен»
      const toHide = await getHideSystemMessagesValuesAsync(baseUrl, effective.authToken, effective.userId_RC);
      const roomRes = await rc.saveRoomSettings(
        effective.authToken,
        effective.userId_RC,
        result.roomId,
        { systemMessages: toHide }
      );
      if (!roomRes.success) {
        return NextResponse.json(
          { error: roomRes.error || 'Канал создан, но не удалось применить скрытие системных сообщений в комнате.' },
          { status: 400 }
        );
      }
    }

    if (setAsDefault) {
      const setDefault = isPrivate ? rc.setGroupDefault : rc.setChannelDefault;
      const defRes = await setDefault.call(rc, effective.authToken, effective.userId_RC, result.roomId, true);
      if (!defRes.ok) {
        return NextResponse.json(
          { error: defRes.error || 'Канал создан, но не удалось сделать каналом по умолчанию.' },
          { status: 400 }
        );
      }
    }

    await prisma.workspaceActionLog.create({
      data: {
        workspaceId,
        userId: user.id,
        action: 'channel_create',
        details: JSON.stringify({ roomId: result.roomId, channelName: normalizedName, rcUsername: effective.rcUsername }),
      },
    }).catch(() => {});

    return NextResponse.json({
      success: true,
      roomId: result.roomId,
      name: normalizedName,
      isPrivate,
    });
  } catch (error) {
    console.error('Create channel error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка создания канала') },
      { status: 500 }
    );
  }
}
