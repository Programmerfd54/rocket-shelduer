import { describe, it, expect, vi, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';

vi.mock('next/headers', () => ({ cookies: vi.fn(), headers: vi.fn() }));
vi.mock('@/lib/prisma', () => ({ default: {} }));
vi.mock('../prisma', () => ({ default: {} }));

const SECRET = 's'.repeat(44);

describe('JWT helpers', () => {
  beforeAll(() => {
    process.env.JWT_SECRET = SECRET;
  });

  it('signs HS256 tokens with sessionId and optional pwc claim', async () => {
    const { generateToken, verifyToken } = await import('../auth');
    const t = generateToken({ userId: 'u1', email: 'a', role: 'MEMBER', sessionId: 's1', pwc: true }, 60);
    const header = JSON.parse(Buffer.from(t.split('.')[0], 'base64url').toString());
    expect(header.alg).toBe('HS256');
    const p = verifyToken(t);
    expect(p?.sessionId).toBe('s1');
    expect(p?.pwc).toBe(true);
    const t2 = generateToken({ userId: 'u1', email: 'a', role: 'MEMBER', sessionId: 's1' }, 60);
    expect(verifyToken(t2)?.pwc).toBeUndefined();
  });

  it('rejects other algorithms, alg=none, wrong secret and expired tokens', async () => {
    const { verifyToken } = await import('../auth');
    const payload = { userId: 'u1', email: 'a', role: 'LEAD_SUP', sessionId: 's1' };
    expect(verifyToken(jwt.sign(payload, SECRET, { algorithm: 'HS512' }))).toBeNull();
    const none = `${Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.`;
    expect(verifyToken(none)).toBeNull();
    expect(verifyToken(jwt.sign(payload, 'other-secret'))).toBeNull();
    expect(verifyToken(jwt.sign({ ...payload, exp: Math.floor(Date.now() / 1000) - 10 }, SECRET))).toBeNull();
  });
});

describe('validateNewPassword (server-side policy)', () => {
  it('enforces length, strength and difference from login', async () => {
    const { validateNewPassword } = await import('../auth');
    expect(await validateNewPassword('short')).toMatch(/минимум 8/);
    expect(await validateNewPassword('a'.repeat(300))).toMatch(/слишком длинный/);
    expect(await validateNewPassword('alllowercase')).toMatch(/простой/);
    expect(await validateNewPassword('Ivan.Petrov1', ['ivan.petrov1@school.ru'])).toMatch(/логином/);
    expect(await validateNewPassword('Ivan.Petrov1', ['Ivan.Petrov1'])).toMatch(/логином/);
    expect(await validateNewPassword('Str0ng!Passw0rd', ['ivan', null])).toBeNull();
    expect(await validateNewPassword(undefined)).toMatch(/минимум 8/);
  });
});
