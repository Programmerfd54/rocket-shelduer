/**
 * Неизменяемая история интенсива (IntensiveEvent).
 * События API пишутся здесь; смены статуса/удаление связанных сообщений пишет триггер БД
 * (миграция 20261008100000_intensives) — так отправщик и существующие роуты работают без изменений.
 * Текст сообщений в историю не копируется.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { IntensiveEventType } from './types';

type Db = Prisma.TransactionClient | typeof prisma;

export interface AppendEventInput {
  intensiveId: string;
  type: IntensiveEventType;
  actorId?: string | null;
  planItemId?: string | null;
  messageId?: string | null;
  details?: Record<string, unknown> | null;
}

export async function appendEvent(db: Db, input: AppendEventInput): Promise<void> {
  await db.intensiveEvent.create({
    data: {
      intensiveId: input.intensiveId,
      type: input.type,
      actorId: input.actorId ?? null,
      planItemId: input.planItemId ?? null,
      messageId: input.messageId ?? null,
      details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
    },
  });
}

export async function appendEvents(db: Db, inputs: AppendEventInput[]): Promise<void> {
  if (inputs.length === 0) return;
  await db.intensiveEvent.createMany({
    data: inputs.map((input) => ({
      intensiveId: input.intensiveId,
      type: input.type,
      actorId: input.actorId ?? null,
      planItemId: input.planItemId ?? null,
      messageId: input.messageId ?? null,
      details: (input.details ?? undefined) as Prisma.InputJsonValue | undefined,
    })),
  });
}

/**
 * Автор действия для триггера истории сообщений в рамках текущей транзакции
 * (set_config(..., is_local = true) действует до конца транзакции).
 */
export async function setHistoryActor(tx: Prisma.TransactionClient, userId: string): Promise<void> {
  await tx.$executeRaw`SELECT set_config('app.intensive_actor_id', ${userId}, true)`;
}
