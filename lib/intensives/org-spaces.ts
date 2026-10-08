/**
 * OrgSpace — организационное пространство (общее расписание интенсивов для персональных подключений одного RC).
 * Привязку подключений подтверждает Lead_SUP; совпадение URL — только подсказка (suggestions).
 * Секреты подключений (токены, пароли) никогда не попадают в ответы.
 */
import prisma from '@/lib/prisma';
import type { CurrentUser } from '@/lib/auth';
import { sameRcInstanceUrl } from '@/lib/workspace-rc';
import { userRef, USER_REF_SELECT, type IntensiveViewer } from './access';
import { dbDateFromYmd, ymdFromDbDate } from './dates';
import { ApiError, prismaErrorCode } from './http';
import { createIntensive } from './service';
import type { IntensiveStatus, OrgSpaceConnection, OrgSpaceDto, OrgSpaceSuggestionGroup } from './types';

export const CONNECTION_PUBLIC_SELECT = {
  id: true,
  workspaceName: true,
  workspaceUrl: true,
  username: true,
  isArchived: true,
  isActive: true,
  startDate: true,
  endDate: true,
  orgSpaceId: true,
  user: { select: USER_REF_SELECT },
} as const;

type ConnectionRow = {
  id: string;
  workspaceName: string;
  workspaceUrl: string;
  username: string;
  isArchived: boolean;
  isActive: boolean;
  startDate: Date | null;
  endDate: Date | null;
  orgSpaceId: string | null;
  user: { id: string; name: string | null; username: string | null };
};

export function toConnectionDto(c: ConnectionRow): OrgSpaceConnection {
  return {
    id: c.id,
    workspaceName: c.workspaceName,
    workspaceUrl: c.workspaceUrl,
    username: c.username,
    owner: userRef(c.user)!,
    isArchived: c.isArchived,
    isActive: c.isActive,
    startDate: c.startDate ? ymdFromDbDate(c.startDate) : null,
    endDate: c.endDate ? ymdFromDbDate(c.endDate) : null,
  };
}

async function logAdminAction(userId: string, details: Record<string, unknown>) {
  try {
    await prisma.activityLog.create({
      data: { userId, action: 'ADMIN_ACTION', entityType: 'org_space', entityId: String(details.orgSpaceId ?? ''), details: JSON.stringify(details) },
    });
  } catch (e) {
    console.error('[intensives] activity log failed:', e);
  }
}

export async function listOrgSpaces(viewer: IntensiveViewer): Promise<OrgSpaceDto[]> {
  if (viewer.orgSpaceIds !== null && viewer.orgSpaceIds.size === 0) return [];
  const spaces = await prisma.orgSpace.findMany({
    where: viewer.orgSpaceIds === null ? {} : { id: { in: Array.from(viewer.orgSpaceIds) } },
    orderBy: { name: 'asc' },
    include: {
      connections: {
        where: viewer.isLead ? {} : { id: { in: Array.from(viewer.accessibleWorkspaceIds) } },
        select: CONNECTION_PUBLIC_SELECT,
        orderBy: { workspaceName: 'asc' },
      },
    },
  });
  const counts = spaces.length
    ? await prisma.intensive.groupBy({
        by: ['orgSpaceId', 'status'],
        where: { orgSpaceId: { in: spaces.map((s) => s.id) }, ...(viewer.isLead ? {} : { status: { not: 'DRAFT' } }) },
        _count: { _all: true },
      })
    : [];
  return spaces.map((s) => {
    const intensiveCounts: Partial<Record<IntensiveStatus, number>> = {};
    for (const c of counts) if (c.orgSpaceId === s.id) intensiveCounts[c.status] = c._count._all;
    return {
      id: s.id,
      name: s.name,
      description: s.description,
      createdAt: s.createdAt.toISOString(),
      updatedAt: s.updatedAt.toISOString(),
      connections: s.connections.map(toConnectionDto),
      intensiveCounts,
    };
  });
}

/** Регистронезависимая уникальность названия (сравнение в JS: ILIKE зависит от локали БД и не всегда понимает кириллицу). */
async function assertNameFree(name: string, exceptId?: string) {
  const norm = (v: string) => v.trim().toLocaleLowerCase('ru-RU');
  const all = await prisma.orgSpace.findMany({ select: { id: true, name: true } });
  const clash = all.find((s) => s.id !== exceptId && norm(s.name) === norm(name));
  if (clash) {
    throw new ApiError(409, 'ORG_SPACE_NAME_TAKEN', 'Пространство с таким названием уже есть', { fieldErrors: { name: 'Название занято' } });
  }
}

