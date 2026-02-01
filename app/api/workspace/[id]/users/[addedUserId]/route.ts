import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string; addedUserId: string }> }
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
    const { id: workspaceId, addedUserId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: { id: workspaceId, userId: user.id },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const deleted = await prisma.workspaceAddedUser.deleteMany({
      where: {
        id: addedUserId,
        workspaceId,
      },
    });

    if (deleted.count === 0) {
      return NextResponse.json({ error: 'Запись не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error: any) {
    console.error('Remove added user error:', error);
    return NextResponse.json(
      { error: error?.message || 'Не удалось удалить запись' },
      { status: 500 }
    );
  }
}
