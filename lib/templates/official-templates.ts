/**
 * ЕДИНСТВЕННЫЙ источник эффективного списка официальных шаблонов (docs/templates-api.md):
 *   статичные lib/templates-data (ADM_TEMPLATES, SUP_TEMPLATES)
 *   + глобальные переопределения OfficialTemplateOverride (любое поле; isDeleted — шаблон скрыт)
 *   + шаблоны, созданные Lead_SUP (CustomOfficialTemplate, id в API — 'c_<cuid>').
 *
 * Потребители: GET /api/templates, /api/templates/official*, GET /api/workspace (следующий анонс),
 * lib/intensives/plan.ts (формирование плана, версии источников), lib/intensives/progress.ts.
 * Удалённые шаблоны не попадают никуда, кроме списка Lead_SUP с includeDeleted (для восстановления);
 * снимки в планах интенсивов не меняются.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { ADM_TEMPLATES, SUP_TEMPLATES, type AnnouncementTemplate, type SupAnnouncementTemplate } from '@/lib/templates-data';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';
import { computeSourceVersion, fallbackTitle, snapshotFromOfficial } from './version';
import {
  CUSTOM_TEMPLATE_ID_PREFIX,
  defaultDayLabel,
  isCustomTemplateId,
  type EffectiveOfficialTemplate,
  type OfficialTemplateDefaults,
  type TemplateAudience,
  type TemplateScope,
} from './types';

type Db = Prisma.TransactionClient | typeof prisma;
type StaticTemplate = AnnouncementTemplate | SupAnnouncementTemplate;

export const STATIC_TEMPLATES: Record<TemplateScope, readonly StaticTemplate[]> = {
  ADM: ADM_TEMPLATES,
  SUP: SUP_TEMPLATES,
};

const STATIC_INDEX: Record<TemplateScope, Map<string, { t: StaticTemplate; index: number }>> = {
  ADM: new Map(ADM_TEMPLATES.map((t, index) => [t.id, { t, index }])),
  SUP: new Map(SUP_TEMPLATES.map((t, index) => [t.id, { t, index }])),
};

export function findBuiltinTemplate(id: string, scope: TemplateScope): StaticTemplate | null {
  return STATIC_INDEX[scope].get(id)?.t ?? null;
}

/** Области, в которых есть встроенный шаблон с таким id (id в наборах не пересекаются, но API требует scope). */
export function builtinScopesOf(id: string): TemplateScope[] {
  return (['ADM', 'SUP'] as const).filter((s) => STATIC_INDEX[s].has(id));
}

export function builtinDefaults(t: StaticTemplate): OfficialTemplateDefaults {
  return {
    title: fallbackTitle(t.title, t.body),
    body: t.body,
    channel: t.channel.trim(),
    intensiveDay: t.intensiveDay,
    dayLabel: t.dayLabel,
    time: t.time,
    audience: t.audience,
    timeNote: t.timeNote ?? null,
  };
}

export const OVERRIDE_SELECT = {
  id: true,
  templateId: true,
  scope: true,
  body: true,
  title: true,
  channel: true,
  time: true,
  intensiveDay: true,
  dayLabel: true,
  audience: true,
  timeNote: true,
  isDeleted: true,
  updatedAt: true,
} as const;

export type OverrideRow = Prisma.OfficialTemplateOverrideGetPayload<{ select: typeof OVERRIDE_SELECT }>;

/** Поля переопределения, означающие «шаблон изменён». */
export const OVERRIDE_CONTENT_FIELDS = ['body', 'title', 'channel', 'time', 'intensiveDay', 'dayLabel', 'audience', 'timeNote'] as const;

export function overrideHasContent(ov: Pick<OverrideRow, (typeof OVERRIDE_CONTENT_FIELDS)[number]>): boolean {
  return OVERRIDE_CONTENT_FIELDS.some((f) => ov[f] !== null && ov[f] !== undefined);
}

function asAudience(v: string | null | undefined, fallback: TemplateAudience): TemplateAudience {
  return v === 'all' || v === 'mk' ? v : fallback;
}

