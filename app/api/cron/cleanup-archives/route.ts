// app/api/cron/cleanup-archives/route.ts
// Настрой в Vercel/Railway: GET /api/cron/cleanup-archives каждый день

import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';

export async function GET(request: Request) {
  try {
    // Проверяем секретный ключ (для безопасности)
    const authHeader = request.headers.get('authorization');
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const now = new Date();

    // Находим workspace, у которых истёк срок хранения
    const expiredWorkspaces = await prisma.workspaceConnection.findMany({
      where: {
        isArchived: true,
        archiveDeleteAt: {
          lte: now,
        },
      },
      select: {
        id: true,
        workspaceName: true,
        userId: true,
        archiveDeleteAt: true,
      },
    });

    if (expiredWorkspaces.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired archives to delete',
        deleted: 0,
      });
    }

    // Удаляем workspace (CASCADE удалит все связанные сообщения)
    const deleteResults = await Promise.all(
      expiredWorkspaces.map(async (ws) => {
        try {
          await prisma.workspaceConnection.delete({
            where: { id: ws.id },
          });

          // Логируем удаление
          await prisma.activityLog.create({
            data: {
              userId: ws.userId,
              action: 'WORKSPACE_DELETED',
              entityType: 'workspace',
              entityId: ws.id,
              details: JSON.stringify({
                workspaceName: ws.workspaceName,
                reason: 'Archive expired',
                archiveDeleteAt: ws.archiveDeleteAt,
              }),
            },
          });

          return { success: true, id: ws.id, name: ws.workspaceName };
        } catch (error) {
          console.error(`Failed to delete workspace ${ws.id}:`, error);
          return { success: false, id: ws.id, name: ws.workspaceName, error };
        }
      })
    );

    const successCount = deleteResults.filter((r) => r.success).length;
    const failedCount = deleteResults.filter((r) => !r.success).length;

    return NextResponse.json({
      success: true,
      message: `Deleted ${successCount} expired archives`,
      deleted: successCount,
      failed: failedCount,
      details: deleteResults,
    });
  } catch (error) {
    console.error('Cleanup archives error:', error);
    return NextResponse.json(
      { error: 'Failed to cleanup archives' },
      { status: 500 }
    );
  }
}