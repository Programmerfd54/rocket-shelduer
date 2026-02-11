import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export const dynamic = 'force-dynamic';

/**
 * GET /api/user/export — экспорт данных пользователя (резервная копия).
 * Возвращает JSON: профиль (без пароля), список пространств (без паролей), сообщения, шаблоны.
 */
export async function GET() {
  try {
    const user = await requireAuth();

    const [profile, workspaces, messages, templates] = await Promise.all([
      prisma.user.findUnique({
        where: { id: user.id },
        select: {
          id: true,
          email: true,
          username: true,
          name: true,
          role: true,
          createdAt: true,
          lastLoginAt: true,
          avatarUrl: true,
        },
      }),
      prisma.workspaceConnection.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          workspaceName: true,
          workspaceUrl: true,
          username: true,
          has2FA: true,
          isActive: true,
          isArchived: true,
          createdAt: true,
          color: true,
          startDate: true,
          endDate: true,
        },
      }),
      prisma.scheduledMessage.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          workspaceId: true,
          channelId: true,
          channelName: true,
          message: true,
          scheduledFor: true,
          status: true,
          sentAt: true,
          createdAt: true,
        },
      }),
      prisma.userTemplate.findMany({
        where: { userId: user.id },
        select: {
          id: true,
          channel: true,
          intensiveDay: true,
          time: true,
          title: true,
          body: true,
          tags: true,
          createdAt: true,
        },
      }),
    ]);

    const exportData = {
      exportedAt: new Date().toISOString(),
      profile: profile ?? undefined,
      workspaces: workspaces ?? [],
      messages: messages ?? [],
      templates: templates ?? [],
    };

    return NextResponse.json(exportData, {
      headers: {
        'Content-Disposition': `attachment; filename="rc-scheduler-backup-${user.id.slice(0, 8)}-${new Date().toISOString().slice(0, 10)}.json"`,
      },
    });
  } catch {
    return NextResponse.json({ error: 'Export failed' }, { status: 500 });
  }
}
