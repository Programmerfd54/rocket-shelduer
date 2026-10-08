import { describe, it, expect } from 'vitest';
import { canPerformAction, requireAction, requireAdmin, type Action } from '../permissions';
import { canManageUserWithRole, canSeeAdminPanel, inviteAssignableRoles, roleChangeAssignableRoles } from '../roles';
import type { CurrentUser } from '../auth';

const mkUser = (overrides: Partial<CurrentUser>): CurrentUser => ({
  id: 'u1',
  email: 'a@b.com',
  name: 'Test',
  role: 'MEMBER',
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
    const admin = mkUser({ role: 'LEAD_SUP' });
    expect(canPerformAction(admin, 'admin:settings')).toBe(true);
    expect(canPerformAction(admin, 'admin:users')).toBe(true);
  });

  it('denies MEMBER for admin actions', () => {
    const user = mkUser({ role: 'MEMBER' });
    expect(canPerformAction(user, 'admin:settings')).toBe(false);
    expect(canPerformAction(user, 'admin:users')).toBe(false);
  });

  it('allows MEMBER for workspace:add and messages', () => {
    const m = mkUser({ role: 'MEMBER' });
    expect(canPerformAction(m, 'workspace:add')).toBe(true);
    expect(canPerformAction(m, 'messages:create')).toBe(true);
  });

  it('denies MEMBER for workspace:archive', () => {
    const m = mkUser({ role: 'MEMBER' });
    expect(canPerformAction(m, 'workspace:archive')).toBe(false);
  });

  it('denies blocked user', () => {
    const blocked = mkUser({ role: 'LEAD_SUP', isBlocked: true });
    expect(canPerformAction(blocked, 'admin:settings')).toBe(false);
  });

  it('denies ADM admin panel', () => {
    expect(canPerformAction(mkUser({ role: 'ADM' }), 'admin:panel')).toBe(false);
  });

  it('allows LEAD_SUP and SUP admin panel when not restricted', () => {
    expect(canPerformAction(mkUser({ role: 'LEAD_SUP' }), 'admin:panel')).toBe(true);
    expect(canPerformAction(mkUser({ role: 'SUP' }), 'admin:panel')).toBe(true);
  });

  it('denies MEMBER admin panel', () => {
    expect(canPerformAction(mkUser({ role: 'MEMBER' }), 'admin:panel')).toBe(false);
  });

  it('respects restrictedFeatures for adminPanel', () => {
    const lead = mkUser({ role: 'LEAD_SUP', restrictedFeatures: ['adminPanel'] });
    expect(canPerformAction(lead, 'admin:panel')).toBe(false);
  });

  it('adminPanel restriction also blocks user-management actions via API', () => {
    const sup = mkUser({ role: 'SUP', restrictedFeatures: ['adminPanel'] });
    for (const action of ['admin:users', 'admin:users:edit', 'admin:users:block', 'admin:users:reset-password', 'admin:users:edit-role', 'admin:invite', 'admin:users:create'] as const) {
      expect(canPerformAction(sup, action), action).toBe(false);
    }
    // назначения на пространство и прочие действия не затрагиваются
    expect(canPerformAction(sup, 'admin:workspaces:assign-adm')).toBe(true);
    expect(canPerformAction(sup, 'workspace:space-settings')).toBe(true);
    // Lead_SUP с ограничением может снять ограничения
    expect(canPerformAction(mkUser({ role: 'LEAD_SUP', restrictedFeatures: ['adminPanel'] }), 'admin:users:edit-restrictions')).toBe(true);
  });

  it('rejects unknown legacy roles everywhere', () => {
    const legacy = mkUser({ role: 'HQ' + '_ADMIN' });
    for (const action of ['admin:panel', 'admin:users', 'workspace:add', 'messages:create'] as const) {
      expect(canPerformAction(legacy, action)).toBe(false);
    }
  });
});

