import { z } from 'zod';
import { rcAdminCredentialsBaseSchema, validateRcAdminCredentials } from '@/lib/rc-admin-credentials';

/** Слово, которое нужно ввести для необратимого удаления. */
export const REMOVE_CONFIRM_WORD = 'УДАЛИТЬ';
export const MAX_REMOVE_TARGETS = 100;
/** Сколько логинов показывать в диалоге подтверждения. */
export const CONFIRM_PREVIEW_LIMIT = 10;

export type UserRemoveMode = 'delete' | 'deactivate';
export type UserRemoveItemStatus = 'removed' | 'skipped' | 'error';
export type UserRemoveResult = { username: string; status: UserRemoveItemStatus; reason?: string };

/** Логин Rocket.Chat: буквы, цифры, точка, дефис, подчёркивание (как в стандартной проверке RC). */
const LOGIN_PATTERN = /^[\p{L}\p{N}._-]+$/u;

export function normalizeLogin(value: string) {
  return value.trim().replace(/^@/, '');
}

/** Возвращает текст ошибки или null, если логин допустим. */
export function validateLogin(login: string): string | null {
  if (!login) return 'Пустой логин';
  if (login.length > 128) return 'Логин длиннее 128 символов';
  if (!LOGIN_PATTERN.test(login)) return 'Допустимы буквы, цифры, точка, дефис и подчёркивание';
  return null;
}

export type ParsedLoginList = {
  /** Валидные уникальные логины (без учёта регистра), в порядке ввода. */
  logins: string[];
  invalid: { login: string; reason: string }[];
  duplicates: number;
  /** true, если валидных логинов больше лимита. */
  tooMany: boolean;
};

/** Разбор списка логинов: по одному на строку, допускаются запятая / точка с запятой и @-префикс. */
export function parseLoginList(text: string): ParsedLoginList {
  const seen = new Map<string, string>();
  const invalid: ParsedLoginList['invalid'] = [];
  let duplicates = 0;
  for (const raw of text.split(/[\n,;]+/)) {
    const login = normalizeLogin(raw);
    if (!login) continue;
    const problem = validateLogin(login);
    if (problem) {
      invalid.push({ login, reason: problem });
      continue;
    }
    const key = login.toLowerCase();
    if (seen.has(key)) duplicates++;
    else seen.set(key, login);
  }
  const logins = [...seen.values()];
  return { logins, invalid, duplicates, tooMany: logins.length > MAX_REMOVE_TARGETS };
}

export function isRemoveConfirmed(typed: string) {
  return typed.trim().toLocaleUpperCase('ru-RU') === REMOVE_CONFIRM_WORD;
}

const loginSchema = z.string().transform(normalizeLogin).pipe(
  z.string().min(1, 'Пустой логин').max(128, 'Логин длиннее 128 символов')
    .regex(LOGIN_PATTERN, 'Недопустимые символы в логине'),
);

export const userRemoveRequestSchema = rcAdminCredentialsBaseSchema.extend({
  mode: z.enum(['delete', 'deactivate']),
  ids: z.array(z.string().trim().min(1).max(64)).max(MAX_REMOVE_TARGETS).optional(),
  usernames: z.array(loginSchema).max(MAX_REMOVE_TARGETS).optional(),
  /** Обязателен для mode=delete: защита от случайного вызова API. */
  confirm: z.string().max(64).optional(),
}).superRefine((value, context) => {
  validateRcAdminCredentials(value, context);
  if (!(value.ids?.length || value.usernames?.length)) {
    context.addIssue({ code: 'custom', path: ['targets'], message: 'Выберите хотя бы одного пользователя.' });
  }
  if ((value.ids?.length ?? 0) + (value.usernames?.length ?? 0) > MAX_REMOVE_TARGETS * 2) {
    context.addIssue({ code: 'custom', path: ['targets'], message: `Максимум ${MAX_REMOVE_TARGETS} пользователей за запрос.` });
  }
  if (value.mode === 'delete' && !isRemoveConfirmed(value.confirm ?? '')) {
    context.addIssue({ code: 'custom', path: ['confirm'], message: `Для удаления передайте подтверждение «${REMOVE_CONFIRM_WORD}».` });
  }
});
export type UserRemoveRequest = z.infer<typeof userRemoveRequestSchema>;

/** Текст в диалоге подтверждения. */
export function buildRemoveConfirmation(mode: UserRemoveMode, logins: string[]) {
  const count = logins.length;
  const shown = logins.slice(0, CONFIRM_PREVIEW_LIMIT);
  const more = Math.max(0, count - shown.length);
  const noun = pluralUsers(count);
  if (mode === 'delete') {
    return {
      title: `Удалить ${count} ${noun} из Rocket.Chat?`,
      description: 'Аккаунты будут удалены безвозвратно. Сообщения останутся без автора, история переходит к системному пользователю. Отменить действие нельзя.',
      confirmLabel: 'Удалить из Rocket.Chat',
      requiresWord: true,
      shown,
      more,
    };
  }
  return {
    title: `Деактивировать ${count} ${noun}?`,
    description: 'Пользователи не смогут входить в Rocket.Chat, но аккаунты и история сохранятся. После повторной активации вход снова станет возможен.',
    confirmLabel: 'Деактивировать',
    requiresWord: false,
    shown,
    more,
  };
}

export function pluralUsers(n: number) {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return 'пользователя';
  return 'пользователей';
}

export function summarizeRemoveResults(mode: UserRemoveMode, results: UserRemoveResult[]) {
  const removed = results.filter(r => r.status === 'removed').length;
  const skipped = results.filter(r => r.status === 'skipped').length;
  const errors = results.filter(r => r.status === 'error').length;
  const verb = mode === 'delete' ? 'Удалено' : 'Деактивировано';
  const parts = [`${verb}: ${removed}`];
  if (skipped) parts.push(`пропущено: ${skipped}`);
  if (errors) parts.push(`ошибок: ${errors}`);
  return { removed, skipped, errors, text: parts.join(', '), level: errors > 0 ? (removed > 0 ? 'warning' : 'error') : skipped > 0 && removed === 0 ? 'warning' : 'success' } as const;
}
