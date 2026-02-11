/**
 * Валидация переменных окружения при старте приложения.
 * Вызывается из instrumentation.ts (Node.js runtime).
 */

function getEnv(name: string): string | undefined {
  return process.env[name];
}

export function validateEnv(): void {
  const missing: string[] = [];
  const databaseUrl = getEnv('DATABASE_URL');
  const jwtSecret = getEnv('JWT_SECRET');

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

  const defaultJwt = 'your-secret-key';
  if (process.env.NODE_ENV === 'production' && (jwtSecret === defaultJwt || !jwtSecret)) {
    throw new Error(
      'JWT_SECRET must be set in production and must not be the default value (your-secret-key).'
    );
  }
}
