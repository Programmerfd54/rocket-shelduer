import { describe, it, expect } from 'vitest';
import { canPerformAction, requireAction, requireAdmin } from '../permissions';
import type { CurrentUser } from '../auth';

const mkUser = (overrides: Partial<CurrentUser>): CurrentUser => ({
  id: 'u1',
  email: 'a@b.com',
  name: 'Test',
  role: 'USER',
  avatarUrl: null,
  restrictedFeatures: [],
  volunteerExpiresAt: null,
  volunteerIntensive: null,
  isBlocked: false,
  blockedAt: null,
  blockedReason: null,
  ...overrides,
});

describe('canPerformAction', () => {
  it('allows ADMIN for admin actions', () => {
    const admin = mkUser({ role: 'ADMIN' });
    expect(canPerformAction(admin, 'admin:settings')).toBe(true);
    expect(canPerformAction(admin, 'admin:users')).toBe(true);
  });

  it('denies USER for admin actions', () => {
    const user = mkUser({ role: 'USER' });
    expect(canPerformAction(user, 'admin:settings')).toBe(false);
    expect(canPerformAction(user, 'admin:users')).toBe(false);
  });

  it('allows VOL for workspace:add and messages', () => {
    const vol = mkUser({ role: 'VOL' });
    expect(canPerformAction(vol, 'workspace:add')).toBe(true);
    expect(canPerformAction(vol, 'messages:create')).toBe(true);
  });

  it('denies VOL for workspace:archive', () => {
    const vol = mkUser({ role: 'VOL' });
    expect(canPerformAction(vol, 'workspace:archive')).toBe(false);
  });

  it('denies blocked user', () => {
    const blocked = mkUser({ role: 'ADMIN', isBlocked: true });
    expect(canPerformAction(blocked, 'admin:settings')).toBe(false);
  });

  it('respects restrictedFeatures for adminPanel', () => {
    const adm = mkUser({ role: 'ADM', restrictedFeatures: ['adminPanel'] });
    expect(canPerformAction(adm, 'admin:panel')).toBe(false);
  });
});

describe('requireAction', () => {
  it('throws for forbidden action', () => {
    const user = mkUser({ role: 'USER' });
    expect(() => requireAction(user, 'admin:settings')).toThrow('Forbidden');
  });

  it('does not throw for allowed action', () => {
    const admin = mkUser({ role: 'ADMIN' });
    expect(() => requireAction(admin, 'admin:settings')).not.toThrow();
  });
});

describe('requireAdmin', () => {
  it('throws for non-ADMIN', () => {
    expect(() => requireAdmin(mkUser({ role: 'SUPPORT' }))).toThrow('Forbidden');
    expect(() => requireAdmin(mkUser({ role: 'USER' }))).toThrow('Forbidden');
  });

  it('does not throw for ADMIN', () => {
    expect(() => requireAdmin(mkUser({ role: 'ADMIN' }))).not.toThrow();
  });
});
