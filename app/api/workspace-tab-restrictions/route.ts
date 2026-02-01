import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

/**
 * GET — для текущего пользователя (SUP, ADM, ADMIN) возвращает, какие вкладки пространства разрешены.
 * ADMIN всегда все true. SUP/ADM — по системным настройкам (по умолчанию true для разрешённых по роли).
 */
export async function GET() {
  try {
    const user = await requireAuth();

    if (user.role === 'ADMIN') {
      return NextResponse.json({
        templates: true,
        emojiImport: true,
        usersAdd: true,
      });
    }

    if (user.role !== 'SUPPORT' && user.role !== 'ADM') {
      return NextResponse.json({
        templates: false,
        emojiImport: false,
        usersAdd: false,
      });
    }

    const keys =
      user.role === 'SUPPORT'
        ? ['workspaceTabTemplatesSup', 'workspaceTabEmojiImportSup', 'workspaceTabUsersAddSup']
        : ['workspaceTabTemplatesAdm'];
    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: keys } },
    });
    const get = (key: string) => (rows.find((r) => r.key === key)?.value ?? 'true') === 'true';

    if (user.role === 'SUPPORT') {
      return NextResponse.json({
        templates: get('workspaceTabTemplatesSup'),
        emojiImport: get('workspaceTabEmojiImportSup'),
        usersAdd: get('workspaceTabUsersAddSup'),
      });
    }

    return NextResponse.json({
      templates: get('workspaceTabTemplatesAdm'),
      emojiImport: false,
      usersAdd: false,
    });
  } catch (error) {
    console.error('Get workspace tab restrictions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch restrictions' },
      { status: 500 }
    );
  }
}
