import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getSafeErrorMessage } from '@/lib/security';
import { requireAuth } from '@/lib/auth';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import {
  type SettingKey,
  applyHideSystemMessages,
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
    const { id: workspaceId } = await params;
    const body = await request.json().catch(() => ({}));
    const key = body?.key as SettingKey;

    if (!key || !APPLIERS[key]) {
      return NextResponse.json(
        { error: 'Неизвестный ключ настройки' },
        { status: 400 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({ error: 'Подключитесь к пространству' });
    }

    const baseUrl = effective.workspaceUrl.replace(/\/$/, '');
    const result = await APPLIERS[key](
      baseUrl,
      effective.authToken,
      effective.userId_RC
    );

    if (!result.ok) {
      return NextResponse.json(
        { error: result.error || 'Не удалось применить' },
        { status: 400 }
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
