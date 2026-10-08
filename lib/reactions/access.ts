import type { Role } from '@prisma/client';
import prisma from '@/lib/prisma';
import { isStudentRcHostStrict } from '@/lib/workspace-url-flags';

/** Роли, которым доступна вкладка «Рейтинг реакций» (не VOL). */
export const REACTIONS_ROLES: Role[] = ['SUP', 'LEAD_SUP', 'ADM'];

/** Владелец или назначенный пользователь пространства rocketchat-student.21-school.ru с подходящей ролью. */
export async function assertReactionsAccess(userId: string, role: string, workspaceId: string) {
  if (!REACTIONS_ROLES.includes(role as Role)) {
    return { ok: false as const, status: 403, error: 'Недостаточно прав для рейтинга реакций' };
  }
  const ws = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true, workspaceUrl: true },
  });
  if (!ws) return { ok: false as const, status: 404, error: 'Пространство не найдено' };
  if (ws.userId !== userId) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({ where: { userId, workspaceId }, select: { id: true } });
    if (!assignment) return { ok: false as const, status: 404, error: 'Пространство не найдено' };
  }
  if (!isStudentRcHostStrict(ws.workspaceUrl)) {
    return { ok: false as const, status: 403, error: 'Рейтинг реакций доступен только для rocketchat-student.21-school.ru' };
  }
  return { ok: true as const, workspace: ws };
}
