import crypto from 'crypto';

/**
 * Шифрование секретов подключений (Rocket.Chat token / пароль, пароли LDAP/SMTP): AES-256-GCM.
 *
 * Ключ:
 * - В проде задать отдельный ENCRYPTION_KEY в .env (не использовать JWT_SECRET для шифрования);
 *   без него приложение не стартует (lib/env.ts) и шифрование/расшифровка падают (fail closed).
 * - Мастер-ключ = scrypt(ENCRYPTION_KEY) (кешируется). Строка ключа НЕ тримится — иначе старые данные
 *   не расшифруются.
 * - Ротация: новый ключ в ENCRYPTION_KEY, старые — в ENCRYPTION_KEY_PREVIOUS (через запятую);
 *   расшифровка пробует все ключи, шифрование — только текущим. Затем `npx tsx scripts/reencrypt-secrets.ts`
 *   и старые ключи убрать.
 *
 * Форматы:
 * - v2 (все новые записи): `enc2:<kid>:<b|u>:<iv>:<tag>:<ct>` (base64url).
 *   · Отдельный подключ на каждое назначение (HKDF-SHA256 от мастер-ключа, info = назначение):
 *     токен RC, пароль RC и секреты LDAP/SMTP шифруются разными ключами — шифртекст одного назначения
 *     нельзя подставить/расшифровать как другое.
 *   · IV 12 байт (рекомендация NIST для GCM), тег 16 байт (длина фиксирована при расшифровке).
 *   · kid — первые 8 hex от sha256("kid:" + подключ): выбирает ключ при ротации, сам ключ не раскрывает.
 *   · AAD (additional authenticated data): `b` — запись привязана к контексту (например `ws:<userId>`
 *     владельца подключения) и расшифровывается только с тем же контекстом (нельзя перенести токен
 *     в чужую строку БД); `u` — без привязки. Заголовок (назначение, kid, флаг) тоже аутентифицируется.
 * - v1 (legacy, только чтение): `hex(iv 16):hex(tag 16):hex(ct)`; для токена RC — с префиксом `enc:`.
 * - Токен RC без префикса — legacy plaintext (только чтение; перешифровывается скриптом).
 *
 * Расшифровка только на сервере при обращении к Rocket.Chat API. Секреты, ключи и открытый текст
 * никогда не логируются и не возвращаются клиенту; ошибки — без подробностей.
 */
const ALGORITHM = 'aes-256-gcm';
const V1_IV_LENGTH = 16;
const V2_IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const DEFAULT_ENCRYPTION_SECRET = 'default-secret-key';
const KDF_SALT = 'workspace-credentials-salt';
const HKDF_SALT = 'rocketchat-scheduler/secrets/v2';

const V1_TOKEN_PREFIX = 'enc:';
const V2_PREFIX = 'enc2:';

/** Назначения секретов: у каждого свой подключ (HKDF). */
export type SecretPurpose = 'rc-auth-token' | 'rc-password' | 'workspace-settings-secret';

const masterKeyCache = new Map<string, Buffer>();
const subKeyCache = new Map<string, { key: Buffer; kid: string }>();
let warnedDefaultKey = false;

/** scrypt дорогой (десятки мс, блокирует event loop) — кешируем производный ключ. */
function deriveKey(secret: string): Buffer {
  let key = masterKeyCache.get(secret);
  if (!key) {
    key = crypto.scryptSync(secret, KDF_SALT, 32);
    masterKeyCache.set(secret, key);
  }
  return key;
}

function deriveSubKey(secret: string, purpose: SecretPurpose): { key: Buffer; kid: string } {
  const cacheKey = `${purpose}\u0000${secret}`;
  let entry = subKeyCache.get(cacheKey);
  if (!entry) {
    const key = Buffer.from(crypto.hkdfSync('sha256', deriveKey(secret), HKDF_SALT, `purpose:${purpose}`, 32));
    const kid = crypto.createHash('sha256').update('kid:').update(key).digest('hex').slice(0, 8);
    entry = { key, kid };
    subKeyCache.set(cacheKey, entry);
  }
  return entry;
}

function getCurrentSecret(): string {
  // Значение НЕ тримим: ключ выводится из точной строки, как и раньше (иначе старые данные не расшифруются)
  const configured = process.env.ENCRYPTION_KEY;
  if (process.env.NODE_ENV === 'production') {
    if (!configured || !configured.trim() || configured === DEFAULT_ENCRYPTION_SECRET) {
      throw new Error('ENCRYPTION_KEY must be set in production for workspace credentials.');
    }
    return configured;
  }
  if (!configured || !configured.trim()) {
    if (!warnedDefaultKey) {
      warnedDefaultKey = true;
      console.warn('[encryption] ENCRYPTION_KEY is not set — using a development-only default key.');
    }
    return DEFAULT_ENCRYPTION_SECRET;
  }
  return configured;
}

