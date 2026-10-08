import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(),
  records: { create: vi.fn(), update: vi.fn(), findMany: vi.fn() },
  audit: vi.fn(),
  rc: {
    login: vi.fn(), createUser: vi.fn(), listRoles: vi.fn(), getProvisioningChannels: vi.fn(),
    inviteUserToRoom: vi.fn(), addUserToRole: vi.fn(),
  },
}));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/workspace-bulk-users-access', () => ({ assertWorkspaceBulkUsersAccess: mocks.access }));
vi.mock('@/lib/prisma', () => ({ default: { workspaceAddedUser: mocks.records, workspaceActionLog: { create: mocks.audit } } }));
vi.mock('@/lib/rocketchat', () => ({ RocketChatClient: class { constructor() { return mocks.rc; } } }));

import { POST as addUsers } from '@/app/api/workspace/[id]/users/add/route';
import { POST as retryUsers } from '@/app/api/workspace/[id]/users/retry-failed/route';

const credentials = { adminUsername: 'admin', adminPassword: 'test-only' };
const publicRoom = { id: 'public', type: 'c', name: 'General' };
const privateRoom = { id: 'private', type: 'p', name: 'Team' };
const context = { params: Promise.resolve({ id: 'workspace' }) };
function request(body: object) {
  return new Request('http://localhost/api/workspace/workspace/users/add', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials, ...body }),
  });
}
async function events(response: Response) {
  expect(response.status).toBe(200);
  expect(response.headers.get('content-type')).toBe('application/x-ndjson');
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: 'operator' });
  mocks.access.mockResolvedValue({ ok: true, workspace: { id: 'workspace', workspaceUrl: 'https://chat.example.test' } });
  mocks.rc.login.mockResolvedValue({ authToken: 'token', userId: 'admin-id' });
  mocks.rc.listRoles.mockResolvedValue([
    { _id: 'user', scope: 'Users' }, { _id: 'support', scope: 'Users' }, { _id: 'moderator', scope: 'Subscriptions' },
  ]);
  mocks.rc.getProvisioningChannels.mockResolvedValue([{ _id: 'public', t: 'c' }, { _id: 'private', t: 'p' }]);
  mocks.rc.createUser.mockImplementation(async (_token, _admin, params) => ({ success: true, userId: params.username + '-id' }));
  mocks.rc.inviteUserToRoom.mockResolvedValue({ success: true });
  mocks.rc.addUserToRole.mockResolvedValue({ success: true });
  mocks.records.create.mockResolvedValue({ id: 'record' });
  mocks.records.update.mockResolvedValue({});
  mocks.records.findMany.mockResolvedValue([]);
  mocks.audit.mockResolvedValue({});
});

