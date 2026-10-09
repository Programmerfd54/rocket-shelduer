/**
 * Общие типы API официальных шаблонов и словаря каналов (docs/templates-api.md).
 * Файл используется и сервером, и клиентом: никаких импортов серверных модулей.
 */

export const TEMPLATE_SCOPES = ['SUP', 'ADM'] as const;
/** Набор официальных шаблонов: шаблоны SUP или шаблоны ADM. */
export type TemplateScope = (typeof TEMPLATE_SCOPES)[number];

export const TEMPLATE_AUDIENCES = ['all', 'mk'] as const;
/** all — всем кампусам, mk — только кампусам с МК. */
export type TemplateAudience = (typeof TEMPLATE_AUDIENCES)[number];

/** builtin — из lib/templates-data (может быть переопределён/удалён), custom — создан Lead_SUP. */
export type OfficialTemplateSource = 'builtin' | 'custom';

/** Префикс id шаблонов, созданных Lead_SUP: 'c_' + cuid. Id встроенных шаблонов не меняются (d1-09, sup-…). */
export const CUSTOM_TEMPLATE_ID_PREFIX = 'c_';

export const TEMPLATE_LIMITS = {
  title: 200,
  body: 20_000,
  dayLabel: 60,
  timeNote: 200,
  channel: 80,
  channelLabel: 80,
  minDay: 1,
  maxDay: 366,
} as const;

/** Эффективный официальный шаблон (статичный + переопределение | созданный Lead_SUP). */
export interface EffectiveOfficialTemplate {
  /** Встроенные — исходный id (d1-09); созданные — 'c_<cuid>' */
  id: string;
  scope: TemplateScope;
  source: OfficialTemplateSource;
  /** Встроенный шаблон удалён для этой области (виден только Lead_SUP с includeDeleted=1) */
  isDeleted: boolean;
  /** Встроенный шаблон изменён (есть переопределение хотя бы одного поля). Для custom — false */
  isModified: boolean;
  title: string;
  body: string;
  channel: string;
  intensiveDay: number;
  dayLabel: string;
  /** 'HH:mm' */
  time: string;
  audience: TemplateAudience;
  timeNote: string | null;
  /** Хеш содержимого (как sourceVersion пунктов плана): одинаковое содержимое = одна версия */
  version: string;
  /** Для custom — порядок внутри дня; для встроенных — индекс в lib/templates-data */
  position: number;
  /** Только custom: ISO; для встроенных — время последнего переопределения или null */
  updatedAt: string | null;
}

/** Значения встроенного шаблона по умолчанию (для «Сбросить к умолчанию» / подсветки изменённых полей). */
export interface OfficialTemplateDefaults {
  title: string;
  body: string;
  channel: string;
  intensiveDay: number;
  dayLabel: string;
  time: string;
  audience: TemplateAudience;
  timeNote: string | null;
}

/** Элемент GET /api/templates/official (Lead_SUP получает defaults у встроенных). */
export interface OfficialTemplateDto extends EffectiveOfficialTemplate {
  defaults?: OfficialTemplateDefaults;
}

/** Тело POST /api/templates/official. */
export interface CreateOfficialTemplateInput {
  scope: TemplateScope;
  title: string;
  body: string;
  channel: string;
  intensiveDay: number;
  time: string;
  audience?: TemplateAudience;
  dayLabel?: string | null;
  timeNote?: string | null;
  position?: number;
  /** Канала нет в словаре → создать его (иначе 400 CHANNEL_NOT_IN_DICTIONARY) */
  createChannelIfMissing?: boolean;
}

/**
 * Тело PATCH /api/templates/official/[templateId].
 * Встроенный: scope обязателен (какой набор правится); поле = null → значение по умолчанию; отсутствует → без изменений.
 * Созданный: scope необязателен — если указан и отличается, шаблон переносится в другую область.
 */
export interface UpdateOfficialTemplateInput {
  scope?: TemplateScope;
  title?: string | null;
  body?: string | null;
  channel?: string | null;
  intensiveDay?: number | null;
  time?: string | null;
  audience?: TemplateAudience | null;
  dayLabel?: string | null;
  timeNote?: string | null;
  position?: number;
  createChannelIfMissing?: boolean;
}

export interface TemplateChannelDto {
  id: string;
  /** Нормализованное имя без '#', в нижнем регистре */
  name: string;
  /** Подпись для селектора (необязательна); UI по умолчанию показывает '#' + name */
  label: string | null;
  createdAt: string;
}

export interface TemplateChannelUsage {
  /** Встроенные и созданные официальные шаблоны (не удалённые) */
  officialTemplates: number;
  /** Строки переопределений, где задан этот канал (включая удалённые шаблоны) */
  overrides: number;
  customTemplates: number;
  userTemplates: number;
  planItems: number;
}

/** Коды ошибок API шаблонов (поле code ответа). */
export type TemplatesErrorCode =
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'NOT_FOUND'
  | 'BAD_REQUEST'
  | 'VALIDATION_ERROR'
  | 'INTERNAL_ERROR'
  | 'TEMPLATE_NOT_FOUND'
  | 'TEMPLATE_DELETED'
  | 'TEMPLATE_NOT_DELETED'
  | 'CHANNEL_NOT_IN_DICTIONARY'
  | 'CHANNEL_IN_USE'
  | 'CHANNEL_NOT_FOUND';

/** Ответ об ошибке API шаблонов. */
export interface TemplatesErrorBody {
  error: string;
  code: TemplatesErrorCode;
  fieldErrors?: Record<string, string>;
  [extra: string]: unknown;
}

/** Нормализация имени канала (общая для клиента и сервера): без '#', пробелы → '_', нижний регистр. */
export function normalizeChannelName(raw: string): string {
  return raw.trim().replace(/^#+/, '').trim().replace(/\s+/g, '_').toLowerCase();
}

/** Допустимое имя канала: буквы (в т.ч. кириллица), цифры, точка, дефис, подчёркивание; 1..80. */
export const CHANNEL_NAME_RE = /^[\p{L}\p{N}._-]{1,80}$/u;

/** Текст ошибки для имени канала или null, если имя корректно (после normalizeChannelName). */
export function channelNameError(raw: string): string | null {
  const name = normalizeChannelName(raw);
  if (!name) return 'Укажите название канала';
  if (name.length > TEMPLATE_LIMITS.channel) return `Название канала — не длиннее ${TEMPLATE_LIMITS.channel} символов`;
  if (!CHANNEL_NAME_RE.test(name)) return 'Название канала может содержать только буквы, цифры, точку, дефис и подчёркивание';
  return null;
}

export function isCustomTemplateId(id: string): boolean {
  return id.startsWith(CUSTOM_TEMPLATE_ID_PREFIX);
}

/** Подпись дня по умолчанию для шаблонов без своей подписи. */
export function defaultDayLabel(day: number): string {
  return `День ${day}`;
}
