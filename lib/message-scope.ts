/**
 * Область видимости запланированных сообщений для ролей.
 *
 * SUP / Lead_SUP — видят сообщения всех пользователей (как и раньше).
 * ADM — только сообщения в пространствах, которыми владеет или на которые назначен
 * (WorkspaceAdminAssignment), плюс собственные сообщения. Фильтр userId для ADM
 * сужает выборку внутри этой области и не расширяет её.
 */
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';

/** id пространств, которыми пользователь владеет или на которые назначен. */
export async function getAccessibleWorkspaceIds(userId: string): Promise<string[]> {
  const [owned, assigned] = await Promise.all([
    prisma.workspaceConnection.findMany({ where: { userId }, select: { id: true } }),
    prisma.workspaceAdminAssignment.findMany({ where: { userId }, select: { workspaceId: true } }),
  ]);
  return Array.from(new Set([...owned.map((w) => w.id), ...assigned.map((a) => a.workspaceId)]));
}

/** Условие Prisma «сообщения, видимые ADM»: свои или в доступных ему пространствах. */
export function admMessageScopeWhere(
  userId: string,
  workspaceIds: string[]
): Prisma.ScheduledMessageWhereInput {
  return {
    OR: [{ userId }, ...(workspaceIds.length > 0 ? [{ workspaceId: { in: workspaceIds } }] : [])],
  };
}

/**
 * Пользователи, которых ADM может выбрать в фильтре по автору: он сам и авторы сообщений
 * в доступных ему пространствах.
 */
export async function getAdmVisibleAuthorIds(userId: string): Promise<string[]> {
  const workspaceIds = await getAccessibleWorkspaceIds(userId);
  if (workspaceIds.length === 0) return [userId];
  const rows = await prisma.scheduledMessage.findMany({
    where: { workspaceId: { in: workspaceIds } },
    select: { userId: true },
    distinct: ['userId'],
  });
  return Array.from(new Set([userId, ...rows.map((r) => r.userId)]));
}
