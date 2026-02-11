import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, hashPassword } from '@/lib/auth';
import { isUnsafeId } from '@/lib/security';
import { RocketChatClient } from '@/lib/rocketchat';

/** Проверка доступа: владелец пространства или назначенный SUP/ADMIN */
async function canAccessWorkspaceAdmin(userId: string, userRole: string, workspaceId: string) {
  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { userId: true },
  });
  if (!workspace) return { ok: false as const, error: 'Workspace not found' };
  if (workspace.userId === userId) return { ok: true as const };
  if (userRole !== 'SUPPORT' && userRole !== 'ADMIN') return { ok: false as const, error: 'Forbidden' };
  const assigned = await prisma.workspaceAdminAssignment.findFirst({
    where: { userId, workspaceId },
    select: { id: true },
  });
  return assigned ? { ok: true as const } : { ok: false as const, error: 'Forbidden' };
}

/** Ищем пользователя в RC по username (или email), перебирая users.list. */
async function findRcUserByUsername(
  rc: RocketChatClient,
  authToken: string,
  rcUserId: string,
  loginValue: string
): Promise<{ _id: string } | null> {
  const want = loginValue.trim().toLowerCase();
  let offset = 0;
  const pageSize = 100;
  for (let i = 0; i < 50; i++) {
    const { users, total } = await rc.listUsers(authToken, rcUserId, { count: pageSize, offset });
    const found = users.find(
      (u) =>
        (u.username ?? '').toLowerCase() === want ||
        (u.emails?.[0]?.address ?? '').toLowerCase() === want ||
        (u.emails?.[0]?.address ?? '').toLowerCase().startsWith(want + '@')
    );
    if (found) return { _id: found._id };
    offset += pageSize;
    if (offset >= total) break;
  }
  return null;
}

/**
 * POST — сброс пароля по никнейму (логину).
 * Новый пароль = логин. Опционально: adminUsername + adminPassword — сброс также в Rocket.Chat.
 * Доступ: SUP или ADMIN с доступом к пространству.
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

    const body = await request.json().catch(() => ({}));
    const single = typeof body.username === 'string' ? body.username.trim() : '';
    const rawList = Array.isArray(body.usernames) ? body.usernames : null;
    const usernames: string[] = rawList
      ? (rawList as string[]).map((u) => String(u).trim()).filter(Boolean)
      : single ? [single] : [];
    const adminUsername = typeof body.adminUsername === 'string' ? body.adminUsername.trim() : '';
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';
    const withRc = !!adminUsername && !!adminPassword;

    if (usernames.length === 0) {
      return NextResponse.json({ error: 'Укажите никнейм (логин) или список логинов (usernames).' }, { status: 400 });
    }
    if (usernames.length > 100) {
      return NextResponse.json({ error: 'Максимум 100 пользователей за запрос.' }, { status: 400 });
    }

    let rcAuth: { authToken: string; rcUserId: string } | null = null;
    let rc: RocketChatClient | null = null;
    if (withRc) {
      const workspace = await prisma.workspaceConnection.findUnique({
        where: { id: workspaceId },
        select: { workspaceUrl: true },
      });
      if (workspace?.workspaceUrl) {
        try {
          rc = new RocketChatClient(workspace.workspaceUrl.replace(/\/$/, ''));
          const loginResult = await rc.login(adminUsername, adminPassword);
          rcAuth = { authToken: loginResult.authToken, rcUserId: loginResult.userId };
        } catch {
          return NextResponse.json(
            { error: 'Не удалось войти в Rocket.Chat. Проверьте логин и пароль администратора.' },
            { status: 401 }
          );
        }
      }
    }

    const results: { username: string; success: boolean; message: string }[] = [];

    for (const rawInput of usernames) {
      const normalized = rawInput.trim().toLowerCase().replace(/\s+/g, '');
      const targetUser = await prisma.user.findFirst({
        where: {
          OR: [
            { username: { equals: rawInput.trim(), mode: 'insensitive' } },
            { email: { equals: rawInput.trim(), mode: 'insensitive' } },
            { email: { equals: normalized, mode: 'insensitive' } },
            ...(normalized.includes('@') ? [] : [{ email: { startsWith: normalized + '@', mode: 'insensitive' as const } }]),
          ],
        },
        select: { id: true, username: true, email: true },
      });
      const loginValue = targetUser ? (targetUser.username ?? targetUser.email.split('@')[0] ?? targetUser.email) : rawInput.trim();

      if (!targetUser) {
        if (withRc && rcAuth && rc) {
          const rcUser = await findRcUserByUsername(rc, rcAuth.authToken, rcAuth.rcUserId, loginValue);
          if (rcUser) {
            const updateRc = await rc.updateUserPassword(rcAuth.authToken, rcAuth.rcUserId, rcUser._id, loginValue, true);
            if (updateRc.success) {
              results.push({ username: rawInput, success: true, message: `Пароль в Rocket.Chat = логин (${loginValue}). В приложении пользователь не найден — сброшен только в RC.` });
            } else {
              results.push({ username: rawInput, success: false, message: `В RC найден, но не удалось сменить пароль: ${updateRc.error ?? 'ошибка'}.` });
            }
          } else {
            results.push({ username: rawInput, success: false, message: 'Не найден в приложении и в Rocket.Chat.' });
          }
        } else {
          results.push({ username: rawInput, success: false, message: 'Не найден в приложении. Укажите креды администратора RC, чтобы сбросить пароль только в Rocket.Chat.' });
        }
        continue;
      }

      const newPasswordHash = await hashPassword(loginValue);
      await prisma.user.update({
        where: { id: targetUser.id },
        data: { password: newPasswordHash, requirePasswordChange: true },
      });

      let msg = `Пароль = логин (${loginValue}). При первом входе потребуется сменить пароль.`;
      if (withRc && rcAuth && rc) {
        const rcUser = await findRcUserByUsername(rc, rcAuth.authToken, rcAuth.rcUserId, loginValue);
        if (rcUser) {
          const updateRc = await rc.updateUserPassword(rcAuth.authToken, rcAuth.rcUserId, rcUser._id, loginValue, true);
          if (updateRc.success) msg += ' В Rocket.Chat пароль также сброшен.';
          else msg += ` В RC не обновлён: ${updateRc.error ?? 'ошибка'}.`;
        } else {
          msg += ' В Rocket.Chat пользователь не найден (сброшен только в приложении).';
        }
      }
      results.push({ username: rawInput, success: true, message: msg });
    }

    const successCount = results.filter((r) => r.success).length;
    return NextResponse.json({
      success: successCount > 0,
      results,
      message: successCount === results.length
        ? `Пароль сброшен для ${successCount} пользователей. При первом входе им нужно будет задать новый пароль.`
        : `Обработано: ${successCount} из ${results.length}.`,
    });
  } catch (error) {
    console.error('Reset user password error:', error);
    return NextResponse.json(
      { error: 'Не удалось сбросить пароль' },
      { status: 500 }
    );
  }
}
