/** zod-схемы тел запросов API интенсивов. Сообщения об ошибках — по-русски (уходят в fieldErrors). */
import { z } from 'zod';
import { isUnsafeId, isValidOfficialTemplateId } from '@/lib/security';
import { MAX_INTENSIVE_DAYS, intensiveLengthDays, isValidHm, isValidTimeZone, isValidYmd } from './dates';
import { MAX_BODY_LENGTH, MAX_CHANNEL_LENGTH, MAX_TITLE_LENGTH } from './plan';

export const safeIdSchema = z
  .string({ error: 'Некорректный идентификатор' })
  .trim()
  .refine((v) => !isUnsafeId(v), 'Некорректный идентификатор');

const ymdSchema = z.string({ error: 'Укажите дату' }).trim().refine(isValidYmd, 'Дата в формате ГГГГ-ММ-ДД');
const timezoneSchema = z
  .string({ error: 'Укажите часовой пояс' })
  .trim()
  .refine(isValidTimeZone, 'Неизвестный часовой пояс (нужен IANA, например Europe/Moscow)');
const officialIdSchema = z.string().trim().refine(isValidOfficialTemplateId, 'Некорректный id шаблона');

const nameSchema = (label: string, max: number) =>
  z.string({ error: `Укажите ${label}` }).trim().min(1, `Укажите ${label}`).max(max, `Не длиннее ${max} символов`);

const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `Не длиннее ${max} символов`)
    .nullable()
    .optional()
    .transform((v) => (v ? v : v === undefined ? undefined : null));

function checkPeriod(
  v: { startDate?: string; endDate?: string },
  ctx: z.RefinementCtx
) {
  if (!v.startDate || !v.endDate) return;
  if (v.endDate < v.startDate) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: 'Дата окончания раньше даты начала' });
    return;
  }
  if (intensiveLengthDays(v.startDate, v.endDate) > MAX_INTENSIVE_DAYS) {
    ctx.addIssue({ code: 'custom', path: ['endDate'], message: `Интенсив не длиннее ${MAX_INTENSIVE_DAYS} дней` });
  }
}

/* ───────────── OrgSpace ───────────── */

export const createOrgSpaceSchema = z.object({
  name: nameSchema('название', 120),
  description: optionalText(2000),
});

export const updateOrgSpaceSchema = z.object({
  name: nameSchema('название', 120).optional(),
  description: optionalText(2000),
});

export const linkWorkspaceSchema = z.object({
  workspaceId: safeIdSchema,
  /** Перенести подключение из другого OrgSpace */
  move: z.boolean().optional(),
});

export const draftFromWorkspaceSchema = z.object({
  workspaceId: safeIdSchema,
  name: nameSchema('название', 200).optional(),
  timezone: timezoneSchema.optional(),
});

/* ───────────── Интенсив ───────────── */

export const createIntensiveSchema = z
  .object({
    /** Организационное пространство (старый способ) */
    orgSpaceId: safeIdSchema.optional(),
    /** Пространство (подключение): OrgSpace подбирается/создаётся автоматически */
    workspaceId: safeIdSchema.optional(),
    name: nameSchema('название', 200),
    description: optionalText(5000),
    startDate: ymdSchema,
    endDate: ymdSchema,
    timezone: timezoneSchema.default('Europe/Moscow'),
    templateIds: z.array(officialIdSchema).max(500).optional(),
  })
  .superRefine((v, ctx) => {
    if (!v.orgSpaceId && !v.workspaceId) {
      ctx.addIssue({ code: 'custom', path: ['workspaceId'], message: 'Выберите пространство' });
    } else if (v.orgSpaceId && v.workspaceId) {
      ctx.addIssue({ code: 'custom', path: ['workspaceId'], message: 'Укажите либо пространство, либо организационное пространство' });
    }
    checkPeriod(v, ctx);
  });

export const updateIntensiveSchema = z
  .object({
    version: z.number({ error: 'Нужна версия (version)' }).int().positive(),
    name: nameSchema('название', 200).optional(),
    description: optionalText(5000),
    startDate: ymdSchema.optional(),
    endDate: ymdSchema.optional(),
    timezone: timezoneSchema.optional(),
    confirmImpact: z.boolean().optional(),
    outOfRangeResolution: z.enum(['keep_linked', 'detach', 'cancel']).optional(),
  });

export const statusChangeSchema = z.object({
  version: z.number().int().positive().optional(),
});

export const cancelIntensiveSchema = z.object({
  version: z.number().int().positive().optional(),
  resolution: z.enum(['cancel_messages', 'detach_messages']).optional(),
  reason: optionalText(2000),
});

/* ───────────── План ───────────── */

export const generatePlanSchema = z.object({
  templateIds: z.array(officialIdSchema).min(1, 'Выберите хотя бы один шаблон').max(500),
});

const audienceSchema = z.enum(['ADM', 'SUP', 'ALL'], { error: 'Аудитория: ADM, SUP или ALL' });
const dayNumberSchema = z
  .number({ error: 'День — число' })
  .int('День — целое число')
  .min(1, 'День начинается с 1')
  .max(MAX_INTENSIVE_DAYS)
  .nullable();
const timeSchema = z.string().trim().refine(isValidHm, 'Время в формате ЧЧ:ММ').nullable();
const categoriesSchema = z.array(z.string().trim().min(1).max(40)).max(10);

export const createPlanItemSchema = z.object({
  /** Снимок пользовательского шаблона вызывающего (поля ниже тогда необязательны и переопределяют снимок) */
  sourceUserTemplateId: safeIdSchema.optional(),
  title: z.string().trim().max(MAX_TITLE_LENGTH).optional(),
  body: z.string().max(MAX_BODY_LENGTH, `Текст не длиннее ${MAX_BODY_LENGTH} символов`).optional(),
  channel: z.string().trim().max(MAX_CHANNEL_LENGTH).optional(),
  dayNumber: dayNumberSchema.optional(),
  time: timeSchema.optional(),
  audience: audienceSchema.default('ALL'),
  categories: categoriesSchema.optional(),
});

export const updatePlanItemSchema = z
  .object({
    title: z.string().trim().min(1, 'Укажите название').max(MAX_TITLE_LENGTH).optional(),
    body: z.string().min(1, 'Текст не может быть пустым').max(MAX_BODY_LENGTH).optional(),
    channel: z.string().trim().min(1, 'Укажите канал').max(MAX_CHANNEL_LENGTH).optional(),
    dayNumber: dayNumberSchema.optional(),
    time: timeSchema.optional(),
    audience: audienceSchema.optional(),
    categories: categoriesSchema.optional(),
    position: z.number().int().min(0).max(100_000).optional(),
    skipped: z.boolean().optional(),
    skipReason: z.string().trim().max(2000).optional(),
  })
  .superRefine((v, ctx) => {
    if (v.skipped === true && !v.skipReason) {
      ctx.addIssue({ code: 'custom', path: ['skipReason'], message: 'Укажите причину пропуска' });
    }
  });

export const linkMessagesSchema = z.object({
  links: z
    .array(z.object({ messageId: safeIdSchema, planItemId: safeIdSchema }))
    .min(1, 'Нет связей для привязки')
    .max(500),
});

export const SNAPSHOT_FIELDS = ['title', 'body', 'channel', 'dayNumber', 'time', 'audience', 'categories'] as const;
