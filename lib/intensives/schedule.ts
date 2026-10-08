/**
 * Планирование сообщения из пункта плана — расширение POST /api/messages (необязательные поля).
 * Сообщения без этих полей создаются как раньше. Все существующие проверки роута (доступ к пространству,
 * «от имени», архив, время в будущем) выполняются до вызова этих функций.
 *
 * Конкуренция: блокировка строки пункта FOR SHARE + частичный уникальный индекс
 * "ScheduledMessage_planItem_active_key" → вторая попытка получает 409 PLAN_ITEM_ALREADY_SCHEDULED.
 * Идемпотентность: clientRequestId (уникален) → повтор запроса возвращает ранее созданное сообщение.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { canPerformAction } from '@/lib/permissions';
import { isUnsafeId } from '@/lib/security';
import { canSeeAudience } from './access';
import { isInstantWithinIntensive, localYmdOfInstant, ymdFromDbDate } from './dates';
import { appendEvent } from './events';
import { ApiError, ensureIntensivesEnabled, prismaErrorCode } from './http';
import { lockPlanItem } from './plan-service';

export interface PlanFieldsInput {
  intensiveId: string | null;
  planItemId: string | null;
  clientRequestId: string | null;
  isPlanRepeat: boolean;
}

const CLIENT_REQUEST_ID_RE = /^[A-Za-z0-9_.:-]{8,100}$/;

/** Разбор необязательных полей интенсива из тела POST /api/messages. null — некорректный ввод (400). */
export function parsePlanFields(body: Record<string, unknown>): PlanFieldsInput | null {
  const { intensiveId, planItemId, clientRequestId, isPlanRepeat } = body;
  if (intensiveId != null && (typeof intensiveId !== 'string' || isUnsafeId(intensiveId))) return null;
  if (planItemId != null && (typeof planItemId !== 'string' || isUnsafeId(planItemId))) return null;
  if (clientRequestId != null && (typeof clientRequestId !== 'string' || !CLIENT_REQUEST_ID_RE.test(clientRequestId))) return null;
  if (isPlanRepeat != null && typeof isPlanRepeat !== 'boolean') return null;
  return {
    intensiveId: (intensiveId as string | undefined)?.trim() || null,
    planItemId: (planItemId as string | undefined)?.trim() || null,
    clientRequestId: (clientRequestId as string | undefined) || null,
    isPlanRepeat: isPlanRepeat === true,
  };
}

export function hasPlanContext(f: PlanFieldsInput): boolean {
  return !!(f.intensiveId || f.planItemId || f.isPlanRepeat);
}

const MESSAGE_RESPONSE_INCLUDE = {
  workspace: { select: { workspaceName: true, workspaceUrl: true } },
} as const;

/**
 * Повтор запроса с тем же clientRequestId: ранее созданное сообщение (только своё) или null.
 * Чужой ключ → 409 IDEMPOTENCY_KEY_CONFLICT.
 */
export async function findIdempotentMessage(user: CurrentUser, clientRequestId: string) {
  const existing = await prisma.scheduledMessage.findUnique({
    where: { clientRequestId },
    include: MESSAGE_RESPONSE_INCLUDE,
  });
  if (!existing) return null;
  const creator = existing.scheduledById ?? existing.userId;
  if (creator !== user.id) {
    throw new ApiError(409, 'IDEMPOTENCY_KEY_CONFLICT', 'Ключ запроса уже использован. Обновите форму и повторите.');
  }
  return existing;
}

export interface ResolvedPlanContext {
  intensiveId: string;
  planItemId: string | null;
  isPlanRepeat: boolean;
  planEditedFromSnapshot: boolean;
}

const normalizeText = (s: string) => s.replace(/\r\n/g, '\n').trim();

/** Проверки контекста интенсива/пункта (вне транзакции; повторные — в транзакции создания). */
export async function resolvePlanContext(params: {
  user: CurrentUser;
  workspace: { id: string; orgSpaceId: string | null };
  fields: PlanFieldsInput;
  scheduledDate: Date;
  messageText: string;
}): Promise<ResolvedPlanContext> {
  const { user, workspace, fields, scheduledDate, messageText } = params;
  await ensureIntensivesEnabled();
  if (!canPerformAction(user, 'messages:create')) throw new ApiError(403, 'FORBIDDEN', 'Недостаточно прав');
  if (!fields.intensiveId) {
    throw new ApiError(400, 'BAD_REQUEST', 'Укажите интенсив', { fieldErrors: { intensiveId: 'Укажите интенсив' } });
  }
  if (fields.isPlanRepeat && !fields.planItemId) {
    throw new ApiError(400, 'BAD_REQUEST', 'Повтор возможен только для пункта плана', { fieldErrors: { planItemId: 'Укажите пункт плана' } });
  }

  const intensive = await prisma.intensive.findUnique({
    where: { id: fields.intensiveId },
    select: { id: true, orgSpaceId: true, status: true, startDate: true, endDate: true, timezone: true },
  });
  // Интенсив другого OrgSpace / черновик не раскрываем: 404
  if (!intensive || (intensive.status === 'DRAFT' && user.role !== 'LEAD_SUP')) {
    throw new ApiError(404, 'NOT_FOUND', 'Интенсив не найден');
  }
  if (!workspace.orgSpaceId || workspace.orgSpaceId !== intensive.orgSpaceId) {
    throw new ApiError(400, 'WORKSPACE_NOT_IN_INTENSIVE_SPACE', 'Пространство не относится к этому интенсиву');
  }
  if (intensive.status !== 'PUBLISHED') {
    throw new ApiError(409, 'INTENSIVE_NOT_PUBLISHED', 'Интенсив не опубликован — планирование по нему недоступно');
  }

  let planEditedFromSnapshot = false;
  if (fields.planItemId) {
    const item = await prisma.intensivePlanItem.findFirst({
      where: { id: fields.planItemId, intensiveId: intensive.id },
      select: { id: true, audience: true, skipped: true, body: true },
    });
    if (!item) throw new ApiError(404, 'PLAN_ITEM_NOT_FOUND', 'Пункт плана не найден');
    if (!canSeeAudience(user.role, item.audience)) {
      throw new ApiError(403, 'PLAN_ITEM_NOT_VISIBLE', 'Этот пункт плана вам недоступен');
    }
    if (item.skipped) throw new ApiError(409, 'PLAN_ITEM_SKIPPED', 'Пункт пропущен — планирование недоступно');
    planEditedFromSnapshot = normalizeText(messageText) !== normalizeText(item.body);
  }

  const startYmd = ymdFromDbDate(intensive.startDate);
  const endYmd = ymdFromDbDate(intensive.endDate);
  if (!isInstantWithinIntensive(scheduledDate, startYmd, endYmd, intensive.timezone)) {
    throw new ApiError(400, 'OUT_OF_INTENSIVE_PERIOD', 'Дата отправки вне периода интенсива', {
      fieldErrors: { scheduledFor: 'Дата вне периода интенсива' },
      startDate: startYmd,
      endDate: endYmd,
      timezone: intensive.timezone,
      localDate: localYmdOfInstant(scheduledDate, intensive.timezone),
    });
  }

  return {
    intensiveId: intensive.id,
    planItemId: fields.planItemId,
    isPlanRepeat: fields.isPlanRepeat,
    planEditedFromSnapshot,
  };
}

