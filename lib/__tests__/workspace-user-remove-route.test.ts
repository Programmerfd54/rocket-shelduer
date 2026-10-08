import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  auth: vi.fn(), access: vi.fn(),
  records: { findMany: vi.fn(), deleteMany: vi.fn() },
  audit: vi.fn(),
  rc: { login: vi.fn(), getUserForRemoval: vi.fn(), deleteUser: vi.fn(), setUserActiveStatus: vi.fn() },
}));
vi.mock('@/lib/auth', () => ({ requireAuth: mocks.auth }));
vi.mock('@/lib/workspace-bulk-users-access', () => ({ assertWorkspaceBulkUsersAccess: mocks.access }));
vi.mock('@/lib/prisma', () => ({ default: { workspaceAddedUser: mocks.records, workspaceActionLog: { create: mocks.audit } } }));
vi.mock('@/lib/rocketchat', () => ({ RocketChatClient: class { constructor() { return mocks.rc; } } }));

import { POST } from '@/app/api/workspace/[id]/users/remove/route';

const context = { params: Promise.resolve({ id: 'workspace' }) };
function request(body: object) {
  return new Request('http://localhost/api/workspace/workspace/users/remove', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ adminUsername: 'admin', adminPassword: 'test-only', ...body }),
  });
}
async function events(response: Response) {
  expect(response.status).toBe(200);
  return (await response.text()).trim().split('\n').map(line => JSON.parse(line));
}
const found = (id: string, username: string, roles: string[] = ['user'], active = true) => ({ state: 'found', _id: id, username, roles, active });

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ id: 'operator' });
  mocks.access.mockResolvedValue({ ok: true, workspace: { id: 'workspace', workspaceUrl: 'https://chat.example.test' } });
  mocks.rc.login.mockResolvedValue({ authToken: 'token', userId: 'admin-id' });
  mocks.records.findMany.mockResolvedValue([
    { id: 'r1', username: 'alice', rcUserId: 'alice-id' },
    { id: 'r2', username: 'boss', rcUserId: 'boss-id' },
    { id: 'r3', username: 'ghost', rcUserId: null },
  ]);
  mocks.records.deleteMany.mockResolvedValue({ count: 1 });
  mocks.audit.mockResolvedValue({});
  mocks.rc.getUserForRemoval.mockImplementation(async (_t, _a, target) => {
    if ('userId' in target) {
      if (target.userId === 'admin-id') return found('admin-id', 'admin', ['admin']);
      if (target.userId === 'alice-id') return found('alice-id', 'alice');
      if (target.userId === 'boss-id') return found('boss-id', 'boss', ['admin', 'user']);
    }
    if ('username' in target && target.username === 'carol') return found('carol-id', 'carol');
    return { state: 'not_found' };
  });
  mocks.rc.deleteUser.mockResolvedValue({ success: true });
  mocks.rc.setUserActiveStatus.mockResolvedValue({ success: true });
});

describe('workspace user remove API', () => {
  it('deletes users, drops local records and skips admins, self and missing accounts', async () => {
    const messages = await events(await POST(request({
      mode: 'delete', confirm: 'УДАЛИТЬ', ids: ['r1', 'r2', 'r3'], usernames: ['admin', 'carol'],
    }), context));
    const done = messages.find(m => m.t === 'done');
    expect(done).toMatchObject({ total: 5, removed: 2, skipped: 3, errors: 0 });
    expect(mocks.rc.deleteUser.mock.calls.map(c => c[2])).toEqual(['alice-id', 'carol-id']);
    const byName = Object.fromEntries(done.results.map((r: any) => [r.username, r]));
    expect(byName.boss.reason).toBe('администратор Rocket.Chat');
    expect(byName.admin.reason).toMatch(/под которой выполнен вход/);
    expect(byName.ghost.reason).toMatch(/не найден в Rocket.Chat/);
    // ghost (not found) and alice (deleted) lose their local record; boss keeps it.
    const dropped = mocks.records.deleteMany.mock.calls.flatMap(c => c[0].where.id.in);
    expect(dropped.sort()).toEqual(['r1', 'r3']);
    expect(mocks.audit).toHaveBeenCalledOnce();
    const logged = mocks.audit.mock.calls[0][0].data;
    expect(logged.action).toBe('users_remove');
    expect(logged.details).not.toMatch(/test-only/);
    expect(messages.some(m => m.t === 'progress')).toBe(true);
  });

  it('deactivates without deleting local records', async () => {
    const messages = await events(await POST(request({ mode: 'deactivate', ids: ['r1'] }), context));
    expect(messages.find(m => m.t === 'done')).toMatchObject({ removed: 1, skipped: 0, errors: 0 });
    expect(mocks.rc.setUserActiveStatus).toHaveBeenCalledWith('token', 'admin-id', 'alice-id', false);
    expect(mocks.rc.deleteUser).not.toHaveBeenCalled();
    expect(mocks.records.deleteMany).not.toHaveBeenCalled();
  });

  it('keeps the local record when RC deletion fails and stops after a permission error', async () => {
    mocks.rc.deleteUser.mockResolvedValue({ success: false, status: 403, error: 'forbidden' });
    mocks.records.findMany.mockResolvedValue([
      { id: 'r1', username: 'alice', rcUserId: 'alice-id' }, { id: 'r4', username: 'carol', rcUserId: 'carol-id' },
    ]);
    mocks.rc.getUserForRemoval.mockImplementation(async (_t, _a, target) =>
      'userId' in target ? found(target.userId, target.userId.replace('-id', '')) : { state: 'not_found' });
    const messages = await events(await POST(request({ mode: 'delete', confirm: 'УДАЛИТЬ', ids: ['r1', 'r4'] }), context));
    expect(messages.find(m => m.t === 'done')).toMatchObject({ removed: 0, errors: 1, skipped: 1 });
    expect(mocks.rc.deleteUser).toHaveBeenCalledTimes(1);
    expect(mocks.records.deleteMany).not.toHaveBeenCalled();
  });

  it('refuses a stored id that now points to another account', async () => {
    mocks.rc.getUserForRemoval.mockImplementation(async (_t, _a, target) => {
      if ('userId' in target) return target.userId === 'admin-id' ? found('admin-id', 'admin', ['admin']) : { state: 'not_found' };
      return found('other-id', 'alice');
    });
    const messages = await events(await POST(request({ mode: 'delete', confirm: 'УДАЛИТЬ', ids: ['r1'] }), context));
    const done = messages.find(m => m.t === 'done');
    expect(done.results[0].reason).toMatch(/другая учётная запись/);
    expect(mocks.rc.deleteUser).not.toHaveBeenCalled();
  });

  it('rejects delete without the confirmation word and forbidden access', async () => {
    const noConfirm = await POST(request({ mode: 'delete', ids: ['r1'] }), context);
    expect(noConfirm.status).toBe(400);
    mocks.access.mockResolvedValue({ ok: false, status: 403, error: 'Недостаточно прав' });
    const forbidden = await POST(request({ mode: 'deactivate', ids: ['r1'] }), context);
    expect(forbidden.status).toBe(403);
    expect(mocks.rc.login).not.toHaveBeenCalled();
  });
});
