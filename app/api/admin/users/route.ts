import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { hashPassword, isForbiddenError } from '@/lib/auth';
import { requireAuth, requireSupportAdmOrAdmin } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { inviteAssignableRoles } from '@/lib/roles';
import { createActivityLog } from '@/app/api/activity/route';
import { getSafeErrorMessage } from '@/lib/security';
import { getAdmVisibleAuthorIds } from '@/lib/message-scope';
import { createUserBodySchema, generateTemporaryPassword, zodErrorBody } from '@/lib/admin-user-schemas';

/**
 * GET — список пользователей (Lead_SUP, SUP, ADM).
 * ?scope=message-authors — для фильтра сообщений по автору: ADM получает только себя и авторов
 * сообщений в своих пространствах (владелец/назначен), SUP/Lead_SUP — полный список, как без параметра.
 */
export async function GET(request: Request) {
  try {
    const currentUser = await requireSupportAdmOrAdmin();
    const scope = new URL(request.url).searchParams.get('scope');

    // ADM получает список только для выбора («от имени», назначения) — без служебных полей админки
    if (!canPerformAction(currentUser, 'admin:users')) {
      const onlyIds =
        scope === 'message-authors' && currentUser.role === 'ADM'
          ? await getAdmVisibleAuthorIds(currentUser.id)
          : null;
      const users = await prisma.user.findMany({
        ...(onlyIds ? { where: { id: { in: onlyIds } } } : {}),
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          avatarUrl: true,
          role: true,
          isActive: true,
          volunteerExpiresAt: true,
          volunteerIntensive: true,
        },
        orderBy: { createdAt: 'desc' },
      });
      return NextResponse.json({ users });
    }

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatarUrl: true,
        role: true,
        restrictedFeatures: true,
        isActive: true,
        isBlocked: true,
        blockedAt: true,
        blockedReason: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
        requirePasswordChange: true,
        lastLoginAt: true,
        createdAt: true,
        _count: {
          select: {
            workspaces: true,
            scheduledMessages: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ users });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    console.error('Get users error:', e);
    return NextResponse.json(
      { error: getSafeErrorMessage(e, 'Failed to fetch users') },
      { status: 500 }
    );
  }
}

/**
 * POST — создать пользователя напрямую (Lead_SUP: SUP/ADM/MEMBER; SUP: ADM/MEMBER).
 * Body: { email (логин), username?, name?, role, passwordMode?: 'generate' | 'login' | 'manual', password?,
 *         volunteerExpiresAt?, volunteerIntensive? }
 * При passwordMode 'generate' / 'login' пользователь обязан сменить пароль при первом входе.
 * Ответ: { user, temporaryPassword? } — временный пароль показывается один раз.
 */
export async function POST(request: Request) {
  try {
    const currentUser = await requireAuth();
    if (!canPerformAction(currentUser, 'admin:users:create')) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }

    const raw = await request.json().catch(() => null);
    const parsed = createUserBodySchema.safeParse(raw ?? {});
    if (!parsed.success) {
      return NextResponse.json(zodErrorBody(parsed.error), { status: 400 });
    }
    const input = parsed.data;

    if (!inviteAssignableRoles(currentUser.role).includes(input.role)) {
      return NextResponse.json(
        { error: `Вы не можете создавать пользователей с ролью ${input.role}`, fieldErrors: { role: 'Роль недоступна для вашей учётной записи' } },
        { status: 403 }
      );
    }

    const existingUser = await prisma.user.findUnique({ where: { email: input.email }, select: { id: true } });
    if (existingUser) {
      return NextResponse.json(
        { error: 'Пользователь с таким логином уже существует', fieldErrors: { email: 'Логин уже занят' } },
        { status: 409 }
      );
    }
    if (input.username) {
      const existingUsername = await prisma.user.findFirst({
        where: { username: { equals: input.username, mode: 'insensitive' } },
        select: { id: true },
      });
      if (existingUsername) {
        return NextResponse.json(
          { error: 'Username уже занят', fieldErrors: { username: 'Username уже занят' } },
          { status: 409 }
        );
      }
    }

    let plainPassword: string;
    let temporaryPassword: string | null = null;
    if (input.passwordMode === 'manual') {
      plainPassword = input.password as string;
    } else if (input.passwordMode === 'login') {
      plainPassword = input.email;
    } else {
      plainPassword = generateTemporaryPassword();
      temporaryPassword = plainPassword;
    }

    const data: Prisma.UserCreateInput = {
      email: input.email,
      password: await hashPassword(plainPassword),
      name: input.name,
      username: input.username,
      role: input.role,
      requirePasswordChange: input.passwordMode !== 'manual',
    };
    if (input.role === 'MEMBER' && input.volunteerExpiresAt) {
      data.volunteerExpiresAt = input.volunteerExpiresAt;
      data.volunteerIntensive = input.volunteerIntensive;
    }

    const newUser = await prisma.user.create({
      data,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
        requirePasswordChange: true,
        createdAt: true,
      },
    });

    await createActivityLog(
      currentUser.id,
      'USER_CREATED_BY_ADMIN',
      { targetUserId: newUser.id, email: newUser.email, role: newUser.role, passwordMode: input.passwordMode },
      'User',
      newUser.id,
      request
    );

    return NextResponse.json({ user: newUser, temporaryPassword });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    console.error('Create user error:', e);
    return NextResponse.json({ error: 'Не удалось создать пользователя' }, { status: 500 });
  }
}
