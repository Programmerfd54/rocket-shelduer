import { describe, it, expect } from 'vitest';
import { isSsrfUrl, assertSafeWorkspaceUrl } from '../ssrf';

describe('isSsrfUrl', () => {
  it('blocks localhost', () => {
    expect(isSsrfUrl('http://localhost:3000')).toBe(true);
    expect(isSsrfUrl('https://127.0.0.1/api')).toBe(true);
    expect(isSsrfUrl('http://[::1]/')).toBe(true);
  });

  it('blocks private IP ranges', () => {
    expect(isSsrfUrl('http://10.0.0.1')).toBe(true);
    expect(isSsrfUrl('https://192.168.1.1')).toBe(true);
    expect(isSsrfUrl('http://172.16.0.1')).toBe(true);
    expect(isSsrfUrl('http://169.254.1.1')).toBe(true);
  });

  it('blocks .localhost and .local', () => {
    expect(isSsrfUrl('http://api.localhost')).toBe(true);
    expect(isSsrfUrl('https://service.local')).toBe(true);
  });

  it('allows public URLs', () => {
    expect(isSsrfUrl('https://rocketchat.example.com')).toBe(false);
    expect(isSsrfUrl('https://api.github.com')).toBe(false);
    expect(isSsrfUrl('https://sub.domain.ru')).toBe(false);
  });

  it('returns true for invalid/null/empty', () => {
    expect(isSsrfUrl(null)).toBe(true);
    expect(isSsrfUrl(undefined)).toBe(true);
    expect(isSsrfUrl('')).toBe(true);
    expect(isSsrfUrl('not-a-url')).toBe(true);
  });
});

describe('assertSafeWorkspaceUrl', () => {
  it('throws for SSRF URLs', () => {
    expect(() => assertSafeWorkspaceUrl('http://localhost')).toThrow('internal or private');
    expect(() => assertSafeWorkspaceUrl('https://127.0.0.1')).toThrow();
  });

  it('does not throw for safe URLs', () => {
    expect(() => assertSafeWorkspaceUrl('https://rc.example.com')).not.toThrow();
  });
});
