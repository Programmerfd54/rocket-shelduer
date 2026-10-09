import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { encryptPassword, decryptPassword, encryptAuthToken, decryptAuthToken } from '../encryption';

const saved = { ...process.env };
function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete (process.env as Record<string, string | undefined>)[k];
    else (process.env as Record<string, string | undefined>)[k] = v;
  }
}

describe('encryption (AES-256-GCM)', () => {
  beforeEach(() => {
    setEnv({ NODE_ENV: 'test', ENCRYPTION_KEY: 'k'.repeat(44), ENCRYPTION_KEY_PREVIOUS: undefined });
  });
  afterEach(() => {
    setEnv({
      NODE_ENV: saved.NODE_ENV,
      ENCRYPTION_KEY: saved.ENCRYPTION_KEY,
      ENCRYPTION_KEY_PREVIOUS: saved.ENCRYPTION_KEY_PREVIOUS,
    });
  });

  it('round-trips and uses a fresh IV each time', () => {
    const a = encryptPassword('secret-пароль');
    const b = encryptPassword('secret-пароль');
    expect(a).not.toBe(b);
    expect(decryptPassword(a)).toBe('secret-пароль');
    expect(a.startsWith('enc2:')).toBe(true);
  });

  it('rejects tampered ciphertext and truncated auth tags', () => {
    const [head, kid, flag, iv, tag, ct] = encryptPassword('hello').split(':');
    const flipped = (ct[0] === 'A' ? 'B' : 'A') + ct.slice(1);
    expect(() => decryptPassword(`${head}:${kid}:${flag}:${iv}:${tag}:${flipped}`)).toThrow('Failed to decrypt password');
    expect(() => decryptPassword(`${head}:${kid}:${flag}:${iv}:${tag.slice(0, 8)}:${ct}`)).toThrow('Failed to decrypt password');
    expect(() => decryptPassword('garbage')).toThrow('Failed to decrypt password');
  });

  it('fails closed in production without ENCRYPTION_KEY', () => {
    setEnv({ NODE_ENV: 'production', ENCRYPTION_KEY: undefined });
    expect(() => encryptPassword('x')).toThrow('ENCRYPTION_KEY must be set');
    setEnv({ ENCRYPTION_KEY: 'default-secret-key' });
    expect(() => encryptPassword('x')).toThrow('ENCRYPTION_KEY must be set');
  });

  it('supports key rotation via ENCRYPTION_KEY_PREVIOUS', () => {
    const old = encryptPassword('rotated');
    setEnv({ ENCRYPTION_KEY: 'n'.repeat(44) });
    expect(() => decryptPassword(old)).toThrow();
    setEnv({ ENCRYPTION_KEY_PREVIOUS: 'k'.repeat(44) });
    expect(decryptPassword(old)).toBe('rotated');
  });

  it('auth token helpers keep legacy plaintext support and hide failures', () => {
    const enc = encryptAuthToken('rc-token');
    expect(enc.startsWith('enc2:')).toBe(true);
    expect(decryptAuthToken(enc)).toBe('rc-token');
    expect(decryptAuthToken('legacy-plain')).toBe('legacy-plain');
    expect(decryptAuthToken('enc:bad')).toBeNull();
    expect(decryptAuthToken(null)).toBeNull();
  });
});
