import { describe, it, expect } from 'vitest';
import {
  buildAllowedOrigins,
  checkBearerSecret,
  checkCsrf,
  createFixedWindowLimiter,
  getClientIpFromHeaders,
  isOriginAllowed,
  isPasswordChangeExemptPath,
  normalizeOrigin,
  parseTrustedProxyHops,
  resolveJwtSecret,
  timingSafeEqualString,
} from '../http-security';

const h = (init: Record<string, string>) => new Headers(init);

describe('getClientIpFromHeaders', () => {
  it('default (1 trusted proxy): rightmost X-Forwarded-For entry wins over spoofed leftmost', () => {
    expect(getClientIpFromHeaders(h({ 'x-forwarded-for': '1.1.1.1, 2.2.2.2, 203.0.113.9' }), {})).toBe('203.0.113.9');
  });

  it('TRUSTED_PROXY_HOPS=2 picks the second entry from the right', () => {
    const env = { TRUSTED_PROXY_HOPS: '2' };
    expect(getClientIpFromHeaders(h({ 'x-forwarded-for': '6.6.6.6, 198.51.100.4, 10.0.0.2' }), env)).toBe('198.51.100.4');
  });

  it('more hops than entries → leftmost entry', () => {
    expect(getClientIpFromHeaders(h({ 'x-forwarded-for': '198.51.100.4' }), { TRUSTED_PROXY_HOPS: '3' })).toBe('198.51.100.4');
  });

  it('falls back to X-Real-IP, strips ports/brackets, rejects garbage', () => {
    expect(getClientIpFromHeaders(h({ 'x-real-ip': '203.0.113.1:5555' }), {})).toBe('203.0.113.1');
    expect(getClientIpFromHeaders(h({ 'x-forwarded-for': '[2001:db8::1]:443' }), {})).toBe('2001:db8::1');
    expect(getClientIpFromHeaders(h({ 'x-forwarded-for': 'evil-host; DROP TABLE' }), {})).toBeNull();
    expect(getClientIpFromHeaders(h({}), {})).toBeNull();
  });

  it('parseTrustedProxyHops clamps invalid values', () => {
    expect(parseTrustedProxyHops(undefined)).toBe(1);
    expect(parseTrustedProxyHops('0')).toBe(1);
    expect(parseTrustedProxyHops('abc')).toBe(1);
    expect(parseTrustedProxyHops('99')).toBe(10);
  });
});

describe('createFixedWindowLimiter', () => {
  it('limits after max hits and resets after the window', () => {
    const l = createFixedWindowLimiter({ windowMs: 1000, max: 3 });
    expect(l.hit('a', 0)).toBe(false);
    expect(l.hit('a', 1)).toBe(false);
    expect(l.hit('a', 2)).toBe(false);
    expect(l.hit('a', 3)).toBe(true);
    expect(l.isLimited('a', 4)).toBe(true);
    expect(l.hit('a', 1001)).toBe(false);
    expect(l.isLimited('a', 1002)).toBe(false);
  });

  it('isLimited does not count; reset clears', () => {
    const l = createFixedWindowLimiter({ windowMs: 1000, max: 2 });
    l.isLimited('k', 0);
    l.isLimited('k', 0);
    expect(l.hit('k', 0)).toBe(false);
    expect(l.hit('k', 0)).toBe(false);
    expect(l.isLimited('k', 0)).toBe(true);
    l.reset('k');
    expect(l.isLimited('k', 0)).toBe(false);
  });

  it('ignores empty keys and bounds memory under key rotation', () => {
    const l = createFixedWindowLimiter({ windowMs: 60_000, max: 5, maxKeys: 100 });
    expect(l.hit(null)).toBe(false);
    expect(l.hit('  ')).toBe(false);
    for (let i = 0; i < 1000; i++) l.hit(`ip-${i}`, 0);
    expect(l.size()).toBeLessThanOrEqual(100);
  });
});

