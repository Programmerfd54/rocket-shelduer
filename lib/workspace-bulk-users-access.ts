import prisma from '@/lib/prisma';
import type { Role } from '@prisma/client';
import { isUnsafeId } from '@/lib/security';
import { getWorkspaceTabFlags, isWorkspaceTabFeatureAllowed } from '@/lib/workspace-tab-access';

/** Кто может массово создавать пользователей RC со вкладки «Импорт». */
const BULK_USERS_ROLES: Role[] = ['SUP', 'LEAD_SUP', 'ADM'];

type WsMin = { id: string; userId: string; workspaceUrl: string };

export async function assertWorkspaceBulkUsersAccess(
  userId: string,
  workspaceId: string
): Promise<
  | { ok: true; workspace: WsMin }
  | { ok: false; status: 400 | 401 | 403 | 404; error: string }
> {
  if (isUnsafeId(workspaceId)) return { ok: false, status: 400, error: 'Некорректный идентификатор пространства' };
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
  if (!user) return { ok: false, status: 401, error: 'Требуется авторизация' };
  if (!BULK_USERS_ROLES.includes(user.role)) {
    return { ok: false, status: 403, error: 'Недостаточно прав для массового добавления пользователей' };
  }

  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true, workspaceUrl: true },
  });
  if (!workspace) return { ok: false, status: 404, error: 'Пространство не найдено' };

  if (workspace.userId !== userId) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId, workspaceId },
    });
    if (!assignment) return { ok: false, status: 404, error: 'Пространство не найдено' };
  }

  // Ограничения вкладок платформы (как в UI: «Настройка пространства» → «Добавление пользователей»)
  const flags = await getWorkspaceTabFlags(user.role);
  if (!isWorkspaceTabFeatureAllowed(flags, 'usersAdd', workspace.workspaceUrl)) {
    return { ok: false, status: 403, error: 'Добавление пользователей недоступно для вашей роли (ограничение платформы).' };
  }
  return { ok: true, workspace };
}
