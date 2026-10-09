/**
 * Изменение состава плана (только Lead_SUP; интенсив в статусе DRAFT или PUBLISHED).
 *  - Поля снимка редактируются, только пока к пункту никогда не привязывались отправки.
 *  - Пропуск — явное решение с причиной; нельзя пропустить пункт с активной отправкой.
 *  - Удаление — только если отправки никогда не привязывались.
 *  - Новая версия источника применяется только к пунктам без отправок.
 * Гонки с планированием сообщений исключены блокировкой строки пункта (FOR UPDATE / FOR SHARE).
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { isValidHm } from './dates';
import { appendEvent } from './events';
import { ApiError, prismaErrorCode } from './http';
import {
  computeSourceVersion,
  diffSnapshot,
  fallbackTitle,
  itemsEverLinked,
  loadOfficialTemplates,
  snapshotFromOfficial,
  snapshotOfItem,
  type SnapshotFields,
} from './plan';
import { createTemplateChannel } from '@/lib/templates/channels';
import { TemplatesApiError } from '@/lib/templates/http';
import type { PlanItemAudience, PlanItemScope, PlanUpdateEntry } from './types';

type Tx = Prisma.TransactionClient;

export function assertPlanEditable(intensive: { status: string }): void {
  if (intensive.status !== 'DRAFT' && intensive.status !== 'PUBLISHED') {
    throw new ApiError(409, 'INTENSIVE_READ_ONLY', 'План отменённого или архивного интенсива не меняется');
  }
}

/** Блокировка строки пункта до конца транзакции. */
export async function lockPlanItem(tx: Tx, itemId: string, mode: 'UPDATE' | 'SHARE'): Promise<void> {
  if (mode === 'UPDATE') {
    await tx.$executeRaw`SELECT 1 FROM "IntensivePlanItem" WHERE "id" = ${itemId} FOR UPDATE`;
  } else {
    await tx.$executeRaw`SELECT 1 FROM "IntensivePlanItem" WHERE "id" = ${itemId} FOR SHARE`;
  }
}

async function loadItem(db: Tx | typeof prisma, intensiveId: string, itemId: string) {
  const item = await db.intensivePlanItem.findFirst({ where: { id: itemId, intensiveId } });
  if (!item) throw new ApiError(404, 'PLAN_ITEM_NOT_FOUND', 'Пункт плана не найден');
  return item;
}

/** Область по audience (для пунктов без явной области): ADM/SUP → область, ALL → null. */
function scopeFromAudience(audience: PlanItemAudience): PlanItemScope | null {
  return audience === 'ADM' || audience === 'SUP' ? audience : null;
}

/** Канал пункта → словарь каналов шаблонов (по запросу createChannelIfMissing). Ошибки — в формате API интенсивов. */
async function addChannelToDictionary(channel: string | undefined, actorId: string): Promise<void> {
  if (!channel) return;
  try {
    await createTemplateChannel({ name: channel }, actorId);
  } catch (e) {
    if (e instanceof TemplatesApiError && e.status === 400) {
      throw new ApiError(400, 'VALIDATION_ERROR', e.message, { fieldErrors: { channel: e.message } });
    }
    throw e;
  }
}

function normalizeCategories(list: string[] | undefined | null): string[] {
  return Array.from(new Set((list ?? []).map((s) => s.trim()).filter(Boolean).map((s) => s.slice(0, 40)))).slice(0, 10);
}

/* ───────────── Добавление пункта ───────────── */

