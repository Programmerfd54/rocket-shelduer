import prisma from '@/lib/prisma';
import type { Role } from '@prisma/client';

/** Роли, которым доступна вкладка R2D2 (не VOL). */
const R2_ROLES: Role[] = ['SUPPORT', 'ADMIN', 'ADM'];

export async function assertWorkspaceR2Access(userId: string, workspaceId: string) {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return { ok: false as const, status: 401 as const, error: 'Требуется авторизация' };
  if (!R2_ROLES.includes(user.role)) {
    return { ok: false as const, status: 403 as const, error: 'Недостаточно прав для операций R2D2' };
  }

  const ws = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true, workspaceUrl: true },
  });
  if (!ws) return { ok: false as const, status: 404 as const, error: 'Пространство не найдено' };

  if (ws.userId === userId) return { ok: true as const, workspace: ws };

  const assignment = await prisma.workspaceAdminAssignment.findFirst({
    where: { userId, workspaceId },
  });
  if (assignment) return { ok: true as const, workspace: ws };

  return { ok: false as const, status: 404 as const, error: 'Пространство не найдено' };
}
