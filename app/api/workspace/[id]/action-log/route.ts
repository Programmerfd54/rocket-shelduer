import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const currentUser = await requireAuth();
    const { id: workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: currentUser.role === 'SUPPORT' ? { id: workspaceId } : { id: workspaceId, userId: currentUser.id },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Для SUP: показываем последние действия по всем подключениям к этому же серверу (тот же workspaceUrl),
    // чтобы любой SUP видел, кто последний делал импорт/добавление пользователей.
    let workspaceIdsToConsider: string[] = [workspaceId];
    if (currentUser.role === 'SUPPORT') {
      const base = workspace.workspaceUrl.replace(/\/$/, '').toLowerCase();
      const urlVariants = [base, base + '/', workspace.workspaceUrl, workspace.workspaceUrl.replace(/\/$/, '')];
      const uniqueUrls = [...new Set(urlVariants.filter(Boolean))];
      const sameUrlConnections = await prisma.workspaceConnection.findMany({
        where: { workspaceUrl: { in: uniqueUrls } },
        select: { id: true },
      });
      if (sameUrlConnections.length > 0) {
        workspaceIdsToConsider = sameUrlConnections.map((w) => w.id);
      }
    }

    const [lastEmoji, lastUsersAdd] = await Promise.all([
      prisma.workspaceActionLog.findFirst({
        where: { workspaceId: { in: workspaceIdsToConsider }, action: 'emoji_import' },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      prisma.workspaceActionLog.findFirst({
        where: { workspaceId: { in: workspaceIdsToConsider }, action: 'users_add' },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
    ]);

    return NextResponse.json({
      lastEmojiImport: lastEmoji
        ? {
            userId: lastEmoji.userId,
            userEmail: lastEmoji.user.email,
            userName: lastEmoji.user.name,
            at: lastEmoji.createdAt.toISOString(),
          }
        : null,
      lastUsersAdd: lastUsersAdd
        ? {
            userId: lastUsersAdd.userId,
            userEmail: lastUsersAdd.user.email,
            userName: lastUsersAdd.user.name,
            at: lastUsersAdd.createdAt.toISOString(),
          }
        : null,
    });
  } catch (error: any) {
    console.error('Action log error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch action log' },
      { status: 500 }
    );
  }
}
