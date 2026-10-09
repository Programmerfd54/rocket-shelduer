/**
 * Изменение официальных шаблонов (только Lead_SUP — права проверяет роут):
 *  - встроенный шаблон: переопределение OfficialTemplateOverride (любое поле; null = по умолчанию),
 *    удаление = isDeleted (обратимо), восстановление, сброс к умолчанию;
 *  - созданный шаблон (CustomOfficialTemplate): создание, изменение, удаление строки.
 * Снимки в планах интенсивов не меняются (Lead_SUP видит «Доступна новая версия» по хешу содержимого).
 * Каждое изменение пишет ActivityLog (ADMIN_ACTION) без текстов шаблонов.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';
import { TemplatesApiError } from './http';
import { normalizeChannelName, resolveTemplateChannel } from './channels';
import {
  builtinScopesOf,
  customRowId,
  findBuiltinTemplate,
  fromCustomRow,
  getEffectiveOfficialTemplate,
  overrideHasContent,
  CUSTOM_SELECT,
  OVERRIDE_CONTENT_FIELDS,
  OVERRIDE_SELECT,
} from './official-templates';
import type { CreateOfficialTemplateParsed, UpdateOfficialTemplateParsed } from './schemas';
import type { EffectiveOfficialTemplate, TemplateChannelDto, TemplateScope } from './types';

type Tx = Prisma.TransactionClient;

export interface TemplateMutationResult {
  template: EffectiveOfficialTemplate;
  /** Канал, добавленный в словарь по ходу операции (createChannelIfMissing) */
  createdChannel: TemplateChannelDto | null;
}

export async function logTemplateAction(userId: string, details: Record<string, unknown>): Promise<void> {
  try {
    await prisma.activityLog.create({
      data: {
        userId,
        action: 'ADMIN_ACTION',
        entityType: String(details.entityType ?? 'official_template'),
        entityId: String(details.templateId ?? details.channelId ?? ''),
        details: JSON.stringify(details),
      },
    });
  } catch (e) {
    console.error('[templates] activity log failed:', e);
  }
}

function notFound(): TemplatesApiError {
  return new TemplatesApiError(404, 'TEMPLATE_NOT_FOUND', 'Шаблон не найден');
}

/**
 * Область встроенного шаблона: явная (тело/query) или единственная, где есть такой id.
 * Неизвестный id → 404.
 */
export function resolveBuiltinScope(id: string, scope: TemplateScope | null | undefined): TemplateScope {
  const scopes = builtinScopesOf(id);
  if (scope) {
    if (!scopes.includes(scope)) throw notFound();
    return scope;
  }
  if (scopes.length === 1) return scopes[0];
  if (scopes.length === 0) throw notFound();
  throw new TemplatesApiError(400, 'VALIDATION_ERROR', 'Укажите scope: SUP или ADM', { fieldErrors: { scope: 'Укажите SUP или ADM' } });
}

export function parseScopeParam(raw: unknown): TemplateScope | null {
  if (raw == null || raw === '') return null;
  if (raw === 'SUP' || raw === 'ADM') return raw;
  throw new TemplatesApiError(400, 'VALIDATION_ERROR', 'scope должен быть SUP или ADM', { fieldErrors: { scope: 'SUP или ADM' } });
}

/* ───────────── Создание ───────────── */

export async function createCustomTemplate(actorId: string, input: CreateOfficialTemplateParsed): Promise<TemplateMutationResult> {
  const result = await prisma.$transaction(async (tx) => {
    const { name, createdChannel } = await resolveTemplateChannel(
      input.channel,
      { createIfMissing: input.createChannelIfMissing, actorId },
      tx
    );
    let position = input.position;
    if (position === undefined) {
      const max = await tx.customOfficialTemplate.aggregate({
        where: { scope: input.scope, intensiveDay: input.intensiveDay },
        _max: { position: true },
      });
      position = (max._max.position ?? -1) + 1;
    }
    const row = await tx.customOfficialTemplate.create({
      data: {
        scope: input.scope,
        title: input.title,
        body: input.body,
        channel: name,
        intensiveDay: input.intensiveDay,
        time: input.time,
        audience: input.audience,
        dayLabel: input.dayLabel || null,
        timeNote: input.timeNote || null,
        position,
        createdById: actorId,
        updatedById: actorId,
      },
      select: CUSTOM_SELECT,
    });
    return { template: fromCustomRow(row), createdChannel };
  });
  await logTemplateAction(actorId, {
    action: 'official_template_created',
    templateId: result.template.id,
    scope: result.template.scope,
    title: result.template.title,
    ...(result.createdChannel ? { createdChannel: result.createdChannel.name } : {}),
  });
  return result;
}

