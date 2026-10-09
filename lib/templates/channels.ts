/**
 * Словарь каналов для шаблонов (TemplateChannel). Источник списка для всех селекторов каналов.
 *  - Имя нормализуется: без '#', пробелы → '_', нижний регистр; допустимы буквы (в т.ч. кириллица), цифры, . _ -
 *    (то же правило, что GET /api/workspace/[id]/channels/check), длина 1..80.
 *  - Создание идемпотентно: существующее имя возвращается как есть (created: false).
 *  - Удаление — только неиспользуемого канала (иначе 409 CHANNEL_IN_USE с количеством использований).
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { TemplatesApiError, prismaCode } from './http';
import { getEffectiveOfficialTemplates } from './official-templates';
import {
  TEMPLATE_LIMITS,
  channelNameError,
  normalizeChannelName,
  type TemplateChannelDto,
  type TemplateChannelUsage,
} from './types';

type Db = Prisma.TransactionClient | typeof prisma;

export { normalizeChannelName, channelNameError };

const CHANNEL_SELECT = { id: true, name: true, label: true, createdAt: true } as const;

function toDto(r: { id: string; name: string; label: string | null; createdAt: Date }): TemplateChannelDto {
  return { id: r.id, name: r.name, label: r.label, createdAt: r.createdAt.toISOString() };
}

/** Нормализованное корректное имя или ApiError 400 с fieldErrors[field]. */
export function validateChannelName(raw: unknown, field = 'name'): string {
  if (typeof raw !== 'string') {
    throw new TemplatesApiError(400, 'VALIDATION_ERROR', 'Укажите название канала', { fieldErrors: { [field]: 'Укажите название канала' } });
  }
  const err = channelNameError(raw);
  if (err) throw new TemplatesApiError(400, 'VALIDATION_ERROR', err, { fieldErrors: { [field]: err } });
  return normalizeChannelName(raw);
}

export async function listTemplateChannels(db: Db = prisma): Promise<TemplateChannelDto[]> {
  const rows = await db.templateChannel.findMany({ select: CHANNEL_SELECT, orderBy: { name: 'asc' } });
  return rows.map(toDto);
}

export async function findTemplateChannel(name: string, db: Db = prisma): Promise<TemplateChannelDto | null> {
  const r = await db.templateChannel.findUnique({ where: { name: normalizeChannelName(name) }, select: CHANNEL_SELECT });
  return r ? toDto(r) : null;
}

/** Создать канал (идемпотентно). name уже может быть ненормализованным — нормализуется здесь. */
export async function createTemplateChannel(
  input: { name: string; label?: string | null },
  actorId: string | null,
  db: Db = prisma
): Promise<{ channel: TemplateChannelDto; created: boolean }> {
  const name = validateChannelName(input.name);
  const label = typeof input.label === 'string' && input.label.trim() ? input.label.trim().slice(0, TEMPLATE_LIMITS.channelLabel) : null;
  const existing = await db.templateChannel.findUnique({ where: { name }, select: CHANNEL_SELECT });
  if (existing) return { channel: toDto(existing), created: false };
  try {
    const row = await db.templateChannel.create({ data: { name, label, createdById: actorId }, select: CHANNEL_SELECT });
    return { channel: toDto(row), created: true };
  } catch (e) {
    // Гонка двух одновременных созданий: второй получает существующую запись
    if (prismaCode(e) === 'P2002') {
      const row = await db.templateChannel.findUnique({ where: { name }, select: CHANNEL_SELECT });
      if (row) return { channel: toDto(row), created: false };
    }
    throw e;
  }
}

/**
 * Канал для шаблона: нормализованное имя, которое есть в словаре.
 * Нет в словаре: createIfMissing → создать; иначе 400 CHANNEL_NOT_IN_DICTIONARY (UI предлагает «Добавить канал»).
 */
export async function resolveTemplateChannel(
  raw: unknown,
  opts: { createIfMissing?: boolean; actorId: string | null; field?: string },
  db: Db = prisma
): Promise<{ name: string; createdChannel: TemplateChannelDto | null }> {
  const field = opts.field ?? 'channel';
  const name = validateChannelName(raw, field);
  const existing = await db.templateChannel.findUnique({ where: { name }, select: { id: true } });
  if (existing) return { name, createdChannel: null };
  if (!opts.createIfMissing) {
    throw new TemplatesApiError(400, 'CHANNEL_NOT_IN_DICTIONARY', `Канала #${name} нет в списке каналов`, {
      channel: name,
      fieldErrors: { [field]: 'Канала нет в списке — добавьте его' },
    });
  }
  const { channel, created } = await createTemplateChannel({ name }, opts.actorId, db);
  return { name, createdChannel: created ? channel : null };
}

/** Где используется канал (сравнение без учёта регистра). */
export async function templateChannelUsage(name: string, db: Db = prisma): Promise<TemplateChannelUsage> {
  const eq = { equals: name, mode: 'insensitive' as const };
  const [effective, overrides, customTemplates, userTemplates, planItems] = await Promise.all([
    getEffectiveOfficialTemplates({ db }),
    db.officialTemplateOverride.count({ where: { channel: eq } }),
    db.customOfficialTemplate.count({ where: { channel: eq } }),
    db.userTemplate.count({ where: { channel: eq } }),
    db.intensivePlanItem.count({ where: { channel: eq } }),
  ]);
  const officialTemplates = effective.filter((t) => normalizeChannelName(t.channel) === name).length;
  return { officialTemplates, overrides, customTemplates, userTemplates, planItems };
}

export function usageTotal(u: TemplateChannelUsage): number {
  return u.officialTemplates + u.overrides + u.customTemplates + u.userTemplates + u.planItems;
}

/** Удалить канал из словаря, если он нигде не используется. */
export async function deleteTemplateChannel(id: string, db: Db = prisma): Promise<{ name: string }> {
  const row = await db.templateChannel.findUnique({ where: { id }, select: { id: true, name: true } });
  if (!row) throw new TemplatesApiError(404, 'CHANNEL_NOT_FOUND', 'Канал не найден');
  const usage = await templateChannelUsage(row.name, db);
  if (usageTotal(usage) > 0) {
    throw new TemplatesApiError(409, 'CHANNEL_IN_USE', `Канал #${row.name} используется — удалить нельзя`, { usage });
  }
  await db.templateChannel.delete({ where: { id: row.id } });
  return { name: row.name };
}
