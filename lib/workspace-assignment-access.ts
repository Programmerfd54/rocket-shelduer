import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { canPerformAction } from '@/lib/permissions';

/**
 * Может ли пользователь управлять назначениями на пространство.
 * Lead_SUP — на любое; SUP — только на пространства, которыми владеет или на которые назначен,
 * и никогда на пространства, принадлежащие Lead_SUP. Остальные роли — нет.
 */
export async function canManageWorkspaceAssignments(
  currentUser: Pick<CurrentUser, 'id' | 'role' | 'isBlocked' | 'restrictedFeatures'>,
  workspace: { id: string; userId: string }
): Promise<boolean> {
  if (!canPerformAction(currentUser as CurrentUser, 'admin:workspaces:assign-adm')) return false;
  if (currentUser.role === 'LEAD_SUP') return true;
  if (currentUser.role !== 'SUP') return false;
  const owner = await prisma.user.findUnique({ where: { id: workspace.userId }, select: { role: true } });
  if (!owner || owner.role === 'LEAD_SUP') return false;
  if (workspace.userId === currentUser.id) return true;
  const assigned = await prisma.workspaceAdminAssignment.findFirst({
    where: { userId: currentUser.id, workspaceId: workspace.id },
    select: { id: true },
  });
  return !!assigned;
}

