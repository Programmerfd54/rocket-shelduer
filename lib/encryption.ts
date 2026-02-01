import crypto from 'crypto';

/**
 * Шифрование паролей пространств (Rocket.Chat).
 * - В проде задать отдельный ENCRYPTION_KEY в .env (не использовать JWT_SECRET для шифрования).
 * - Расшифровка только на сервере при обращении к Rocket.Chat API.
 * - encryptedPassword и исходный пароль никогда не возвращаются клиенту и не логируются.
 */
const ALGORITHM = 'aes-256-gcm';
const DEFAULT_ENCRYPTION_SECRET = 'default-secret-key';

function getEncryptionKey(): Buffer {
  const secret =
    process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || DEFAULT_ENCRYPTION_SECRET;
  if (
    process.env.NODE_ENV === 'production' &&
    (secret === DEFAULT_ENCRYPTION_SECRET || !process.env.ENCRYPTION_KEY)
  ) {
    throw new Error('ENCRYPTION_KEY must be set in production for workspace credentials.');
  }
  return crypto.scryptSync(secret, 'workspace-credentials-salt', 32);
}

export function encryptPassword(password: string): string {
  const KEY = getEncryptionKey();
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  
  let encrypted = cipher.update(password, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  
  const authTag = cipher.getAuthTag();
  
  return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
}

export function decryptPassword(encryptedData: string): string {
  try {
    const KEY = getEncryptionKey();
    const [ivHex, authTagHex, encrypted] = encryptedData.split(':');

    if (!ivHex || !authTagHex || !encrypted) {
      throw new Error('Invalid encrypted data format');
    }

    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
    
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch {
    // Не логируем содержимое ошибки — может содержать чувствительные данные
    throw new Error('Failed to decrypt password');
  }
}