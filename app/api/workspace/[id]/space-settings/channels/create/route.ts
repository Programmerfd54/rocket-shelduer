import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { requireWorkspaceTabAccess } from '@/lib/workspace-tab-access';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import {
  applyHideSystemMessages,
  clearHideSystemMessages,
  getHideSystemMessagesValuesAsync,
} from '@/lib/space-settings-rc';

/** POST — создать канал в Rocket.Chat (публичный или приватный) с topic и description. */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (!canPerformAction(user, 'workspace:channels:create')) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const { id: workspaceId } = await params;
    const tabAccess = await requireWorkspaceTabAccess(user, workspaceId, 'spaceSettings');
    if (!tabAccess.ok) return tabAccess.response;
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
    const postCreateWarnings: string[] = [];

    if (hideSystemMessages) {
      const res = await applyHideSystemMessages(baseUrl, effective.authToken, effective.userId_RC);
      if (!res.ok) {
        postCreateWarnings.push(
          res.permissionDenied
            ? 'Глобальный список скрытых системных сообщений не обновлён (нет прав admin в RC).'
            : res.error || 'Не удалось применить глобальное скрытие системных сообщений.'
        );
      }
    } else {
      const clearRes = await clearHideSystemMessages(baseUrl, effective.authToken, effective.userId_RC);
      if (!clearRes.ok && !clearRes.skipped) {
        postCreateWarnings.push(
          clearRes.permissionDenied
            ? 'Глобальный список скрытых системных сообщений не сброшен (нет прав admin в RC).'
            : clearRes.error || 'Не удалось сбросить глобальное скрытие системных сообщений.'
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

    if (result.warnings?.length) {
      postCreateWarnings.push(...result.warnings);
    }

    let roomId = result.roomId;

    if (result.error) {
      const errLower = result.error.toLowerCase();
      const alreadyExists =
        errLower.includes('already exists') || errLower.includes('уже существует');
      if (alreadyExists) {
        const existing = await rc.getRoomInfoByName(
          effective.authToken,
          effective.userId_RC,
          normalizedName,
          isPrivate
        );
        if (existing.roomId) {
          roomId = existing.roomId;
          postCreateWarnings.push('Канал уже существовал в Rocket.Chat — применены настройки к существующему каналу.');
          if (topic) {
            const t = await rc.setRoomTopic(
              effective.authToken,
              effective.userId_RC,
              roomId,
              topic,
              isPrivate
            );
            if (!t.ok) postCreateWarnings.push(`тема: ${t.error || 'ошибка'}`);
          }
          if (description) {
            const d = await rc.setRoomDescription(
              effective.authToken,
              effective.userId_RC,
              roomId,
              description,
              isPrivate
            );
            if (!d.ok) postCreateWarnings.push(`описание: ${d.error || 'ошибка'}`);
          }
        } else {
          return NextResponse.json(
            {
              error: `Канал #${normalizedName} уже есть в Rocket.Chat, но не удалось получить его id: ${result.error}`,
            },
            { status: 400 }
          );
        }
      } else {
        return NextResponse.json({ error: result.error }, { status: 400 });
      }
    }

    if (!roomId) {
      return NextResponse.json({ error: 'Не получен id канала от Rocket.Chat' }, { status: 500 });
    }

    if (hideSystemMessages) {
      const types = await getHideSystemMessagesValuesAsync(
        baseUrl,
        effective.authToken,
        effective.userId_RC
      );
      const roomRes = await rc.saveRoomSettings(effective.authToken, effective.userId_RC, roomId, {
        systemMessages: types,
      });
      if (!roomRes.success) {
        postCreateWarnings.push(
          roomRes.error || 'не удалось применить скрытие системных сообщений в комнате'
        );
      }
    }

    if (setAsDefault && !isPrivate) {
      const defRes = await rc.setChannelDefault(
        effective.authToken,
        effective.userId_RC,
        roomId,
        true
      );
      if (!defRes.ok) {
        postCreateWarnings.push(defRes.error || 'не удалось сделать каналом по умолчанию');
      }
    }

    await prisma.workspaceActionLog.create({
      data: {
        workspaceId,
        userId: user.id,
        action: 'channel_create',
        details: JSON.stringify({ roomId, channelName: normalizedName, rcUsername: effective.rcUsername }),
      },
    }).catch(() => {});

    const warningText = postCreateWarnings.length
      ? `${postCreateWarnings.join(' ')} При необходимости нажмите «Применить настройки» в списке каналов.`
      : undefined;

    return NextResponse.json({
      success: true,
      roomId,
      name: normalizedName,
      isPrivate,
      partial: postCreateWarnings.length > 0,
      ...(warningText ? { warning: warningText } : {}),
    });
  } catch (error) {
    console.error('Create channel error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка создания канала') },
      { status: 500 }
    );
  }
}
