import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { canManageWorkspaceAssignments } from '@/lib/workspace-assignment-access';
import { isUnsafeId } from '@/lib/security';

function authErrorResponse(error: unknown): NextResponse | null {
  if (error instanceof Error && error.message === 'Unauthorized') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  if (error instanceof Error && error.message === 'Forbidden') {
    return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
  }
  return null;
}

const MANAGE_FORBIDDEN =
  'Недостаточно прав: SUP может управлять назначениями только в своих пространствах или пространствах, на которые назначен (кроме пространств Lead_SUP).';

/** GET — список назначенных на пространство (SUP/ADMIN или владелец пространства) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { workspaceId } = await params;
    if (isUnsafeId(workspaceId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { id: true, userId: true, workspaceUrl: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const ownerUser = await prisma.user.findUnique({
      where: { id: workspace.userId },
      select: { id: true, name: true, email: true, username: true, role: true, avatarUrl: true },
    });

    const assignedToThis = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId: currentUser.id, workspaceId },
      select: { id: true },
    });
    const normUrl = (workspace.workspaceUrl || '').trim().replace(/\/+$/, '');
    const urlVariants = normUrl
      ? [normUrl, normUrl + '/', normUrl.toLowerCase(), normUrl.toLowerCase() + '/']
      : [];
    const sameUrlIds =
      urlVariants.length > 0
        ? (await prisma.workspaceConnection.findMany({
            where: { workspaceUrl: { in: urlVariants } },
            select: { id: true },
          })).map((r) => r.id)
        : [workspaceId];
    const canList =
      currentUser.role === 'SUP' ||
      currentUser.role === 'LEAD_SUP' ||
      workspace.userId === currentUser.id ||
      !!assignedToThis;
    if (!canList) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    // Сливать назначения по URL только если текущий пользователь сам назначен на какое-то пространство с этим URL (иначе индивидуальное пространство показывало бы чужих участников)
    const currentUserAssignedToSameUrl = sameUrlIds.length > 1
      ? await prisma.workspaceAdminAssignment.findFirst({
          where: { userId: currentUser.id, workspaceId: { in: sameUrlIds } },
          select: { id: true },
        })
      : assignedToThis;
    const idsToLoad = currentUserAssignedToSameUrl ? sameUrlIds : [workspaceId];

    const assignmentsRaw = await prisma.workspaceAdminAssignment.findMany({
      where: { workspaceId: { in: idsToLoad } },
      include: {
        user: {
          select: { id: true, name: true, email: true, username: true, role: true, avatarUrl: true },
        },
        assignedBy: {
          select: { id: true, name: true, email: true },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
    const seenUserIds = new Set<string>();
    const assignments = assignmentsRaw.filter((a) => {
      if (seenUserIds.has(a.userId)) return false;
      seenUserIds.add(a.userId);
      return true;
    });

    const canManage = await canManageWorkspaceAssignments(currentUser, workspace);

    return NextResponse.json({
      canManage,
      owner: ownerUser ? { id: ownerUser.id, name: ownerUser.name, email: ownerUser.email, username: ownerUser.username, role: ownerUser.role, avatarUrl: ownerUser.avatarUrl } : null,
      assignments: assignments.map((a) => ({
        id: a.id,
        userId: a.userId,
        user: a.user,
        assignedById: a.assignedById,
        assignedBy: a.assignedBy,
        createdAt: a.createdAt,
      })),
    });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('List workspace assignments error:', error);
    return NextResponse.json(
      { error: 'Failed to list assignments' },
      { status: 500 }
    );
  }
}

/** POST — назначить пользователя на пространство (SUP: ADM/MEMBER/SUP; Lead_SUP: ещё Lead_SUP). Body: { userId: string } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    if (currentUser.role !== 'SUP' && currentUser.role !== 'LEAD_SUP') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { workspaceId } = await params;
    const body = await request.json().catch(() => null);
    const userId = body?.userId;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }
    if (isUnsafeId(workspaceId) || isUnsafeId(userId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const targetUser = await prisma.user.findUnique({
      where: { id: userId },
    });
    if (!targetUser) {
      return NextResponse.json(
        { error: 'User not found' },
        { status: 400 }
      );
    }
    // SUP: только ADM, MEMBER или SUP; Lead_SUP: ADM, SUP, MEMBER или Lead_SUP
    if (currentUser.role === 'SUP') {
      if (
        targetUser.role !== 'ADM' &&
        targetUser.role !== 'MEMBER' &&
        targetUser.role !== 'SUP'
      ) {
        return NextResponse.json(
          { error: 'SUP может назначать только пользователей с ролями ADM, MEMBER или SUP' },
          { status: 400 }
        );
      }
    } else {
      if (
        targetUser.role !== 'ADM' &&
        targetUser.role !== 'SUP' &&
        targetUser.role !== 'MEMBER' &&
        targetUser.role !== 'LEAD_SUP'
      ) {
        return NextResponse.json(
          { error: 'Lead_SUP может назначать только ADM, SUP, MEMBER или Lead_SUP' },
          { status: 400 }
        );
      }
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { id: true, userId: true, workspaceUrl: true },
    });
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }
    if (!(await canManageWorkspaceAssignments(currentUser, workspace))) {
      return NextResponse.json({ error: MANAGE_FORBIDDEN }, { status: 403 });
    }

    // Не назначать, если пользователь уже добавил себе это пространство (тот же URL)
    const alreadyAdded = await prisma.workspaceConnection.findFirst({
      where: {
        userId,
        workspaceUrl: workspace.workspaceUrl,
      },
    });
    if (alreadyAdded) {
      return NextResponse.json(
        {
          error: 'USER_ALREADY_ADDED',
          message: 'Пользователь уже добавил себе это пространство. Назначение невозможно.',
        },
        { status: 400 }
      );
    }

    const existing = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId, workspaceId },
    });
    if (existing) {
      await prisma.workspaceAdminAssignment.update({
        where: { id: existing.id },
        data: { assignedById: currentUser.id },
      });
    } else {
      await prisma.workspaceAdminAssignment.create({
        data: { userId, workspaceId, assignedById: currentUser.id },
      });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Assign ADM to workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to assign' },
      { status: 500 }
    );
  }
}

/** DELETE — снять назначение ADM с пространства. Body: { userId: string } */
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    if (currentUser.role !== 'SUP' && currentUser.role !== 'LEAD_SUP') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { workspaceId } = await params;
    const body = await request.json().catch(() => null);
    const userId = body?.userId;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }
    if (isUnsafeId(workspaceId) || isUnsafeId(userId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { id: true, userId: true },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }
    if (!(await canManageWorkspaceAssignments(currentUser, workspace))) {
      return NextResponse.json({ error: MANAGE_FORBIDDEN }, { status: 403 });
    }

    await prisma.workspaceAdminAssignment.deleteMany({
      where: { userId, workspaceId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    const authResponse = authErrorResponse(error);
    if (authResponse) return authResponse;
    console.error('Unassign ADM from workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to unassign' },
      { status: 500 }
    );
  }
}
