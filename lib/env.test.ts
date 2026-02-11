import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { validateEnv } from './env';

const originalEnv = { ...process.env };

describe('validateEnv', () => {
  beforeEach(() => {
    process.env.NODE_ENV = 'test';
    process.env.DATABASE_URL = 'postgresql://localhost:5432/test';
    process.env.JWT_SECRET = 'test-secret';
  });

  afterEach(() => {
    process.env.DATABASE_URL = originalEnv.DATABASE_URL;
    process.env.JWT_SECRET = originalEnv.JWT_SECRET;
    process.env.NODE_ENV = originalEnv.NODE_ENV;
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
    process.env.NODE_ENV = 'production';
    process.env.JWT_SECRET = 'your-secret-key';
    expect(() => validateEnv()).toThrow('JWT_SECRET must be set in production');
  });
});
