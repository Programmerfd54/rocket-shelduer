import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { requireWorkspaceTabAccess } from '@/lib/workspace-tab-access';
import { getSafeErrorMessage } from '@/lib/security';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import { applyThreadDefault } from '@/lib/space-settings-rc';

/**
 * POST — применить настройку «Выбрано не по умолчанию» для «Также отправить сообщение треда в чат».
 * Использует applyThreadDefault для корректного формата значения (select key, а не boolean).
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (!canPerformAction(user, 'workspace:space-settings')) {
      return NextResponse.json({ error: 'Недостаточно прав' }, { status: 403 });
    }
    const { id: workspaceId } = await params;
    const tabAccess = await requireWorkspaceTabAccess(user, workspaceId, 'spaceSettings');
    if (!tabAccess.ok) return tabAccess.response;

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({ error: 'Подключитесь к пространству' });
    }

    const baseUrl = effective.workspaceUrl.replace(/\/$/, '');
    const result = await applyThreadDefault(
      baseUrl,
      effective.authToken,
      effective.userId_RC
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Не удалось обновить. Установите вручную в RC.' },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Thread default setting error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка') },
      { status: 500 }
    );
  }
}
