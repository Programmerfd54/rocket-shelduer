/**
 * Проверка адреса в момент подключения (DNS rebinding / TOCTOU) и туннельные IPv6-префиксы.
 * Реальный DNS не используется: резолвер подменяется.
 */
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  __setSsrfResolverForTests,
  classifyIp,
  createSsrfSafeDispatcher,
  createSsrfSafeLookup,
  getSsrfSafeDispatcher,
  safeFetch,
  SsrfBlockedError,
  vetResolvedAddresses,
  type ResolvedAddress,
} from '../ssrf';
import { getPublicOnlyDispatcher, isPrivateIp } from '../emoji-safe-fetch';

afterEach(() => {
  __setSsrfResolverForTests(null);
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

function lookupAsync(
  fn: ReturnType<typeof createSsrfSafeLookup>,
  host: string,
  options: { all?: boolean; family?: number } = {}
): Promise<{ address: string | ResolvedAddress[]; family?: number }> {
  return new Promise((resolve, reject) => {
    fn(host, options, (err, address, family) => (err ? reject(err) : resolve({ address, family })));
  });
}

describe('classifyIp: tunnel / translation prefixes', () => {
  it('6to4 inherits the class of the embedded IPv4', () => {
    expect(classifyIp('2002:7f00:1::1')).toBe('blocked'); // 127.0.0.1
    expect(classifyIp('2002:a9fe:a9fe::')).toBe('blocked'); // 169.254.169.254
    expect(classifyIp('2002:0a00:0001::1')).toBe('private'); // 10.0.0.1
    expect(classifyIp('2002:c0a8:0101::1')).toBe('private'); // 192.168.1.1
    expect(classifyIp('2002:0808:0808::1')).toBe('public'); // 8.8.8.8
  });

  it('Teredo is never public and is blocked when embedding loopback/link-local', () => {
    // сервер 65.54.227.120, клиент ~ 0x7fffffff → 128.0.0.0 (публичные) → минимум private
    expect(classifyIp('2001:0:4136:e378:8000:63bf:3fff:fdd2')).toBe('private');
    // клиент = ~0x80fffffe = 127.0.0.1 → blocked
    expect(classifyIp('2001:0:4136:e378:8000:63bf:80ff:fffe')).toBe('blocked');
    // сервер 127.0.0.1
    expect(classifyIp('2001:0:7f00:1::')).toBe('blocked');
  });

  it('NAT64 maps to embedded IPv4 and is at least private', () => {
    expect(classifyIp('64:ff9b::7f00:1')).toBe('blocked');
    expect(classifyIp('64:ff9b::a9fe:a9fe')).toBe('blocked');
    expect(classifyIp('64:ff9b::808:808')).toBe('private');
    expect(classifyIp('64:ff9b:1::1')).toBe('private');
  });

  it('documentation / discard / site-local IPv6 are blocked', () => {
    for (const ip of ['2001:db8::1', '100::1', 'fec0::1']) expect(classifyIp(ip), ip).toBe('blocked');
  });

  it('emoji isPrivateIp also covers tunnel prefixes', () => {
    for (const ip of ['2002:7f00:1::1', '2001:0:4136:e378:8000:63bf:3fff:fdd2', '64:ff9b:1::1', '2002:0a00:0001::1']) {
      expect(isPrivateIp(ip), ip).toBe(true);
    }
    expect(isPrivateIp('2002:0808:0808::1')).toBe(false);
  });
});

describe('vetResolvedAddresses', () => {
  it('accepts public addresses and normalises family', () => {
    expect(vetResolvedAddresses('rc.example.com', [{ address: '93.184.216.34', family: 4 }])).toEqual([
      { address: '93.184.216.34', family: 4 },
    ]);
  });

  it('rejects when any address is internal (rebinding to loopback/metadata)', () => {
    expect(() =>
      vetResolvedAddresses('rc.example.com', [
        { address: '93.184.216.34', family: 4 },
        { address: '169.254.169.254', family: 4 },
      ])
    ).toThrow(SsrfBlockedError);
    expect(() => vetResolvedAddresses('rc.example.com', [{ address: '::ffff:127.0.0.1', family: 6 }])).toThrow(
      SsrfBlockedError
    );
  });

  it('allows private only for SSRF_ALLOWED_HOSTS, never loopback', () => {
    vi.stubEnv('SSRF_ALLOWED_HOSTS', 'rc.corp.example');
    expect(vetResolvedAddresses('rc.corp.example', [{ address: '10.0.0.5', family: 4 }])).toHaveLength(1);
    expect(() => vetResolvedAddresses('other.example', [{ address: '10.0.0.5', family: 4 }])).toThrow(SsrfBlockedError);
    expect(() => vetResolvedAddresses('rc.corp.example', [{ address: '127.0.0.1', family: 4 }])).toThrow(SsrfBlockedError);
  });

  it('rejects empty results and blocked hostnames', () => {
    expect(() => vetResolvedAddresses('rc.example.com', [])).toThrow(SsrfBlockedError);
    expect(() => vetResolvedAddresses('localhost', [{ address: '93.184.216.34', family: 4 }])).toThrow(SsrfBlockedError);
  });

  it('honours isAddressAllowed (strict public-only mode)', () => {
    expect(() =>
      vetResolvedAddresses('x.example', [{ address: '10.0.0.5', family: 4 }], {
        allowPrivateHost: () => true,
        isAddressAllowed: (a) => !isPrivateIp(a),
      })
    ).toThrow(SsrfBlockedError);
  });
});

describe('createSsrfSafeLookup', () => {
  it('returns only vetted addresses (all: true and single)', async () => {
    const resolver = vi.fn(async () => [
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
    const lookup = createSsrfSafeLookup({ resolver });
    const all = await lookupAsync(lookup, 'rc.example.com', { all: true });
    expect(all.address).toEqual([
      { address: '93.184.216.34', family: 4 },
      { address: '2606:2800:220:1::1', family: 6 },
    ]);
    const single = await lookupAsync(lookup, 'rc.example.com', {});
    expect(single).toEqual({ address: '93.184.216.34', family: 4 });
    const v6 = await lookupAsync(lookup, 'rc.example.com', { family: 6 });
    expect(v6).toEqual({ address: '2606:2800:220:1::1', family: 6 });
    expect(resolver).toHaveBeenCalledWith('rc.example.com');
  });

  it('simulated DNS rebinding: first answer public, second internal → connection refused', async () => {
    let n = 0;
    const resolver = async () => (n++ === 0 ? [{ address: '93.184.216.34', family: 4 }] : [{ address: '127.0.0.1', family: 4 }]);
    const lookup = createSsrfSafeLookup({ resolver });
    await expect(lookupAsync(lookup, 'rebind.example')).resolves.toBeTruthy();
    await expect(lookupAsync(lookup, 'rebind.example')).rejects.toBeInstanceOf(SsrfBlockedError);
  });

  it('propagates resolver errors', async () => {
    const err = Object.assign(new Error('getaddrinfo ENOTFOUND x'), { code: 'ENOTFOUND' });
    const lookup = createSsrfSafeLookup({ resolver: async () => Promise.reject(err) });
    await expect(lookupAsync(lookup, 'x.example')).rejects.toBe(err);
  });

  it('vets IP literals without calling the resolver', async () => {
    const resolver = vi.fn();
    const lookup = createSsrfSafeLookup({ resolver });
    await expect(lookupAsync(lookup, '169.254.169.254')).rejects.toBeInstanceOf(SsrfBlockedError);
    expect(resolver).not.toHaveBeenCalled();
  });
});

describe('undici dispatcher integration (local server, injected DNS)', () => {
  function startServer(): Promise<{ server: Server; port: number }> {
    return new Promise((resolve) => {
      const server = createServer((_req, res) => res.end('ok')).listen(0, '127.0.0.1', () =>
        resolve({ server, port: (server.address() as AddressInfo).port })
      );
    });
  }

  it('refuses to connect when the name resolves to loopback at connect time (server never hit)', async () => {
    let hits = 0;
    const { server, port } = await startServer();
    server.on('request', () => hits++);
    try {
      const resolver = vi.fn(async () => [{ address: '127.0.0.1', family: 4 }]);
      const dispatcher = createSsrfSafeDispatcher({ resolver });
      const err = await fetch(`http://rebind.example:${port}/`, { dispatcher } as RequestInit).catch((e) => e);
      expect(err).toBeInstanceOf(TypeError);
      expect((err as { cause?: { code?: string } }).cause?.code).toBe('ESSRFBLOCKED');
      expect(resolver).toHaveBeenCalledWith('rebind.example');
      expect(hits).toBe(0);
    } finally {
      server.close();
    }
  });
});

describe('safeFetch / safeFetchPublic pass a connect-time guard', () => {
  it('safeFetch sends the SSRF-safe dispatcher on every hop', async () => {
    __setSsrfResolverForTests(async () => ['93.184.216.34']);
    const fetcher = vi.fn(async (_url: string, init: RequestInit & { dispatcher?: unknown }) => {
      expect(init.dispatcher).toBe(getSsrfSafeDispatcher());
      return new Response('ok');
    });
    vi.stubGlobal('fetch', fetcher);
    await safeFetch('https://rc.example.com/api/v1/info');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it('safeFetchPublic sends the public-only dispatcher', async () => {
    const { safeFetchPublic } = await import('../emoji-safe-fetch');
    const fetcher = vi.fn(async (_url: URL, init: RequestInit & { dispatcher?: unknown }) => {
      expect(init.dispatcher).toBe(getPublicOnlyDispatcher());
      return new Response('emojis: []', { status: 200 });
    });
    vi.stubGlobal('fetch', fetcher);
    await safeFetchPublic('https://ok.example.com/x.yaml', {
      maxBytes: 1000,
      timeoutMs: 1000,
      resolve: async () => ['93.184.216.34'],
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
