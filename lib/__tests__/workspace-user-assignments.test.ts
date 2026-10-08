import { describe, expect, it, vi } from 'vitest';
import { getImportUsers, resolveUserAssignments, userImportRequestSchema, userAssignmentsSchema } from '../workspace-user-assignments';
import { applyUserAssignments } from '../apply-user-assignments';

const credentials = { adminUsername: 'admin', adminPassword: 'test-only' };
const publicRoom = { id: 'public', type: 'c' as const, name: 'General' };
const privateRoom = { id: 'private', type: 'p' as const, name: 'Team' };

describe('per-user import assignments', () => {
  it('keeps separate channels and multiple roles for each user', () => {
    const users = getImportUsers(userImportRequestSchema.parse({ ...credentials, users: [
      { login: '@alice', channels: [publicRoom, privateRoom], roleIds: ['user', 'support'] },
      { login: 'bob', channels: [privateRoom], roleIds: ['user'] },
    ] }));
    expect(users).toEqual([
      { login: 'alice', assignments: { channels: [publicRoom, privateRoom], roleIds: ['user', 'support'] } },
      { login: 'bob', assignments: { channels: [privateRoom], roleIds: ['user'] } },
    ]);
  });

  it('inherits defaults by field but honors an explicit empty selection', () => {
    const defaults = { channels: [publicRoom], roleIds: ['user', 'support'] };
    expect(resolveUserAssignments(defaults, { channels: [] })).toEqual({ channels: [], roleIds: ['user', 'support'] });
    const users = getImportUsers(userImportRequestSchema.parse({ ...credentials, ...defaults, users: [
      { login: 'alice', channels: [], roleIds: [] }, { login: 'bob' },
    ] }));
    expect(users[0].assignments).toEqual({ channels: [], roleIds: [] });
    expect(users[1].assignments).toEqual(defaults);
  });

  it('supports the previous single-channel/single-role request', () => {
    const users = getImportUsers(userImportRequestSchema.parse({ ...credentials,
      logins: ' @alice ; bob\n', channelId: 'private', channelType: 'p', roleId: 'support',
    }));
    expect(users.map(user => user.login)).toEqual(['alice', 'bob']);
    expect(users[1].assignments).toEqual({ channels: [{ id: 'private', type: 'p' }], roleIds: ['support'] });
  });

  it('deduplicates assignments and rejects duplicate usernames ignoring case', () => {
    expect(userAssignmentsSchema.parse({ channels: [publicRoom, publicRoom], roleIds: ['user', 'user'] }))
      .toEqual({ channels: [publicRoom], roleIds: ['user'] });
    expect(() => getImportUsers(userImportRequestSchema.parse({ ...credentials, logins: ['@Alice', 'alice'] }))).toThrow('Логин повторяется');
  });

  it('rejects invalid room types, role IDs, and oversized imports', () => {
    expect(() => userImportRequestSchema.parse({ ...credentials, users: [{ login: 'alice', channels: [{ id: 'dm', type: 'd' }] }] })).toThrow();
    expect(() => userImportRequestSchema.parse({ ...credentials, roleIds: [''] })).toThrow();
    expect(() => userImportRequestSchema.parse({ ...credentials, logins: Array(101).fill('alice') })).toThrow();
    expect(() => getImportUsers(userImportRequestSchema.parse({ ...credentials, logins: '' }))).toThrow();
  });
});

describe('assignment failures and retries', () => {
  it('attempts all channels and roles and retains only failed assignments for retry', async () => {
    const client = {
      inviteUserToRoom: vi.fn().mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'Forbidden' }),
      addUserToRole: vi.fn().mockResolvedValueOnce({ success: true }).mockRejectedValueOnce(new Error('Unavailable')),
    };
    const result = await applyUserAssignments(client, 'token', 'admin', 'alice-id', 'alice', {
      channels: [publicRoom, privateRoom], roleIds: ['user', 'support'],
    });
    expect(client.inviteUserToRoom.mock.calls).toEqual([
      ['token', 'admin', 'public', 'c', 'alice-id'], ['token', 'admin', 'private', 'p', 'alice-id'],
    ]);
    expect(client.addUserToRole.mock.calls).toEqual([
      ['token', 'admin', 'user', 'alice'], ['token', 'admin', 'support', 'alice'],
    ]);
    expect(result.pending).toEqual({ channels: [privateRoom], roleIds: ['support'] });
    expect(result.errors).toEqual(['Канал Team: Forbidden', 'Роль support: Unavailable']);
    client.inviteUserToRoom.mockResolvedValue({ success: true });
    client.addUserToRole.mockResolvedValue({ success: true });
    const retried = await applyUserAssignments(client, 'token', 'admin', 'alice-id', 'alice', result.pending);
    expect(retried).toEqual({ pending: { channels: [], roleIds: [] }, errors: [] });
    expect(client.inviteUserToRoom).toHaveBeenCalledTimes(3);
    expect(client.addUserToRole).toHaveBeenCalledTimes(3);
  });
});
