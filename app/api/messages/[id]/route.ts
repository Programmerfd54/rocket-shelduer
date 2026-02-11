import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';
import { isUnsafeId } from '@/lib/security';

type ExternalStatus = 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN';

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

    const message = await prisma.scheduledMessage.findUnique({
      where: { id },
      include: {
        workspace: true,
      },
    });

    if (!message) {
      return NextResponse.json(
        { error: 'Message not found' },
        { status: 404 }
      );
    }

    // Владелец сообщения, SUP, ADMIN или ADM с доступом к пространству (владелец/назначенный) могут смотреть статус
    if (message.userId !== user.id && user.role !== 'SUPPORT' && user.role !== 'ADMIN') {
      if (user.role === 'ADM' || user.role === 'VOL') {
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

    // Проверяем только отправленные сообщения, у которых есть messageId_RC и привязанный workspace
    if (
      message.status === 'SENT' &&
      message.messageId_RC &&
      message.workspace &&
      message.workspace.authToken &&
      message.workspace.userId_RC
    ) {
      const rcClient = new RocketChatClient(message.workspace.workspaceUrl);
      const rcMessage = await rcClient.getMessage(
        message.workspace.authToken,
        message.workspace.userId_RC,
        message.messageId_RC
      );

      if (!rcMessage) {
        externalStatus = 'DELETED_IN_RC';
      } else {
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
    const body = await request.json();
    const { message: messageText, scheduledFor } = body;

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
      });

      if (!workspace || !workspace.authToken || !workspace.userId_RC) {
        return NextResponse.json(
          { error: 'Workspace not authenticated' },
          { status: 401 }
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
          workspace.authToken,
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
            details: rcError instanceof Error ? rcError.message : 'Unknown error'
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

    const updatedMessage = await prisma.scheduledMessage.update({
      where: { id },
      data: {
        message: messageText,
        ...(scheduledFor && { scheduledFor: scheduledDate }),
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