export async function addPlanItem(
  user: CurrentUser,
  intensive: { id: string; status: string },
  input: {
    sourceUserTemplateId?: string;
    title?: string;
    body?: string;
    channel?: string;
    dayNumber?: number | null;
    time?: string | null;
    audience: PlanItemAudience;
    categories?: string[];
    /** SUP | ADM | null (для всех); если задано — определяет audience */
    scope?: PlanItemScope | null;
    createChannelIfMissing?: boolean;
  }
) {
  assertPlanEditable(intensive);
  // Область пункта: явная scope приоритетнее audience (null — общий пункт, audience ALL)
  if (input.scope !== undefined) input = { ...input, audience: input.scope ?? 'ALL' };
  const sourceScope = input.scope !== undefined ? input.scope : scopeFromAudience(input.audience);
  let snapshot: SnapshotFields;
  let source: { sourceType: 'USER_TEMPLATE' | 'CUSTOM'; sourceTemplateId: string | null; sourceVersion: string | null };

  if (input.sourceUserTemplateId) {
    // Только свой пользовательский шаблон (чужие приватные шаблоны не раскрываются)
    const tpl = await prisma.userTemplate.findFirst({ where: { id: input.sourceUserTemplateId, userId: user.id } });
    if (!tpl) throw new ApiError(404, 'NOT_FOUND', 'Шаблон не найден', { fieldErrors: { sourceUserTemplateId: 'Шаблон не найден' } });
    const fromTpl: SnapshotFields = {
      title: fallbackTitle(tpl.title, tpl.body),
      body: tpl.body,
      channel: tpl.channel,
      dayNumber: tpl.intensiveDay && tpl.intensiveDay >= 1 ? tpl.intensiveDay : null,
      time: isValidHm(tpl.time) ? tpl.time : null,
      audience: input.audience,
      categories: normalizeCategories(tpl.tags),
    };
    source = { sourceType: 'USER_TEMPLATE', sourceTemplateId: tpl.id, sourceVersion: computeSourceVersion(fromTpl) };
    snapshot = {
      title: input.title || fromTpl.title,
      body: input.body || fromTpl.body,
      channel: input.channel || fromTpl.channel,
      dayNumber: input.dayNumber !== undefined ? input.dayNumber : fromTpl.dayNumber,
      time: input.time !== undefined ? input.time : fromTpl.time,
      audience: input.audience,
      categories: input.categories ? normalizeCategories(input.categories) : fromTpl.categories,
    };
  } else {
    const fieldErrors: Record<string, string> = {};
    if (!input.body || !input.body.trim()) fieldErrors.body = 'Введите текст анонса';
    if (!input.channel) fieldErrors.channel = 'Укажите канал';
    if (Object.keys(fieldErrors).length > 0) {
      throw new ApiError(400, 'VALIDATION_ERROR', Object.values(fieldErrors)[0], { fieldErrors });
    }
    snapshot = {
      title: fallbackTitle(input.title, input.body!),
      body: input.body!,
      channel: input.channel!,
      dayNumber: input.dayNumber ?? null,
      time: input.time ?? null,
      audience: input.audience,
      categories: normalizeCategories(input.categories),
    };
    source = { sourceType: 'CUSTOM', sourceTemplateId: null, sourceVersion: null };
  }

  if (input.createChannelIfMissing) await addChannelToDictionary(snapshot.channel, user.id);

  try {
    return await prisma.$transaction(async (tx) => {
      const maxPos = await tx.intensivePlanItem.aggregate({ where: { intensiveId: intensive.id }, _max: { position: true } });
      const item = await tx.intensivePlanItem.create({
        data: {
          intensiveId: intensive.id,
          position: (maxPos._max.position ?? -1) + 1,
          ...source,
          sourceScope,
          ...snapshot,
          createdById: user.id,
          updatedById: user.id,
        },
      });
      await appendEvent(tx, {
        intensiveId: intensive.id,
        type: 'PLAN_ITEM_ADDED',
        actorId: user.id,
        planItemId: item.id,
        details: {
          sourceType: item.sourceType,
          sourceTemplateId: item.sourceTemplateId,
          sourceScope: item.sourceScope,
          title: item.title,
          dayNumber: item.dayNumber,
          time: item.time,
        },
      });
      return item;
    });
  } catch (e) {
    if (prismaErrorCode(e) === 'P2002') {
      throw new ApiError(409, 'PLAN_ITEM_DUPLICATE_SOURCE', 'Этот шаблон уже есть в плане');
    }
    throw e;
  }
}

/* ───────────── Изменение / пропуск ───────────── */