describe('workspace user import API', () => {
  it('assigns each user their own rooms and multiple roles', async () => {
    const messages = await events(await addUsers(request({ users: [
      { login: 'alice', channels: [publicRoom, privateRoom], roleIds: ['user', 'support'] },
      { login: 'bob', channels: [privateRoom], roleIds: [] },
    ] }), context));
    expect(mocks.access).toHaveBeenCalledWith('operator', 'workspace');
    expect(mocks.rc.inviteUserToRoom.mock.calls).toEqual([
      ['token', 'admin-id', 'public', 'c', 'alice-id'],
      ['token', 'admin-id', 'private', 'p', 'alice-id'],
      ['token', 'admin-id', 'private', 'p', 'bob-id'],
    ]);
    expect(mocks.rc.addUserToRole.mock.calls).toEqual([
      ['token', 'admin-id', 'user', 'alice'], ['token', 'admin-id', 'support', 'alice'],
    ]);
    expect(messages.at(-1)).toMatchObject({ t: 'done', added: 2, errors: 0, skipped: 0 });
    expect(mocks.records.create.mock.calls[0][0].data).toMatchObject({
      workspaceId: 'workspace', pendingAssignments: { channels: [publicRoom, privateRoom], roleIds: ['user', 'support'] },
    });
  });

  it('records partial failure and retries only saved assignments without recreating the account', async () => {
    mocks.rc.inviteUserToRoom.mockResolvedValueOnce({ success: true }).mockResolvedValueOnce({ success: false, error: 'Forbidden' });
    const messages = await events(await addUsers(request({ users: [
      { login: 'alice', channels: [publicRoom, privateRoom], roleIds: ['user', 'support'] },
    ] }), context));
    expect(messages.at(-1)).toMatchObject({ added: 0, errors: 1 });
    const saved = mocks.records.update.mock.calls.at(-1)?.[0].data;
    expect(saved).toMatchObject({ status: 'ERROR', rcUserId: 'alice-id', pendingAssignments: { channels: [privateRoom], roleIds: [] } });
    mocks.records.findMany.mockResolvedValue([{ id: 'record', username: 'alice', email: 'alice@example.test', ...saved }]);
    mocks.rc.createUser.mockClear();
    mocks.rc.inviteUserToRoom.mockClear();
    mocks.rc.addUserToRole.mockClear();
    const retried = await events(await retryUsers(request({ channels: [publicRoom], roleIds: ['support'] }), context));
    expect(mocks.rc.createUser).not.toHaveBeenCalled();
    expect(mocks.rc.inviteUserToRoom.mock.calls).toEqual([['token', 'admin-id', 'private', 'p', 'alice-id']]);
    expect(mocks.rc.addUserToRole).not.toHaveBeenCalled();
    expect(retried.at(-1)).toMatchObject({ added: 1, errors: 0 });
    expect(mocks.records.findMany).toHaveBeenCalledWith({ where: { workspaceId: 'workspace', status: 'ERROR' }, orderBy: { addedAt: 'asc' } });
  });

  it('retries failed creation with persisted per-user selections even when the form has changed', async () => {
    mocks.records.findMany.mockResolvedValue([{ id: 'old', username: 'alice', email: 'alice@example.test', rcUserId: null,
      pendingAssignments: { channels: [privateRoom], roleIds: ['user', 'support'] },
    }]);
    const messages = await events(await retryUsers(request({ channels: [publicRoom], roleIds: [] }), context));
    expect(mocks.rc.createUser).toHaveBeenCalledTimes(1);
    expect(mocks.rc.inviteUserToRoom.mock.calls).toEqual([['token', 'admin-id', 'private', 'p', 'alice-id']]);
    expect(mocks.rc.addUserToRole).toHaveBeenCalledTimes(2);
    expect(messages.at(-1)).toMatchObject({ added: 1 });
  });

  it('skips existing accounts without changing their channels, roles, or passwords', async () => {
    mocks.rc.createUser.mockResolvedValue({ success: false, error: 'Username already exists' });
    const messages = await events(await addUsers(request({ users: [{ login: 'alice', channels: [publicRoom], roleIds: ['user'] }] }), context));
    expect(messages.at(-1)).toMatchObject({ added: 0, skipped: 1 });
    expect(mocks.rc.inviteUserToRoom).not.toHaveBeenCalled();
    expect(mocks.rc.addUserToRole).not.toHaveBeenCalled();
  });

  it.each([
    { users: [{ login: 'alice', channels: [{ id: 'foreign', type: 'c' }] }] },
    { users: [{ login: 'alice', channels: [{ id: 'private', type: 'c' }] }] },
    { users: [{ login: 'alice', roleIds: ['moderator'] }] },
    { users: [{ login: 'alice', roleIds: ['unknown-role'] }] },
    { users: [{ login: 'alice', roleIds: [42] }] },
    { logins: ['alice', 'ALICE'] },
  ])('rejects invalid assignments before creating users: %j', async body => {
    expect((await addUsers(request(body), context)).status).toBe(400);
    expect(mocks.rc.createUser).not.toHaveBeenCalled();
    expect(mocks.records.create).not.toHaveBeenCalled();
  });

  it('rejects unauthorized access before connecting to Rocket.Chat', async () => {
    mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'Forbidden' });
    expect((await addUsers(request({ logins: ['alice'] }), context)).status).toBe(403);
    expect((await retryUsers(request({}), context)).status).toBe(403);
    expect(mocks.rc.login).not.toHaveBeenCalled();
    expect(mocks.records.findMany).not.toHaveBeenCalled();
  });

  it('returns 401 when there is no session and 403 for bad RC credentials', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('Unauthorized'));
    expect((await addUsers(request({ logins: ['alice'] }), context)).status).toBe(401);
    mocks.rc.login.mockRejectedValueOnce(new Error('Bad password'));
    expect((await addUsers(request({ logins: ['alice'] }), context)).status).toBe(403);
    expect(mocks.records.create).not.toHaveBeenCalled();
  });

  it('returns a migration instruction if the new column is missing', async () => {
    mocks.records.findMany.mockRejectedValue({ code: 'P2022' });
    const response = await retryUsers(request({}), context);
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: 'MIGRATION_NEEDED' });
  });
});
