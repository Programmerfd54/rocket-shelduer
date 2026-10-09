import { z } from 'zod';

/**
 * Проверка и нормализация учётных данных Rocket.Chat, приходящих от клиента
 * (подключение пространства, смена кредов, подтверждение назначения).
 * Значения не логируются; при ошибке — общий ответ «Invalid input» без подробностей.
 */
const hasControlChars = (s: string) => /[\u0000-\u001f\u007f]/.test(s);

export const rcCredentialFieldsSchema = z.object({
  username: z
    .string()
    .trim()
    .max(256)
    .refine((s) => !hasControlChars(s))
    .optional(),
  // Пароль не тримится и не фильтруется по «подозрительным» шаблонам: он не попадает ни в SQL, ни в HTML
  password: z
    .string()
    .max(4096)
    .refine((s) => !hasControlChars(s))
    .optional()
    .nullable(),
  // Код 2FA: цифры (TOTP/e-mail) или резервный код; пробелы убираем
  totpCode: z
    .string()
    .max(128)
    .transform((s) => s.replace(/\s+/g, ''))
    .refine((s) => s === '' || /^[A-Za-z0-9-]{4,64}$/.test(s))
    .optional()
    .nullable(),
  // Личный токен: печатный ASCII без пробелов
  personalToken: z
    .string()
    .trim()
    .max(4096)
    .refine((s) => /^[\x21-\x7e]*$/.test(s))
    .optional(),
  // User ID Rocket.Chat (Meteor id)
  rcUserId: z
    .string()
    .trim()
    .max(256)
    .refine((s) => /^[A-Za-z0-9_.-]*$/.test(s))
    .optional(),
});

export type RcCredentialFields = z.infer<typeof rcCredentialFieldsSchema>;

/** null — данные некорректны (ответить 400 «Invalid input»). */
export function parseRcCredentialFields(input: {
  username?: unknown;
  password?: unknown;
  totpCode?: unknown;
  personalToken?: unknown;
  rcUserId?: unknown;
}): RcCredentialFields | null {
  const clean = Object.fromEntries(Object.entries(input).filter(([, v]) => v !== undefined));
  const parsed = rcCredentialFieldsSchema.safeParse(clean);
  return parsed.success ? parsed.data : null;
}