export async function updatePlanItem(
  user: CurrentUser,
  intensive: { id: string; status: string },
  itemId: string,
  input: {
    title?: string;
    body?: string;
    channel?: string;
    dayNumber?: number | null;
    time?: string | null;
    audience?: PlanItemAudience;
    categories?: string[];
    position?: number;
    skipped?: boolean;
    skipReason?: string;
    scope?: PlanItemScope | null;
    createChannelIfMissing?: boolean;
  }
) {
  assertPlanEditable(intensive);
  if (input.createChannelIfMissing && input.channel) await addChannelToDictionary(input.channel, user.id);
  return prisma.$transaction(async (tx) => {
    await lockPlanItem(tx, itemId, 'UPDATE');
    const item = await loadItem(tx, intensive.id, itemId);
    const before = snapshotOfItem(item);
    // Область: у OFFICIAL задаётся шаблоном; у CUSTOM/USER_TEMPLATE — scope (приоритетнее) или audience
    let nextScope: PlanItemScope | null | undefined;
    let nextAudience = input.audience;
    if (input.scope !== undefined) {
      if (item.sourceType === 'OFFICIAL') {
        throw new ApiError(400, 'VALIDATION_ERROR', 'Область официального пункта задаётся шаблоном', {
          fieldErrors: { scope: 'Только для своих пунктов' },
        });
      }
      nextScope = input.scope;
      nextAudience = input.scope ?? 'ALL';
    } else if (input.audience !== undefined && item.sourceType !== 'OFFICIAL') {
      nextScope = scopeFromAudience(input.audience);
    }
    const after: SnapshotFields = {
      title: input.title ?? before.title,
      body: input.body ?? before.body,
      channel: input.channel ?? before.channel,
      dayNumber: input.dayNumber !== undefined ? input.dayNumber : before.dayNumber,
      time: input.time !== undefined ? input.time : before.time,
      audience: nextAudience ?? before.audience,
      categories: input.categories ? normalizeCategories(input.categories) : before.categories,
    };
    const diff = diffSnapshot(before, after);
    if (diff.length > 0) {
      const linked = await itemsEverLinked(tx, [itemId]);
      if (linked.has(itemId)) {
        throw new ApiError(409, 'PLAN_ITEM_HAS_MESSAGES', 'У пункта есть отправки — снимок шаблона больше не меняется');
      }
    }

    const data: Prisma.IntensivePlanItemUpdateInput = {};
    if (diff.length > 0) Object.assign(data, after);
    if (nextScope !== undefined && nextScope !== item.sourceScope) data.sourceScope = nextScope;
    if (input.position !== undefined && input.position !== item.position) data.position = input.position;

    let skipEvent: 'PLAN_ITEM_SKIPPED' | 'PLAN_ITEM_UNSKIPPED' | null = null;
    if (input.skipped === true) {
      const active = await tx.scheduledMessage.findFirst({
        where: { planItemId: itemId, isPlanRepeat: false, status: { in: ['PENDING', 'SENT'] } },
        select: { id: true },
      });
      if (active) {
        throw new ApiError(409, 'PLAN_ITEM_ACTIVE_SEND', 'У пункта есть запланированная или выполненная отправка — пропустить нельзя', {
          existingMessageId: active.id,
        });
      }
      data.skipped = true;
      data.skipReason = input.skipReason!;
      data.skippedBy = { connect: { id: user.id } };
      data.skippedAt = new Date();
      skipEvent = 'PLAN_ITEM_SKIPPED';
    } else if (input.skipped === false && item.skipped) {
      data.skipped = false;
      data.skipReason = null;
      data.skippedBy = { disconnect: true };
      data.skippedAt = null;
      skipEvent = 'PLAN_ITEM_UNSKIPPED';
    } else if (input.skipped === undefined && input.skipReason !== undefined && item.skipped && input.skipReason) {
      data.skipReason = input.skipReason;
    }

    if (Object.keys(data).length === 0) return item;
    data.updatedBy = { connect: { id: user.id } };
    const updated = await tx.intensivePlanItem.update({ where: { id: itemId }, data });

    if (diff.length > 0 || data.position !== undefined || data.sourceScope !== undefined) {
      await appendEvent(tx, {
        intensiveId: intensive.id,
        type: 'PLAN_ITEM_UPDATED',
        actorId: user.id,
        planItemId: itemId,
        details: {
          fields: diff.map((d) => d.field),
          ...(data.sourceScope !== undefined ? { scope: { from: item.sourceScope, to: nextScope } } : {}),
          ...(data.position !== undefined ? { position: { from: item.position, to: input.position } } : {}),
        },
      });
    }
    if (skipEvent) {
      await appendEvent(tx, {
        intensiveId: intensive.id,
        type: skipEvent,
        actorId: user.id,
        planItemId: itemId,
        details: skipEvent === 'PLAN_ITEM_SKIPPED' ? { reason: input.skipReason } : null,
      });
    }
    return updated;
  });
}

/* ───────────── Удаление ───────────── */

export async function deletePlanItem(user: CurrentUser, intensive: { id: string; status: string }, itemId: string) {
  assertPlanEditable(intensive);
  await prisma.$transaction(async (tx) => {
    await lockPlanItem(tx, itemId, 'UPDATE');
    const item = await loadItem(tx, intensive.id, itemId);
    const linked = await itemsEverLinked(tx, [itemId]);
    if (linked.has(itemId)) {
      throw new ApiError(409, 'PLAN_ITEM_HAS_MESSAGES', 'К пункту привязывались отправки — удалить его нельзя (можно пропустить)');
    }
    await tx.intensivePlanItem.delete({ where: { id: itemId } });
    await appendEvent(tx, {
      intensiveId: intensive.id,
      type: 'PLAN_ITEM_DELETED',
      actorId: user.id,
      planItemId: itemId,
      details: {
        title: item.title,
        sourceType: item.sourceType,
        sourceTemplateId: item.sourceTemplateId,
        dayNumber: item.dayNumber,
        time: item.time,
        channel: item.channel,
      },
    });
  });
}

