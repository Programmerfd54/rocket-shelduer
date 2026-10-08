import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/api-auth';
import { getSystemSettings, getBool } from '@/lib/system-settings';

/** Оставлено для совместимости: справка отключена; «Шаблоны» в меню не используем. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const settings = await getSystemSettings();
    const templatesTabVisible = getBool(settings, 'templatesTabVisible');

    return NextResponse.json({
      templatesTabVisible,
      helpMainVisible: false,
      helpAdminVisible: false,
      isAdmin: user.role === 'LEAD_SUP',
    });
  } catch (e) {
    console.error('Help visibility error:', e);
    return NextResponse.json({ error: 'Failed to load visibility' }, { status: 500 });
  }
}