/* ───────────── Изменение ───────────── */

function changedFieldsOf(input: UpdateOfficialTemplateParsed): string[] {
  return (['title', 'body', 'channel', 'intensiveDay', 'time', 'audience', 'dayLabel', 'timeNote', 'position', 'scope'] as const).filter(
    (f) => input[f] !== undefined
  );
}

async function updateCustom(
  tx: Tx,
  actorId: string,
  rowId: string,
  input: UpdateOfficialTemplateParsed
): Promise<TemplateMutationResult> {
  const row = await tx.customOfficialTemplate.findUnique({ where: { id: rowId }, select: CUSTOM_SELECT });
  if (!row) throw notFound();

  const fieldErrors: Record<string, string> = {};
  for (const f of ['title', 'body', 'channel', 'intensiveDay', 'time'] as const) {
    if (input[f] === null) fieldErrors[f] = 'Поле обязательно для созданного шаблона';
  }
  if (Object.keys(fieldErrors).length > 0) {
    throw new TemplatesApiError(400, 'VALIDATION_ERROR', Object.values(fieldErrors)[0], { fieldErrors });
  }

  const data: Prisma.CustomOfficialTemplateUpdateInput = { updatedBy: { connect: { id: actorId } } };
  let createdChannel: TemplateChannelDto | null = null;
  if (input.channel != null && normalizeChannelName(input.channel) !== row.channel) {
    const r = await resolveTemplateChannel(input.channel, { createIfMissing: input.createChannelIfMissing, actorId }, tx);
    data.channel = r.name;
    createdChannel = r.createdChannel;
  }
  if (input.title != null) data.title = input.title;
  if (input.body != null) data.body = input.body;
  if (input.intensiveDay != null) data.intensiveDay = input.intensiveDay;
  if (input.time != null) data.time = input.time;
  if (input.audience !== undefined) data.audience = input.audience ?? 'all';
  if (input.dayLabel !== undefined) data.dayLabel = input.dayLabel || null;
  if (input.timeNote !== undefined) data.timeNote = input.timeNote || null;
  if (input.position !== undefined) data.position = input.position;
  if (input.scope && input.scope !== row.scope) data.scope = input.scope;

  const updated = await tx.customOfficialTemplate.update({ where: { id: rowId }, data, select: CUSTOM_SELECT });
  return { template: fromCustomRow(updated), createdChannel };
}

