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

type AppliedField = 'topic' | 'description' | 'readOnly' | 'default' | 'systemMessages';

/** POST — применить тему, описание и прочие настройки к существующему каналу. */
export async function POST(
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
    const body = await request.json().catch(() => ({}));

    const roomId = typeof body?.roomId === 'string' ? body.roomId.trim() : '';
    const topic = typeof body?.topic === 'string' ? body.topic.trim() : '';
    const description = typeof body?.description === 'string' ? body.description.trim() : '';
    const hideSystemMessages = body?.hideSystemMessages === true;
    const setAsDefault = body?.default === true;
    const readOnly = body?.readOnly === true;
    const fillMissingOnly = body?.fillMissingOnly !== false;

    if (!roomId) {
      return NextResponse.json({ error: 'Укажите roomId канала' }, { status: 400 });
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({
        error: 'Подключитесь к пространству (учётные данные Rocket.Chat)',
      });
    }

    const baseUrl = effective.workspaceUrl.replace(/\/$/, '');
    const rc = new RocketChatClient(effective.workspaceUrl);
    const { authToken, userId_RC: rcUserId } = effective;

    const warnings: string[] = [];

    if (hideSystemMessages) {
      const res = await applyHideSystemMessages(baseUrl, authToken, rcUserId);
      if (!res.ok) {
        warnings.push(
          res.permissionDenied
            ? 'Глобальный список скрытых системных сообщений не обновлён (нет прав admin в RC).'
            : res.error || 'Не удалось применить глобальное скрытие системных сообщений'
        );
      }
    } else {
      const clearRes = await clearHideSystemMessages(baseUrl, authToken, rcUserId);
      if (!clearRes.ok && !clearRes.skipped) {
        warnings.push(
          clearRes.permissionDenied
            ? 'Глобальный список скрытых системных сообщений не сброшен (нет прав admin в RC).'
            : clearRes.error || 'Не удалось сбросить глобальное скрытие системных сообщений'
        );
      }
    }

    const roomInfo = await rc.getRoomInfo(authToken, rcUserId, roomId);
    if (roomInfo.error || !roomInfo.room) {
      return NextResponse.json(
        { error: roomInfo.error || 'Канал не найден в Rocket.Chat' },
        { status: 404 }
      );
    }

    const room = roomInfo.room;
    const isPrivate = room.t === 'p';
    const applied: AppliedField[] = [];
    const skipped: string[] = [];

    const roomTopicCurrent = (room.topic ?? '').trim();
    const roomDescCurrent = (room.description ?? '').trim();

    let topicToSet = '';
    if (topic) {
      if (!fillMissingOnly || !roomTopicCurrent) topicToSet = topic;
      else skipped.push('тема (уже задана)');
    }
    let descToSet = '';
    if (description) {
      if (!fillMissingOnly || !roomDescCurrent) descToSet = description;
      else skipped.push('описание (уже задано)');
    }

    if (topicToSet) {
      const t = await rc.setRoomTopic(authToken, rcUserId, roomId, topicToSet, isPrivate);
      if (t.ok) applied.push('topic');
      else warnings.push(`тема: ${t.error || 'ошибка'}`);
    }

    if (descToSet) {
      const d = await rc.setRoomDescription(authToken, rcUserId, roomId, descToSet, isPrivate);
      if (d.ok) applied.push('description');
      else warnings.push(`описание: ${d.error || 'ошибка'}`);
    }

    if (body?.readOnly !== undefined) {
      const saveRes = await rc.saveRoomSettings(authToken, rcUserId, roomId, { readOnly });
      if (saveRes.success) applied.push('readOnly');
      else warnings.push(`только чтение: ${saveRes.error || 'ошибка'}`);
    }

    if (hideSystemMessages) {
      const types = await getHideSystemMessagesValuesAsync(baseUrl, authToken, rcUserId);
      const saveRes = await rc.saveRoomSettings(authToken, rcUserId, roomId, {
        systemMessages: types,
      });
      if (saveRes.success) applied.push('systemMessages');
      else warnings.push(`скрытие системных в комнате: ${saveRes.error || 'ошибка'}`);
    }

    if (body?.default !== undefined && !isPrivate) {
      const defRes = await rc.setChannelDefault(authToken, rcUserId, roomId, setAsDefault);
      if (defRes.ok) applied.push('default');
      else warnings.push(`по умолчанию: ${defRes.error || 'ошибка'}`);
    } else if (body?.default === true && isPrivate) {
      skipped.push('«по умолчанию» (недоступно для закрытых каналов)');
    }

    await prisma.workspaceActionLog.create({
      data: {
        workspaceId,
        userId: user.id,
        action: 'channel_apply_settings',
        details: JSON.stringify({
          roomId,
          channelName: room.name,
          applied,
          warnings: warnings.length ? warnings : undefined,
          rcUsername: effective.rcUsername,
        }),
      },
    }).catch(() => {});

    const warningText =
      warnings.length > 0
        ? `${warnings.join('; ')}. Часть настроек могла уже примениться в Rocket.Chat.`
        : undefined;

    return NextResponse.json({
      success: true,
      applied,
      skipped,
      roomName: room.name,
      partial: warnings.length > 0,
      ...(warningText ? { warning: warningText } : {}),
    });
  } catch (error) {
    console.error('Apply channel settings error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка применения настроек') },
      { status: 500 }
    );
  }
}
