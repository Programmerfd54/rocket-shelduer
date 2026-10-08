import prisma from '@/lib/prisma';
import type { Role } from '@prisma/client';
import { isUnsafeId } from '@/lib/security';
import { getWorkspaceTabFlags, isWorkspaceTabFeatureAllowed } from '@/lib/workspace-tab-access';

/** Роли, которым доступна вкладка R2D2 (не VOL). */
const R2_ROLES: Role[] = ['SUP', 'LEAD_SUP', 'ADM'];

export async function assertWorkspaceR2Access(userId: string, workspaceId: string) {
  if (isUnsafeId(workspaceId)) return { ok: false as const, status: 400 as const, error: 'Некорректный идентификатор пространства' };
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

  if (ws.userId !== userId) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId, workspaceId },
    });
    if (!assignment) return { ok: false as const, status: 404 as const, error: 'Пространство не найдено' };
  }

  // R2D2 находится во вкладке «Настройка пространства» — то же ограничение платформы, что и в UI
  const flags = await getWorkspaceTabFlags(user.role);
  if (!isWorkspaceTabFeatureAllowed(flags, 'r2d2', ws.workspaceUrl)) {
    return { ok: false as const, status: 403 as const, error: 'R2D2 недоступен для вашей роли (ограничение платформы).' };
  }
  return { ok: true as const, workspace: ws };
}
