import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { assertWorkspaceBulkUsersAccess } from '@/lib/workspace-bulk-users-access';

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
    if (isUnsafeId(addedUserId)) {
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const access = await assertWorkspaceBulkUsersAccess(user.id, workspaceId);
    if (!access.ok) {
      return NextResponse.json({ error: access.error }, { status: access.status });
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
      { error: getSafeErrorMessage(error, 'Не удалось удалить запись') },
      { status: 500 }
    );
  }
}
