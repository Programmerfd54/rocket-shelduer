import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let user;
    try {
      user = await requireAuth();
    } catch (authError: any) {
      if (authError?.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
      }
      throw authError;
    }
    const { id: workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id: workspaceId,
        userId: user.id,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const added = await prisma.workspaceAddedUser.findMany({
      where: { workspaceId },
      orderBy: { addedAt: 'desc' },
    });

    return NextResponse.json({
      users: added.map((u) => ({
        id: u.id,
        username: u.username,
        email: u.email,
        addedAt: u.addedAt.toISOString(),
        lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
        status: u.status,
        errorMessage: u.errorMessage,
      })),
    });
  } catch (error: any) {
    console.error('Get added users error:', error);
    const code = error?.code;
    if (code === 'P2021' || (error?.message && error.message.includes('does not exist'))) {
      return NextResponse.json(
        {
          error: 'Таблица добавленных пользователей не найдена. Выполните миграцию: npx prisma migrate dev',
          code: 'MIGRATION_NEEDED',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch users' },
      { status: 500 }
    );
  }
}
