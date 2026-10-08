import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { requireWorkspaceTabAccess } from '@/lib/workspace-tab-access';
import { safeFetch } from '@/lib/ssrf';
import { getSafeErrorMessage } from '@/lib/security';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';
import { rcNotConnectedResponse } from '@/lib/rc-http';
import {
  type SettingKey,
  fetchSettings,
  checkHideSystemMessages,
  findAllHideSystemMessagesSettings,
  checkThreadDefault,
  checkOfflineEmail,
  checkMessageEditDelete,
  checkAvatarSize,
  checkFileUploadSize,
  checkPermissionCreateC,
  checkPermissionDeleteD,
} from '@/lib/space-settings-rc';

function getValue(settings: { _id: string; value?: unknown }[], id: string): unknown {
  return settings.find((s) => s._id === id)?.value;
}

function findSetting(settings: { _id: string; value?: unknown }[], matcher: (s: { _id: string }) => boolean) {
  return settings.find(matcher);
}

export async function GET(
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
    const url = new URL(_request.url);
    const key = url.searchParams.get('key') as SettingKey | null;

    const validKeys: SettingKey[] = [
      'hideSystemMessages',
      'threadDefault',
      'offlineEmail',
      'messageEditDelete',
      'avatarSize',
      'fileUploadSize',
      'permissionCreateC',
      'permissionDeleteD',
    ];
    if (!key || !validKeys.includes(key)) {
      return NextResponse.json(
        { error: 'Неизвестный ключ настройки' },
        { status: 400 }
      );
    }

    const effective = await getEffectiveConnectionForRc(user.id, workspaceId);
    if (!effective?.authToken || !effective.userId_RC) {
      return rcNotConnectedResponse({
        applied: false,
        error: 'Подключитесь к пространству',
      });
    }

    const baseUrl = effective.workspaceUrl.replace(/\/$/, '');
    const settings = await fetchSettings(
      baseUrl,
      effective.authToken,
      effective.userId_RC
    );

    let applied = false;

    if (key === 'permissionCreateC' || key === 'permissionDeleteD') {
      const res = await safeFetch(`${baseUrl}/api/v1/permissions.listAll`, {
        headers: { 'X-Auth-Token': effective.authToken, 'X-User-Id': effective.userId_RC },
      });
      const permData = await res.json().catch(() => ({}));
      const perms = permData.update ?? [];
      if (key === 'permissionCreateC') {
        const createC = perms.find((p: { _id: string }) => p._id === 'create-c');
        applied = checkPermissionCreateC(createC?.roles ?? []);
      } else {
        const deleteD = perms.find((p: { _id: string }) => p._id === 'delete-d');
        applied = checkPermissionDeleteD(deleteD?.roles ?? []);
      }
      return NextResponse.json({ applied });
    }
    switch (key) {
      case 'hideSystemMessages': {
        const targets = findAllHideSystemMessagesSettings(settings);
        applied = targets.some((s) => checkHideSystemMessages(s.value));
        break;
      }
      case 'threadDefault': {
        const s = settings.find(
          (x) =>
            x._id === 'Accounts_Default_User_Preferences_threadsAlsoSendChannelMessages' ||
            x._id === 'Threads_Also_Send_Channel_Messages' ||
            (x._id?.toLowerCase().includes('thread') && x._id?.toLowerCase().includes('channel'))
        );
        applied = checkThreadDefault(s?.value);
        break;
      }
      case 'offlineEmail': {
        const s = settings.find(
          (x) =>
            x._id === 'Accounts_Default_User_Preferences_emailNotificationMode' ||
            (x._id?.toLowerCase().includes('email') && x._id?.toLowerCase().includes('notification'))
        );
        applied = checkOfflineEmail(s?.value);
        break;
      }
      case 'messageEditDelete': {
        const editS = findSetting(settings, (x) =>
          x._id === 'Message_AllowEditing' ||
          (x._id?.toLowerCase().includes('allowediting') && x._id?.toLowerCase().includes('message'))
        );
        const delS = findSetting(settings, (x) =>
          x._id === 'Message_AllowDeleting' ||
          (x._id?.toLowerCase().includes('allowdeleting') && x._id?.toLowerCase().includes('message'))
        );
        applied = checkMessageEditDelete(editS?.value, delS?.value);
        break;
      }
      case 'avatarSize': {
        const s =
          settings.find(
            (x) =>
              x._id === 'Avatar_MaxFileSize' ||
              x._id === 'Accounts_AvatarSize' ||
              (x._id?.toLowerCase().includes('avatar') && (x._id?.toLowerCase().includes('size') || x._id?.toLowerCase().includes('file')))
          ) || settings.find((x) => x._id === 'FileUpload_MaxFileSize');
        applied = checkAvatarSize(s?.value);
        break;
      }
      case 'fileUploadSize': {
        const id = (x: { _id?: string }) => (x._id || '').toLowerCase();
        const s =
          findSetting(settings, (x) => x._id === 'FileUpload_MaxFileSize') ||
          findSetting(settings, (x) => x._id === 'fileupload_maxfilesize') ||
          findSetting(
            settings,
            (x) =>
              id(x).includes('fileupload') &&
              id(x).includes('maxfilesize') &&
              !id(x).includes('avatar')
          );
        applied = checkFileUploadSize(s?.value);
        break;
      }
    }

    return NextResponse.json({ applied });
  } catch (error) {
    console.error('Space settings check error:', error);
    return NextResponse.json(
      { applied: false, error: getSafeErrorMessage(error, 'Ошибка') },
      { status: 500 }
    );
  }
}