describe('permission matrix', () => {
  const roles = ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'] as const;
  const matrix: Record<string, (typeof roles)[number][]> = {
    'admin:panel': ['LEAD_SUP', 'SUP'],
    'admin:users': ['LEAD_SUP', 'SUP'],
    'admin:users:create': ['LEAD_SUP', 'SUP'],
    'admin:invite': ['LEAD_SUP', 'SUP'],
    'admin:users:edit-restrictions': ['LEAD_SUP'],
    'admin:settings': ['LEAD_SUP'],
    'admin:help': ['LEAD_SUP'],
    'admin:templates:edit': ['LEAD_SUP'],
    'admin:security': ['LEAD_SUP'],
    'admin:audit': ['LEAD_SUP', 'SUP'],
    'workspace:add': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
    'workspace:archive': ['LEAD_SUP', 'SUP', 'ADM'],
    'messages:send-as': ['LEAD_SUP', 'SUP', 'ADM'],
  };
  for (const [action, allowed] of Object.entries(matrix)) {
    for (const role of roles) {
      it(`${role} ${allowed.includes(role) ? 'can' : 'cannot'} ${action}`, () => {
        expect(canPerformAction(mkUser({ role }), action as Action)).toBe(allowed.includes(role));
      });
    }
  }
});

describe('role assignment helpers', () => {
  it('Lead_SUP invites SUP/ADM/MEMBER, SUP only ADM/MEMBER, others nothing', () => {
    expect(inviteAssignableRoles('LEAD_SUP')).toEqual(['SUP', 'ADM', 'MEMBER']);
    expect(inviteAssignableRoles('SUP')).toEqual(['ADM', 'MEMBER']);
    expect(inviteAssignableRoles('ADM')).toEqual([]);
    expect(inviteAssignableRoles('MEMBER')).toEqual([]);
  });

  it('only Lead_SUP can grant LEAD_SUP / SUP via role change', () => {
    expect(roleChangeAssignableRoles('LEAD_SUP')).toContain('LEAD_SUP');
    expect(roleChangeAssignableRoles('LEAD_SUP')).toContain('SUP');
    expect(roleChangeAssignableRoles('SUP')).not.toContain('SUP');
    expect(roleChangeAssignableRoles('SUP')).not.toContain('LEAD_SUP');
  });

  it('SUP manages only ADM and MEMBER; Lead_SUP manages everyone', () => {
    expect(canManageUserWithRole('SUP', 'MEMBER')).toBe(true);
    expect(canManageUserWithRole('SUP', 'ADM')).toBe(true);
    expect(canManageUserWithRole('SUP', 'SUP')).toBe(false);
    expect(canManageUserWithRole('SUP', 'LEAD_SUP')).toBe(false);
    expect(canManageUserWithRole('LEAD_SUP', 'LEAD_SUP')).toBe(true);
    expect(canManageUserWithRole('ADM', 'MEMBER')).toBe(false);
  });

  it('canSeeAdminPanel follows role and restriction', () => {
    expect(canSeeAdminPanel('LEAD_SUP')).toBe(true);
    expect(canSeeAdminPanel('SUP')).toBe(true);
    expect(canSeeAdminPanel('ADM')).toBe(false);
    expect(canSeeAdminPanel('SUP', ['adminPanel'])).toBe(false);
  });
});

describe('requireAction', () => {
  it('throws for forbidden action', () => {
    const user = mkUser({ role: 'MEMBER' });
    expect(() => requireAction(user, 'admin:settings')).toThrow('Forbidden');
  });

  it('does not throw for allowed action', () => {
    const admin = mkUser({ role: 'LEAD_SUP' });
    expect(() => requireAction(admin, 'admin:settings')).not.toThrow();
  });
});

describe('requireAdmin', () => {
  it('throws for non-ADMIN', () => {
    expect(() => requireAdmin(mkUser({ role: 'SUP' }))).toThrow('Forbidden');
    expect(() => requireAdmin(mkUser({ role: 'MEMBER' }))).toThrow('Forbidden');
  });

  it('does not throw for ADMIN', () => {
    expect(() => requireAdmin(mkUser({ role: 'LEAD_SUP' }))).not.toThrow();
  });
});