describe('origin allow-list', () => {
  const allowed = buildAllowedOrigins({
    requestOrigin: 'http://localhost:3000',
    host: 'app.example.com',
    forwardedProto: 'https',
    env: { APP_URL: 'https://app.example.com/', CORS_ALLOWED_ORIGINS: 'https://admin.example.com' },
  });

  it('normalizes origins', () => {
    expect(normalizeOrigin('https://app.example.com/path?x=1')).toBe('https://app.example.com');
    expect(normalizeOrigin('null')).toBeNull();
    expect(normalizeOrigin('javascript:alert(1)')).toBeNull();
  });

  it('allows exact matches only', () => {
    expect(isOriginAllowed('https://app.example.com', allowed)).toBe(true);
    expect(isOriginAllowed('http://localhost:3000', allowed)).toBe(true);
    expect(isOriginAllowed('https://admin.example.com', allowed)).toBe(true);
  });

  it('rejects prefix/suffix tricks that the old startsWith check accepted', () => {
    expect(isOriginAllowed('https://app.example.com.evil.com', allowed)).toBe(false);
    expect(isOriginAllowed('https://app.example', allowed)).toBe(false); // old: a.startsWith(origin)
    expect(isOriginAllowed('https://evil-app.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('http://app.example.com', allowed)).toBe(false);
    expect(isOriginAllowed('null', allowed)).toBe(false);
    expect(isOriginAllowed(null, allowed)).toBe(false);
  });
});

describe('checkCsrf', () => {
  const allowed = new Set(['https://app.example.com']);
  const base = { method: 'POST', origin: null, referer: null, secFetchSite: null, allowed };

  it('safe methods always pass', () => {
    expect(checkCsrf({ ...base, method: 'GET', origin: 'https://evil.com' }).ok).toBe(true);
  });

  it('same-origin POST passes', () => {
    expect(checkCsrf({ ...base, origin: 'https://app.example.com' }).ok).toBe(true);
  });

  it('foreign Origin is rejected even when Referer is absent (old bypass)', () => {
    expect(checkCsrf({ ...base, origin: 'https://evil.example.com' }).ok).toBe(false);
  });

  it('Origin: null (sandboxed iframe / no-referrer) is rejected', () => {
    expect(checkCsrf({ ...base, origin: 'null' }).ok).toBe(false);
  });

  it('foreign Origin cannot be rescued by a matching Referer', () => {
    expect(checkCsrf({ ...base, origin: 'https://evil.com', referer: 'https://app.example.com/x' }).ok).toBe(false);
  });

  it('without Origin, Referer must match', () => {
    expect(checkCsrf({ ...base, referer: 'https://app.example.com/dashboard' }).ok).toBe(true);
    expect(checkCsrf({ ...base, referer: 'https://app.example.com.evil.com/' }).ok).toBe(false);
  });

  it('no Origin/Referer: cross-site Sec-Fetch-Site rejected, non-browser clients pass', () => {
    expect(checkCsrf({ ...base, secFetchSite: 'cross-site' }).ok).toBe(false);
    expect(checkCsrf({ ...base, secFetchSite: 'same-site' }).ok).toBe(false);
    expect(checkCsrf({ ...base, secFetchSite: 'same-origin' }).ok).toBe(true);
    expect(checkCsrf(base).ok).toBe(true);
  });
});

describe('secrets', () => {
  it('timingSafeEqualString', () => {
    expect(timingSafeEqualString('abc', 'abc')).toBe(true);
    expect(timingSafeEqualString('abc', 'abd')).toBe(false);
    expect(timingSafeEqualString('abc', 'abcd')).toBe(false);
    expect(timingSafeEqualString('', '')).toBe(true);
    expect(timingSafeEqualString(null, 'a')).toBe(false);
  });

  it('checkBearerSecret', () => {
    const s = 'x'.repeat(40);
    expect(checkBearerSecret(`Bearer ${s}`, s, true)).toBe('ok');
    expect(checkBearerSecret(`bearer   ${s}`, s, true)).toBe('ok');
    expect(checkBearerSecret(`Bearer ${s}x`, s, true)).toBe('unauthorized');
    expect(checkBearerSecret(null, s, true)).toBe('unauthorized');
    expect(checkBearerSecret(s, s, true)).toBe('unauthorized');
    expect(checkBearerSecret('Bearer x', undefined, true)).toBe('misconfigured');
    expect(checkBearerSecret('Bearer changeme', 'changeme', true)).toBe('misconfigured');
    expect(checkBearerSecret(null, undefined, false)).toBe('ok'); // dev без секрета — как раньше
  });

  it('resolveJwtSecret has no default and rejects placeholders in production', () => {
    expect(resolveJwtSecret({})).toBeNull();
    expect(resolveJwtSecret({ JWT_SECRET: '  ' })).toBeNull();
    expect(resolveJwtSecret({ JWT_SECRET: 'your-secret-key', NODE_ENV: 'production' })).toBeNull();
    expect(resolveJwtSecret({ JWT_SECRET: 'your-secret-key', NODE_ENV: 'development' })).toBe('your-secret-key');
    expect(resolveJwtSecret({ JWT_SECRET: 'a'.repeat(44), NODE_ENV: 'production' })).toBe('a'.repeat(44));
  });
});

describe('isPasswordChangeExemptPath', () => {
  it('only auth/set-initial-password endpoints are reachable with a temporary password', () => {
    expect(isPasswordChangeExemptPath('/api/auth/me')).toBe(true);
    expect(isPasswordChangeExemptPath('/api/auth/logout')).toBe(true);
    expect(isPasswordChangeExemptPath('/api/user/set-initial-password')).toBe(true);
    expect(isPasswordChangeExemptPath('/api/messages')).toBe(false);
    expect(isPasswordChangeExemptPath('/api/user/password')).toBe(false);
    expect(isPasswordChangeExemptPath('/api/admin/users')).toBe(false);
    expect(isPasswordChangeExemptPath('/api/authz')).toBe(false);
  });
});
