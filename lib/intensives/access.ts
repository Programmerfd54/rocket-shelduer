/**
 * Кто что видит в интенсивах (сервер проверяет всё; UI лишь прячет кнопки).
 *
 *  - Lead_SUP — все OrgSpace и интенсивы, включая черновики.
 *  - Остальные — только OrgSpace, к которым привязано подключение, которым они владеют или на которое назначены
 *    (WorkspaceAdminAssignment). Черновики — никогда. Выбор интенсива доступа к пространству не выдаёт.
 *  - Пункты плана фильтруются по audience: SUP/Lead_SUP — все, ADM — ADM+ALL, MEMBER — ALL.
 *  - Текст/автор/ошибка сообщения — только если вызывающий видит сообщение по правилам GET /api/messages:
 *    SUP/Lead_SUP — все; остальные — свои и в доступных пространствах.
 */
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { canPerformAction, requireAction } from '@/lib/permissions';
import { getAccessibleWorkspaceIds } from '@/lib/message-scope';
import { ApiError } from './http';
import type { IntensiveStatus, PlanItemAudience, UserRef } from './types';

export interface IntensiveViewer {
  user: CurrentUser;
  isLead: boolean;
  /** Пространства (подключения), которыми владеет или на которые назначен */
  accessibleWorkspaceIds: Set<string>;
  /** OrgSpace, доступные вызывающему; null — все (Lead_SUP) */
  orgSpaceIds: Set<string> | null;
}

export async function getIntensiveViewer(user: CurrentUser): Promise<IntensiveViewer> {
  requireAction(user, 'intensives:view');
  const isLead = user.role === 'LEAD_SUP';
  const accessibleWorkspaceIds = new Set(await getAccessibleWorkspaceIds(user.id));
  if (isLead) return { user, isLead, accessibleWorkspaceIds, orgSpaceIds: null };
  const rows =
    accessibleWorkspaceIds.size > 0
      ? await prisma.workspaceConnection.findMany({
          where: { id: { in: Array.from(accessibleWorkspaceIds) }, orgSpaceId: { not: null } },
          select: { orgSpaceId: true },
        })
      : [];
  const orgSpaceIds = new Set(rows.map((r) => r.orgSpaceId).filter((v): v is string => !!v));
  return { user, isLead, accessibleWorkspaceIds, orgSpaceIds };
}

export function canManageIntensives(user: CurrentUser): boolean {
  return canPerformAction(user, 'intensives:manage');
}

export function requireManageIntensives(user: CurrentUser): void {
  requireAction(user, 'intensives:manage');
}

export function canViewOrgSpace(viewer: IntensiveViewer, orgSpaceId: string): boolean {
  return viewer.orgSpaceIds === null || viewer.orgSpaceIds.has(orgSpaceId);
}

export function canViewIntensive(
  viewer: IntensiveViewer,
  intensive: { orgSpaceId: string; status: IntensiveStatus | string }
): boolean {
  if (viewer.isLead) return true;
  if (intensive.status === 'DRAFT') return false;
  return canViewOrgSpace(viewer, intensive.orgSpaceId);
}

/** Аудитории пунктов, видимые роли; null — все. */
export function visibleAudiences(role: string): PlanItemAudience[] | null {
  if (role === 'LEAD_SUP' || role === 'SUP') return null;
  if (role === 'ADM') return ['ADM', 'ALL'];
  return ['ALL'];
}

export function canSeeAudience(role: string, audience: string): boolean {
  const list = visibleAudiences(role);
  return list === null || (list as string[]).includes(audience);
}

/** Может ли вызывающий видеть содержимое сообщения (текст, автора, ошибку). */
export function canSeeMessage(
  viewer: IntensiveViewer,
  msg: { userId?: string | null; scheduledById?: string | null; workspaceId?: string | null }
): boolean {
  if (viewer.user.role === 'LEAD_SUP' || viewer.user.role === 'SUP') return true;
  if (msg.userId && msg.userId === viewer.user.id) return true;
  if (msg.scheduledById && msg.scheduledById === viewer.user.id) return true;
  return !!msg.workspaceId && viewer.accessibleWorkspaceIds.has(msg.workspaceId);
}

/**
 * Интенсив, доступный вызывающему, или 404 (не 403 — чтобы не раскрывать существование черновиков/чужих интенсивов).
 */
export async function loadIntensiveForViewer(viewer: IntensiveViewer, id: string) {
  const intensive = await prisma.intensive.findUnique({
    where: { id },
    include: { orgSpace: { select: { id: true, name: true } } },
  });
  if (!intensive || !canViewIntensive(viewer, intensive)) {
    throw new ApiError(404, 'NOT_FOUND', 'Интенсив не найден');
  }
  return intensive;
}

export function userRef(u: { id: string; name?: string | null; username?: string | null } | null | undefined): UserRef | null {
  if (!u) return null;
  return { id: u.id, name: u.name ?? u.username ?? null };
}

export const USER_REF_SELECT = { id: true, name: true, username: true } as const;
