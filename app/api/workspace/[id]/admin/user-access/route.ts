import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { isUnsafeId } from '@/lib/security';

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

type OneResult = {
  username: string;
  found: boolean;
  email?: string;
  addedAt?: string;
  lastLoginAt?: string | null;
  enteredWorkspace?: boolean;
  lastEnteredAt?: string | null;
  message?: string;
};

/**
 * GET — состояние входа одного или нескольких пользователей в пространство по никнейму.
 * Параметры: username (один) или usernames (несколько, через запятую).
 * Возвращает: results[] с полями по каждому пользователю.
 */
export async function GET(
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

    const { searchParams } = new URL(request.url);
    const single = searchParams.get('username')?.trim() ?? '';
    const multiRaw = searchParams.get('usernames')?.trim() ?? '';
    const usernames: string[] = multiRaw
      ? multiRaw.split(/[\s,;]+/).map((s) => s.trim()).filter(Boolean)
      : single ? [single] : [];

    if (usernames.length === 0) {
      return NextResponse.json({ error: 'Укажите никнейм (username) или список (usernames через запятую).' }, { status: 400 });
    }
    if (usernames.length > 100) {
      return NextResponse.json({ error: 'Максимум 100 пользователей за запрос.' }, { status: 400 });
    }

    const results: OneResult[] = [];

    for (const username of usernames) {
      const added = await prisma.workspaceAddedUser.findFirst({
        where: {
          workspaceId,
          username: { equals: username, mode: 'insensitive' },
        },
        select: {
          id: true,
          username: true,
          email: true,
          addedAt: true,
          lastLoginAt: true,
          status: true,
        },
      });

      if (!added) {
        results.push({
          username,
          found: false,
          message: 'Не найден в списке добавленных в пространство',
        });
        continue;
      }

      results.push({
        username: added.username,
        found: true,
        email: added.email,
        addedAt: added.addedAt.toISOString(),
        lastLoginAt: added.lastLoginAt?.toISOString() ?? null,
        enteredWorkspace: !!added.lastLoginAt,
        lastEnteredAt: added.lastLoginAt?.toISOString() ?? null,
      });
    }

    return NextResponse.json({ results });
  } catch (error) {
    console.error('User access check error:', error);
    return NextResponse.json(
      { error: 'Не удалось получить данные' },
      { status: 500 }
    );
  }
}