export async function createOrgSpace(user: CurrentUser, input: { name: string; description?: string | null }) {
  await assertNameFree(input.name);
  try {
    const space = await prisma.orgSpace.create({
      data: { name: input.name, description: input.description ?? null, createdById: user.id },
    });
    await logAdminAction(user.id, { op: 'org_space_create', orgSpaceId: space.id, name: space.name });
    return space;
  } catch (e) {
    if (prismaErrorCode(e) === 'P2002') {
      throw new ApiError(409, 'ORG_SPACE_NAME_TAKEN', 'Пространство с таким названием уже есть', { fieldErrors: { name: 'Название занято' } });
    }
    throw e;
  }
}

async function loadOrgSpace(id: string) {
  const space = await prisma.orgSpace.findUnique({ where: { id } });
  if (!space) throw new ApiError(404, 'NOT_FOUND', 'Пространство (OrgSpace) не найдено');
  return space;
}

export async function updateOrgSpace(user: CurrentUser, id: string, input: { name?: string; description?: string | null }) {
  await loadOrgSpace(id);
  if (input.name) await assertNameFree(input.name, id);
  try {
    const space = await prisma.orgSpace.update({
      where: { id },
      data: {
        ...(input.name ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      },
    });
    await logAdminAction(user.id, { op: 'org_space_update', orgSpaceId: id });
    return space;
  } catch (e) {
    if (prismaErrorCode(e) === 'P2002') {
      throw new ApiError(409, 'ORG_SPACE_NAME_TAKEN', 'Пространство с таким названием уже есть', { fieldErrors: { name: 'Название занято' } });
    }
    throw e;
  }
}

export async function deleteOrgSpace(user: CurrentUser, id: string) {
  const space = await loadOrgSpace(id);
  const count = await prisma.intensive.count({ where: { orgSpaceId: id } });
  if (count > 0) {
    throw new ApiError(409, 'ORG_SPACE_HAS_INTENSIVES', 'В пространстве есть интенсивы — удалить нельзя (история сохраняется)', {
      intensiveCount: count,
    });
  }
  try {
    // Подключения отвязываются (ON DELETE SET NULL), сами подключения и их данные не трогаются
    await prisma.orgSpace.delete({ where: { id } });
  } catch (e) {
    if (prismaErrorCode(e) === 'P2003') {
      throw new ApiError(409, 'ORG_SPACE_HAS_INTENSIVES', 'В пространстве есть интенсивы — удалить нельзя');
    }
    throw e;
  }
  await logAdminAction(user.id, { op: 'org_space_delete', orgSpaceId: id, name: space.name });
}

export async function linkWorkspace(user: CurrentUser, orgSpaceId: string, input: { workspaceId: string; move?: boolean }) {
  const space = await loadOrgSpace(orgSpaceId);
  const conn = await prisma.workspaceConnection.findUnique({
    where: { id: input.workspaceId },
    select: { id: true, orgSpaceId: true, orgSpace: { select: { id: true, name: true } } },
  });
  if (!conn) throw new ApiError(404, 'NOT_FOUND', 'Подключение не найдено', { fieldErrors: { workspaceId: 'Не найдено' } });
  if (conn.orgSpaceId === orgSpaceId) return { alreadyLinked: true };
  if (conn.orgSpaceId && !input.move) {
    throw new ApiError(409, 'WORKSPACE_LINKED_ELSEWHERE', 'Подключение уже привязано к другому пространству', {
      linkedOrgSpace: conn.orgSpace,
    });
  }
  const res = await prisma.workspaceConnection.updateMany({
    where: { id: conn.id, orgSpaceId: conn.orgSpaceId },
    data: { orgSpaceId },
  });
  if (res.count !== 1) {
    throw new ApiError(409, 'VERSION_CONFLICT', 'Привязка подключения изменилась. Обновите страницу.');
  }
  await logAdminAction(user.id, {
    op: 'org_space_link',
    orgSpaceId,
    orgSpaceName: space.name,
    workspaceId: conn.id,
    previousOrgSpaceId: conn.orgSpaceId,
  });
  return { alreadyLinked: false };
}

export async function unlinkWorkspace(user: CurrentUser, orgSpaceId: string, workspaceId: string) {
  await loadOrgSpace(orgSpaceId);
  const res = await prisma.workspaceConnection.updateMany({
    where: { id: workspaceId, orgSpaceId },
    data: { orgSpaceId: null },
  });
  if (res.count !== 1) throw new ApiError(409, 'WORKSPACE_NOT_LINKED', 'Подключение не привязано к этому пространству');
  // Сообщения, уже связанные с интенсивами, остаются связанными (история не меняется)
  await logAdminAction(user.id, { op: 'org_space_unlink', orgSpaceId, workspaceId });
}

/** Группы подключений к одному инстансу RC (подсказка для Lead_SUP, не основание объединять права). */
export async function getOrgSpaceSuggestions(): Promise<OrgSpaceSuggestionGroup[]> {
  const conns = await prisma.workspaceConnection.findMany({
    select: CONNECTION_PUBLIC_SELECT,
    orderBy: { createdAt: 'asc' },
  });
  const groups: { url: string; items: typeof conns }[] = [];
  for (const c of conns) {
    const g = groups.find((x) => sameRcInstanceUrl(x.url, c.workspaceUrl));
    if (g) g.items.push(c);
    else groups.push({ url: c.workspaceUrl, items: [c] });
  }
  return groups
    .map((g) => ({
      sampleUrl: g.url,
      suggestedName: g.items[0].workspaceName,
      connections: g.items.map((c) => ({ ...toConnectionDto(c), orgSpaceId: c.orgSpaceId })),
      linkedOrgSpaceIds: Array.from(new Set(g.items.map((c) => c.orgSpaceId).filter((v): v is string => !!v))),
    }))
    .sort((a, b) => b.connections.length - a.connections.length || a.suggestedName.localeCompare(b.suggestedName));
}

/**
 * Черновик интенсива по старым датам подключения (startDate/endDate). Только DRAFT, не публикует,
 * старые поля подключения не меняет. Повторный вызов для тех же дат возвращает существующий интенсив.
 */
export async function draftFromWorkspaceDates(
  user: CurrentUser,
  orgSpaceId: string,
  input: { workspaceId: string; name?: string; timezone?: string }
) {
  const space = await loadOrgSpace(orgSpaceId);
  const conn = await prisma.workspaceConnection.findUnique({
    where: { id: input.workspaceId },
    select: { id: true, orgSpaceId: true, workspaceName: true, startDate: true, endDate: true },
  });
  if (!conn) throw new ApiError(404, 'NOT_FOUND', 'Подключение не найдено');
  if (conn.orgSpaceId !== orgSpaceId) {
    throw new ApiError(409, 'WORKSPACE_NOT_LINKED', 'Подключение не привязано к этому пространству');
  }
  if (!conn.startDate || !conn.endDate) {
    throw new ApiError(409, 'WORKSPACE_HAS_NO_DATES', 'У подключения не заданы даты интенсива');
  }
  const startYmd = ymdFromDbDate(conn.startDate);
  const endYmd = ymdFromDbDate(conn.endDate);
  if (endYmd < startYmd) {
    throw new ApiError(409, 'WORKSPACE_HAS_NO_DATES', 'Даты подключения некорректны (окончание раньше начала)');
  }
  const existing = await prisma.intensive.findFirst({
    where: {
      orgSpaceId,
      status: { in: ['DRAFT', 'PUBLISHED'] },
      startDate: dbDateFromYmd(startYmd),
      endDate: dbDateFromYmd(endYmd),
    },
    include: { orgSpace: { select: { id: true, name: true } } },
  });
  if (existing) return { intensive: existing, existing: true, overlaps: [] };

  const created = await createIntensive(user, {
    orgSpaceId,
    name: input.name ?? `${space.name}: ${startYmd} — ${endYmd}`,
    description: `Черновик по датам подключения «${conn.workspaceName}»`,
    startDate: startYmd,
    endDate: endYmd,
    timezone: input.timezone ?? 'Europe/Moscow',
  });
  return { intensive: created.intensive, existing: false, overlaps: created.overlaps };
}
