import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { decryptAuthToken } from '@/lib/encryption';
import { RocketChatClient } from '@/lib/rocketchat';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import { buildRcPermalink } from '@/lib/rc-permalink';
import { isInstantWithinIntensive, ymdFromDbDate } from '@/lib/intensives/dates';

type ExternalStatus = 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN';

/** Публичные поля сообщения для GET /api/messages/[id] (без секретов подключения). */
const MESSAGE_PUBLIC_SELECT = {
  id: true,
  userId: true,
  scheduledById: true,
  workspaceId: true,
  channelId: true,
  channelName: true,
  message: true,
  scheduledFor: true,
  status: true,
  sentAt: true,
  error: true,
  messageId_RC: true,
  sourceUserTemplateId: true,
  sourceOfficialTemplateId: true,
  // Интенсивы (docs/intensives-api.md)
  intensiveId: true,
  planItemId: true,
  isPlanRepeat: true,
  planEditedFromSnapshot: true,
  createdAt: true,
  updatedAt: true,
  workspace: { select: { id: true, workspaceName: true, workspaceUrl: true } },
} as const;

const MAX_MESSAGE_LENGTH = 20_000;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    // Только поля, нужные UI. Креды подключения (authToken, encryptedPassword, userId_RC) в ответ не попадают:
    // они читаются отдельным запросом ниже и используются только на сервере.
    const message = await prisma.scheduledMessage.findUnique({
      where: { id },
      select: MESSAGE_PUBLIC_SELECT,
    });

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      );
    }

    // Владелец сообщения, SUP, ADMIN или ADM с доступом к пространству (владелец/назначенный) могут смотреть статус
    if (message.userId !== user.id && user.role !== 'SUP' && user.role !== 'LEAD_SUP') {
      if (user.role === 'ADM' || user.role === 'MEMBER') {
        const workspace = await prisma.workspaceConnection.findUnique({
          where: { id: message.workspaceId },
          select: { userId: true },
        });
        const assignment = workspace
          ? await prisma.workspaceAdminAssignment.findFirst({
              where: { workspaceId: message.workspaceId, userId: user.id },
            })
          : null;
        const hasAccess = workspace?.userId === user.id || !!assignment;
        if (!hasAccess) {
          return NextResponse.json(
            { error: 'Unauthorized' },
            { status: 403 }
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Unauthorized' },
          { status: 403 }
        );
      }
    }

    let externalStatus: ExternalStatus = 'UNKNOWN';
    let rocketChatMessage: any = null;
    // Ссылка на сообщение в Rocket.Chat: только если тип комнаты точно определён через rooms.info
    let rcPermalink: string | null = null;

    const rcConnection =
      message.status === 'SENT' && message.messageId_RC
        ? await prisma.workspaceConnection.findUnique({
            where: { id: message.workspaceId },
            select: { workspaceUrl: true, authToken: true, userId_RC: true },
          })
        : null;
    const decryptedToken = rcConnection?.authToken ? decryptAuthToken(rcConnection.authToken) : null;
    if (
      message.status === 'SENT' &&
      message.messageId_RC &&
      rcConnection &&
      decryptedToken &&
      rcConnection.userId_RC
    ) {
      const rcClient = new RocketChatClient(rcConnection.workspaceUrl);
      const [rcMessage, roomInfo] = await Promise.all([
        rcClient.getMessage(decryptedToken, rcConnection.userId_RC, message.messageId_RC),
        // Ссылка — необязательная часть: любая ошибка RC (в том числе синхронная) → ссылки нет
        (async () => {
          try {
            const { room } = await rcClient.getRoomInfo(decryptedToken, rcConnection.userId_RC!, message.channelId);
            return room ? { t: room.t, name: room.name } : null;
          } catch {
            return null;
          }
        })(),
      ]);

      if (!rcMessage) {
        externalStatus = 'DELETED_IN_RC';
      } else {
        rcPermalink = buildRcPermalink({
          workspaceUrl: rcConnection.workspaceUrl,
          roomType: roomInfo?.t,
          roomName: roomInfo?.name,
          roomId: message.channelId,
          messageId: message.messageId_RC,
        });
        rocketChatMessage = {
          id: rcMessage._id,
          text: rcMessage.msg,
          updatedAt: rcMessage._updatedAt || null,
        };

        // Если текст в Rocket.Chat отличается от сохранённого текста — считаем, что сообщение изменено
        if (rcMessage.msg !== message.message) {
          externalStatus = 'EDITED_IN_RC';
        } else {
          externalStatus = 'SYNCHRONIZED';
        }
      }
    }

    return NextResponse.json({
      message,
      externalStatus,
      rocketChatMessage,
      rcPermalink,
    });
  } catch (error) {
    console.error('Get message with external status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch message status' },
      { status: 500 }
    );
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const message = await prisma.scheduledMessage.findUnique({
      where: { id },
      select: { id: true, userId: true, status: true },
    });

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      );
    }

    if (message.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    if (message.status === 'SENT') {
      return NextResponse.json(
        { error: 'Cannot delete sent message' },
        { status: 400 }
      );
    }

    await prisma.scheduledMessage.delete({
      where: { id },
    });

    return NextResponse.json({
      success: true,
      message: 'Message deleted successfully',
    });
  } catch (error) {
    console.error('Delete message error:', error);
    return NextResponse.json(
      { error: 'Failed to delete message' },
      { status: 500 }
    );
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }
    const { message: messageText, scheduledFor, channelId: newChannelId, channelName: newChannelName } = body;
    if (
      (messageText !== undefined && (typeof messageText !== 'string' || messageText.length > MAX_MESSAGE_LENGTH)) ||
      (scheduledFor !== undefined && scheduledFor !== null && Number.isNaN(new Date(scheduledFor).getTime())) ||
      (newChannelId !== undefined && newChannelId !== null && (typeof newChannelId !== 'string' || isUnsafeId(newChannelId))) ||
      (newChannelName !== undefined && newChannelName !== null && (typeof newChannelName !== 'string' || newChannelName.length > 200))
    ) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const message = await prisma.scheduledMessage.findUnique({
      where: { id },
    });

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      );
    }

    if (message.userId !== user.id) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 403 }
      );
    }

    // Allow editing SENT messages (for Rocket.Chat message editing)
    if (message.status !== 'PENDING' && message.status !== 'SENT') {
      return NextResponse.json(
        { error: 'Can only edit pending or sent messages' },
        { status: 400 }
      );
    }

    // If editing a SENT message, update it in Rocket.Chat
    if (message.status === 'SENT') {
      const workspace = await prisma.workspaceConnection.findFirst({
        where: {
          id: message.workspaceId,
          userId: user.id,
        },
        select: { workspaceUrl: true, authToken: true, userId_RC: true },
      });

      const editToken = workspace?.authToken ? decryptAuthToken(workspace.authToken) : null;
      if (!workspace || !editToken || !workspace.userId_RC) {
        return NextResponse.json(
          { error: 'Workspace not authenticated', code: 'RC_NOT_CONNECTED' },
          { status: 403 }
        );
      }

      // Проверяем наличие messageId_RC для редактирования в Rocket.Chat
      if (!message.messageId_RC) {
        return NextResponse.json(
          { error: 'Message ID from Rocket.Chat not found. Cannot edit sent message.' },
          { status: 400 }
        );
      }

      try {
        const rcClient = new RocketChatClient(workspace.workspaceUrl);
        
        // Редактируем сообщение в Rocket.Chat
        // roomId (channelId) обязателен для API редактирования
        await rcClient.editMessage(
          editToken,
          workspace.userId_RC,
          message.channelId, // roomId для Rocket.Chat API
          message.messageId_RC,
          messageText
        );
        
        console.log(`✓ Edited message ${message.id} in Rocket.Chat (messageId: ${message.messageId_RC}, roomId: ${message.channelId})`);
        
      } catch (rcError: any) {
        console.error('Rocket.Chat edit error:', rcError);
        
        // Определяем тип ошибки для более понятного сообщения
        const isNetworkError = rcError.message?.includes('timeout') || 
                              rcError.message?.includes('Connection') ||
                              rcError.message?.includes('Network error');
        
        return NextResponse.json(
          { 
            error: isNetworkError 
              ? 'Не удалось подключиться к серверу Rocket.Chat. Проверьте доступность сервера и интернет-соединение.'
              : 'Не удалось отредактировать сообщение в Rocket.Chat',
            details: getSafeErrorMessage(rcError, 'Rocket.Chat error')
          },
          { status: isNetworkError ? 503 : 500 } // 503 для проблем с сетью
        );
      }
    }

    const scheduledDate = scheduledFor ? new Date(scheduledFor) : message.scheduledFor;
    if (scheduledDate <= new Date() && message.status === 'PENDING') {
      return NextResponse.json(
        { error: 'Scheduled time must be in the future' },
        { status: 400 }
      );
    }

    // Интенсивы: новое время сообщения, связанного с интенсивом, должно оставаться в периоде интенсива
    if (scheduledFor && message.intensiveId && message.status === 'PENDING') {
      const intensive = await prisma.intensive.findUnique({
        where: { id: message.intensiveId },
        select: { startDate: true, endDate: true, timezone: true },
      });
      if (
        intensive &&
        !isInstantWithinIntensive(
          scheduledDate,
          ymdFromDbDate(intensive.startDate),
          ymdFromDbDate(intensive.endDate),
          intensive.timezone
        )
      ) {
        return NextResponse.json(
          { error: 'Дата отправки вне периода интенсива', code: 'OUT_OF_INTENSIVE_PERIOD' },
          { status: 400 }
        );
      }
    }

    // channelId/channelName можно менять только для PENDING (ещё не отправлено)
    const channelUpdate =
      newChannelId && newChannelName && message.status === 'PENDING'
        ? { channelId: newChannelId, channelName: newChannelName }
        : {};

    const updatedMessage = await prisma.scheduledMessage.update({
      where: { id },
      data: {
        message: messageText,
        // Ручная правка текста сохраняет связь с пунктом плана, но отмечает отличие от снимка
        ...(message.planItemId && typeof messageText === 'string' && messageText !== message.message
          ? { planEditedFromSnapshot: true }
          : {}),
        ...(scheduledFor && { scheduledFor: scheduledDate }),
        ...channelUpdate,
        updatedAt: new Date(),
      },
      include: {
        workspace: {
          select: {
            workspaceName: true,
            workspaceUrl: true,
          },
        },
      },
    });

    return NextResponse.json({
      success: true,
      message: updatedMessage,
    });
  } catch (error) {
    console.error('Update message error:', error);
    return NextResponse.json(
      { error: 'Failed to update message' },
      { status: 500 }
    );
  }
}