/** Встроенный шаблон + переопределение → эффективный. */
export function mergeBuiltin(
  t: StaticTemplate,
  scope: TemplateScope,
  index: number,
  ov: OverrideRow | undefined
): EffectiveOfficialTemplate {
  const body = ov?.body ?? t.body;
  const intensiveDay = ov?.intensiveDay ?? t.intensiveDay;
  // '' в dayLabel/timeNote переопределения = «явно пусто»
  const dayLabel =
    ov?.dayLabel != null
      ? ov.dayLabel || defaultDayLabel(intensiveDay)
      : intensiveDay !== t.intensiveDay
        ? defaultDayLabel(intensiveDay)
        : t.dayLabel;
  const timeNote = ov?.timeNote != null ? ov.timeNote || null : (t.timeNote ?? null);
  const base = {
    id: t.id,
    scope,
    title: fallbackTitle(ov?.title ?? t.title, body),
    body,
    channel: (ov?.channel ?? t.channel).trim(),
    intensiveDay,
    time: ov?.time ?? t.time,
    audience: asAudience(ov?.audience, t.audience),
  };
  return {
    ...base,
    source: 'builtin',
    isDeleted: !!ov?.isDeleted,
    isModified: !!ov && overrideHasContent(ov),
    dayLabel,
    timeNote,
    version: computeSourceVersion(snapshotFromOfficial(base)),
    position: index,
    updatedAt: ov?.updatedAt ? ov.updatedAt.toISOString() : null,
  };
}

export const CUSTOM_SELECT = {
  id: true,
  scope: true,
  title: true,
  body: true,
  channel: true,
  intensiveDay: true,
  dayLabel: true,
  time: true,
  audience: true,
  timeNote: true,
  position: true,
  createdAt: true,
  updatedAt: true,
} as const;

export type CustomRow = Prisma.CustomOfficialTemplateGetPayload<{ select: typeof CUSTOM_SELECT }>;

export function customApiId(rowId: string): string {
  return `${CUSTOM_TEMPLATE_ID_PREFIX}${rowId}`;
}

/** 'c_<cuid>' → cuid; null, если id не похож на id созданного шаблона. */
export function customRowId(apiId: string): string | null {
  if (!isCustomTemplateId(apiId)) return null;
  const rest = apiId.slice(CUSTOM_TEMPLATE_ID_PREFIX.length);
  return /^[A-Za-z0-9_-]{1,60}$/.test(rest) ? rest : null;
}

export function fromCustomRow(r: CustomRow): EffectiveOfficialTemplate {
  const scope: TemplateScope = r.scope === 'ADM' ? 'ADM' : 'SUP';
  const base = {
    id: customApiId(r.id),
    scope,
    title: fallbackTitle(r.title, r.body),
    body: r.body,
    channel: r.channel.trim(),
    intensiveDay: r.intensiveDay,
    time: r.time,
    audience: asAudience(r.audience, 'all'),
  };
  return {
    ...base,
    source: 'custom',
    isDeleted: false,
    isModified: false,
    dayLabel: r.dayLabel || defaultDayLabel(r.intensiveDay),
    timeNote: r.timeNote || null,
    version: computeSourceVersion(snapshotFromOfficial(base)),
    position: r.position,
    updatedAt: r.updatedAt.toISOString(),
  };
}

function sortTemplates(list: EffectiveOfficialTemplate[], createdAt: Map<string, number>): EffectiveOfficialTemplate[] {
  // Стабильная сортировка: день → время → встроенные раньше созданных → позиция → дата создания.
  // Статичные наборы уже упорядочены по дню/времени, поэтому их порядок не меняется.
  return list
    .map((t, i) => ({ t, i }))
    .sort(
      (a, b) =>
        a.t.intensiveDay - b.t.intensiveDay ||
        a.t.time.localeCompare(b.t.time) ||
        (a.t.source === b.t.source ? 0 : a.t.source === 'builtin' ? -1 : 1) ||
        a.t.position - b.t.position ||
        (createdAt.get(a.t.id) ?? 0) - (createdAt.get(b.t.id) ?? 0) ||
        a.i - b.i
    )
    .map((x) => x.t);
}

export interface EffectiveTemplatesOptions {
  /** Только один набор; по умолчанию оба (сначала ADM, затем SUP — как раньше в плане) */
  scope?: TemplateScope;
  /** Включить удалённые встроенные (только для Lead_SUP — экран восстановления) */
  includeDeleted?: boolean;
  db?: Db;
}

/**
 * Эффективные официальные шаблоны. Ошибка чтения переопределений/созданных (например, БД до миграции)
 * не ломает список: остаются статичные шаблоны — как раньше в GET /api/templates.
 */
