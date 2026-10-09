// app/api/cron/cleanup-archives/route.ts
// Настрой в Vercel/Railway: GET /api/cron/cleanup-archives каждый день

import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/security';
import prisma from '@/lib/prisma';
import { workspaceIdsWithIntensives } from '@/lib/intensives/workspace-schedule';

export async function GET(request: Request) {
  try {
    // Bearer CRON_SECRET: сравнение за постоянное время, в production секрет обязателен
    const denied = verifyCronRequest(request);
    if (denied) {
      return NextResponse.json({ error: denied.error }, { status: denied.status });
    }

    const now = new Date();

    // Находим workspace, у которых истёк срок хранения
    const candidates = await prisma.workspaceConnection.findMany({
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
        orgSpaceId: true,
      },
    });

    // Подключения, у которых в графике есть интенсивы (любой статус), автоматически не удаляем никогда:
    // история интенсивов и связанные сообщения важнее срока хранения архива. Только пишем количество.
    const protectedIds = await workspaceIdsWithIntensives(candidates);
    if (protectedIds.size > 0) {
      console.info(`[cleanup-archives] skipped ${protectedIds.size} archived workspace(s) with intensives`);
    }
    const expiredWorkspaces = candidates.filter((ws) => !protectedIds.has(ws.id));

    if (expiredWorkspaces.length === 0) {
      return NextResponse.json({
        success: true,
        message: 'No expired archives to delete',
        deleted: 0,
        skippedWithIntensives: protectedIds.size,
      });
    }

    // Удаляем workspace (CASCADE удалит все связанные сообщения)
    const deleteResults = await Promise.all(
      expiredWorkspaces.map(async (ws) => {
        try {
          // Условие повторяет проверку выше атомарно: интенсив мог появиться между выборкой и удалением
          const del = await prisma.workspaceConnection.deleteMany({
            where: {
              id: ws.id,
              isArchived: true,
              OR: [{ orgSpaceId: null }, { orgSpace: { intensives: { none: {} } } }],
            },
          });
          if (del.count === 0) return { success: false, skipped: true, id: ws.id, name: ws.workspaceName };

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
          console.error(`Failed to delete workspace ${ws.id}:`, error instanceof Error ? error.message : 'unknown');
          return {
            success: false,
            id: ws.id,
            name: ws.workspaceName,
          };
        }
      })
    );

    const successCount = deleteResults.filter((r) => r.success).length;
    const failedCount = deleteResults.filter((r) => !r.success && !('skipped' in r)).length;

    return NextResponse.json({
      success: true,
      message: `Deleted ${successCount} expired archives`,
      deleted: successCount,
      failed: failedCount,
      skippedWithIntensives: protectedIds.size,
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