async function activeSendOf(db: Prisma.TransactionClient | typeof prisma, planItemId: string) {
  return db.scheduledMessage.findFirst({
    where: { planItemId, isPlanRepeat: false, status: { in: ['PENDING', 'SENT'] } },
    select: { id: true },
  });
}

function alreadyScheduled(existingMessageId: string | null): ApiError {
  return new ApiError(409, 'PLAN_ITEM_ALREADY_SCHEDULED', 'Это сообщение уже запланировано', { existingMessageId });
}

/**
 * Создание сообщения со связью (и/или ключом идемпотентности) в одной транзакции с событием истории.
 * Возвращает { message, idempotent }.
 */
export async function createMessageWithPlanLink(params: {
  user: CurrentUser;
  data: Prisma.ScheduledMessageUncheckedCreateInput;
  plan: ResolvedPlanContext | null;
  clientRequestId: string | null;
}) {
  const { user, data, plan, clientRequestId } = params;
  if (clientRequestId) {
    const existing = await findIdempotentMessage(user, clientRequestId);
    if (existing) return { message: existing, idempotent: true };
  }
  try {
    const message = await prisma.$transaction(async (tx) => {
      if (plan?.planItemId) {
        await lockPlanItem(tx, plan.planItemId, 'SHARE');
        const item = await tx.intensivePlanItem.findUnique({ where: { id: plan.planItemId }, select: { skipped: true } });
        if (!item) throw new ApiError(404, 'PLAN_ITEM_NOT_FOUND', 'Пункт плана не найден');
        if (item.skipped) throw new ApiError(409, 'PLAN_ITEM_SKIPPED', 'Пункт пропущен — планирование недоступно');
        if (plan.isPlanRepeat) {
          const sent = await tx.scheduledMessage.findFirst({
            where: { planItemId: plan.planItemId, status: 'SENT' },
            select: { id: true },
          });
          if (!sent) {
            throw new ApiError(409, 'REPEAT_REQUIRES_SENT', 'Повтор возможен только после успешной отправки');
          }
        } else {
          const active = await activeSendOf(tx, plan.planItemId);
          if (active) throw alreadyScheduled(active.id);
        }
      }
      const created = await tx.scheduledMessage.create({
        data: {
          ...data,
          ...(clientRequestId ? { clientRequestId } : {}),
          ...(plan
            ? {
                intensiveId: plan.intensiveId,
                planItemId: plan.planItemId,
                isPlanRepeat: plan.isPlanRepeat,
                planEditedFromSnapshot: plan.planEditedFromSnapshot,
              }
            : {}),
        },
        include: MESSAGE_RESPONSE_INCLUDE,
      });
      if (plan) {
        await appendEvent(tx, {
          intensiveId: plan.intensiveId,
          type: plan.isPlanRepeat ? 'MESSAGE_REPEAT_SCHEDULED' : 'MESSAGE_SCHEDULED',
          actorId: user.id,
          planItemId: plan.planItemId,
          messageId: created.id,
          details: {
            scheduledFor: created.scheduledFor.toISOString(),
            workspaceId: created.workspaceId,
            channelName: created.channelName,
            authorId: created.userId,
            scheduledById: created.scheduledById,
            planEditedFromSnapshot: plan.planEditedFromSnapshot,
          },
        });
      }
      return created;
    });
    return { message, idempotent: false };
  } catch (e) {
    if (prismaErrorCode(e) !== 'P2002') throw e;
    if (clientRequestId) {
      const existing = await findIdempotentMessage(user, clientRequestId);
      if (existing) return { message: existing, idempotent: true };
    }
    if (plan?.planItemId && !plan.isPlanRepeat) {
      const active = await activeSendOf(prisma, plan.planItemId);
      throw alreadyScheduled(active?.id ?? null);
    }
    throw e;
  }
}