/* ───────────── Новые версии источников ───────────── */

async function currentSourceSnapshots(
  items: { id: string; sourceType: string; sourceTemplateId: string | null; audience: string }[]
): Promise<Map<string, { snapshot: SnapshotFields; version: string }>> {
  const out = new Map<string, { snapshot: SnapshotFields; version: string }>();
  const officialIds = items.filter((i) => i.sourceType === 'OFFICIAL' && i.sourceTemplateId);
  const userIds = items.filter((i) => i.sourceType === 'USER_TEMPLATE' && i.sourceTemplateId);
  if (officialIds.length > 0) {
    const officials = new Map((await loadOfficialTemplates()).map((t) => [t.id, t]));
    for (const it of officialIds) {
      const t = officials.get(it.sourceTemplateId!);
      if (t) out.set(it.id, { snapshot: snapshotFromOfficial(t), version: t.version });
    }
  }
  if (userIds.length > 0) {
    const tpls = await prisma.userTemplate.findMany({
      where: { id: { in: userIds.map((i) => i.sourceTemplateId!) } },
      select: { id: true, title: true, body: true, channel: true, intensiveDay: true, time: true, tags: true },
    });
    const byId = new Map(tpls.map((t) => [t.id, t]));
    for (const it of userIds) {
      const t = byId.get(it.sourceTemplateId!);
      if (!t) continue; // шаблон удалён — план не меняется
      const snap: SnapshotFields = {
        title: fallbackTitle(t.title, t.body),
        body: t.body,
        channel: t.channel,
        dayNumber: t.intensiveDay && t.intensiveDay >= 1 ? t.intensiveDay : null,
        time: isValidHm(t.time) ? t.time : null,
        audience: it.audience as PlanItemAudience,
        categories: normalizeCategories(t.tags),
      };
      out.set(it.id, { snapshot: snap, version: computeSourceVersion(snap) });
    }
  }
  return out;
}

export async function listPlanUpdates(intensiveId: string): Promise<PlanUpdateEntry[]> {
  const items = await prisma.intensivePlanItem.findMany({
    where: { intensiveId, sourceType: { in: ['OFFICIAL', 'USER_TEMPLATE'] }, sourceTemplateId: { not: null } },
    orderBy: { position: 'asc' },
  });
  const current = await currentSourceSnapshots(items);
  const candidates = items.filter((i) => {
    const c = current.get(i.id);
    return c && c.version !== i.sourceVersion;
  });
  const linked = await itemsEverLinked(prisma, candidates.map((i) => i.id));
  return candidates.map((i) => {
    const c = current.get(i.id)!;
    return {
      planItemId: i.id,
      sourceTemplateId: i.sourceTemplateId!,
      sourceScope: (i.sourceScope as 'ADM' | 'SUP' | null) ?? null,
      currentVersion: c.version,
      snapshotVersion: i.sourceVersion,
      applicable: !linked.has(i.id),
      diff: diffSnapshot(snapshotOfItem(i), c.snapshot),
    };
  });
}

export async function applyPlanUpdate(user: CurrentUser, intensive: { id: string; status: string }, itemId: string) {
  assertPlanEditable(intensive);
  const item = await loadItem(prisma, intensive.id, itemId);
  if (item.sourceType === 'CUSTOM' || !item.sourceTemplateId) {
    throw new ApiError(409, 'NO_UPDATE_AVAILABLE', 'У пункта нет источника-шаблона');
  }
  const current = (await currentSourceSnapshots([item])).get(item.id);
  if (!current || current.version === item.sourceVersion) {
    throw new ApiError(409, 'NO_UPDATE_AVAILABLE', 'Новой версии шаблона нет');
  }
  return prisma.$transaction(async (tx) => {
    await lockPlanItem(tx, itemId, 'UPDATE');
    const linked = await itemsEverLinked(tx, [itemId]);
    if (linked.has(itemId)) {
      throw new ApiError(409, 'PLAN_ITEM_HAS_MESSAGES', 'У пункта есть отправки — новую версию применить нельзя');
    }
    const fresh = await loadItem(tx, intensive.id, itemId);
    const diff = diffSnapshot(snapshotOfItem(fresh), current.snapshot);
    const updated = await tx.intensivePlanItem.update({
      where: { id: itemId },
      data: { ...current.snapshot, sourceVersion: current.version, updatedById: user.id },
    });
    await appendEvent(tx, {
      intensiveId: intensive.id,
      type: 'PLAN_ITEM_SOURCE_UPDATED',
      actorId: user.id,
      planItemId: itemId,
      details: { fromVersion: fresh.sourceVersion, toVersion: current.version, fields: diff.map((d) => d.field) },
    });
    return updated;
  });
}
