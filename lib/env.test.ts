import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnv } from './env';

const originalEnv = { ...process.env };

/** ProcessEnv помечает NODE_ENV как read-only для TS — в тестах задаём через запись в объект окружения. */
function setNodeEnv(value: string | undefined) {
  (process.env as Record<string, string | undefined>).NODE_ENV = value
}

describe('validateEnv', () => {
  beforeEach(() => {
    setNodeEnv('test');
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    process.env.JWT_SECRET = originalEnv.JWT_SECRET;
    if (originalEnv.ENCRYPTION_KEY === undefined) delete process.env.ENCRYPTION_KEY;
    else process.env.ENCRYPTION_KEY = originalEnv.ENCRYPTION_KEY;
    setNodeEnv(originalEnv.NODE_ENV);
  });

  it('does not throw when DATABASE_URL and JWT_SECRET are set', () => {
    expect(() => validateEnv()).not.toThrow();
  });

  it('throws when DATABASE_URL is missing', () => {
    delete process.env.DATABASE_URL;
    expect(() => validateEnv()).toThrow('DATABASE_URL');
  });

  it('throws when JWT_SECRET is missing', () => {
    delete process.env.JWT_SECRET;
    expect(() => validateEnv()).toThrow('JWT_SECRET');
  });

  it('throws in production when JWT_SECRET is default', () => {
    setNodeEnv('production');
    process.env.JWT_SECRET = 'your-secret-key';
    expect(() => validateEnv()).toThrow('JWT_SECRET must be set in production');
  });

  it('throws in production for other known placeholders', () => {
    setNodeEnv('production');
    process.env.JWT_SECRET = 'changeme';
    process.env.ENCRYPTION_KEY = 'e'.repeat(44);
    expect(() => validateEnv()).toThrow('JWT_SECRET must be set in production');
  });

  it('throws in production without ENCRYPTION_KEY (fail closed)', () => {
    setNodeEnv('production');
    process.env.JWT_SECRET = 'j'.repeat(44);
    delete process.env.ENCRYPTION_KEY;
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY must be set in production');
    process.env.ENCRYPTION_KEY = 'default-secret-key';
    expect(() => validateEnv()).toThrow('ENCRYPTION_KEY must be set in production');
  });

  it('starts in production with strong secrets', () => {
    setNodeEnv('production');
    process.env.JWT_SECRET = 'j'.repeat(44);
    process.env.ENCRYPTION_KEY = 'e'.repeat(44);
    expect(() => validateEnv()).not.toThrow();
  });
});
