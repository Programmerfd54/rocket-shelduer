import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

/** GET — список назначенных на пространство (SUP/ADMIN или владелец пространства) */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
      select: { userId: true },
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
    const canList =
      currentUser.role === 'SUPPORT' ||
      currentUser.role === 'ADMIN' ||
      workspace.userId === currentUser.id ||
      !!assignedToThis;
    if (!canList) {
      return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    }

    const assignments = await prisma.workspaceAdminAssignment.findMany({
      where: { workspaceId },
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

    return NextResponse.json({
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
    console.error('List workspace assignments error:', error);
    return NextResponse.json(
      { error: 'Failed to list assignments' },
      { status: 500 }
    );
  }
}

/** POST — назначить ADM/SUP на пространство (SUP только ADM, ADMIN — ADM или SUP). Body: { userId: string } */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ workspaceId: string }> }
) {
  try {
    const currentUser = await requireAuth();
    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { workspaceId } = await params;
    const body = await request.json();
    const userId = body?.userId;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
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
    // SUP может назначать ADM или VOL; ADMIN — ADM, SUP или VOL
    if (currentUser.role === 'SUPPORT') {
      if (targetUser.role !== 'ADM' && targetUser.role !== 'VOL') {
        return NextResponse.json(
          { error: 'SUP can assign only ADM or VOL users' },
          { status: 400 }
        );
      }
    } else {
      // ADMIN
      if (targetUser.role !== 'ADM' && targetUser.role !== 'SUPPORT' && targetUser.role !== 'VOL') {
        return NextResponse.json(
          { error: 'Can assign only ADM, SUP or VOL users' },
          { status: 400 }
        );
      }
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
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
    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

    const { workspaceId } = await params;
    const body = await request.json();
    const userId = body?.userId;

    if (!userId || typeof userId !== 'string') {
      return NextResponse.json(
        { error: 'userId is required' },
        { status: 400 }
      );
    }

    await prisma.workspaceAdminAssignment.deleteMany({
      where: { userId, workspaceId },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Unassign ADM from workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to unassign' },
      { status: 500 }
    );
  }
}
