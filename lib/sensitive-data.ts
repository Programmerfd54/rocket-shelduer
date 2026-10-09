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
 *
 * Для логов — redactForLog / safeErrorForLog / redactString (ниже); в Node-процессе приложения
 * installConsoleRedaction() (instrumentation.ts) дополнительно пропускает через них весь вывод console.*.
 */

export const SENSITIVE_USER_FIELDS = ['password'] as const;

export const SENSITIVE_WORKSPACE_FIELDS = [
  'encryptedPassword',
  'authToken',
  'ldapBindPass',
  'smtpPass',
] as const;

export type SensitiveUserField = (typeof SENSITIVE_USER_FIELDS)[number];
export type SensitiveWorkspaceField = (typeof SENSITIVE_WORKSPACE_FIELDS)[number];

/**
 * Ключи, значения которых всегда скрываются в логах (сравнение без регистра, без '-' и '_').
 * 'code' скрывается только если значение похоже на одноразовый код (цифры), чтобы не терять коды ошибок.
 */
export const REDACTED_KEYS = [
  'password',
  'newPassword',
  'currentPassword',
  'oldPassword',
  'confirmPassword',
  'token',
  'authToken',
  'personalToken',
  'accessToken',
  'refreshToken',
  'inviteToken',
  'resetToken',
  'adminPassword',
  'adminPersonalToken',
  'adminTotpCode',
  'totp',
  'totpCode',
  'code',
  'secret',
  'clientSecret',
  'x-auth-token',
  'authorization',
  'cookie',
  'set-cookie',
  'ldapBindPass',
  'smtpPass',
  'encryptedPassword',
  'passwordHash',
  'tokenHash',
  'jwt',
] as const;

const REDACTED = '[REDACTED]';
const normKey = (k: string) => k.toLowerCase().replace(/[-_]/g, '');
const REDACTED_KEY_SET = new Set<string>(REDACTED_KEYS.map(normKey));

/** true — значение под этим ключом нельзя логировать/возвращать. */
export function isSensitiveKey(key: string, value?: unknown): boolean {
  const k = normKey(key);
  if (k === 'code') {
    return (typeof value === 'string' || typeof value === 'number') && /^\s*\d{4,10}\s*$/.test(String(value));
  }
  if (REDACTED_KEY_SET.has(k)) return true;
  // Производные имена: adminPassword2, rcAuthTokenOld, smtpPassword и т.п.
  return /(password|passwd|secret|authtoken|personaltoken|apikey|privatekey|totp|cookie|authorization)/.test(k);
}

/* Порядок важен: сначала целые значения шифртекста, затем пары ключ/значение. */
const KEY_ALT =
  '(?:password|newPassword|currentPassword|oldPassword|adminPassword|encryptedPassword|ldapBindPass|smtpPass|' +
  'authToken|personalToken|adminPersonalToken|accessToken|refreshToken|token|adminTotpCode|totpCode|totp|secret|' +
  'x-auth-token|authorization|cookie|set-cookie)';

const STRING_PATTERNS: Array<[RegExp, string]> = [
  // Шифртексты v2 / v1 (сами по себе не секрет без ключа, но не должны утекать в логи)
  [/enc2:[0-9a-f]{8}:[bu]:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]*/g, REDACTED],
  [/enc:[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]*/gi, REDACTED],
  [/\b[0-9a-f]{32}:[0-9a-f]{32}:[0-9a-f]+\b/gi, REDACTED],
  // Bearer / Basic в заголовках
  [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/g, '$1 ' + REDACTED],
  // JSON: "password":"..."
  [new RegExp(`("${KEY_ALT}"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"`, 'gi'), `$1"${REDACTED}"`],
  // Одноразовые коды в JSON: "code":"123456"
  [/("code"\s*:\s*)"\d{4,10}"/gi, `$1"${REDACTED}"`],
  // JS-объекты (сообщения Prisma) и key="value": password: "..." / authToken: '...' / password="..."
  [new RegExp(`(\\b${KEY_ALT}\\s*[:=]\\s*)(["'\`])(?:(?!\\2)[^\\\\]|\\\\.)*\\2`, 'gi'), `$1$2${REDACTED}$2`],
  // Заголовки и query: X-Auth-Token: xxx, password=xxx
  [new RegExp(`(\\b${KEY_ALT}\\s*[:=]\\s*)(?!\\[REDACTED\\]|["'\`])[^\\s,;&"'}]+`, 'gi'), `$1${REDACTED}`],
  // JWT
  [/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, REDACTED],
];

