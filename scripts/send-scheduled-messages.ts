/**
 * Скрипт для отправки запланированных сообщений
 * Запускается через cron каждую минуту для проверки и отправки сообщений
 * 
 * Настройка в vercel.json:
 * {
 *   "crons": [{
 *     "path": "/api/cron/send-messages",
 *     "schedule": "* * * * *"
 *   }]
 * }
 */

import prisma from '../lib/prisma';
import { RocketChatClient } from '../lib/rocketchat';

export async function sendScheduledMessages() {
  console.log(`[${new Date().toISOString()}] Checking for scheduled messages...`);

  try {
    const now = new Date();
    
    // Находим все сообщения, которые нужно отправить
    const messagesToSend = await prisma.scheduledMessage.findMany({
      where: {
        status: 'PENDING',
        scheduledFor: {
          lte: now,
        },
      },
      include: {
        workspace: true,
      },
      take: 50, // Ограничиваем количество сообщений за один запуск
    });

    if (messagesToSend.length === 0) {
      console.log('No messages to send');
      return { sent: 0, failed: 0 };
    }

    console.log(`Found ${messagesToSend.length} messages to send`);

    let sentCount = 0;
    let failedCount = 0;

    // Отправляем сообщения
    for (const message of messagesToSend) {
      let connectionIdToDeactivate = message.workspaceId; // при 401 деактивируем то подключение, которым отправляли
      try {
        const { workspace } = message;

        // Если сообщение запланировано «от имени» другого пользователя (SUP), отправляем его
        // через подключение этого пользователя к тому же RC-серверу, чтобы в RC сообщение
        // отображалось от правильного отправителя.
        let authToken = workspace.authToken;
        let userId_RC = workspace.userId_RC;
        let connectionActive = workspace.isActive;
        connectionIdToDeactivate = message.workspaceId;

        if (message.userId !== workspace.userId) {
          const authorConnection = await prisma.workspaceConnection.findFirst({
            where: {
              userId: message.userId,
              workspaceUrl: workspace.workspaceUrl,
              isActive: true,
              authToken: { not: null },
              userId_RC: { not: null },
            },
          });
          if (authorConnection?.authToken && authorConnection?.userId_RC) {
            authToken = authorConnection.authToken;
            userId_RC = authorConnection.userId_RC;
            connectionActive = true;
            connectionIdToDeactivate = authorConnection.id;
          } else {
            // Не подставляем токен владельца — в RC сообщение уйдёт от него. Требуем подключение автора.
            throw new Error(
              'Отправитель не подключил это пространство в планировщике. Подключите Rocket.Chat под этим пользователем для этого сервера или запланируйте сообщение от имени владельца пространства.'
            );
          }
        }

        if (!authToken || !userId_RC || !connectionActive) {
          throw new Error('Workspace not authenticated or inactive');
        }

        const rcClient = new RocketChatClient(workspace.workspaceUrl);
        
        const result = await rcClient.sendMessage(
          authToken,
          userId_RC,
          message.channelId,
          message.message
        );

        // Обновляем статус сообщения и сохраняем messageId из Rocket.Chat
        await prisma.scheduledMessage.update({
          where: { id: message.id },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            error: null,
            messageId_RC: result.messageId || null, // Сохраняем messageId для возможности редактирования
          },
        });

        sentCount++;
        console.log(`✓ Sent message ${message.id} to ${message.channelName}`);

      } catch (error) {
        failedCount++;
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        
        console.error(`✗ Failed to send message ${message.id}:`, errorMessage);

        // Обновляем статус с ошибкой
        await prisma.scheduledMessage.update({
          where: { id: message.id },
          data: {
            status: 'FAILED',
            error: errorMessage,
          },
        });

        // Если токен истек, деактивируем то подключение, которым пытались отправить
        if (errorMessage.includes('Unauthorized') || errorMessage.includes('401')) {
          await prisma.workspaceConnection.update({
            where: { id: connectionIdToDeactivate },
            data: { isActive: false },
          });
          console.log(`Deactivated connection ${connectionIdToDeactivate} due to auth error`);
        }
      }
    }

    console.log(`Completed: ${sentCount} sent, ${failedCount} failed`);
    return { sent: sentCount, failed: failedCount };

  } catch (error) {
    console.error('Error in sendScheduledMessages:', error);
    throw error;
  }
}

// Если запускается напрямую (не через API)
if (require.main === module) {
  sendScheduledMessages()
    .then((result) => {
      console.log('Result:', result);
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}