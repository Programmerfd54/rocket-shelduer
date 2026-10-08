/**
 * Валидация переменных окружения при старте приложения.
 * Вызывается из instrumentation.ts (Node.js runtime).
 *
 * Fail closed: в production приложение не стартует без JWT_SECRET / ENCRYPTION_KEY
 * или с известными «заглушками» из примеров (your-secret-key, default-secret-key, changeme…).
 */
import { KNOWN_WEAK_SECRETS } from './http-security';

function getEnv(name: string): string | undefined {
  return process.env[name];
}

function isPlaceholder(value: string | undefined): boolean {
  return !!value && KNOWN_WEAK_SECRETS.has(value.trim().toLowerCase());
}

export function validateEnv(): void {
  const missing: string[] = [];
  const databaseUrl = getEnv('DATABASE_URL');
  const jwtSecret = getEnv('JWT_SECRET');
  const isProduction = process.env.NODE_ENV === 'production';

  if (!databaseUrl || databaseUrl.trim() === '') {
    missing.push('DATABASE_URL');
  }

  if (!jwtSecret || jwtSecret.trim() === '') {
    missing.push('JWT_SECRET');
  }

  if (missing.length > 0) {
    throw new Error(
      `Missing required environment variables: ${missing.join(', ')}. ` +
        'Check .env and .env.example.'
    );
  }

  const warnings: string[] = [];

  if (isPlaceholder(jwtSecret)) {
    if (isProduction) {
      throw new Error(
        'JWT_SECRET must be set in production and must not be a default/placeholder value (e.g. your-secret-key). ' +
          'Generate one: openssl rand -base64 32'
      );
    }
    warnings.push('JWT_SECRET is a placeholder value — acceptable only for local development.');
  } else if (jwtSecret!.trim().length < 32) {
    warnings.push('JWT_SECRET is shorter than 32 characters. Use: openssl rand -base64 32');
  }

  const encryptionKey = getEnv('ENCRYPTION_KEY');
  if (isProduction) {
    if (!encryptionKey || !encryptionKey.trim() || isPlaceholder(encryptionKey)) {
      throw new Error(
        'ENCRYPTION_KEY must be set in production (Rocket.Chat credentials are encrypted with it). ' +
          'Generate one: openssl rand -base64 32. Do NOT change it on an existing database without re-encrypting.'
      );
    }
    if (encryptionKey.trim().length < 32) {
      warnings.push('ENCRYPTION_KEY is shorter than 32 characters.');
    }
    if (encryptionKey === jwtSecret) {
      warnings.push('ENCRYPTION_KEY equals JWT_SECRET — use independent secrets.');
    }
    const cronSecret = getEnv('CRON_SECRET');
    if (cronSecret && (isPlaceholder(cronSecret) || cronSecret.trim().length < 32)) {
      warnings.push('CRON_SECRET is weak (placeholder or < 32 chars); /api/cron/* will reject placeholders.');
    }
    if (process.env.ALLOW_PUBLIC_REGISTER === 'true') {
      warnings.push('ALLOW_PUBLIC_REGISTER=true — anyone can create a MEMBER account.');
    }
  }

  for (const w of warnings) console.warn(`[env] ${w}`);
}