function getDecryptionSecrets(): string[] {
  const secrets = [getCurrentSecret()];
  for (const s of (process.env.ENCRYPTION_KEY_PREVIOUS ?? '').split(',')) {
    const v = s.trim();
    if (v && !secrets.includes(v)) secrets.push(v);
  }
  // В dev данные могли быть зашифрованы ключом по умолчанию до появления ENCRYPTION_KEY
  if (process.env.NODE_ENV !== 'production' && !secrets.includes(DEFAULT_ENCRYPTION_SECRET)) {
    secrets.push(DEFAULT_ENCRYPTION_SECRET);
  }
  return secrets;
}

function constantTimeEqualStr(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  return ba.length === bb.length && crypto.timingSafeEqual(ba, bb);
}

function v2Aad(purpose: SecretPurpose, kid: string, flag: 'b' | 'u', context: string): Buffer {
  return Buffer.from(`enc2|${purpose}|${kid}|${flag}|${context}`, 'utf8');
}

const B64URL = /^[A-Za-z0-9_-]*$/;

/* ------------------------------------------------------------------ */
/* Общие функции                                                        */
/* ------------------------------------------------------------------ */

/** AAD для секретов подключения RC (токен, пароль): привязка к владельцу подключения. */
export function connectionAad(ownerUserId: string): string {
  return `ws:${ownerUserId}`;
}

/** AAD для секретов LDAP/SMTP: привязка к подключению (WorkspaceSettings.workspaceId). */
export function workspaceSettingsAad(workspaceId: string): string {
  return `wss:${workspaceId}`;
}