/** Скрывает секреты внутри произвольной строки (сообщения ошибок, тела запросов, заголовки). */
export function redactString(input: string): string {
  let s = input;
  for (const [re, repl] of STRING_PATTERNS) s = s.replace(re, repl);
  return s;
}

/** Глубокая копия значения со скрытыми секретами (для логирования объектов). */
export function redactForLog(value: unknown, depth = 0, seen: WeakSet<object> = new WeakSet()): unknown {
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value);
  if (typeof value !== 'object') return value;
  if (value instanceof Error) return safeErrorForLog(value);
  if (seen.has(value)) return '[Circular]';
  if (depth > 6) return '[Object]';
  seen.add(value);
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactForLog(v, depth + 1, seen));
  if (value instanceof Date) return value;
  if (typeof Headers !== 'undefined' && value instanceof Headers) {
    const out: Record<string, string> = {};
    value.forEach((v, k) => {
      out[k] = isSensitiveKey(k, v) ? REDACTED : redactString(v);
    });
    return out;
  }
  if (Buffer.isBuffer(value) || ArrayBuffer.isView(value)) return `[Binary ${(value as ArrayBufferView).byteLength} bytes]`;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k, v) ? REDACTED : redactForLog(v, depth + 1, seen);
  }
  return out;
}

/**
 * Безопасное текстовое представление ошибки для логов: имя, сообщение и стек со скрытыми секретами,
 * code/status (без config/headers/request/response — там бывают X-Auth-Token и тела запросов).
 */
export function safeErrorForLog(error: unknown, maxLength = 4000): string {
  if (error == null) return String(error);
  if (!(error instanceof Error)) {
    if (typeof error === 'string') return redactString(error).slice(0, maxLength);
    try {
      return JSON.stringify(redactForLog(error)).slice(0, maxLength);
    } catch {
      return '[Unserializable error]';
    }
  }
  const e = error as Error & { code?: unknown; status?: unknown; cause?: unknown };
  const meta: string[] = [];
  if (typeof e.code === 'string' || typeof e.code === 'number') meta.push(`code=${String(e.code).slice(0, 64)}`);
  if (typeof e.status === 'number') meta.push(`status=${e.status}`);
  let text = e.stack && e.stack.includes(e.message ?? '') ? e.stack : `${e.name}: ${e.message}\n${e.stack ?? ''}`;
  if (meta.length) text += ` [${meta.join(' ')}]`;
  if (e.cause instanceof Error) text += `\nCaused by: ${e.cause.name}: ${e.cause.message}`;
  else if (e.cause && typeof e.cause === 'object' && 'code' in e.cause) {
    text += `\nCaused by: code=${String((e.cause as { code?: unknown }).code).slice(0, 64)}`;
  }
  return redactString(text).slice(0, maxLength);
}

const CONSOLE_PATCHED = Symbol.for('rocketchat-scheduler.console-redaction');

/**
 * Пропускает аргументы console.log/info/warn/error/debug через redactForLog (один раз на процесс).
 * Последний рубеж: даже если где-то залогируют объект ошибки или тело запроса целиком, секреты
 * (пароли, токены, заголовки X-Auth-Token / Authorization, шифртексты) в журнал не попадут.
 */
export function installConsoleRedaction(target: Console = console): void {
  const flagged = target as Console & { [CONSOLE_PATCHED]?: boolean };
  if (flagged[CONSOLE_PATCHED]) return;
  flagged[CONSOLE_PATCHED] = true;
  for (const method of ['log', 'info', 'warn', 'error', 'debug'] as const) {
    const original = target[method].bind(target);
    target[method] = (...args: unknown[]) => {
      let safe: unknown[];
      try {
        safe = args.map((a) => (a instanceof Error ? safeErrorForLog(a) : redactForLog(a)));
      } catch {
        safe = ['[log redaction failed]'];
      }
      original(...safe);
    };
  }
}