async function updateBuiltin(
  tx: Tx,
  actorId: string,
  id: string,
  scope: TemplateScope,
  input: UpdateOfficialTemplateParsed
): Promise<TemplateMutationResult> {
  const t = findBuiltinTemplate(id, scope);
  if (!t) throw notFound();
  if (input.position !== undefined) {
    throw new TemplatesApiError(400, 'VALIDATION_ERROR', 'Порядок встроенных шаблонов не меняется', {
      fieldErrors: { position: 'Только для созданных шаблонов' },
    });
  }
  const existing = await tx.officialTemplateOverride.findFirst({
    where: { templateId: id, scope, ...GLOBAL_SCOPE },
    orderBy: { updatedAt: 'desc' },
    select: OVERRIDE_SELECT,
  });
  if (existing?.isDeleted) {
    throw new TemplatesApiError(409, 'TEMPLATE_DELETED', 'Шаблон удалён — сначала восстановите его');
  }

  // Новое значение переопределения: undefined — оставить, null — по умолчанию, совпадает с умолчанием — null.
  const next: Record<(typeof OVERRIDE_CONTENT_FIELDS)[number], string | number | null> = {
    body: existing?.body ?? null,
    title: existing?.title ?? null,
    channel: existing?.channel ?? null,
    time: existing?.time ?? null,
    intensiveDay: existing?.intensiveDay ?? null,
    dayLabel: existing?.dayLabel ?? null,
    audience: existing?.audience ?? null,
    timeNote: existing?.timeNote ?? null,
  };
  const set = (field: keyof typeof next, value: string | number | null | undefined, def: string | number | null) => {
    if (value === undefined) return;
    next[field] = value === null || value === def ? null : value;
  };
  set('title', input.title, t.title ?? null);
  set('body', input.body, t.body);
  set('time', input.time, t.time);
  set('intensiveDay', input.intensiveDay, t.intensiveDay);
  set('audience', input.audience, t.audience);
  // dayLabel/timeNote: '' — «явно пусто» (подпись по умолчанию «День N» / без подсказки)
  set('dayLabel', input.dayLabel, t.dayLabel);
  set('timeNote', input.timeNote, t.timeNote ?? null);

  let createdChannel: TemplateChannelDto | null = null;
  if (input.channel !== undefined) {
    const raw = input.channel === null ? null : input.channel.trim();
    const current = (existing?.channel ?? t.channel).trim();
    if (raw === null || raw === t.channel.trim() || normalizeChannelName(raw) === normalizeChannelName(t.channel)) {
      next.channel = null; // по умолчанию
    } else if (raw === current || normalizeChannelName(raw) === normalizeChannelName(current)) {
      // без изменений (в т.ч. «старые» имена вне словаря)
    } else {
      const r = await resolveTemplateChannel(raw, { createIfMissing: input.createChannelIfMissing, actorId }, tx);
      next.channel = r.name;
      createdChannel = r.createdChannel;
    }
  }

  const data = {
    body: next.body as string | null,
    title: next.title as string | null,
    channel: next.channel as string | null,
    time: next.time as string | null,
    intensiveDay: next.intensiveDay as number | null,
    dayLabel: next.dayLabel as string | null,
    audience: next.audience as string | null,
    timeNote: next.timeNote as string | null,
  };
  if (!overrideHasContent(data)) {
    // Всё совпадает с умолчанием — переопределение не нужно
    await tx.officialTemplateOverride.deleteMany({ where: { templateId: id, scope, ...GLOBAL_SCOPE } });
  } else if (existing) {
    await tx.officialTemplateOverride.update({ where: { id: existing.id }, data: { ...data, updatedById: actorId } });
  } else {
    // Составной unique с NULL (cityId) не поддерживает upsert — ищем глобальную строку и обновляем/создаём.
    await tx.officialTemplateOverride.create({ data: { templateId: id, scope, ...data, updatedById: actorId } });
  }
  const template = await getEffectiveOfficialTemplate(id, scope, tx);
  if (!template) throw notFound();
  return { template, createdChannel };
}

export async function updateOfficialTemplate(
  actorId: string,
  id: string,
  scopeParam: TemplateScope | null,
  input: UpdateOfficialTemplateParsed
): Promise<TemplateMutationResult> {
  const rowId = customRowId(id);
  const result = await prisma.$transaction(async (tx) => {
    if (rowId) return updateCustom(tx, actorId, rowId, input);
    const scope = resolveBuiltinScope(id, input.scope ?? scopeParam);
    return updateBuiltin(tx, actorId, id, scope, input);
  });
  await logTemplateAction(actorId, {
    action: 'official_template_updated',
    templateId: id,
    scope: result.template.scope,
    source: result.template.source,
    fields: changedFieldsOf(input),
    ...(result.createdChannel ? { createdChannel: result.createdChannel.name } : {}),
  });
  return result;
}

/* ───────────── Удаление / восстановление / сброс ───────────── */

