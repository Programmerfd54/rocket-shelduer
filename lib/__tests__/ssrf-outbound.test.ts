import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setSsrfResolverForTests,
  assertSafeOutboundUrl,
  classifyIp,
  isSsrfUrl,
  safeFetch,
} from '../ssrf';

afterEach(() => {
  __setSsrfResolverForTests(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe('classifyIp', () => {
  it('classifies loopback, link-local and metadata as blocked', () => {
    for (const ip of ['127.0.0.1', '127.1.2.3', '0.0.0.0', '169.254.169.254', '::1', '::', 'fe80::1', '::ffff:127.0.0.1', '::ffff:7f00:1', '::ffff:169.254.169.254']) {
      expect(classifyIp(ip), ip).toBe('blocked');
    }
  });

  it('classifies RFC1918 / CGNAT / ULA as private', () => {
    for (const ip of ['10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.0.10', '100.64.0.1', '100.100.100.200', 'fd00::1', 'fc12::3', '::ffff:10.0.0.1']) {
      expect(classifyIp(ip), ip).toBe('private');
    }
  });

  it('classifies public addresses as public', () => {
    for (const ip of ['8.8.8.8', '172.32.0.1', '93.184.216.34', '2001:4860:4860::8888']) {
      expect(classifyIp(ip), ip).toBe('public');
    }
  });

  it('returns invalid for hostnames', () => {
    expect(classifyIp('example.com')).toBe('invalid');
  });
});

describe('isSsrfUrl (extended)', () => {
  it('blocks alternative IP encodings normalised by URL parser', () => {
    expect(isSsrfUrl('http://2130706433/')).toBe(true); // 127.0.0.1 decimal
    expect(isSsrfUrl('http://0x7f.1/')).toBe(true);
    expect(isSsrfUrl('http://[::ffff:127.0.0.1]/')).toBe(true);
    expect(isSsrfUrl('http://0.0.0.0:3000/')).toBe(true);
    expect(isSsrfUrl('http://100.100.100.200/latest/meta-data')).toBe(true);
    expect(isSsrfUrl('http://metadata.google.internal/')).toBe(true);
  });

  it('blocks non-http schemes and credentials in URL', () => {
    expect(isSsrfUrl('file:///etc/passwd')).toBe(true);
    expect(isSsrfUrl('ftp://example.com/')).toBe(true);
    expect(isSsrfUrl('https://user:pass@example.com/')).toBe(true);
  });

  it('allows private hosts listed in SSRF_ALLOWED_HOSTS but never loopback', () => {
    vi.stubEnv('SSRF_ALLOWED_HOSTS', '10.0.0.5, rc.corp.local, 127.0.0.1');
    expect(isSsrfUrl('https://10.0.0.5/')).toBe(false);
    expect(isSsrfUrl('https://rc.corp.local/')).toBe(false);
    expect(isSsrfUrl('https://10.0.0.6/')).toBe(true);
    expect(isSsrfUrl('http://127.0.0.1/')).toBe(true);
  });

  it('still allows ordinary public URLs', () => {
    expect(isSsrfUrl('https://rocketchat-student.21-school.ru')).toBe(false);
  });
});

describe('assertSafeOutboundUrl (DNS)', () => {
  it('blocks hostnames resolving to internal addresses', async () => {
    __setSsrfResolverForTests(async (host) => (host === 'evil.example' ? ['127.0.0.1'] : ['93.184.216.34']));
    await expect(assertSafeOutboundUrl('https://evil.example/api')).rejects.toThrow(/blocked/);
    await expect(assertSafeOutboundUrl('https://good.example/api')).resolves.toBeUndefined();
  });

  it('blocks if any resolved address is private', async () => {
    __setSsrfResolverForTests(async () => ['93.184.216.34', '10.0.0.1']);
    await expect(assertSafeOutboundUrl('https://mixed.example/')).rejects.toThrow(/blocked/);
  });

  it('does not block on DNS failure (fetch fails by itself)', async () => {
    __setSsrfResolverForTests(async () => {
      throw new Error('ENOTFOUND');
    });
    await expect(assertSafeOutboundUrl('https://nx.example/')).resolves.toBeUndefined();
  });
});

describe('safeFetch', () => {
  it('refuses redirects to internal addresses', async () => {
    __setSsrfResolverForTests(async () => ['93.184.216.34']);
    const fetcher = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://169.254.169.254/latest/meta-data' } }));
    vi.stubGlobal('fetch', fetcher);
    await expect(safeFetch('https://rc.example/api/v1/me')).rejects.toThrow(/blocked/);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('does not forward Rocket.Chat credentials to another origin on redirect', async () => {
    __setSsrfResolverForTests(async () => ['93.184.216.34']);
    const seen: Headers[] = [];
    const fetcher = vi.fn(async (url: string, init: RequestInit) => {
      seen.push(new Headers(init.headers));
      if (url.startsWith('https://rc.example')) {
        return new Response(null, { status: 307, headers: { location: 'https://other.example/api/v1/me' } });
      }
      return Response.json({ ok: true });
    });
    vi.stubGlobal('fetch', fetcher);
    const res = await safeFetch('https://rc.example/api/v1/me', { headers: { 'X-Auth-Token': 't', 'X-User-Id': 'u' } });
    expect(res.status).toBe(200);
    expect(seen[0].get('x-auth-token')).toBe('t');
    expect(seen[1].get('x-auth-token')).toBeNull();
    expect(seen[1].get('x-user-id')).toBeNull();
  });

  it('blocks the initial request to a private literal without calling fetch', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    await expect(safeFetch('http://192.168.1.1/api/v1/login', { method: 'POST' })).rejects.toThrow(/blocked/);
    expect(fetcher).not.toHaveBeenCalled();
  });
});
