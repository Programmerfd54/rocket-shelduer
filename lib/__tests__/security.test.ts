import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  isPathTraversal,
  isUnsafeId,
  isSuspiciousInput,
  getClientIp,
  isAuthEndpointRateLimited,
  isInviteTokenRateLimited,
} from '../security';

describe('isPathTraversal', () => {
  it('returns true for ..', () => {
    expect(isPathTraversal('..')).toBe(true);
    expect(isPathTraversal('abc/../etc')).toBe(true);
  });

  it('returns true for absolute paths', () => {
    expect(isPathTraversal('/etc/passwd')).toBe(true);
    expect(isPathTraversal('C:\\Windows\\System32')).toBe(true);
  });

  it('returns false for safe ids', () => {
    expect(isPathTraversal('clxyz123')).toBe(false);
    expect(isPathTraversal('abc-def_123')).toBe(false);
  });

  it('returns false for null/undefined', () => {
    expect(isPathTraversal(null)).toBe(false);
    expect(isPathTraversal(undefined)).toBe(false);
  });
});

describe('isUnsafeId', () => {
  it('returns true for path traversal', () => {
    expect(isUnsafeId('../etc')).toBe(true);
    expect(isUnsafeId('/path')).toBe(true);
  });

  it('returns true for empty or too long', () => {
    expect(isUnsafeId('')).toBe(true);
    expect(isUnsafeId(null)).toBe(true);
    expect(isUnsafeId(undefined)).toBe(true);
    expect(isUnsafeId('a'.repeat(101))).toBe(true);
  });

  it('returns true for dangerous chars', () => {
    expect(isUnsafeId('id with spaces')).toBe(true);
    expect(isUnsafeId('id<script>')).toBe(true);
    expect(isUnsafeId('id"quote')).toBe(true);
  });

  it('returns false for valid cuid-like ids', () => {
    expect(isUnsafeId('clxyz123abc')).toBe(false);
    expect(isUnsafeId('cmmm1npt700036k8rlzu3roxd')).toBe(false);
  });
});

describe('isSuspiciousInput', () => {
  it('detects SQL-like patterns', () => {
    expect(isSuspiciousInput("' OR 1=1 --")).toBe(true);
    expect(isSuspiciousInput('UNION ALL SELECT')).toBe(true);
    expect(isSuspiciousInput('; DROP TABLE users')).toBe(true);
  });

  it('detects XSS patterns', () => {
    expect(isSuspiciousInput('<script>alert(1)</script>')).toBe(true);
    expect(isSuspiciousInput('javascript:alert(1)')).toBe(true);
    expect(isSuspiciousInput('onerror=alert(1)')).toBe(true);
  });

  it('returns false for normal input', () => {
    expect(isSuspiciousInput('hello')).toBe(false);
    expect(isSuspiciousInput('user@example.com')).toBe(false);
    expect(isSuspiciousInput('')).toBe(false);
    expect(isSuspiciousInput(null)).toBe(false);
  });
});

describe('getClientIp', () => {
  it('takes the entry appended by the trusted proxy (rightmost), not the client-supplied one', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-forwarded-for': '6.6.6.6, 203.0.113.7' },
    });
    expect(getClientIp(req)).toBe('203.0.113.7');
  });

  it('uses x-real-ip when no forwarded', () => {
    const req = new Request('http://localhost', {
      headers: { 'x-real-ip': '203.0.113.1' },
    });
    expect(getClientIp(req)).toBe('203.0.113.1');
  });

  it('returns null when no IP headers', () => {
    const req = new Request('http://localhost');
    expect(getClientIp(req)).toBe(null);
  });
});

describe('isAuthEndpointRateLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('allows first request', () => {
    expect(isAuthEndpointRateLimited('1.2.3.4')).toBe(false);
  });

  it('limits after 60 requests in window', () => {
    const ip = '10.0.0.1';
    for (let i = 0; i < 60; i++) {
      expect(isAuthEndpointRateLimited(ip)).toBe(false);
    }
    expect(isAuthEndpointRateLimited(ip)).toBe(true);
  });

  it('returns false for null/empty IP', () => {
    expect(isAuthEndpointRateLimited(null)).toBe(false);
    expect(isAuthEndpointRateLimited('')).toBe(false);
  });
});

describe('isInviteTokenRateLimited', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it('allows first request', () => {
    expect(isInviteTokenRateLimited('1.2.3.4')).toBe(false);
  });

  it('limits after 30 requests in window', () => {
    const ip = '192.168.1.1';
    for (let i = 0; i < 30; i++) {
      expect(isInviteTokenRateLimited(ip)).toBe(false);
    }
    expect(isInviteTokenRateLimited(ip)).toBe(true);
  });
});
