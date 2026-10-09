/**
 * Формирование плана анонсов (снимки шаблонов) и обнаружение новых версий источников.
 *
 *  - Снимок фиксирует название, текст, канал, день, время, аудиторию, категории и версию источника.
 *    Изменение/удаление исходного шаблона не меняет план и тексты созданных сообщений.
 *  - Официальные шаблоны — эффективный список lib/templates/official-templates (встроенные + переопределения +
 *    созданные Lead_SUP, без удалённых) — как в GET /api/templates. Созданные работают так же, как встроенные
 *    (sourceType OFFICIAL, sourceTemplateId 'c_<cuid>', sourceScope — набор шаблона).
 *  - Версия источника — хеш содержимого (не updatedAt): одинаковый текст = одна версия.
 *  - «Применить новую версию» — только для пунктов без когда-либо связанных отправок.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { getEffectiveOfficialTemplates } from '@/lib/templates/official-templates';
import type { EffectiveOfficialTemplate } from '@/lib/templates/types';
import {
  MAX_TITLE_LENGTH,
  computeSourceVersion,
  fallbackTitle,
  snapshotFromOfficial,
  type SnapshotFields,
} from '@/lib/templates/version';
import { ApiError } from './http';
import { appendEvent } from './events';
import type { OfficialTemplateOption, PlanItemAudience, PlanUpdateDiffField } from './types';

export { MAX_TITLE_LENGTH, computeSourceVersion, fallbackTitle, snapshotFromOfficial, type SnapshotFields };

type Db = Prisma.TransactionClient | typeof prisma;

export const MAX_BODY_LENGTH = 20_000;
export const MAX_CHANNEL_LENGTH = 200;

/** Эффективный официальный шаблон (встроенный с переопределением или созданный Lead_SUP). */
export type OfficialTemplateResolved = EffectiveOfficialTemplate;

/**
 * Официальные шаблоны для плана: встроенные + переопределения + созданные Lead_SUP, БЕЗ удалённых
 * (lib/templates/official-templates.ts — единый источник). Удалённый шаблон не попадает в новый план
 * и не даёт «новой версии» существующим пунктам; их снимки не меняются.
 */
export async function loadOfficialTemplates(db: Db = prisma): Promise<OfficialTemplateResolved[]> {
  return getEffectiveOfficialTemplates({ db });
}

/** Набор официальных шаблонов, доступный роли (как GET /api/templates: ADM — только ADM). */
export function officialTemplatesForRole(list: OfficialTemplateResolved[], role: string): OfficialTemplateResolved[] {
  if (role === 'LEAD_SUP' || role === 'SUP') return list;
  if (role === 'ADM') return list.filter((t) => t.scope === 'ADM');
  return [];
}

export function toTemplateOption(t: OfficialTemplateResolved, inPlan?: boolean): OfficialTemplateOption {
  return {
    id: t.id,
    scope: t.scope,
    title: t.title,
    channel: t.channel,
    intensiveDay: t.intensiveDay,
    time: t.time,
    audience: t.audience,
    version: t.version,
    source: t.source,
    isModified: t.isModified,
    dayLabel: t.dayLabel,
    timeNote: t.timeNote,
    ...(inPlan !== undefined ? { inPlan } : {}),
  };
}

export function snapshotOfItem(item: {
  title: string;
  body: string;
  channel: string;
  dayNumber: number | null;
  time: string | null;
  audience: string;
  categories: string[];
}): SnapshotFields {
  return {
    title: item.title,
    body: item.body,
    channel: item.channel,
    dayNumber: item.dayNumber,
    time: item.time,
    audience: item.audience as PlanItemAudience,
    categories: item.categories,
  };
}

