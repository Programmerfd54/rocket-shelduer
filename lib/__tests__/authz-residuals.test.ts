/**
 * Регрессионные тесты авторизации / бизнес-логики (остаточные риски после аудита):
 * видимость сообщений для ADM, публикация рейтинга реакций, серверные ограничения вкладок,
 * назначения SUP на пространства, хеширование токенов приглашений, безопасные сообщения об ошибках.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  createSession: vi.fn(),
  prisma: {
    workspaceConnection: { findUnique: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    workspaceAdminAssignment: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn() },
    scheduledMessage: { findMany: vi.fn() },
    user: { findUnique: vi.fn(), findFirst: vi.fn(), findMany: vi.fn() },
    systemSetting: { findMany: vi.fn() },
    reactionRatingSettings: { findUnique: vi.fn(), upsert: vi.fn() },
    workspaceActionLog: { create: vi.fn() },
    inviteToken: { findMany: vi.fn(), create: vi.fn(), deleteMany: vi.fn() },
    securityEvent: { create: vi.fn(), count: vi.fn() },
    $transaction: vi.fn(),
  },
  reactions: {
    buildWeeklyPost: vi.fn(),
    buildMonthlyPost: vi.fn(),
    enqueuePost: vi.fn(),
    verifyReportChannel: vi.fn(),
  },
  reactionsAccess: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  requireAuth: mocks.session,
  getCurrentUser: mocks.session,
  hashPassword: vi.fn(async (p: string) => `hash:${p}`),
  validateNewPassword: vi.fn(async () => null),
  createSessionAndSetCookie: mocks.createSession,
  isForbiddenError: (e: unknown) => e instanceof Error && e.message === 'Forbidden',
}));
vi.mock('@/lib/prisma', () => ({ default: mocks.prisma }));
vi.mock('@/lib/reactions/access', () => ({ assertReactionsAccess: mocks.reactionsAccess }));
vi.mock('@/lib/reactions/service', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/reactions/service')>();
  return { ...actual, ...mocks.reactions };
});

import { GET as getMessages } from '@/app/api/messages/route';
import { GET as getAdminUsers } from '@/app/api/admin/users/route';
import { POST as assignAdm, DELETE as unassignAdm, GET as listAssignments } from '@/app/api/admin/workspaces/[workspaceId]/assign-adm/route';
import { POST as reactionsPost, PUT as reactionsPut } from '@/app/api/workspace/[id]/reactions/route';
import { GET as tabRestrictions } from '@/app/api/workspace-tab-restrictions/route';
import { POST as createInvite } from '@/app/api/admin/invite/route';
import { GET as checkInvite } from '@/app/api/auth/invite/[token]/route';
import { POST as registerInvite } from '@/app/api/auth/register-invite/route';
import { computeWorkspaceTabFlags, isWorkspaceTabFeatureAllowed, requireWorkspaceTabAccess } from '@/lib/workspace-tab-access';
import { assertWorkspaceBulkUsersAccess } from '@/lib/workspace-bulk-users-access';
import { assertWorkspaceR2Access } from '@/lib/workspace-r2-access';
import { findInviteByRawToken, hashInviteToken, inviteLoginMatches, inviteTokenLookupValues } from '@/lib/invite-token';
import { applyUserAssignments } from '@/lib/apply-user-assignments';

const user = (over: Record<string, unknown> = {}) => ({
  id: 'u1', email: 'u1', name: null, role: 'MEMBER', avatarUrl: null, restrictedFeatures: [],
  volunteerExpiresAt: null, volunteerIntensive: null, isBlocked: false, blockedAt: null, blockedReason: null,
  ...over,
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.prisma.systemSetting.findMany.mockResolvedValue([]);
  mocks.prisma.scheduledMessage.findMany.mockResolvedValue([]);
  mocks.prisma.workspaceActionLog.create.mockResolvedValue({});
});
afterEach(() => {
  vi.unstubAllEnvs();
});

// ── 1. ADM видит сообщения только своих пространств ──

describe('GET /api/messages — область видимости ADM', () => {
  const lastWhere = () => mocks.prisma.scheduledMessage.findMany.mock.calls.at(-1)![0].where;

  beforeEach(() => {
    mocks.prisma.workspaceConnection.findMany.mockResolvedValue([{ id: 'own-ws' }]);
    mocks.prisma.workspaceAdminAssignment.findMany.mockResolvedValue([{ workspaceId: 'assigned-ws' }]);
  });

  it('calendar: ADM — свои сообщения и сообщения в своих/назначенных пространствах', async () => {
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    const res = await getMessages(new Request('http://localhost/api/messages?scope=calendar'));
    expect(res.status).toBe(200);
    expect(lastWhere()).toEqual({
      OR: [{ userId: 'adm' }, { workspaceId: { in: ['own-ws', 'assigned-ws'] } }],
    });
  });

  it('фильтр userId у ADM сужает область, а не расширяет её', async () => {
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    await getMessages(new Request('http://localhost/api/messages?scope=calendar&userId=victim'));
    expect(lastWhere()).toEqual({
      OR: [{ userId: 'adm' }, { workspaceId: { in: ['own-ws', 'assigned-ws'] } }],
      userId: 'victim',
    });
    await getMessages(new Request('http://localhost/api/messages?status=PENDING&userId=victim'));
    expect(lastWhere()).toMatchObject({ OR: expect.any(Array), userId: 'victim', status: 'PENDING' });
  });

  it('ADM без пространств видит только свои сообщения', async () => {
    mocks.prisma.workspaceConnection.findMany.mockResolvedValue([]);
    mocks.prisma.workspaceAdminAssignment.findMany.mockResolvedValue([]);
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    await getMessages(new Request('http://localhost/api/messages?scope=calendar&userId=victim'));
    expect(lastWhere()).toEqual({ OR: [{ userId: 'adm' }], userId: 'victim' });
  });

  it('SUP и Lead_SUP — без изменений (все пользователи / фильтр как есть)', async () => {
    for (const role of ['SUP', 'LEAD_SUP']) {
      mocks.session.mockResolvedValue(user({ id: 's', role }));
      await getMessages(new Request('http://localhost/api/messages?scope=calendar'));
      expect(lastWhere()).toEqual({});
      await getMessages(new Request('http://localhost/api/messages?userId=other'));
      expect(lastWhere()).toEqual({ userId: 'other' });
    }
    expect(mocks.prisma.workspaceAdminAssignment.findMany).not.toHaveBeenCalled();
  });

  it('MEMBER в календаре видит только свои', async () => {
    mocks.session.mockResolvedValue(user({ id: 'm', role: 'MEMBER' }));
    await getMessages(new Request('http://localhost/api/messages?scope=calendar&userId=other'));
    expect(lastWhere()).toEqual({ userId: 'm' });
  });
});

describe('GET /api/admin/users?scope=message-authors', () => {
  it('ADM получает только себя и авторов сообщений своих пространств', async () => {
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    mocks.prisma.workspaceConnection.findMany.mockResolvedValue([{ id: 'own-ws' }]);
    mocks.prisma.workspaceAdminAssignment.findMany.mockResolvedValue([]);
    mocks.prisma.scheduledMessage.findMany.mockResolvedValue([{ userId: 'author1' }]);
    mocks.prisma.user.findMany.mockResolvedValue([]);
    const res = await getAdminUsers(new Request('http://localhost/api/admin/users?scope=message-authors'));
    expect(res.status).toBe(200);
    expect(mocks.prisma.user.findMany.mock.calls[0][0].where).toEqual({ id: { in: ['adm', 'author1'] } });
  });

  it('без scope список для ADM прежний (нужен для «от имени»)', async () => {
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    mocks.prisma.user.findMany.mockResolvedValue([]);
    await getAdminUsers(new Request('http://localhost/api/admin/users'));
    expect(mocks.prisma.user.findMany.mock.calls[0][0].where).toBeUndefined();
  });
});

// ── 2. Публикация рейтинга реакций ──

describe('reactions: publish / report channel', () => {
  const ctx = { params: Promise.resolve({ id: 'ws1' }) };
  const settings = {
    id: 's1', workspaceId: 'ws1', timezone: 'Europe/Moscow', reportChannelId: 'room-ok', reportChannelName: 'rating',
    channels: [], excludedUsernames: [], weeklyEnabled: false, monthlyEnabled: false,
  };
  const post = (body: object) =>
    reactionsPost(new Request('http://localhost/api/workspace/ws1/reactions', { method: 'POST', body: JSON.stringify(body) }), ctx);

  beforeEach(() => {
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    mocks.reactionsAccess.mockResolvedValue({ ok: true, workspace: { id: 'ws1' } });
    mocks.prisma.reactionRatingSettings.findUnique.mockResolvedValue(settings);
    mocks.reactions.buildWeeklyPost.mockResolvedValue({ text: 'SERVER WEEKLY', key: 'k' });
    mocks.reactions.buildMonthlyPost.mockResolvedValue('SERVER MONTHLY');
    mocks.reactions.enqueuePost.mockResolvedValue({ id: 'msg1', scheduledFor: new Date() });
  });

  it('клиентский текст игнорируется: публикуется текст, собранный сервером', async () => {
    const res = await post({ action: 'publish', kind: 'weekly', text: '@all phishing http://evil' });
    expect(res.status).toBe(200);
    expect(mocks.reactions.enqueuePost).toHaveBeenCalledWith('ws1', settings, 'SERVER WEEKLY');
    expect(JSON.stringify(mocks.reactions.enqueuePost.mock.calls)).not.toContain('phishing');
  });

  it('monthly: текст из сохранённых результатов за период; действие пишется в журнал', async () => {
    const res = await post({ action: 'publish', kind: 'monthly', period: '2026-09' });
    expect(res.status).toBe(200);
    expect(mocks.reactions.buildMonthlyPost).toHaveBeenCalledWith('ws1', settings, '2026-09');
    expect(mocks.reactions.enqueuePost).toHaveBeenCalledWith('ws1', settings, 'SERVER MONTHLY');
    const log = mocks.prisma.workspaceActionLog.create.mock.calls.at(-1)![0].data;
    expect(log).toMatchObject({ workspaceId: 'ws1', userId: 'adm', action: 'reactions_publish' });
    expect(JSON.parse(log.details)).toMatchObject({ kind: 'monthly', period: '2026-09', channelId: 'room-ok' });
  });

  it('без сохранённого канала публикация невозможна; без доступа — ошибка доступа', async () => {
    mocks.prisma.reactionRatingSettings.findUnique.mockResolvedValue({ ...settings, reportChannelId: null });
    expect((await post({ action: 'publish', kind: 'weekly' })).status).toBe(400);
    mocks.reactionsAccess.mockResolvedValue({ ok: false, status: 403, error: 'no' });
    expect((await post({ action: 'publish', kind: 'weekly' })).status).toBe(403);
    expect(mocks.reactions.enqueuePost).not.toHaveBeenCalled();
  });

  it('PUT: новый канал рейтинга проверяется в RC, имя берётся из RC, а не от клиента', async () => {
    mocks.reactions.verifyReportChannel.mockResolvedValue({ id: 'room-new', name: 'real-name' });
    mocks.prisma.reactionRatingSettings.upsert.mockImplementation(async ({ update }) => ({ ...settings, ...update }));
    const res = await reactionsPut(
      new Request('http://localhost/api/workspace/ws1/reactions', {
        method: 'PUT',
        body: JSON.stringify({ reportChannelId: 'room-new', reportChannelName: 'spoofed' }),
      }),
      ctx,
    );
    expect(res.status).toBe(200);
    expect(mocks.reactions.verifyReportChannel).toHaveBeenCalledWith('ws1', 'adm', 'room-new');
    expect(mocks.prisma.reactionRatingSettings.upsert.mock.calls[0][0].update).toMatchObject({
      reportChannelId: 'room-new',
      reportChannelName: 'real-name',
    });
  });

  it('PUT: неизменённый канал повторно не проверяется; недоступный канал отклоняется', async () => {
    mocks.prisma.reactionRatingSettings.upsert.mockImplementation(async ({ update }) => ({ ...settings, ...update }));
    const put = (body: object) =>
      reactionsPut(new Request('http://localhost/api/workspace/ws1/reactions', { method: 'PUT', body: JSON.stringify(body) }), ctx);
    expect((await put({ reportChannelId: 'room-ok' })).status).toBe(200);
    expect(mocks.reactions.verifyReportChannel).not.toHaveBeenCalled();

    const { ReactionRatingError } = await import('@/lib/reactions/service');
    mocks.reactions.verifyReportChannel.mockRejectedValue(new ReactionRatingError('Канал недоступен'));
    expect((await put({ reportChannelId: 'room-foreign' })).status).toBe(400);
  });
});

// ── 3. Ограничения вкладок на сервере ──

describe('workspace tab restrictions (server)', () => {
  it('флаги совпадают с прежним ответом /api/workspace-tab-restrictions', () => {
    expect(computeWorkspaceTabFlags('LEAD_SUP', {})).toEqual({ templates: true, emojiImport: true, usersAdd: true });
    expect(computeWorkspaceTabFlags('MEMBER', {})).toEqual({ templates: true, emojiImport: false, usersAdd: false });
    expect(computeWorkspaceTabFlags('SUP', {})).toEqual({ templates: true, emojiImport: true, usersAdd: true });
    expect(computeWorkspaceTabFlags('ADM', {})).toEqual({ templates: true, emojiImport: false, usersAdd: false });
    expect(computeWorkspaceTabFlags('SUP', { workspaceTabUsersAddSup: 'false' }).usersAdd).toBe(false);
    expect(computeWorkspaceTabFlags('SUP', { workspaceTabEmojiImportSup: 'false' }).emojiImport).toBe(false);
    expect(computeWorkspaceTabFlags('ADM', { workspaceTabTemplatesAdm: 'false' }).templates).toBe(false);
  });

  it('usersAdd требует вкладку, флаг и не-интенсивное пространство', () => {
    const all = { templates: true, emojiImport: true, usersAdd: true };
    expect(isWorkspaceTabFeatureAllowed(all, 'usersAdd', 'https://chat.example.test')).toBe(true);
    expect(isWorkspaceTabFeatureAllowed({ ...all, usersAdd: false }, 'usersAdd')).toBe(false);
    expect(isWorkspaceTabFeatureAllowed({ ...all, emojiImport: false }, 'spaceSettings')).toBe(false);
    expect(isWorkspaceTabFeatureAllowed({ ...all, usersAdd: false }, 'spaceSettings')).toBe(true);
  });

  it('GET /api/workspace-tab-restrictions использует те же правила', async () => {
    mocks.session.mockResolvedValue(user({ role: 'SUP' }));
    mocks.prisma.systemSetting.findMany.mockResolvedValue([{ key: 'workspaceTabUsersAddSup', value: 'false' }]);
    expect(await (await tabRestrictions()).json()).toEqual({ templates: true, emojiImport: true, usersAdd: false });
  });

  it('bulk users: SUP с выключенным «Добавление пользователей» получает 403, по умолчанию — доступ', async () => {
    mocks.prisma.user.findUnique.mockResolvedValue({ role: 'SUP' });
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ id: 'w1', userId: 'sup', workspaceUrl: 'https://chat.example.test' });
    expect(await assertWorkspaceBulkUsersAccess('sup', 'w1')).toMatchObject({ ok: true });
    mocks.prisma.systemSetting.findMany.mockResolvedValue([{ key: 'workspaceTabUsersAddSup', value: 'false' }]);
    expect(await assertWorkspaceBulkUsersAccess('sup', 'w1')).toMatchObject({ ok: false, status: 403 });
  });

  it('bulk users / R2D2: ADM (вкладка скрыта в UI) получает 403; Lead_SUP — доступ', async () => {
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ id: 'w1', userId: 'x', workspaceUrl: 'https://chat.example.test' });
    mocks.prisma.workspaceAdminAssignment.findFirst.mockResolvedValue({ id: 'a' });
    mocks.prisma.user.findUnique.mockResolvedValue({ role: 'ADM' });
    expect(await assertWorkspaceBulkUsersAccess('adm', 'w1')).toMatchObject({ ok: false, status: 403 });
    expect(await assertWorkspaceR2Access('adm', 'w1')).toMatchObject({ ok: false, status: 403 });
    mocks.prisma.user.findUnique.mockResolvedValue({ role: 'LEAD_SUP' });
    expect(await assertWorkspaceBulkUsersAccess('lead', 'w1')).toMatchObject({ ok: true });
    expect(await assertWorkspaceR2Access('lead', 'w1')).toMatchObject({ ok: true });
  });

  it('space-settings: нужен доступ к пространству и вкладка; небезопасный id — 400', async () => {
    expect((await requireWorkspaceTabAccess({ id: 'sup', role: 'SUP' }, '../x', 'spaceSettings')).ok).toBe(false);
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ id: 'w1', userId: 'owner', workspaceUrl: 'https://c.test' });
    mocks.prisma.workspaceAdminAssignment.findFirst.mockResolvedValue(null);
    const foreign = await requireWorkspaceTabAccess({ id: 'sup', role: 'SUP' }, 'w1', 'spaceSettings');
    expect(foreign.ok ? 200 : foreign.response.status).toBe(404);
    mocks.prisma.workspaceAdminAssignment.findFirst.mockResolvedValue({ id: 'a' });
    expect((await requireWorkspaceTabAccess({ id: 'sup', role: 'SUP' }, 'w1', 'spaceSettings')).ok).toBe(true);
    mocks.prisma.systemSetting.findMany.mockResolvedValue([{ key: 'workspaceTabEmojiImportSup', value: 'false' }]);
    const denied = await requireWorkspaceTabAccess({ id: 'sup', role: 'SUP' }, 'w1', 'spaceSettings');
    expect(denied.ok ? 200 : denied.response.status).toBe(403);
  });
});

// ── 4. Назначения на пространства ──

describe('assign-adm: SUP не управляет пространствами Lead_SUP и чужими', () => {
  const ctx = { params: Promise.resolve({ workspaceId: 'w1' }) };
  const call = (fn: typeof assignAdm, body: object) =>
    fn(new Request('http://localhost/api/admin/workspaces/w1/assign-adm', { method: 'POST', body: JSON.stringify(body) }), ctx);

  beforeEach(() => {
    mocks.prisma.workspaceConnection.findUnique.mockResolvedValue({ id: 'w1', userId: 'owner', workspaceUrl: 'https://c.test' });
    mocks.prisma.workspaceConnection.findMany.mockResolvedValue([{ id: 'w1' }]);
    mocks.prisma.workspaceConnection.findFirst.mockResolvedValue(null);
    mocks.prisma.workspaceAdminAssignment.findMany.mockResolvedValue([]);
  });

  const setup = (ownerRole: string, assigned: boolean) => {
    mocks.prisma.user.findUnique.mockImplementation(async ({ where }: { where: { id: string } }) =>
      where.id === 'owner' ? { id: 'owner', role: ownerRole } : { id: where.id, role: 'MEMBER' },
    );
    mocks.prisma.workspaceAdminAssignment.findFirst.mockImplementation(async ({ where }: { where: { userId: string } }) =>
      where.userId === 'sup' && assigned ? { id: 'asg' } : null,
    );
  };

  it('SUP, назначенный на пространство Lead_SUP, не может назначать и снимать', async () => {
    mocks.session.mockResolvedValue(user({ id: 'sup', role: 'SUP' }));
    setup('LEAD_SUP', true);
    expect((await call(assignAdm, { userId: 'target' })).status).toBe(403);
    expect((await call(unassignAdm, { userId: 'target' })).status).toBe(403);
    expect(mocks.prisma.workspaceAdminAssignment.create).not.toHaveBeenCalled();
    expect(mocks.prisma.workspaceAdminAssignment.deleteMany).not.toHaveBeenCalled();
    const list = await (await listAssignments(new Request('http://localhost/x'), ctx)).json();
    expect(list.canManage).toBe(false);
  });

  it('SUP без назначения на чужое пространство — 403; назначенный на пространство SUP/ADM — можно', async () => {
    mocks.session.mockResolvedValue(user({ id: 'sup', role: 'SUP' }));
    setup('ADM', false);
    expect((await call(assignAdm, { userId: 'target' })).status).toBe(403);
    setup('ADM', true);
    expect((await call(assignAdm, { userId: 'target' })).status).toBe(200);
    expect(mocks.prisma.workspaceAdminAssignment.create).toHaveBeenCalled();
  });

  it('Lead_SUP — без ограничений; ADM — 403; небезопасный id — 400', async () => {
    mocks.session.mockResolvedValue(user({ id: 'lead', role: 'LEAD_SUP' }));
    setup('LEAD_SUP', false);
    expect((await call(assignAdm, { userId: 'target' })).status).toBe(200);
    expect((await call(assignAdm, { userId: '../etc' })).status).toBe(400);
    mocks.session.mockResolvedValue(user({ id: 'adm', role: 'ADM' }));
    expect((await call(assignAdm, { userId: 'target' })).status).toBe(403);
  });
});

// ── 7. Токены приглашений ──

describe('invite tokens: в БД только хеш', () => {
  it('hash/lookup: хеш из БД нельзя предъявить вместо токена', () => {
    const raw = 'A'.repeat(43);
    expect(hashInviteToken(raw)).toMatch(/^sha256:[0-9a-f]{64}$/);
    expect(inviteTokenLookupValues(raw)).toEqual([hashInviteToken(raw), raw]);
    expect(inviteTokenLookupValues(hashInviteToken(raw))).toEqual([]);
    expect(inviteTokenLookupValues('short')).toEqual([]);
  });

  it('поиск: сначала по хешу, затем legacy по сырому значению', async () => {
    const raw = 'legacyToken_0123456789abcdef';
    mocks.prisma.inviteToken.findMany.mockResolvedValue([{ id: 'legacy', token: raw }]);
    expect(await findInviteByRawToken(raw)).toMatchObject({ id: 'legacy' });
    mocks.prisma.inviteToken.findMany.mockResolvedValue([{ id: 'legacy', token: raw }, { id: 'new', token: hashInviteToken(raw) }]);
    expect(await findInviteByRawToken(raw)).toMatchObject({ id: 'new' });
  });

  it('создание: в БД пишется хеш, сырой токен — только в ответе', async () => {
    mocks.session.mockResolvedValue(user({ id: 'lead', role: 'LEAD_SUP' }));
    mocks.prisma.user.findUnique.mockResolvedValue(null);
    mocks.prisma.inviteToken.create.mockResolvedValue({});
    const res = await createInvite(
      new Request('http://localhost/api/admin/invite', { method: 'POST', body: JSON.stringify({ role: 'ADM' }) }),
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const stored = mocks.prisma.inviteToken.create.mock.calls[0][0].data.token;
    expect(stored).toBe(hashInviteToken(body.token));
    expect(stored).not.toContain(body.token);
    expect(body.link).toContain(`/register/invite/${body.token}`);
  });

  it('проверка ссылки работает по сырому токену из ссылки', async () => {
    const raw = 'newToken_0123456789abcdefghij';
    mocks.prisma.inviteToken.findMany.mockResolvedValue([
      { token: hashInviteToken(raw), role: 'ADM', email: null, expiresAt: new Date(Date.now() + 3600_000) },
    ]);
    const res = await checkInvite(new Request('http://localhost/api/auth/invite/x'), { params: Promise.resolve({ token: raw }) });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ valid: true, role: 'ADM' });
  });

  it('регистрация: если в приглашении задан логин, другой логин отклоняется', async () => {
    expect(inviteLoginMatches(null, 'any')).toBe(true);
    expect(inviteLoginMatches('ivan.petrov', 'Ivan.Petrov')).toBe(true);
    expect(inviteLoginMatches('ivan.petrov', 'attacker')).toBe(false);

    const raw = 'regToken_0123456789abcdefghij';
    mocks.prisma.inviteToken.findMany.mockResolvedValue([
      { id: 'i1', token: hashInviteToken(raw), role: 'ADM', email: 'ivan.petrov', expiresAt: new Date(Date.now() + 3600_000) },
    ]);
    const res = await registerInvite(
      new Request('http://localhost/api/auth/register-invite', {
        method: 'POST',
        body: JSON.stringify({ token: raw, login: 'attacker', password: 'Str0ng!Passw0rd', confirmPassword: 'Str0ng!Passw0rd', name: 'X' }),
      }),
    );
    expect(res.status).toBe(400);
    expect(mocks.prisma.$transaction).not.toHaveBeenCalled();
  });
});

// ── 5. Внутренние ошибки не раскрываются в production ──

describe('safe error messages', () => {
  it('исключение при назначении каналов не раскрывает детали в production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const client = {
      inviteUserToRoom: vi.fn().mockRejectedValue(new Error('connect ECONNREFUSED 10.0.0.5:5432 secret')),
      addUserToRole: vi.fn(),
    };
    const result = await applyUserAssignments(client, 't', 'a', 'u', 'alice', {
      channels: [{ id: 'c1', type: 'c', name: 'General' }], roleIds: [],
    });
    expect(result.errors.join(' ')).not.toContain('10.0.0.5');
    expect(result.errors[0]).toContain('Ошибка соединения с Rocket.Chat');
  });
});
