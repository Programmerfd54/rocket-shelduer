import crypto from 'crypto';

/**
 * Шифрование паролей/токенов пространств (Rocket.Chat): AES-256-GCM.
 * - В проде задать отдельный ENCRYPTION_KEY в .env (не использовать JWT_SECRET для шифрования);
 *   без него приложение не стартует (lib/env.ts) и шифрование/расшифровка падают (fail closed).
 * - Формат: hex(iv 16 байт):hex(authTag 16 байт):hex(ciphertext). Случайный IV на каждое шифрование.
 * - Ротация ключа: новый ключ в ENCRYPTION_KEY, старые — в ENCRYPTION_KEY_PREVIOUS (через запятую);
 *   расшифровка пробует все ключи, шифрование — только текущим. После перешифровки старые ключи убрать.
 * - Расшифровка только на сервере при обращении к Rocket.Chat API.
 * - encryptedPassword и исходный пароль никогда не возвращаются клиенту и не логируются.
 */
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;
const DEFAULT_ENCRYPTION_SECRET = 'default-secret-key';
const KDF_SALT = 'workspace-credentials-salt';

const derivedKeyCache = new Map<string, Buffer>();
let warnedDefaultKey = false;

/** scrypt дорогой (десятки мс, блокирует event loop) — кешируем производный ключ. */
function deriveKey(secret: string): Buffer {
  let key = derivedKeyCache.get(secret);
  if (!key) {
    key = crypto.scryptSync(secret, KDF_SALT, 32);
    derivedKeyCache.set(secret, key);
  }
  return key;
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

function getDecryptionKeys(): Buffer[] {
  const secrets = [getCurrentSecret()];
  for (const s of (process.env.ENCRYPTION_KEY_PREVIOUS ?? '').split(',')) {
    const v = s.trim();
    if (v && !secrets.includes(v)) secrets.push(v);
  }
  // В dev данные могли быть зашифрованы ключом по умолчанию до появления ENCRYPTION_KEY
  if (process.env.NODE_ENV !== 'production' && !secrets.includes(DEFAULT_ENCRYPTION_SECRET)) {
    secrets.push(DEFAULT_ENCRYPTION_SECRET);
  }
  return secrets.map(deriveKey);
}

export function encryptPassword(password: string): string {
  const KEY = deriveKey(getCurrentSecret());
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv, { authTagLength: AUTH_TAG_LENGTH });

  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');

  const authTag = cipher.getAuthTag();

  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

function decryptWithKey(key: Buffer, iv: Buffer, authTag: Buffer, encrypted: string): string {
  // authTagLength фиксирован: иначе Node принимает укороченный тег (4–15 байт) и подделка проще
  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: AUTH_TAG_LENGTH });
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function decryptPassword(encryptedData: string): string {
  try {
    const parts = encryptedData.split(':');
    if (parts.length !== 3) throw new Error('Invalid encrypted data format');
    const [ivHex, authTagHex, encrypted] = parts;
    if (!ivHex || !authTagHex || !encrypted || !/^[0-9a-f]+$/i.test(ivHex + authTagHex + encrypted)) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    if (iv.length !== IV_LENGTH || authTag.length !== AUTH_TAG_LENGTH) {
      throw new Error('Invalid encrypted data format');
    }

    for (const key of getDecryptionKeys()) {
      try {
        return decryptWithKey(key, iv, authTag, encrypted);
      } catch {
        // пробуем следующий (предыдущий) ключ
      }
    }
    throw new Error('Decryption failed');
  } catch {
    // Не логируем содержимое ошибки — может содержать чувствительные данные
    throw new Error('Failed to decrypt password');
  }
}

const AUTH_TOKEN_PREFIX = 'enc:';

/** Шифрование RC auth token для хранения в БД. */
export function encryptAuthToken(token: string): string {
  return AUTH_TOKEN_PREFIX + encryptPassword(token);
}

/** Расшифровка RC auth token. Поддерживает legacy (незашифрованные) значения. */
export function decryptAuthToken(stored: string | null | undefined): string | null {
  if (!stored?.trim()) return null;
  if (stored.startsWith(AUTH_TOKEN_PREFIX)) {
    try {
      return decryptPassword(stored.slice(AUTH_TOKEN_PREFIX.length));
    } catch {
      return null;
    }
  }
  return stored;
}