export async function getEffectiveOfficialTemplates(opts: EffectiveTemplatesOptions = {}): Promise<EffectiveOfficialTemplate[]> {
  const db = opts.db ?? prisma;
  const scopes: TemplateScope[] = opts.scope ? [opts.scope] : ['ADM', 'SUP'];

  let overrides: OverrideRow[] = [];
  let customs: CustomRow[] = [];
  try {
    [overrides, customs] = await Promise.all([
      db.officialTemplateOverride.findMany({
        where: { ...GLOBAL_SCOPE, scope: { in: scopes } },
        orderBy: { updatedAt: 'desc' },
        select: OVERRIDE_SELECT,
      }),
      db.customOfficialTemplate.findMany({
        where: { scope: { in: scopes } },
        select: CUSTOM_SELECT,
      }),
    ]);
  } catch (e) {
    console.error('[templates] failed to load overrides/custom templates:', e);
    overrides = [];
    customs = [];
  }

  // Самое свежее переопределение на (scope, templateId)
  const ovByKey = new Map<string, OverrideRow>();
  for (const o of overrides) {
    const key = `${o.scope}:${o.templateId}`;
    if (!ovByKey.has(key)) ovByKey.set(key, o);
  }

  const out: EffectiveOfficialTemplate[] = [];
  for (const scope of scopes) {
    const createdAt = new Map<string, number>();
    const list: EffectiveOfficialTemplate[] = STATIC_TEMPLATES[scope].map((t, i) =>
      mergeBuiltin(t, scope, i, ovByKey.get(`${scope}:${t.id}`))
    );
    for (const r of customs) {
      if (r.scope !== scope) continue;
      const t = fromCustomRow(r);
      createdAt.set(t.id, r.createdAt.getTime());
      list.push(t);
    }
    out.push(...sortTemplates(opts.includeDeleted ? list : list.filter((t) => !t.isDeleted), createdAt));
  }
  return out;
}

/** Один эффективный шаблон (включая удалённый встроенный) или null. */
export async function getEffectiveOfficialTemplate(
  id: string,
  scope: TemplateScope | null,
  db: Db = prisma
): Promise<EffectiveOfficialTemplate | null> {
  const rowId = customRowId(id);
  if (rowId) {
    const r = await db.customOfficialTemplate.findUnique({ where: { id: rowId }, select: CUSTOM_SELECT });
    if (!r || (scope && r.scope !== scope)) return null;
    return fromCustomRow(r);
  }
  if (!scope) return null;
  const entry = STATIC_INDEX[scope].get(id);
  if (!entry) return null;
  const ov = await db.officialTemplateOverride.findFirst({
    where: { templateId: id, scope, ...GLOBAL_SCOPE },
    orderBy: { updatedAt: 'desc' },
    select: OVERRIDE_SELECT,
  });
  return mergeBuiltin(entry.t, scope, entry.index, ov ?? undefined);
}

/**
 * Наборы, доступные роли (правило прежнего GET /api/templates):
 * Lead_SUP и SUP — оба набора (SUP смотрит шаблоны ADM через фильтр), ADM — только ADM, остальные — ничего.
 */
export function templateScopesForRole(role: string): TemplateScope[] {
  if (role === 'LEAD_SUP' || role === 'SUP') return ['ADM', 'SUP'];
  if (role === 'ADM') return ['ADM'];
  return [];
}

export function filterTemplatesForRole<T extends { scope: TemplateScope }>(list: T[], role: string): T[] {
  const scopes = templateScopesForRole(role);
  return list.filter((t) => scopes.includes(t.scope));
}

/**
 * Формат прежнего GET /api/templates (AnnouncementTemplate) + аддитивные поля.
 * Старые клиенты читают id, intensiveDay, dayLabel, time, channel, audience, title, body, timeNote.
 */
export function toLegacyTemplate(t: EffectiveOfficialTemplate) {
  return {
    id: t.id,
    intensiveDay: t.intensiveDay,
    dayLabel: t.dayLabel,
    time: t.time,
    channel: t.channel,
    audience: t.audience,
    title: t.title,
    body: t.body,
    ...(t.timeNote ? { timeNote: t.timeNote } : {}),
    // аддитивно
    scope: t.scope,
    source: t.source,
    isModified: t.isModified,
    isDeleted: t.isDeleted,
    version: t.version,
  };
}