export async function deleteOfficialTemplate(
  actorId: string,
  id: string,
  scopeParam: TemplateScope | null
): Promise<{ id: string; scope: TemplateScope; source: 'builtin' | 'custom'; restorable: boolean }> {
  const rowId = customRowId(id);
  if (rowId) {
    const row = await prisma.customOfficialTemplate.findUnique({ where: { id: rowId }, select: { id: true, scope: true, title: true } });
    if (!row || (scopeParam && row.scope !== scopeParam)) throw notFound();
    await prisma.customOfficialTemplate.delete({ where: { id: rowId } });
    await logTemplateAction(actorId, { action: 'official_template_deleted', templateId: id, scope: row.scope, source: 'custom', title: row.title });
    return { id, scope: row.scope as TemplateScope, source: 'custom', restorable: false };
  }
  const scope = resolveBuiltinScope(id, scopeParam);
  await prisma.$transaction(async (tx) => {
    const existing = await tx.officialTemplateOverride.findFirst({
      where: { templateId: id, scope, ...GLOBAL_SCOPE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, isDeleted: true },
    });
    if (existing) {
      if (!existing.isDeleted) {
        await tx.officialTemplateOverride.update({ where: { id: existing.id }, data: { isDeleted: true, updatedById: actorId } });
      }
    } else {
      await tx.officialTemplateOverride.create({ data: { templateId: id, scope, isDeleted: true, updatedById: actorId } });
    }
  });
  await logTemplateAction(actorId, { action: 'official_template_deleted', templateId: id, scope, source: 'builtin' });
  return { id, scope, source: 'builtin', restorable: true };
}

export async function restoreBuiltinTemplate(actorId: string, id: string, scopeParam: TemplateScope | null): Promise<EffectiveOfficialTemplate> {
  if (customRowId(id)) {
    throw new TemplatesApiError(400, 'BAD_REQUEST', 'Созданные шаблоны удаляются безвозвратно — восстановить нельзя');
  }
  const scope = resolveBuiltinScope(id, scopeParam);
  const template = await prisma.$transaction(async (tx) => {
    const rows = await tx.officialTemplateOverride.findMany({
      where: { templateId: id, scope, ...GLOBAL_SCOPE },
      orderBy: { updatedAt: 'desc' },
      select: OVERRIDE_SELECT,
    });
    const latest = rows[0];
    if (!latest?.isDeleted) throw new TemplatesApiError(409, 'TEMPLATE_NOT_DELETED', 'Шаблон не удалён');
    if (overrideHasContent(latest)) {
      await tx.officialTemplateOverride.update({ where: { id: latest.id }, data: { isDeleted: false, updatedById: actorId } });
    } else {
      await tx.officialTemplateOverride.deleteMany({ where: { templateId: id, scope, ...GLOBAL_SCOPE } });
    }
    return getEffectiveOfficialTemplate(id, scope, tx);
  });
  if (!template) throw notFound();
  await logTemplateAction(actorId, { action: 'official_template_restored', templateId: id, scope });
  return template;
}

/** Сбросить встроенный шаблон к умолчанию (удалённый остаётся удалённым). */
export async function resetBuiltinTemplate(actorId: string, id: string, scopeParam: TemplateScope | null): Promise<EffectiveOfficialTemplate> {
  if (customRowId(id)) {
    throw new TemplatesApiError(400, 'BAD_REQUEST', 'Сброс к умолчанию доступен только для встроенных шаблонов');
  }
  const scope = resolveBuiltinScope(id, scopeParam);
  const template = await prisma.$transaction(async (tx) => {
    const latest = await tx.officialTemplateOverride.findFirst({
      where: { templateId: id, scope, ...GLOBAL_SCOPE },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, isDeleted: true },
    });
    await tx.officialTemplateOverride.deleteMany({
      where: { templateId: id, scope, ...GLOBAL_SCOPE, ...(latest?.isDeleted ? { id: { not: latest.id } } : {}) },
    });
    if (latest?.isDeleted) {
      await tx.officialTemplateOverride.update({
        where: { id: latest.id },
        data: {
          body: null,
          title: null,
          channel: null,
          time: null,
          intensiveDay: null,
          dayLabel: null,
          audience: null,
          timeNote: null,
          updatedById: actorId,
        },
      });
    }
    return getEffectiveOfficialTemplate(id, scope, tx);
  });
  if (!template) throw notFound();
  await logTemplateAction(actorId, { action: 'official_template_reset', templateId: id, scope });
  return template;
}
