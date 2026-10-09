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
import { connectionAad, decryptAuthToken } from '../lib/encryption';
import { RocketChatClient } from '../lib/rocketchat';
import { isRcUnauthorizedError, tryRefreshRcSession } from '../lib/rc-session-refresh';
import { safeErrorForLog } from '../lib/sensitive-data';
import { recordSendTick } from '../lib/queue-heartbeat';

/**
 * Защита от двойной отправки.
 * 1) В пределах процесса: тики не перекрываются (внутренний cron и /api/cron/send-messages
 *    в одном процессе, медленный тик > 1 мин).
 * 2) Между процессами/репликами: перед отправкой сообщение «захватывается» атомарным
 *    compare-and-swap по полю sentAt (у PENDING оно используется как отметка «взято в работу»).
 *    Захват, не завершённый за CLAIM_LEASE_MS (процесс упал), можно перехватить снова.
 */
const CLAIM_LEASE_MS = 10 * 60 * 1000;
let tickInProgress = false;

async function claimMessage(id: string, previousClaim: Date | null): Promise<Date | null> {
  const claimedAt = new Date();
  const res = await prisma.scheduledMessage.updateMany({
    where: { id, status: 'PENDING', sentAt: previousClaim },
    data: { sentAt: claimedAt },
  });
  return res.count === 1 ? claimedAt : null;
}

export async function sendScheduledMessages() {
  if (tickInProgress) {
    console.log('Previous send tick is still running — skipping');
    return { sent: 0, failed: 0, skipped: true };
  }
  tickInProgress = true;
  try {
    const result = await runSendTick();
    // Heartbeat очереди для индикатора на дашборде; recordSendTick не бросает и отправку не затрагивает
    await recordSendTick(result);
    return result;
  } finally {
    tickInProgress = false;
  }
}

async function runSendTick() {
  console.log(`[${new Date().toISOString()}] Checking for scheduled messages...`);

  try {
    const now = new Date();
    const staleClaimBefore = new Date(now.getTime() - CLAIM_LEASE_MS);

    // Находим все сообщения, которые нужно отправить (не захваченные или с просроченным захватом)
    const messagesToSend = await prisma.scheduledMessage.findMany({
      where: {
        status: 'PENDING',
        scheduledFor: {
          lte: now,
        },
        OR: [{ sentAt: null }, { sentAt: { lt: staleClaimBefore } }],
      },
      include: {
        workspace: true,
      },
      orderBy: { scheduledFor: 'asc' },
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
      // Атомарный захват: если сообщение уже взял другой процесс/тик — пропускаем
      const claimedAt = await claimMessage(message.id, message.sentAt);
      if (!claimedAt) {
        console.log(`Message ${message.id} is being sent by another worker — skipping`);
        continue;
      }
      try {
        const { workspace } = message;

        // Если сообщение запланировано «от имени» другого пользователя (SUP), отправляем его
        // через подключение этого пользователя к тому же RC-серверу, чтобы в RC сообщение
        // отображалось от правильного отправителя.
        let authToken = decryptAuthToken(workspace.authToken, connectionAad(workspace.userId));
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
          const authorToken = authorConnection?.authToken
            ? decryptAuthToken(authorConnection.authToken, connectionAad(authorConnection.userId))
            : null;
          if (authorToken && authorConnection?.userId_RC) {
            authToken = authorToken;
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

        let result: { messageId?: string };
        try {
          result = await rcClient.sendMessage(authToken, userId_RC, message.channelId, message.message);
        } catch (sendError) {
          // 401: сессия RC истекла. Для подключения по логину/паролю без 2FA — один повторный вход
          // по сохранённому паролю (не чаще раза в 30 минут) и повтор отправки; иначе — как раньше.
          if (!isRcUnauthorizedError(sendError)) throw sendError;
          const refreshed = await tryRefreshRcSession(connectionIdToDeactivate);
          if (!refreshed) throw sendError;
          result = await rcClient.sendMessage(
            refreshed.authToken,
            refreshed.userId_RC,
            message.channelId,
            message.message
          );
        }

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

        if (message.sourceUserTemplateId) {
          await prisma.userTemplate.updateMany({
            where: { id: message.sourceUserTemplateId },
            data: { lastSentAt: new Date() },
          });
        }

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
            error: errorMessage.slice(0, 1000),
            sentAt: null, // снимаем отметку захвата
          },
        });

        // Если токен истек, деактивируем то подключение, которым пытались отправить
        if (isRcUnauthorizedError(error)) {
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
    console.error('Error in sendScheduledMessages:', safeErrorForLog(error));
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
      console.error('Fatal error:', safeErrorForLog(error));
      process.exit(1);
    });
}