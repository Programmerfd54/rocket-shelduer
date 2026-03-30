import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { resolveR2RcAuth } from '@/lib/r2d2-rc-auth';
import { assertWorkspaceR2Access } from '@/lib/workspace-r2-access';

const EMAIL_DOMAIN = '@student.21-school.ru';
/** Как в «Добавление пользователей» (импорт) */
const MAX_CREATE_USERS = 100;
const MAX_BATCH = 200;

/** Простая проверка «школьного» логина: строчные латинские буквы и цифры, от 3 символов. */
const DEFAULT_VALID_USERNAME = /^[a-z][a-z0-9]*$/;

function parseIdentifiers(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw.map((x) => (typeof x === 'string' ? x.trim().replace(/^@/, '') : '')).filter(Boolean);
  }
  if (typeof raw === 'string') {
    return raw
      .split(/[\n,;]+/)
      .map((s) => s.trim().replace(/^@/, ''))
      .filter(Boolean);
  }
  return [];
}

async function logR2(
  workspaceId: string,
  userId: string,
  action: string,
  details: Record<string, unknown>
) {
  try {
    await prisma.workspaceActionLog.create({
      data: {
        workspaceId,
        userId,
        action: `r2d2_${action}`,
        details: JSON.stringify(details).slice(0, 12000),
      },
    });
  } catch {
    /* ignore */
  }
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;

    const access = await assertWorkspaceR2Access(user.id, workspaceId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
    }

    const body = await request.json().catch(() => ({}));
    const auth = await resolveR2RcAuth(workspaceId, user.id, {
      adminUsername: typeof body.adminUsername === 'string' ? body.adminUsername : undefined,
      adminPassword: typeof body.adminPassword === 'string' ? body.adminPassword : undefined,
      totpCode: typeof body.totpCode === 'string' ? body.totpCode : undefined,
    });
    if (!auth.ok) {
      return NextResponse.json(
        { error: auth.error, ...(auth.requiresTotp ? { requiresTotp: true } : {}) },
        { status: auth.status }
      );
    }
    const { rc, authToken, rcUserId: rcAdminId } = auth;

    const action = typeof body.action === 'string' ? body.action : '';

    switch (action) {
      case 'lost_users': {
        const users = await rc.listAllUsers(authToken, rcAdminId);
        const lost = users.filter((u) => {
          if (!u.lastLogin) return true;
          const t = new Date(u.lastLogin).getTime();
          return !Number.isFinite(t) || t === 0;
        });
        await logR2(workspaceId, user.id, 'lost_users', { count: lost.length });
        return NextResponse.json({
          ok: true,
          users: lost.map((u) => ({
            id: u._id,
            username: u.username,
            name: u.name,
            email: u.emails?.[0]?.address,
            lastLogin: u.lastLogin ?? null,
          })),
        });
      }

      case 'bad_nicknames': {
        const patternRaw = typeof body.pattern === 'string' ? body.pattern : '';
        let re: RegExp;
        try {
          re = patternRaw.trim() ? new RegExp(patternRaw) : DEFAULT_VALID_USERNAME;
        } catch {
          return NextResponse.json({ error: 'Некорректное регулярное выражение' }, { status: 400 });
        }
        const users = await rc.listAllUsers(authToken, rcAdminId);
        const bad = users.filter((u) => u.username && !re.test(u.username));
        await logR2(workspaceId, user.id, 'bad_nicknames', { count: bad.length, pattern: patternRaw || 'default' });
        return NextResponse.json({
          ok: true,
          pattern: patternRaw || String(DEFAULT_VALID_USERNAME),
          users: bad.map((u) => ({
            id: u._id,
            username: u.username,
            name: u.name,
            email: u.emails?.[0]?.address,
          })),
        });
      }

      case 'create_users': {
        const ids = parseIdentifiers(body.identifiers);
        if (ids.length === 0) {
          return NextResponse.json({ error: 'Укажите логины (по одному на строку)' }, { status: 400 });
        }
        if (ids.length > MAX_CREATE_USERS) {
          return NextResponse.json(
            { error: `Максимум ${MAX_CREATE_USERS} пользователей за один запрос` },
            { status: 400 }
          );
        }
        const results: { login: string; ok: boolean; error?: string; rcUserId?: string }[] = [];
        for (const login of ids) {
          const local = login.includes('@') ? login.split('@')[0]! : login;
          const email = login.includes('@') ? login : `${local}${EMAIL_DOMAIN}`;
          const created = await rc.createUser(authToken, rcAdminId, {
            email,
            name: local,
            username: local,
            password: local,
            requirePasswordChange: true,
            verified: true,
          });
          if (created.success && created.userId) {
            results.push({ login: local, ok: true, rcUserId: created.userId });
          } else {
            results.push({ login: local, ok: false, error: created.error || 'Ошибка' });
          }
        }
        await logR2(workspaceId, user.id, 'create_users', {
          ok: results.filter((r) => r.ok).length,
          fail: results.filter((r) => !r.ok).length,
        });
        return NextResponse.json({ ok: true, results });
      }

      case 'deactivate_users':
      case 'activate_users': {
        const active = action === 'activate_users';
        const ids = parseIdentifiers(body.identifiers);
        if (ids.length === 0) {
          return NextResponse.json({ error: 'Укажите логины' }, { status: 400 });
        }
        if (ids.length > MAX_BATCH) {
          return NextResponse.json({ error: `Максимум ${MAX_BATCH}` }, { status: 400 });
        }
        const results: { username: string; ok: boolean; error?: string }[] = [];
        for (const un of ids) {
          const info = await rc.getUserByUsername(authToken, rcAdminId, un);
          if (!info) {
            results.push({ username: un, ok: false, error: 'Пользователь не найден' });
            continue;
          }
          const r = await rc.setUserActiveStatus(authToken, rcAdminId, info._id, active);
          results.push({ username: un, ok: r.success, error: r.error });
        }
        await logR2(workspaceId, user.id, active ? 'activate_users' : 'deactivate_users', {
          count: results.filter((x) => x.ok).length,
        });
        return NextResponse.json({ ok: true, results });
      }

      case 'invite_to_room': {
        const channelName = typeof body.channelName === 'string' ? body.channelName.replace(/^#/, '').trim() : '';
        const ids = parseIdentifiers(body.identifiers);
        if (!channelName || ids.length === 0) {
          return NextResponse.json({ error: 'Укажите channelName и логины пользователей' }, { status: 400 });
        }
        const channels = await rc.getChannels(authToken, rcAdminId);
        const room = channels.find((c) => (c.name || '').toLowerCase() === channelName.toLowerCase());
        if (!room?._id) {
          return NextResponse.json({ error: `Канал #${channelName} не найден среди доступных` }, { status: 404 });
        }
        const roomType = room.t === 'p' ? 'p' : 'c';
        const results: { username: string; ok: boolean; error?: string }[] = [];
        for (const un of ids) {
          const info = await rc.getUserByUsername(authToken, rcAdminId, un);
          if (!info) {
            results.push({ username: un, ok: false, error: 'Не найден' });
            continue;
          }
          const inv = await rc.inviteUserToRoom(authToken, rcAdminId, room._id, roomType, info._id);
          results.push({ username: un, ok: inv.success, error: inv.error });
        }
        await logR2(workspaceId, user.id, 'invite_to_room', { channel: channelName, ok: results.filter((x) => x.ok).length });
        return NextResponse.json({ ok: true, channel: channelName, results });
      }

      case 'kick_from_room': {
        const channelName = typeof body.channelName === 'string' ? body.channelName.replace(/^#/, '').trim() : '';
        const ids = parseIdentifiers(body.identifiers);
        if (!channelName || ids.length === 0) {
          return NextResponse.json({ error: 'Укажите channelName и логины' }, { status: 400 });
        }
        const channels = await rc.getChannels(authToken, rcAdminId);
        const room = channels.find((c) => (c.name || '').toLowerCase() === channelName.toLowerCase());
        if (!room?._id) {
          return NextResponse.json({ error: `Канал #${channelName} не найден` }, { status: 404 });
        }
        const roomType = room.t === 'p' ? 'p' : 'c';
        const results: { username: string; ok: boolean; error?: string }[] = [];
        for (const un of ids) {
          const info = await rc.getUserByUsername(authToken, rcAdminId, un);
          if (!info) {
            results.push({ username: un, ok: false, error: 'Не найден' });
            continue;
          }
          const k = await rc.kickFromRoom(authToken, rcAdminId, room._id, roomType, info._id);
          results.push({ username: un, ok: k.success, error: k.error });
        }
        await logR2(workspaceId, user.id, 'kick_from_room', { channel: channelName, ok: results.filter((x) => x.ok).length });
        return NextResponse.json({ ok: true, channel: channelName, results });
      }

      default:
        return NextResponse.json({ error: 'Неизвестное действие' }, { status: 400 });
    }
  } catch (error: any) {
    console.error('[r2d2]', error);
    return NextResponse.json(
      { error: error?.message || 'Ошибка R2D2' },
      { status: 500 }
    );
  }
}
