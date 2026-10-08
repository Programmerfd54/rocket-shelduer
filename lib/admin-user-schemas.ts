import { z } from 'zod';

/** Логин: как в регистрации — хранится в User.email в нижнем регистре. */
export const loginSchema = z
  .string({ error: 'Укажите логин' })
  .trim()
  .min(2, 'Логин — не короче 2 символов')
  .max(100, 'Логин — не длиннее 100 символов')
  .regex(/^[^\s]+$/, 'Логин не должен содержать пробелов')
  .transform((v) => v.toLowerCase());

const optionalTrimmed = (max: number, label: string) =>
  z
    .string()
    .trim()
    .max(max, `${label} — не длиннее ${max} символов`)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

/** Дата окончания доступа волонтёра (ISO / YYYY-MM-DD), должна быть в будущем. */
const volunteerExpiresSchema = z
  .string()
  .trim()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const d = /^\d{4}-\d{2}-\d{2}$/.test(v) ? new Date(`${v}T23:59:59.999Z`) : new Date(v);
    if (Number.isNaN(d.getTime())) {
      ctx.addIssue({ code: 'custom', message: 'Некорректная дата' });
      return z.NEVER;
    }
    if (d.getTime() <= Date.now()) {
      ctx.addIssue({ code: 'custom', message: 'Дата окончания доступа должна быть в будущем' });
      return z.NEVER;
    }
    return d;
  });

export const INVITE_ROLES = ['SUP', 'ADM', 'MEMBER'] as const;
export const INVITE_VALIDITY_HOURS = [1, 24, 72, 168] as const;

export const inviteBodySchema = z.object({
  role: z.enum(INVITE_ROLES, { error: 'Выберите роль: SUP, ADM или MEMBER' }),
  email: optionalTrimmed(200, 'Подсказка логина'),
  volunteerExpiresAt: volunteerExpiresSchema,
  volunteerIntensive: optionalTrimmed(50, 'Интенсив'),
  expiresInHours: z
    .union([z.literal(1), z.literal(24), z.literal(72), z.literal(168)])
    .optional()
    .default(1),
});

export const createUserBodySchema = z
  .object({
    email: loginSchema,
    username: optionalTrimmed(100, 'Username'),
    name: optionalTrimmed(200, 'Имя'),
    role: z.enum(INVITE_ROLES, { error: 'Выберите роль: SUP, ADM или MEMBER' }),
    /** generate — сгенерировать временный пароль; login — пароль = логин; manual — задать вручную. */
    passwordMode: z.enum(['generate', 'login', 'manual']).optional().default('generate'),
    password: z.string().optional().nullable(),
    volunteerExpiresAt: volunteerExpiresSchema,
    volunteerIntensive: optionalTrimmed(50, 'Интенсив'),
  })
  .superRefine((v, ctx) => {
    if (v.passwordMode === 'manual') {
      if (!v.password || v.password.length < 8) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Пароль — не короче 8 символов' });
      } else if (v.password.length > 200) {
        ctx.addIssue({ code: 'custom', path: ['password'], message: 'Пароль слишком длинный' });
      }
    }
    if (v.username && !/^[a-zA-Z0-9._-]+$/.test(v.username)) {
      ctx.addIssue({
        code: 'custom',
        path: ['username'],
        message: 'Только латиница, цифры, точка, дефис и подчёркивание',
      });
    }
  });

/** Ошибки zod → { error, fieldErrors } для ответа API (первое сообщение по каждому полю). */
export function zodErrorBody(error: z.ZodError): { error: string; fieldErrors: Record<string, string> } {
  const fieldErrors: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = issue.path.length ? String(issue.path[0]) : '_';
    if (!fieldErrors[key]) fieldErrors[key] = issue.message;
  }
  const first = error.issues[0]?.message ?? 'Некорректные данные';
  return { error: first, fieldErrors };
}

/** Случайный временный пароль (буквы разного регистра, цифры, спецсимволы). */
export function generateTemporaryPassword(length = 12): string {
  const lower = 'abcdefghijkmnopqrstuvwxyz';
  const upper = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  const digits = '23456789';
  const special = '!@#$%^&*';
  const all = lower + upper + digits + special;
  const bytes = new Uint32Array(length);
  globalThis.crypto.getRandomValues(bytes);
  const pick = (set: string, n: number) => set.charAt(n % set.length);
  const chars = [pick(lower, bytes[0]), pick(upper, bytes[1]), pick(digits, bytes[2]), pick(special, bytes[3])];
  for (let i = 4; i < length; i++) chars.push(pick(all, bytes[i]));
  // перемешивание
  const shuffle = new Uint32Array(chars.length);
  globalThis.crypto.getRandomValues(shuffle);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = shuffle[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join('');
}
