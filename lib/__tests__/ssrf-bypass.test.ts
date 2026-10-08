import { describe, it, expect, afterEach } from 'vitest';
import { isSsrfUrl, assertSafeOutboundUrl, __setSsrfResolverForTests } from '../ssrf';

/** Набор известных обходов SSRF-фильтров — все должны блокироваться. */
describe('isSsrfUrl — bypass cases', () => {
  const blocked = [
    // альтернативные записи 127.0.0.1 (WHATWG URL нормализует их в dotted-quad)
    'http://2130706433/',
    'http://0x7f000001/',
    'http://0177.0.0.1/',
    'http://0x7f.0.0.1/',
    'http://127.1/',
    'http://127.0.0.1./',
    // trailing dot у имени
    'http://localhost./',
    'http://LOCALHOST/',
    // 0.0.0.0 и 0/8
    'http://0.0.0.0/',
    'http://0/',
    // облачные metadata / link-local / CGNAT
    'http://169.254.169.254/latest/meta-data/',
    'http://100.100.100.200/',
    'http://metadata.google.internal/',
    // IPv6 loopback/unspecified/link-local/ULA
    'http://[::1]/',
    'http://[::]/',
    'http://[fe80::1]/',
    'http://[fc00::1]/',
    'http://[fd12:3456::1]/',
    // IPv4-mapped / IPv4-compatible IPv6
    'http://[::ffff:127.0.0.1]/',
    'http://[::ffff:7f00:1]/',
    'http://[::ffff:169.254.169.254]/',
    'http://[::127.0.0.1]/',
    // userinfo-трюки: креды в URL не принимаются вовсе
    'http://rc.example.com@127.0.0.1/',
    'http://user:pass@rc.example.com/',
    // недопустимые схемы
    'file:///etc/passwd',
    'gopher://rc.example.com:70/',
    'ftp://rc.example.com/',
    'javascript:alert(1)',
  ];

  for (const url of blocked) {
    it(`blocks ${url}`, () => {
      expect(isSsrfUrl(url)).toBe(true);
    });
  }

  it('allows normal public hosts and custom ports', () => {
    expect(isSsrfUrl('https://open.rocket.chat')).toBe(false);
    expect(isSsrfUrl('https://rc.example.com:3000/')).toBe(false);
    expect(isSsrfUrl('https://8.8.8.8/')).toBe(false);
  });
});

describe('assertSafeOutboundUrl — DNS', () => {
  afterEach(() => __setSsrfResolverForTests(null));

  it('blocks public-looking names that resolve to internal addresses (e.g. 127.0.0.1.nip.io)', async () => {
    __setSsrfResolverForTests(async () => ['127.0.0.1']);
    await expect(assertSafeOutboundUrl('https://127.0.0.1.nip.io/')).rejects.toThrow();
  });

  it('blocks when any resolved address is internal (mixed A records)', async () => {
    __setSsrfResolverForTests(async () => ['93.184.216.34', '10.0.0.5']);
    await expect(assertSafeOutboundUrl('https://rebind.example/')).rejects.toThrow();
  });

  it('allows names that resolve only to public addresses', async () => {
    __setSsrfResolverForTests(async () => ['93.184.216.34']);
    await expect(assertSafeOutboundUrl('https://rc.example.com/')).resolves.toBeUndefined();
  });
});
