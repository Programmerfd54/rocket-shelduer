/**
 * Политика защиты чувствительных данных.
 *
 * Эти поля НИКОГДА не должны:
 * - возвращаться в ответах API клиенту;
 * - попадать в логи, ошибки или события безопасности;
 * - передаваться в URL или query-параметрах.
 *
 * При запросах к БД использовать явный select без этих полей,
 * кроме маршрутов, где поле нужно только для проверки (например password для verifyPassword).
 */

export const SENSITIVE_USER_FIELDS = ['password'] as const;

export const SENSITIVE_WORKSPACE_FIELDS = [
  'encryptedPassword',
  'authToken',
] as const;

export type SensitiveUserField = (typeof SENSITIVE_USER_FIELDS)[number];
export type SensitiveWorkspaceField = (typeof SENSITIVE_WORKSPACE_FIELDS)[number];
