import { NextResponse } from 'next/server';
import { getSafeErrorMessage } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { isUnsafeId } from '@/lib/security';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';

/** Проверка доступа: владелец пространства или назначенный SUP/ADMIN/ADM */
async function canAccessWorkspaceAdmin(userId: string, userRole: string, workspaceId: string) {
  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { userId: true, workspaceUrl: true },
  });
  if (!workspace) return { ok: false as const, error: 'Workspace not found' };
  if (workspace.userId === userId) return { ok: true as const };
  if (userRole !== 'SUPPORT' && userRole !== 'ADMIN' && userRole !== 'ADM') return { ok: false as const, error: 'Forbidden' };
  const assigned = await prisma.workspaceAdminAssignment.findFirst({
    where: { userId, workspaceId },
    select: { id: true },
  });
  return assigned ? { ok: true as const } : { ok: false as const, error: 'Forbidden' };
}

/**
 * POST — список пользователей Rocket.Chat (все или по логинам) с lastLogin.
 * Тело: { adminUsername?, adminPassword?, usernames?: string[] }.
 * Сначала пробует использовать существующее подключение (если вы владелец или назначены). Если не хватает прав — нужны креды админа RC.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id: workspaceId } = await params;
    if (isUnsafeId(workspaceId)) {
      return NextResponse.json({ error: 'Invalid workspace id' }, { status: 400 });
    }

    const access = await canAccessWorkspaceAdmin(currentUser.id, currentUser.role, workspaceId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.error === 'Workspace not found' ? 404 : 403 });
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { workspaceUrl: true },
    });
    if (!workspace?.workspaceUrl) {
      return NextResponse.json({ error: 'Workspace URL not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const adminUsername = (body.adminUsername ?? '').trim();
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';
    const filterUsernames = Array.isArray(body.usernames)
      ? (body.usernames as string[]).map((u) => String(u).trim().toLowerCase()).filter(Boolean)
      : null;

    const baseUrl = workspace.workspaceUrl.replace(/\/$/, '');
    const rc = new RocketChatClient(baseUrl);
    let authToken: string;
    let rcUserId: string;

    // 1. Если запрашивают полный список (пустой filterUsernames) — требуем креды админа RC.
    //    Без кредов можно только по конкретным логинам (через user-access API для добавленных).
    if ((!filterUsernames || filterUsernames.length === 0) && (!adminUsername || !adminPassword)) {
      return NextResponse.json(
        { error: 'Для получения полного списка пользователей RC укажите логин и пароль администратора Rocket.Chat.' },
        { status: 400 }
      );
    }

    // 2. Пробуем существующее подключение — работает, если вы владелец/назначены и подключены
    const effective = await getEffectiveConnectionForRc(currentUser.id, workspaceId);
    if (effective?.authToken && effective?.userId_RC && (filterUsernames?.length ?? 0) > 0) {
      try {
        await rc.listUsers(effective.authToken, effective.userId_RC, { count: 1, offset: 0 });
        authToken = effective.authToken;
        rcUserId = effective.userId_RC;
      } catch {
        // Подключение есть, но listUsers не прошёл (нет прав) — пробуем логин по кредам
        if (adminUsername && adminPassword) {
          try {
            const loginResult = await rc.login(adminUsername, adminPassword);
            authToken = loginResult.authToken;
            rcUserId = loginResult.userId;
          } catch (e: any) {
            const msg = e?.message ?? '';
            const hint =
              msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid')
                ? 'Проверьте логин и пароль. Если входите через OAuth/SSO — у аккаунта может не быть пароля для API.'
                : msg ? `Ошибка Rocket.Chat: ${msg}` : 'Проверьте логин и пароль.';
            return NextResponse.json(
              { code: 'RC_LOGIN_FAILED', error: 'Не удалось войти в Rocket.Chat. ' + hint, details: msg },
              { status: 403 }
            );
          }
        } else {
          return NextResponse.json(
            { error: 'Подключение есть, но прав на список пользователей нет. Укажите логин и пароль администратора RC.' },
            { status: 400 }
          );
        }
      }
    } else if (adminUsername && adminPassword) {
      // 3. Логин по кредам
      try {
        const loginResult = await rc.login(adminUsername, adminPassword);
        authToken = loginResult.authToken;
        rcUserId = loginResult.userId;
      } catch (e: any) {
        const msg = e?.message ?? '';
        const hint =
          msg.toLowerCase().includes('unauthorized') || msg.toLowerCase().includes('invalid')
            ? 'Проверьте логин и пароль. Если входите через OAuth/SSO — у аккаунта может не быть пароля для API.'
            : msg ? `Ошибка Rocket.Chat: ${msg}` : 'Проверьте логин и пароль.';
        return NextResponse.json(
          { code: 'RC_LOGIN_FAILED', error: 'Не удалось войти в Rocket.Chat. ' + hint, details: msg },
          { status: 403 }
        );
      }
    } else {
      return NextResponse.json(
        { error: 'Укажите логины для проверки и подключитесь к пространству, либо укажите креды админа RC для полного списка.' },
        { status: 400 }
      );
    }

    const allUsers: Array<{ _id: string; username?: string; name?: string; emails?: Array<{ address: string }>; lastLogin?: string }> = [];
    let offset = 0;
    const pageSize = 100;
    let total = 0;
    do {
      const { users, total: t } = await rc.listUsers(authToken, rcUserId, { count: pageSize, offset });
      allUsers.push(...users);
      total = t;
      offset += pageSize;
    } while (allUsers.length < total && offset < 5000);

    const normalized = allUsers.map((u) => ({
      rcUserId: u._id,
      username: u.username ?? u.name ?? '',
      email: u.emails?.[0]?.address ?? '',
      lastLogin: u.lastLogin ?? null,
    }));

    let results = normalized;
    if (filterUsernames && filterUsernames.length > 0) {
      const set = new Set(filterUsernames);
      results = normalized.filter((r) => set.has((r.username || '').toLowerCase()) || set.has((r.email || '').toLowerCase()));
    }

    return NextResponse.json({
      results: results.map((r) => ({
        username: r.username,
        email: r.email,
        lastLogin: r.lastLogin,
        rcUserId: r.rcUserId,
        found: true,
        enteredWorkspace: !!r.lastLogin,
        lastEnteredAt: r.lastLogin,
      })),
      total: results.length,
    });
  } catch (error) {
    console.error('User access RC error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Не удалось получить список пользователей RC') },
      { status: 500 }
    );
  }
}
