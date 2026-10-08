import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { getWorkspaceTabFlags } from '@/lib/workspace-tab-access';

/**
 * GET — для текущего пользователя возвращает, какие вкладки пространства разрешены.
 * Lead_SUP — всё разрешено; SUP/ADM — по глобальным настройкам платформы (SystemSetting).
 * Те же правила применяются на сервере в API вкладок (lib/workspace-tab-access.ts).
 */
export async function GET() {
  try {
    const user = await requireAuth();
    return NextResponse.json(await getWorkspaceTabFlags(user.role));
  } catch (error) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (error instanceof Error && error.message === 'Forbidden') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Get workspace tab restrictions error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch restrictions' },
      { status: 500 }
    );
  }
}