export function diffSnapshot(from: SnapshotFields, to: SnapshotFields): PlanUpdateDiffField[] {
  const out: PlanUpdateDiffField[] = [];
  const fields: PlanUpdateDiffField['field'][] = ['title', 'body', 'channel', 'dayNumber', 'time', 'audience'];
  for (const f of fields) {
    if (from[f] !== to[f]) out.push({ field: f, from: from[f], to: to[f] });
  }
  const a = [...from.categories].sort().join(',');
  const b = [...to.categories].sort().join(',');
  if (a !== b) out.push({ field: 'categories', from: from.categories, to: to.categories });
  return out;
}

/** Пункты, к которым когда-либо привязывались отправки (сейчас или в истории). */
export async function itemsEverLinked(db: Db, itemIds: string[]): Promise<Set<string>> {
  if (itemIds.length === 0) return new Set();
  const [msgs, events] = await Promise.all([
    db.scheduledMessage.groupBy({
      by: ['planItemId'],
      where: { planItemId: { in: itemIds } },
      _count: { _all: true },
    }),
    db.intensiveEvent.groupBy({
      by: ['planItemId'],
      where: {
        planItemId: { in: itemIds },
        type: { in: ['MESSAGE_SCHEDULED', 'MESSAGE_REPEAT_SCHEDULED', 'MESSAGE_LINKED'] },
      },
      _count: { _all: true },
    }),
  ]);
  const set = new Set<string>();
  for (const r of msgs) if (r.planItemId) set.add(r.planItemId);
  for (const r of events) if (r.planItemId) set.add(r.planItemId);
  return set;
}

/**
 * Добавить в план выбранные официальные шаблоны. Идемпотентно: шаблон, уже присутствующий в плане, пропускается
 * (уникальность (intensiveId, sourceType, sourceTemplateId)).
 */
export async function generatePlanFromOfficial(
  tx: Prisma.TransactionClient,
  params: { intensiveId: string; templateIds: string[]; actorId: string }
): Promise<{ created: string[]; alreadyInPlan: string[] }> {
  const all = await loadOfficialTemplates(tx);
  const byId = new Map(all.map((t) => [t.id, t]));
  const ids = Array.from(new Set(params.templateIds.map((s) => s.trim())));
  const unknown = ids.filter((id) => !byId.has(id));
  if (unknown.length > 0) {
    throw new ApiError(400, 'UNKNOWN_TEMPLATE', 'Неизвестные шаблоны', { unknownTemplateIds: unknown });
  }
  const existing = await tx.intensivePlanItem.findMany({
    where: { intensiveId: params.intensiveId, sourceType: 'OFFICIAL', sourceTemplateId: { in: ids } },
    select: { sourceTemplateId: true },
  });
  const existingSet = new Set(existing.map((e) => e.sourceTemplateId));
  const toCreate = ids
    .filter((id) => !existingSet.has(id))
    .map((id) => byId.get(id)!)
    .sort((a, b) => a.intensiveDay - b.intensiveDay || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));

  const maxPos = await tx.intensivePlanItem.aggregate({
    where: { intensiveId: params.intensiveId },
    _max: { position: true },
  });
  let pos = (maxPos._max.position ?? -1) + 1;

  if (toCreate.length > 0) {
    await tx.intensivePlanItem.createMany({
      data: toCreate.map((t) => {
        const snap = snapshotFromOfficial(t);
        return {
          intensiveId: params.intensiveId,
          position: pos++,
          sourceType: 'OFFICIAL' as const,
          sourceTemplateId: t.id,
          sourceScope: t.scope,
          sourceVersion: t.version,
          ...snap,
          createdById: params.actorId,
          updatedById: params.actorId,
        };
      }),
      skipDuplicates: true,
    });
    await appendEvent(tx, {
      intensiveId: params.intensiveId,
      type: 'PLAN_GENERATED',
      actorId: params.actorId,
      details: { templateIds: toCreate.map((t) => t.id), alreadyInPlan: Array.from(existingSet) },
    });
  }
  return { created: toCreate.map((t) => t.id), alreadyInPlan: ids.filter((id) => existingSet.has(id)) };
}