/** Шифрование v2 текущим ключом. aad — контекст привязки (если известен во ВСЕХ местах расшифровки). */
export function encryptSecret(plaintext: string, purpose: SecretPurpose, aad?: string): string {
  const { key, kid } = deriveSubKey(getCurrentSecret(), purpose);
  const flag: 'b' | 'u' = aad ? 'b' : 'u';
  const iv = crypto.randomBytes(V2_IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  cipher.setAAD(v2Aad(purpose, kid, flag, aad ?? ''));
  const pt = Buffer.from(plaintext, 'utf8');
  try {
    const ct = Buffer.concat([cipher.update(pt), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${V2_PREFIX}${kid}:${flag}:${iv.toString('base64url')}:${tag.toString('base64url')}:${ct.toString('base64url')}`;
  } finally {
    pt.fill(0);
  }
}

function decryptV2(stored: string, purpose: SecretPurpose, aad: string | undefined): string {
  const parts = stored.slice(V2_PREFIX.length).split(':');
  if (parts.length !== 5) throw new Error('format');
  const [kid, flag, ivB64, tagB64, ctB64] = parts;
  if (!/^[0-9a-f]{8}$/.test(kid) || (flag !== 'b' && flag !== 'u')) throw new Error('format');
  if (!B64URL.test(ivB64) || !B64URL.test(tagB64) || !B64URL.test(ctB64)) throw new Error('format');
  // Запись привязана к контексту — без него (или с другим) не расшифровывается
  if (flag === 'b' && !aad) throw new Error('context');
  const iv = Buffer.from(ivB64, 'base64url');
  const tag = Buffer.from(tagB64, 'base64url');
  const ct = Buffer.from(ctB64, 'base64url');
  if (iv.length !== V2_IV_LENGTH || tag.length !== AUTH_TAG_LENGTH) throw new Error('format');
  const context = flag === 'b' ? (aad as string) : '';

  for (const secret of getDecryptionSecrets()) {
    const sub = deriveSubKey(secret, purpose);
    if (!constantTimeEqualStr(sub.kid, kid)) continue;
    try {
      const decipher = crypto.createDecipheriv(ALGORITHM, sub.key, iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAAD(v2Aad(purpose, kid, flag, context));
      decipher.setAuthTag(tag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      try {
        return pt.toString('utf8');
      } finally {
        pt.fill(0);
      }
    } catch {
      // коллизия kid маловероятна, но пробуем остальные ключи
    }
  }
  throw new Error('decrypt');
}

function decryptV1(data: string): string {
  const parts = data.split(':');
  if (parts.length !== 3) throw new Error('format');
  const [ivHex, authTagHex, encrypted] = parts;
  // Пустой шифртекст допустим (encryptPassword('') у подключений по токену) — тег всё равно проверяется
  if (!ivHex || !authTagHex || !/^[0-9a-f]+$/i.test(ivHex + authTagHex) || !/^[0-9a-f]*$/i.test(encrypted)) {
    throw new Error('format');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const authTag = Buffer.from(authTagHex, 'hex');
  if (iv.length !== V1_IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH || encrypted.length % 2 !== 0) {
    throw new Error('format');
  }
  const ct = Buffer.from(encrypted, 'hex');
  for (const secret of getDecryptionSecrets()) {
    try {
      // authTagLength фиксирован: иначе Node принимает укороченный тег (4–15 байт) и подделка проще
      const decipher = crypto.createDecipheriv(ALGORITHM, deriveKey(secret), iv, { authTagLength: AUTH_TAG_LENGTH });
      decipher.setAuthTag(authTag);
      const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
      try {
        return pt.toString('utf8');
      } finally {
        pt.fill(0);
      }
    } catch {
      // пробуем следующий (предыдущий) ключ
    }
  }
  throw new Error('decrypt');
}

/**
 * Расшифровка v2 (с подключом назначения) или legacy v1 (`iv:tag:ct`, в т.ч. с префиксом `enc:`).
 * Ошибка — без подробностей (не раскрываем, что именно не так).
 */
export function decryptSecret(stored: string, purpose: SecretPurpose, aad?: string): string {
  try {
    if (typeof stored !== 'string' || !stored) throw new Error('empty');
    if (stored.startsWith(V2_PREFIX)) return decryptV2(stored, purpose, aad);
    const v1 = stored.startsWith(V1_TOKEN_PREFIX) ? stored.slice(V1_TOKEN_PREFIX.length) : stored;
    return decryptV1(v1);
  } catch {
    throw new Error('Failed to decrypt secret');
  }
}

/** Значение уже в формате v2 и зашифровано ТЕКУЩИМ ключом. */
export function isCurrentV2(stored: string | null | undefined, purpose: SecretPurpose): boolean {
  if (!stored || !stored.startsWith(V2_PREFIX)) return false;
  const kid = stored.slice(V2_PREFIX.length, V2_PREFIX.length + 8);
  return constantTimeEqualStr(kid, deriveSubKey(getCurrentSecret(), purpose).kid);
}

/** Значение в v2 привязано к контексту (флаг `b`). */
export function isBoundV2(stored: string | null | undefined): boolean {
  if (!stored || !stored.startsWith(V2_PREFIX)) return false;
  return stored.slice(V2_PREFIX.length + 9, V2_PREFIX.length + 10) === 'b';
}

/* ------------------------------------------------------------------ */
/* Пароль Rocket.Chat (WorkspaceConnection.encryptedPassword)          */
/* ------------------------------------------------------------------ */

/** Шифрование пароля RC (v2, подключ 'rc-password'). aad — connectionAad(ownerUserId). */
export function encryptPassword(password: string, aad?: string): string {
  return encryptSecret(password, 'rc-password', aad);
}

/** Расшифровка пароля RC (v2 или legacy v1). Бросает «Failed to decrypt password» без подробностей. */
export function decryptPassword(encryptedData: string, aad?: string): string {
  try {
    return decryptSecret(encryptedData, 'rc-password', aad);
  } catch {
    // Не логируем содержимое ошибки — может содержать чувствительные данные
    throw new Error('Failed to decrypt password');
  }
}

/* ------------------------------------------------------------------ */
/* Токен Rocket.Chat (WorkspaceConnection.authToken)                   */
/* ------------------------------------------------------------------ */

/** Шифрование RC auth token для хранения в БД (v2, подключ 'rc-auth-token'). aad — connectionAad(ownerUserId). */
export function encryptAuthToken(token: string, aad?: string): string {
  return encryptSecret(token, 'rc-auth-token', aad);
}

/** Расшифровка RC auth token: v2, v1 (`enc:`), legacy plaintext. При ошибке — null. */
export function decryptAuthToken(stored: string | null | undefined, aad?: string): string | null {
  if (!stored?.trim()) return null;
  if (stored.startsWith(V2_PREFIX) || stored.startsWith(V1_TOKEN_PREFIX)) {
    try {
      return decryptSecret(stored, 'rc-auth-token', aad);
    } catch {
      return null;
    }
  }
  return stored;
}

/* ------------------------------------------------------------------ */
/* Секреты LDAP/SMTP (WorkspaceSettings.ldapBindPass / smtpPass)        */
/* ------------------------------------------------------------------ */

/** Шифрование пароля LDAP bind / SMTP (v2, подключ 'workspace-settings-secret'). aad — workspaceSettingsAad(id). */
export function encryptSettingsSecret(value: string, aad?: string): string {
  return encryptSecret(value, 'workspace-settings-secret', aad);
}

export function decryptSettingsSecret(stored: string, aad?: string): string {
  return decryptSecret(stored, 'workspace-settings-secret', aad);
}
