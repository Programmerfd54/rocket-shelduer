/**
 * Платформенные меры: __Host- cookie, nonce-CSP, защищённые загрузки (заголовки, Range, квота),
 * метки лимита входа по учётной записи.
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  API_CSP,
  AUTH_COOKIE_HOST,
  AUTH_COOKIE_LEGACY,
  DEVICE_COOKIE_HOST,
  DEVICE_COOKIE_LEGACY,
  authCookieName,
  buildPageCsp,
  deviceCookieName,
  generateCspNonce,
  isApiCacheablePath,
  isProtectedUploadPath,
  isSecureCookieMode,
  readCookiePreferHost,
} from '../http-security';
import {
  checkUploadQuota,
  classifyUploadName,
  helpUploadQuotaFromEnv,
  helpUploadTimestamp,
  isSafeUploadName,
  isUploadBucket,
  parseRange,
  uploadResponseHeaders,
  UPLOAD_CSP,
} from '../uploaded-files';
import { accountLockWindowStart, accountLoginMarker, ACCOUNT_LOGIN_WINDOW_MS } from '../security';

describe('auth cookie names (__Host- prefix)', () => {
  it('uses __Host- names only in production with secure cookies', () => {
    expect(isSecureCookieMode({ NODE_ENV: 'production' })).toBe(true);
    expect(isSecureCookieMode({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toBe(false);
    expect(isSecureCookieMode({ NODE_ENV: 'development' })).toBe(false);
    expect(authCookieName({ NODE_ENV: 'production' })).toBe(AUTH_COOKIE_HOST);
    expect(deviceCookieName({ NODE_ENV: 'production' })).toBe(DEVICE_COOKIE_HOST);
    expect(authCookieName({ NODE_ENV: 'production', COOKIE_SECURE: 'false' })).toBe(AUTH_COOKIE_LEGACY);
    expect(deviceCookieName({ NODE_ENV: 'test' })).toBe(DEVICE_COOKIE_LEGACY);
    expect(AUTH_COOKIE_HOST.startsWith('__Host-')).toBe(true);
  });

  it('reads the new name first, then the legacy one', () => {
    const jar = (c: Record<string, string>) => (n: string) => c[n];
    expect(readCookiePreferHost(jar({ [AUTH_COOKIE_HOST]: 'new', [AUTH_COOKIE_LEGACY]: 'old' }), AUTH_COOKIE_HOST, AUTH_COOKIE_LEGACY)).toBe('new');
    expect(readCookiePreferHost(jar({ [AUTH_COOKIE_LEGACY]: 'old' }), AUTH_COOKIE_HOST, AUTH_COOKIE_LEGACY)).toBe('old');
    expect(readCookiePreferHost(jar({ [AUTH_COOKIE_HOST]: '', [AUTH_COOKIE_LEGACY]: 'old' }), AUTH_COOKIE_HOST, AUTH_COOKIE_LEGACY)).toBe('old');
    expect(readCookiePreferHost(jar({}), AUTH_COOKIE_HOST, AUTH_COOKIE_LEGACY)).toBeUndefined();
  });
});

describe('nonce CSP', () => {
  it('generates unique base64 nonces of 128 bits', () => {
    const a = generateCspNonce();
    const b = generateCspNonce();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[A-Za-z0-9+/]{22}==$/);
  });

  it('production policy: nonce + strict-dynamic, no unsafe-inline/unsafe-eval in script-src', () => {
    const nonce = generateCspNonce();
    const csp = buildPageCsp(nonce);
    const scriptSrc = csp.split('; ').find((d) => d.startsWith('script-src '))!;
    expect(scriptSrc).toBe(`script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
    expect(csp).not.toContain('unsafe-eval');
    for (const d of ["object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'self'"]) {
      expect(csp).toContain(d);
    }
  });

  it('dev policy additionally allows unsafe-eval only', () => {
    const csp = buildPageCsp(generateCspNonce(), { dev: true });
    expect(csp).toMatch(/script-src [^;]*'unsafe-eval'/);
    expect(csp).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('rejects nonces that could inject directives', () => {
    expect(() => buildPageCsp("abc'; script-src *")).toThrow();
  });

  it('API CSP forbids everything', () => {
    expect(API_CSP).toContain("default-src 'none'");
    expect(API_CSP).toContain("frame-ancestors 'none'");
  });
});

describe('path helpers', () => {
  it('protected upload paths', () => {
    for (const p of ['/help-uploads/a.png', '/uploads/avatars/u.webp', '/uploads', '/help-uploads']) expect(isProtectedUploadPath(p), p).toBe(true);
    for (const p of ['/help', '/uploadsx', '/api/uploads/help/a.png', '/dashboard']) expect(isProtectedUploadPath(p), p).toBe(false);
  });

  it('API paths with own browser caching', () => {
    expect(isApiCacheablePath('/api/workspace/abc/emoji-image')).toBe(true);
    expect(isApiCacheablePath('/api/workspace/abc/emojis')).toBe(true);
    expect(isApiCacheablePath('/api/uploads/help/x.png')).toBe(true);
    expect(isApiCacheablePath('/api/auth/me')).toBe(false);
    expect(isApiCacheablePath('/api/workspace/abc/emoji-image/extra')).toBe(false);
  });
});

describe('uploaded files: names, types, headers', () => {
  it('validates bucket and file names', () => {
    expect(isUploadBucket('help')).toBe(true);
    expect(isUploadBucket('avatars')).toBe(true);
    expect(isUploadBucket('none')).toBe(false);
    expect(isSafeUploadName('help-1769853062938-487gorsd.jpg')).toBe(true);
    for (const bad of ['', '..', '../x', 'a/b', '.env', 'a\\b', 'x%2f..', 'a\nb']) expect(isSafeUploadName(bad), bad).toBe(false);
  });

  it('images/media inline, everything else attachment + octet-stream', () => {
    expect(classifyUploadName('a.PNG')).toEqual({ kind: 'image', contentType: 'image/png' });
    expect(classifyUploadName('a.mp4').kind).toBe('media');
    expect(classifyUploadName('a.pdf')).toEqual({ kind: 'download', contentType: 'application/octet-stream' });
    expect(classifyUploadName('a.svg').kind).toBe('download');
    expect(classifyUploadName('a.html').kind).toBe('download');

    const img = uploadResponseHeaders('help-1-a.png', 10, 1_700_000_000_000);
    expect(img['Content-Disposition']).toBe('inline');
    expect(img['X-Content-Type-Options']).toBe('nosniff');
    expect(img['Content-Security-Policy']).toBe(UPLOAD_CSP);
    expect(img['Cache-Control']).toBe('private, max-age=3600');
    const pdf = uploadResponseHeaders('help-1-a.pdf', 10, 1_700_000_000_000);
    expect(pdf['Content-Disposition']).toBe('attachment; filename="help-1-a.pdf"');
    expect(pdf['Content-Type']).toBe('application/octet-stream');
    expect(UPLOAD_CSP).toBe("default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox");
  });

  it('parses single byte ranges', () => {
    expect(parseRange(null, 100)).toBeNull();
    expect(parseRange('bytes=0-9', 100)).toEqual({ start: 0, end: 9 });
    expect(parseRange('bytes=90-', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=-10', 100)).toEqual({ start: 90, end: 99 });
    expect(parseRange('bytes=0-1000', 100)).toEqual({ start: 0, end: 99 });
    expect(parseRange('bytes=100-', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=5-1', 100)).toBe('unsatisfiable');
    expect(parseRange('bytes=0-1,5-6', 100)).toBeNull();
    expect(parseRange('items=0-1', 100)).toBeNull();
  });
});

describe('help upload daily quota', () => {
  const now = 1_800_000_000_000;
  const limits = { maxFiles: 3, maxBytes: 1000 };

  it('reads the timestamp from file names', () => {
    expect(helpUploadTimestamp('help-1769853062938-487gorsd.jpg')).toBe(1769853062938);
    expect(helpUploadTimestamp('other.png')).toBeNull();
  });

  it('counts only the last 24h, by name timestamp or mtime', () => {
    const entries = [
      { name: `help-${now - 1000}-a.png`, size: 300, mtimeMs: 0 },
      { name: `help-${now - 25 * 3600 * 1000}-b.png`, size: 900, mtimeMs: now }, // старый по имени
      { name: 'legacy.png', size: 200, mtimeMs: now - 10_000 }, // по mtime
    ];
    const r = checkUploadQuota(entries, 100, limits, now);
    expect(r).toEqual({ ok: true, usedFiles: 2, usedBytes: 500 });
  });

  it('rejects by count and by bytes', () => {
    const three = [1, 2, 3].map((i) => ({ name: `help-${now - i}-x.png`, size: 1, mtimeMs: now }));
    expect(checkUploadQuota(three, 1, limits, now)).toMatchObject({ ok: false, reason: 'files' });
    const one = [{ name: `help-${now - 1}-x.png`, size: 900, mtimeMs: now }];
    expect(checkUploadQuota(one, 200, limits, now)).toMatchObject({ ok: false, reason: 'bytes' });
  });

  it('limits from env with sane defaults', () => {
    expect(helpUploadQuotaFromEnv({})).toEqual({ maxFiles: 200, maxBytes: 1024 * 1024 * 1024 });
    expect(helpUploadQuotaFromEnv({ HELP_UPLOAD_DAILY_MAX_FILES: '5', HELP_UPLOAD_DAILY_MAX_MB: '10' })).toEqual({
      maxFiles: 5,
      maxBytes: 10 * 1024 * 1024,
    });
    expect(helpUploadQuotaFromEnv({ HELP_UPLOAD_DAILY_MAX_FILES: '-1', HELP_UPLOAD_DAILY_MAX_MB: 'abc' })).toEqual({
      maxFiles: 200,
      maxBytes: 1024 * 1024 * 1024,
    });
  });
});

describe('serveUploadedFile (temp dir)', () => {
  let dir: string;
  let serve: typeof import('../uploaded-files').serveUploadedFile;

  beforeAll(async () => {
    dir = mkdtempSync(path.join(tmpdir(), 'uploads-test-'));
    mkdirSync(path.join(dir, 'public', 'help-uploads'), { recursive: true });
    writeFileSync(path.join(dir, 'public', 'help-uploads', 'help-1-a.png'), Buffer.from('0123456789'));
    writeFileSync(path.join(dir, 'public', 'secret.txt'), 'nope');
    const spy = vi.spyOn(process, 'cwd').mockReturnValue(dir);
    vi.resetModules();
    serve = (await import('../uploaded-files')).serveUploadedFile;
    spy.mockRestore();
  });

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  it('serves a full file with safe headers', async () => {
    const res = (await serve('help', 'help-1-a.png', new Request('http://x/help-uploads/help-1-a.png')))!;
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('0123456789');
    expect(res.headers.get('content-type')).toBe('image/png');
    expect(res.headers.get('content-length')).toBe('10');
    expect(res.headers.get('x-content-type-options')).toBe('nosniff');
  });

  it('supports Range and conditional requests', async () => {
    const r = (await serve('help', 'help-1-a.png', new Request('http://x/', { headers: { range: 'bytes=2-4' } })))!;
    expect(r.status).toBe(206);
    expect(await r.text()).toBe('234');
    expect(r.headers.get('content-range')).toBe('bytes 2-4/10');
    const etag = r.headers.get('etag')!;
    const c = (await serve('help', 'help-1-a.png', new Request('http://x/', { headers: { 'if-none-match': etag } })))!;
    expect(c.status).toBe(304);
  });

  it('returns null for missing files and never leaves the bucket directory', async () => {
    expect(await serve('help', 'missing.png', new Request('http://x/'))).toBeNull();
    expect(await serve('help', '../secret.txt', new Request('http://x/'))).toBeNull();
  });
});

describe('account lockout markers (DB-backed limiter)', () => {
  it('marker is an HMAC of the normalised login, not the login itself', () => {
    const m = accountLoginMarker('  Admin@Example.com ', 's3cret');
    expect(m).toBe(accountLoginMarker('admin@example.com', 's3cret'));
    expect(m).toMatch(/^\[acct:[0-9a-f]{24}\]$/);
    expect(m.toLowerCase()).not.toContain('admin');
    expect(accountLoginMarker('admin@example.com', 'other')).not.toBe(m);
  });

  it('window starts 15 min ago or at the last successful login', () => {
    const now = 1_800_000_000_000;
    expect(accountLockWindowStart(now).getTime()).toBe(now - ACCOUNT_LOGIN_WINDOW_MS);
    expect(accountLockWindowStart(now, new Date(now - 60_000)).getTime()).toBe(now - 60_000);
    expect(accountLockWindowStart(now, new Date(now - 3600_000)).getTime()).toBe(now - ACCOUNT_LOGIN_WINDOW_MS);
  });
});
