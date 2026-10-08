/**
 * Регрессионные тесты API-уязвимостей (утечки секретов, эскалация привилегий, заблокированные пользователи).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  prisma: {
    scheduledMessage: { findUnique: vi.fn() },
    workspaceConnection: { findUnique: vi.fn() },
    workspaceAdminAssignment: { findFirst: vi.fn() },
    user: { findFirst: vi.fn(), update: vi.fn() },
    session: { deleteMany: vi.fn() },
  },
  rc: { getMessage: vi.fn(), getRoomInfo: vi.fn(), login: vi.fn(), listUsers: vi.fn(), updateUserPassword: vi.fn() },
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.session,
  getCurrentUser: mocks.session,
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
}));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/rocketchat', () => ({ RocketChatClient: class { constructor() { return mocks.rc; } } }));
vi.mock('@/lib/encryption', () => ({ decryptAuthToken: (v: string | null) => (v ? `plain-${v}` : null) }));

import { GET as getMessage } from '@/app/api/messages/[id]/route';
import { POST as resetUserPassword } from '@/app/api/workspace/[id]/admin/reset-user-password/route';
import { isAccountBlocked, requireAuth } from '@/lib/api-auth';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', email: 'u1', name: null, role: 'MEMBER', avatarUrl: null, restrictedFeatures: [],
  volunteerExpiresAt: null, volunteerIntensive: null, isBlocked: false, blockedAt: null, blockedReason: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
});

describe('blocked users are rejected by API guards', () => {
  it('isAccountBlocked: explicit block and expired volunteer', () => {
    expect(isAccountBlocked(user({ isBlocked: true }))).toBe(true);
    expect(isAccountBlocked(user({ volunteerExpiresAt: new Date(Date.now() - 1000) }))).toBe(true);
    expect(isAccountBlocked(user({ volunteerExpiresAt: new Date(Date.now() + 86_400_000) }))).toBe(false);
    expect(isAccountBlocked(user({ role: 'ADM', volunteerExpiresAt: new Date(0) }))).toBe(false);
  });

  it('requireAuth throws Forbidden for a blocked session', async () => {
    mocks.session.mockResolvedValue(user({ role: 'LEAD_SUP', isBlocked: true }));
    await expect(requireAuth()).rejects.toThrow('Forbidden');
  });
});

describe('GET /api/messages/[id] does not leak workspace credentials', () => {
  it('selects only public fields and returns no tokens/passwords', async () => {
    mocks.session.mockResolvedValue(user({ id: 'owner' }));
    mocks.prisma.scheduledMessage.findUnique.mockImplementation(async (args: { select?: Record<string, unknown> }) => {
      // Защита от регресса: запрос не должен тянуть всю запись пространства
      expect(args.select).toBeDefined();
      expect(JSON.stringify(args)).not.toMatch(/authToken|encryptedPassword|userId_RC/);
      return {
        id: 'm1', userId: 'owner', workspaceId: 'w1', status: 'SENT', messageId_RC: 'rc1', message: 'hi',
        workspace: { id: 'w1', workspaceName: 'WS', workspaceUrl: 'https://rc.example' },
      };
    });
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({
      workspaceUrl: 'https://rc.example', authToken: 'enc-token', userId_RC: 'rc-user',
    });
    mocks.rc.getMessage.mockResolvedValue({ _id: 'rc1', msg: 'hi' });
    mocks.rc.getRoomInfo.mockResolvedValue({ room: { _id: 'room1', t: 'c', name: 'general' } });

    const res = await getMessage(new Request('http://localhost/api/messages/m1'), { params: Promise.resolve({ id: 'm1' }) });
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toMatch(/authToken|encryptedPassword|userId_RC|enc-token|plain-enc-token/);
    expect(JSON.parse(text)).toMatchObject({
      externalStatus: 'SYNCHRONIZED',
      message: { id: 'm1' },
      rcPermalink: 'https://rc.example/channel/general?msg=rc1',
    });
    expect(mocks.rc.getMessage).toHaveBeenCalledWith('plain-enc-token', 'rc-user', 'rc1');
  });

  it('rcPermalink is null when the room type cannot be determined (RC error or unknown type)', async () => {
    mocks.session.mockResolvedValue(user({ id: 'owner' }));
    mocks.prisma.scheduledMessage.findUnique.mockResolvedValue({
      id: 'm1', userId: 'owner', workspaceId: 'w1', channelId: 'room1', status: 'SENT', messageId_RC: 'rc1', message: 'hi',
      workspace: { id: 'w1', workspaceName: 'WS', workspaceUrl: 'https://rc.example' },
    });
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({
      workspaceUrl: 'https://rc.example', authToken: 'enc-token', userId_RC: 'rc-user',
    });
    mocks.rc.getMessage.mockResolvedValue({ _id: 'rc1', msg: 'hi' });
    const call = () => getMessage(new Request('http://localhost/api/messages/m1'), { params: Promise.resolve({ id: 'm1' }) });

    mocks.rc.getRoomInfo.mockRejectedValue(new Error('network'));
    let res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).rcPermalink).toBeNull();

    mocks.rc.getRoomInfo.mockResolvedValue({ room: { _id: 'room1', t: 'l', name: 'livechat' } });
    res = await call();
    expect((await res.json()).rcPermalink).toBeNull();

    mocks.rc.getRoomInfo.mockResolvedValue({ error: 'not allowed' });
    res = await call();
    expect((await res.json()).rcPermalink).toBeNull();
  });
});

describe('POST /api/workspace/[id]/admin/reset-user-password', () => {
  const call = (body: object) =>
    resetUserPassword(
      new Request('http://localhost/api/workspace/w1/admin/reset-user-password', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: 'w1' }) }
    );

  it('forbids workspace owners without SUP/Lead_SUP role (no app-wide password reset by ADM/MEMBER)', async () => {
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ userId: 'adm' });
    const res = await call({ username: 'lead' });
    expect(res.status).toBe(403);
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('SUP cannot reset the password of a Lead_SUP', async () => {
    mocks.session.mockResolvedValue(user({ id: 'sup', role: 'SUP' }));
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ userId: 'sup' });
    mocks.prisma.user.findFirst.mockResolvedValue({ id: 'lead', username: 'lead', email: 'lead', role: 'LEAD_SUP' });
    const res = await call({ username: 'lead' });
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.results[0]).toMatchObject({ success: false });
    expect(mocks.prisma.user.update).not.toHaveBeenCalled();
  });

  it('SUP resets a MEMBER password and invalidates their sessions', async () => {
    mocks.session.mockResolvedValue(user({ id: 'sup', role: 'SUP' }));
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ userId: 'sup' });
    mocks.prisma.user.findFirst.mockResolvedValue({ id: 'm1', username: 'student', email: 'student', role: 'MEMBER' });
    const res = await call({ username: 'student' });
    expect(res.status).toBe(200);
    expect(mocks.prisma.user.update).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 'm1' } }));
    expect(mocks.prisma.session.deleteMany).toHaveBeenCalledWith({ where: { userId: 'm1' } });
  });
});
