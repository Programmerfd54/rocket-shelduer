import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

const VISIBILITY_KEYS = ['templatesTabVisible', 'helpMainVisible', 'helpAdminVisible'] as const;

/** Видимость вкладок «Шаблоны» и «Справка» для текущего пользователя (любой авторизованный) */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: [...VISIBILITY_KEYS] } },
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value ?? 'true';
    const templatesTabVisible = get('templatesTabVisible') !== 'false';
    const helpMainVisible = get('helpMainVisible') !== 'false';
    const helpAdminVisible = get('helpAdminVisible') !== 'false';

    return NextResponse.json({
      templatesTabVisible,
      helpMainVisible,
      helpAdminVisible,
      isAdmin: user.role === 'ADMIN',
    });
  } catch (e) {
    console.error('Help visibility error:', e);
    return NextResponse.json({ error: 'Failed to load visibility' }, { status: 500 });
  }
}
