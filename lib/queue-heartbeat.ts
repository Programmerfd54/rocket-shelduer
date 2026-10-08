/**
 * Запись и чтение heartbeat планировщика (SystemSetting `cron:lastSendTick`), без миграций.
 * Относительные импорты: модуль подключается из scripts/send-scheduled-messages.ts (запускается и вне Next).
 */
import prisma from './prisma';
import {
  CRON_LAST_TICK_KEY,
  computeQueueStatus,
  parseHeartbeat,
  serializeHeartbeat,
  type QueueStatus,
} from './queue-status';

/**
 * Отметить завершённый тик отправки. Никогда не бросает: heartbeat не должен влиять на отправку.
 */
export async function recordSendTick(result: { sent?: number; failed?: number }): Promise<void> {
  try {
    const value = serializeHeartbeat(new Date(), {
      processed: (result.sent ?? 0) + (result.failed ?? 0),
      failed: result.failed ?? 0,
    });
    await prisma.systemSetting.upsert({
      where: { key: CRON_LAST_TICK_KEY },
      update: { value },
      create: { key: CRON_LAST_TICK_KEY, value },
    });
  } catch (error) {
    console.warn('Queue heartbeat write failed:', error instanceof Error ? error.message : 'unknown error');
  }
}

export async function readQueueStatus(now: Date = new Date()): Promise<QueueStatus> {
  const row = await prisma.systemSetting.findUnique({
    where: { key: CRON_LAST_TICK_KEY },
    select: { value: true },
  });
  return computeQueueStatus(parseHeartbeat(row?.value)?.at ?? null, now);
}
