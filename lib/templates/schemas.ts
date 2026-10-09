/** zod-схемы API официальных шаблонов и словаря каналов. Сообщения — по-русски (уходят в fieldErrors). */
import { z } from 'zod';
import { TEMPLATE_LIMITS } from './types';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const scopeSchema = z.enum(['SUP', 'ADM'], { error: 'Область: SUP или ADM' });
const audienceSchema = z.enum(['all', 'mk'], { error: 'Аудитория: all или mk' });
const titleSchema = z
  .string({ error: 'Укажите название' })
  .trim()
  .min(1, 'Укажите название')
  .max(TEMPLATE_LIMITS.title, `Название — не длиннее ${TEMPLATE_LIMITS.title} символов`);
const bodySchema = z
  .string({ error: 'Введите текст' })
  .max(TEMPLATE_LIMITS.body, `Текст — не длиннее ${TEMPLATE_LIMITS.body} символов`)
  .refine((v) => v.trim().length > 0, 'Введите текст');
const channelSchema = z.string({ error: 'Укажите канал' }).max(200, 'Слишком длинное название канала');
const daySchema = z
  .number({ error: 'День — число' })
  .int('День — целое число')
  .min(TEMPLATE_LIMITS.minDay, `День — от ${TEMPLATE_LIMITS.minDay}`)
  .max(TEMPLATE_LIMITS.maxDay, `День — не больше ${TEMPLATE_LIMITS.maxDay}`);
const timeSchema = z.string({ error: 'Укажите время' }).trim().regex(TIME_RE, 'Время в формате ЧЧ:ММ, например 09:00');
const dayLabelSchema = z.string().trim().max(TEMPLATE_LIMITS.dayLabel, `Подпись дня — не длиннее ${TEMPLATE_LIMITS.dayLabel} символов`);
const timeNoteSchema = z.string().trim().max(TEMPLATE_LIMITS.timeNote, `Подсказка — не длиннее ${TEMPLATE_LIMITS.timeNote} символов`);
const positionSchema = z.number().int().min(0).max(100_000);

export const createOfficialTemplateSchema = z.object({
  scope: scopeSchema,
  title: titleSchema,
  body: bodySchema,
  channel: channelSchema,
  intensiveDay: daySchema,
  time: timeSchema,
  audience: audienceSchema.default('all'),
  dayLabel: dayLabelSchema.nullable().optional(),
  timeNote: timeNoteSchema.nullable().optional(),
  position: positionSchema.optional(),
  createChannelIfMissing: z.boolean().optional(),
});

/** null у поля встроенного шаблона = вернуть значение по умолчанию; отсутствует = не менять. */
export const updateOfficialTemplateSchema = z.object({
  scope: scopeSchema.optional(),
  title: titleSchema.nullable().optional(),
  body: bodySchema.nullable().optional(),
  channel: channelSchema.nullable().optional(),
  intensiveDay: daySchema.nullable().optional(),
  time: timeSchema.nullable().optional(),
  audience: audienceSchema.nullable().optional(),
  dayLabel: dayLabelSchema.nullable().optional(),
  timeNote: timeNoteSchema.nullable().optional(),
  position: positionSchema.optional(),
  createChannelIfMissing: z.boolean().optional(),
});

export const createChannelSchema = z.object({
  name: z.string({ error: 'Укажите название канала' }).max(200, 'Слишком длинное название канала'),
  label: z.string().trim().max(TEMPLATE_LIMITS.channelLabel).nullable().optional(),
});

export type CreateOfficialTemplateParsed = z.infer<typeof createOfficialTemplateSchema>;
export type UpdateOfficialTemplateParsed = z.infer<typeof updateOfficialTemplateSchema>;
