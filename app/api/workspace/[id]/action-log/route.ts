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

    let workspace = await prisma.workspaceConnection.findFirst({
      where: currentUser.role === 'SUPPORT' ? { id: workspaceId } : { id: workspaceId, userId: currentUser.id },
    });
    if (!workspace && (currentUser.role === 'ADMIN' || currentUser.role === 'ADM')) {
      const assigned = await prisma.workspaceAdminAssignment.findFirst({
        where: { workspaceId, userId: currentUser.id },
        include: { workspace: true },
      });
      if (assigned?.workspace) workspace = assigned.workspace;
    }
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    // Для SUP: показываем последние действия по всем подключениям к этому же серверу.
    // Для channelCreators/settingAppliers — всегда расширяем по workspaceUrl: каналы и настройки общие для RC-сервера,
    // поэтому кто бы ни применял (через любое подключение к этому серверу), все должны видеть «кто применил».
    let workspaceIdsToConsider: string[] = [workspaceId];
    let workspaceIdsForSpaceSettings: string[] = [workspaceId];
    const base = workspace.workspaceUrl.replace(/\/$/, '').toLowerCase();
    const urlVariants = [base, base + '/', workspace.workspaceUrl, workspace.workspaceUrl.replace(/\/$/, '')];
    const uniqueUrls = [...new Set(urlVariants.filter(Boolean))];
    const sameUrlConnections = await prisma.workspaceConnection.findMany({
      where: { workspaceUrl: { in: uniqueUrls } },
      select: { id: true },
    });
    if (sameUrlConnections.length > 0) {
      workspaceIdsForSpaceSettings = sameUrlConnections.map((w) => w.id);
      if (currentUser.role === 'SUPPORT') {
        workspaceIdsToConsider = workspaceIdsForSpaceSettings;
      }
    }

    const [lastEmoji, lastUsersAdd, channelCreates, settingApplies] = await Promise.all([
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
      prisma.workspaceActionLog.findMany({
        where: { workspaceId: { in: workspaceIdsForSpaceSettings }, action: 'channel_create' },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
      prisma.workspaceActionLog.findMany({
        where: { workspaceId: { in: workspaceIdsForSpaceSettings }, action: 'setting_apply' },
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { id: true, email: true, name: true } } },
      }),
    ]);

    const channelCreators: Record<string, { userId: string; userName: string | null; userEmail: string; rcUsername?: string; at: string }> = {};
    for (const log of channelCreates) {
      try {
        const d = log.details ? JSON.parse(log.details) : {};
        const roomId = d.roomId as string | undefined;
        const channelName = (d.channelName as string | undefined)?.toLowerCase();
        const entry = {
          userId: log.userId,
          userName: log.user.name,
          userEmail: log.user.email,
          rcUsername: d.rcUsername as string | undefined,
          at: log.createdAt.toISOString(),
        };
        if (roomId && !channelCreators[roomId]) channelCreators[roomId] = entry;
        if (channelName && !channelCreators[channelName]) channelCreators[channelName] = entry;
      } catch { /* ignore */ }
    }

    const settingAppliers: Record<string, { userId: string; userName: string | null; userEmail: string; rcUsername?: string; at: string }> = {};
    for (const log of settingApplies) {
      try {
        const d = log.details ? JSON.parse(log.details) : {};
        const settingKey = d.settingKey as string | undefined;
        if (settingKey && !settingAppliers[settingKey]) {
          settingAppliers[settingKey] = {
            userId: log.userId,
            userName: log.user.name,
            userEmail: log.user.email,
            rcUsername: d.rcUsername as string | undefined,
            at: log.createdAt.toISOString(),
          };
        }
      } catch { /* ignore */ }
    }

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
      channelCreators,
      settingAppliers,
    });
  } catch (error: any) {
    console.error('Action log error:', error);
    return NextResponse.json(
      { error: error?.message || 'Failed to fetch action log' },
      { status: 500 }
    );
  }
}
