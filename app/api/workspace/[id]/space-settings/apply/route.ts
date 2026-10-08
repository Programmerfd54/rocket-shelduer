import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { requireWorkspaceTabAccess } from '@/lib/workspace-tab-access';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import {
  type SettingKey,
  applyHideSystemMessages,
  clearHideSystemMessages,
  isRcSettingsPermissionError,
  applyThreadDefault,
  applyOfflineEmail,
  applyMessageEditDelete,
  applyAvatarSize,
  applyFileUploadSize,
  applyPermissionCreateC,
  applyPermissionDeleteD,
} from '@/lib/space-settings-rc';

const APPLIERS: Record<
  SettingKey,
  (baseUrl: string, token: string, userId: string) => Promise<{ ok: boolean; error?: string }>
> = {
  hideSystemMessages: applyHideSystemMessages,
  threadDefault: applyThreadDefault,
  offlineEmail: applyOfflineEmail,
  messageEditDelete: applyMessageEditDelete,
  avatarSize: applyAvatarSize,
  fileUploadSize: applyFileUploadSize,
  permissionCreateC: applyPermissionCreateC,
  permissionDeleteD: applyPermissionDeleteD,
};

export async function POST(
  request: Request,
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
    const body = await request.json().catch(() => ({}));
    const key = body?.key as SettingKey;
    const clear = body?.clear === true;

    if (!key || (!clear && !APPLIERS[key])) {
      return NextResponse.json(
        { error: 'Неизвестный ключ настройки' },
        { status: 400 }
      );
    }
    if (clear && key !== 'hideSystemMessages') {
      return NextResponse.json(
        { error: 'Сброс доступен только для hideSystemMessages' },
        { status: 400 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({ error: 'Подключитесь к пространству' });
    }

    const baseUrl = effective.workspaceUrl.replace(/\/$/, '');
    const result = clear
      ? await clearHideSystemMessages(baseUrl, effective.authToken, effective.userId_RC)
      : await APPLIERS[key](baseUrl, effective.authToken, effective.userId_RC);

    if (!result.ok) {
      const permissionDenied =
        'permissionDenied' in result && result.permissionDenied === true;
      const status =
        permissionDenied || isRcSettingsPermissionError(result.error) ? 403 : 400;
      return NextResponse.json(
        {
          error:
            result.error ||
            (permissionDenied
              ? 'Недостаточно прав в Rocket.Chat. Для изменения настроек сервера нужна учётная запись администратора RC (личный токен без роли admin не подойдёт).'
              : 'Не удалось применить'),
          code: permissionDenied ? 'RC_SETTINGS_FORBIDDEN' : undefined,
        },
        { status }
      );
    }

    await prisma.workspaceActionLog.create({
      data: {
        workspaceId,
        userId: user.id,
        action: 'setting_apply',
        details: JSON.stringify({ settingKey: key, rcUsername: effective.rcUsername }),
      },
    }).catch(() => {});

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Space settings apply error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка') },
      { status: 500 }
    );
  }
}
