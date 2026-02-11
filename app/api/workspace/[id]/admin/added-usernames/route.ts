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

/**
 * GET — список логинов (и email) пользователей, добавленных в пространство через «Добавление пользователей».
 * Нужен для подсказки во вкладке «Состояние входа»: по ним только и выполняется поиск.
 */
export async function GET(
  _request: Request,
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

    const added = await prisma.workspaceAddedUser.findMany({
      where: { workspaceId },
      orderBy: { username: 'asc' },
      select: { username: true, email: true },
    });

    return NextResponse.json({
      list: added.map((u) => ({ username: u.username, email: u.email })),
    });
  } catch (error) {
    console.error('Added usernames error:', error);
    return NextResponse.json(
      { error: 'Не удалось загрузить список' },
      { status: 500 }
    );
  }
}
