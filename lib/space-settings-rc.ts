/**
 * Логика применения и проверки настроек Rocket.Chat для подготовки пространства.
 */

export type SettingKey =
  | 'hideSystemMessages'
  | 'threadDefault'
  | 'offlineEmail'
  | 'messageEditDelete'
  | 'avatarSize'
  | 'fileUploadSize'
  | 'permissionCreateC'
  | 'permissionDeleteD';

export interface RcSetting {
  _id: string;
  value?: unknown;
  type?: string;
  values?: Array<{ key: string; i18nLabel?: string } | string>;
  packageValue?: unknown;
}

const AUTH_HEADERS = (authToken: string, userId: string) =>
  ({ 'X-Auth-Token': authToken, 'X-User-Id': userId }) as Record<string, string>;

export async function fetchSettings(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<RcSetting[]> {
  const base = baseUrl.replace(/\/$/, '');
  const headers = AUTH_HEADERS(authToken, userId);

  const seen = new Set<string>();
  const merged: RcSetting[] = [];

  // Загружаем с пагинацией — настройки могут быть разбиты по страницам
  const fetchAll = async (endpoint: string) => {
    let offset = 0;
    const count = 500;
    for (;;) {
      const url = `${base}${endpoint}?count=${count}&offset=${offset}`;
      const res = await fetch(url, { headers });
      if (!res.ok) break;
      const data = await res.json();
      const list = data.settings ?? [];
      for (const s of list) {
        const id = s?._id ?? s?.id;
        if (id && !seen.has(id)) {
          seen.add(id);
          merged.push({ ...s, _id: id });
        }
      }
      const total = data.total ?? list.length;
      if (list.length === 0 || offset + list.length >= total) break;
      offset += list.length;
    }
  };

  try {
    await fetchAll('/api/v1/settings');
    await fetchAll('/api/v1/settings.public');
    // Дополнительно запрашиваем по конкретным _id — в некоторых версиях RC они не попадают в общий список
    const ids = [
      'Message_Hide_System_Messages',
      'Message_AllowEditing',
      'Message_AllowDeleting',
      'FileUpload_MaxFileSize',
      'Avatar_MaxFileSize',
      'Accounts_Default_User_Preferences_threadsAlsoSendChannelMessages',
      'Threads_Also_Send_Channel_Messages',
    ];
    for (const id of ids) {
      if (seen.has(id)) continue;
      for (const ep of ['/api/v1/settings', '/api/v1/settings.public']) {
        const res = await fetch(`${base}${ep}?_id=${encodeURIComponent(id)}&count=1`, { headers });
        if (!res.ok) continue;
        const data = await res.json();
        const list = data.settings ?? [];
        const s = list[0];
        if (s && (s._id || s.id)) {
          const sid = s._id ?? s.id;
          if (!seen.has(sid)) {
            seen.add(sid);
            merged.push({ ...s, _id: sid });
          }
          break;
        }
      }
    }
  } catch {
    // ignore
  }
  return merged;
}

export async function updateSetting(
  baseUrl: string,
  authToken: string,
  userId: string,
  settingId: string,
  value: unknown
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(
    `${baseUrl.replace(/\/$/, '')}/api/v1/settings/${settingId}`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Auth-Token': authToken,
        'X-User-Id': userId,
      },
      body: JSON.stringify({ value }),
    }
  );
  if (res.ok) return { ok: true };
  const errData = await res.json().catch(() => ({}));
  const msg = errData.error || errData.message || (res.status === 403 ? 'Нет прав (нужен admin RC)' : `HTTP ${res.status}`);
  return { ok: false, error: msg };
}

// Исключаем из скрытия: «Пользователь заглушен/не заглушен»
const EXCLUDE_FROM_HIDE = ['user-muted-unmuted', 'user-unmuted'];

// Полный список типов системных сообщений RC (все кроме user-muted-unmuted)
const ALL_SYSTEM_MESSAGE_TYPES = [
  'au', 'ru', 'subscription-role-added', 'subscription-role-removed',
  'room_changed_privacy', 'room_changed_topic', 'room_changed_announcement',
  'room_changed_description', 'room_changed_avatar', 'room_changed_avatar_description',
  'room_e2e_enabled', 'room_e2e_disabled', 'jitsi_call_started', 'jitsi_call_ended',
  'room-archived', 'room-unarchived', 'room_changed_join_code', 'room_changed_read_only',
  'message_pinned', 'room_changed_name', 'room_changed_parent', 'room_changed_reactions',
  'room_changed_widgets', 'room_changed_team', 'room_changed_team_id',
  'room-archived', 'room-unarchived', 'room_changed_topic', 'room_changed_avatar',
  'room_changed_description', 'room_changed_announcement', 'room_changed_custom_fields',
  'room_changed_code', 'room_changed_retention', 'room_changed_avatar_description',
  'room_changed_join_code', 'room_changed_read_only', 'room_changed_parent',
  'room_changed_reactions', 'room_changed_widgets', 'room_changed_team',
  'room_changed_team_id', 'room_changed_custom_fields', 'room_changed_code',
  'room_changed_retention', 'room_changed_avatar_description',
  'message_removed', 'room_changed_privacy', 'room_changed_announcement',
  'room_changed_topic', 'room_changed_description', 'room_changed_avatar',
  'room_changed_avatar_description', 'room_changed_join_code', 'room_changed_read_only',
  'room_changed_parent', 'room_changed_reactions', 'room_changed_widgets',
  'room_changed_team', 'room_changed_team_id', 'room_changed_custom_fields',
  'room_changed_code', 'room_changed_retention',
  'room_name_changed', 'room_description_changed', 'room_announcement_changed',
  'room_avatar_changed', 'room_topic_changed', 'room_parent_changed',
  'room_reactions_changed', 'room_widgets_changed', 'room_team_changed',
  'room_join_code_changed', 'room_read_only_changed', 'room_retention_changed',
  'room_custom_fields_changed', 'room_code_changed', 'room_avatar_description_changed',
  'user_added', 'user_removed', 'user_joined', 'user_left', 'user_deleted',
  'subscription_role_added', 'subscription_role_removed',
  'room_archived', 'room_unarchived', 'room_restored',
  'room_converted_to_team', 'room_converted_to_channel',
  'room_added_to_workspace', 'room_removed_from_workspace', 'room_extracted_from_workspace',
  'room_announcement_changed', 'room_description_changed', 'room_name_changed',
  'role_assigned', 'role_removed', 'room_type_changed', 'room_avatar_changed',
  'welcome', 'message_deleted', 'room_changed_parent', 'room_changed_reactions',
];

function buildHideSystemMessagesList(availableValues?: string[]): string[] {
  const excludeSet = new Set(EXCLUDE_FROM_HIDE.map((x) => x.toLowerCase()));
  if (availableValues && availableValues.length > 0) {
    return availableValues.filter((v) => !excludeSet.has(String(v).toLowerCase()));
  }
  const all = [...new Set(ALL_SYSTEM_MESSAGE_TYPES)];
  return all.filter((v) => !excludeSet.has(v.toLowerCase()));
}

export async function applyHideSystemMessages(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  const s = settings.find(
    (x) =>
      x._id === 'Message_Hide_System_Messages' ||
      x._id === 'message_hide_system_messages' ||
      (x._id && x._id.toLowerCase().includes('hide') && x._id.toLowerCase().includes('system'))
  ) as RcSetting | undefined;
  if (!s?._id) {
    const similar = settings.filter((x) => x._id?.toLowerCase().includes('message')).map((x) => x._id);
    return {
      ok: false,
      error: similar.length
        ? `Настройка Message_Hide_System_Messages не найдена. Похожие: ${similar.slice(0, 5).join(', ')}`
        : 'Настройка Message_Hide_System_Messages не найдена. Проверьте версию Rocket.Chat и права администратора.',
    };
  }
  let availableValues: string[] = [];
  if (s.values && Array.isArray(s.values)) {
    availableValues = s.values.map((v) => (typeof v === 'string' ? v : (v as { key: string }).key));
  }
  const toHide = buildHideSystemMessagesList(availableValues);
  const r = await updateSetting(baseUrl, authToken, userId, s._id, toHide);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Не удалось обновить' };
}

/** Список типов для скрытия (статический fallback). */
export function getHideSystemMessagesValues(): string[] {
  return buildHideSystemMessagesList();
}

/** Список типов для скрытия с учётом схемы RC (предпочтительно при создании канала). */
export async function getHideSystemMessagesValuesAsync(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<string[]> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  const s = settings.find(
    (x) =>
      x._id === 'Message_Hide_System_Messages' ||
      x._id === 'message_hide_system_messages' ||
      (x._id && x._id.toLowerCase().includes('hide') && x._id.toLowerCase().includes('system'))
  ) as RcSetting | undefined;
  let availableValues: string[] = [];
  if (s?.values && Array.isArray(s.values)) {
    availableValues = s.values.map((v) => (typeof v === 'string' ? v : (v as { key: string }).key));
  }
  return buildHideSystemMessagesList(availableValues);
}

export function checkHideSystemMessages(current: unknown): boolean {
  if (!Array.isArray(current)) return false;
  const arr = current as string[];
  return (
    arr.includes('au') &&
    arr.includes('ru') &&
    !arr.includes('user-muted-unmuted') &&
    !arr.includes('user-unmuted')
  );
}

/** Значение для «Выбрано не по умолчанию» — RC может ожидать select key, а не boolean */
function resolveThreadUncheckedValue(s: RcSetting): unknown {
  const vals = s.values;
  if (vals && Array.isArray(vals) && vals.length > 0) {
    const keys = vals.map((v) => (typeof v === 'string' ? v : (v as { key: string }).key));
    // Ищем ключ для «не выбрано по умолчанию»: 0, default, never, unselected
    const prefer = ['0', 'default', 'never', 'unselected', 'false'];
    for (const p of prefer) {
      if (keys.includes(p)) return p;
    }
    // Если есть 0 — обычно 0 = unchecked
    if (keys.includes('0')) return '0';
  }
  return false;
}

export async function applyThreadDefault(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  const s = settings.find(
    (x) =>
      x._id === 'Accounts_Default_User_Preferences_threadsAlsoSendChannelMessages' ||
      x._id === 'Threads_Also_Send_Channel_Messages' ||
      (x._id &&
        x._id.toLowerCase().includes('thread') &&
        x._id.toLowerCase().includes('channel'))
  );
  if (!s?._id) {
    return { ok: false, error: 'Настройка не найдена' };
  }
  const value = resolveThreadUncheckedValue(s);
  const r = await updateSetting(baseUrl, authToken, userId, s._id, value);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Не удалось обновить. Проверьте: 1) вы администратор RC; 2) настройка есть в Учётные записи → Поведение.' };
}

export function checkThreadDefault(value: unknown): boolean {
  return (
    value === false ||
    value === 'false' ||
    value === '0' ||
    value === 'default' ||
    value === 'never' ||
    value === 'unselected'
  );
}

export async function applyOfflineEmail(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  const s = settings.find(
    (x) =>
      x._id === 'Accounts_Default_User_Preferences_emailNotificationMode' ||
      (x._id &&
        x._id.toLowerCase().includes('email') &&
        x._id.toLowerCase().includes('notification'))
  );
  if (!s?._id) {
    return { ok: false, error: 'Настройка emailNotificationMode не найдена' };
  }
  const r = await updateSetting(baseUrl, authToken, userId, s._id, 'nothing');
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Не удалось обновить' };
}

export function checkOfflineEmail(value: unknown): boolean {
  return value === 'nothing' || value === 'disabled';
}

export async function applyMessageEditDelete(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  const editS =
    settings.find((x) => x._id === 'Message_AllowEditing') ||
    settings.find((x) => x._id?.toLowerCase().includes('allowediting') && x._id?.toLowerCase().includes('message'));
  const delS =
    settings.find((x) => x._id === 'Message_AllowDeleting') ||
    settings.find((x) => x._id?.toLowerCase().includes('allowdeleting') && x._id?.toLowerCase().includes('message'));
  if (!editS?._id || !delS?._id) {
    const missing = [!editS?._id && 'AllowEditing', !delS?._id && 'AllowDeleting'].filter(Boolean).join(', ');
    const similar = settings.filter((x) => x._id?.toLowerCase().includes('message')).map((x) => x._id);
    return {
      ok: false,
      error: similar.length
        ? `Настройки ${missing} не найдены. Похожие: ${similar.slice(0, 5).join(', ')}`
        : 'Настройки Message_AllowEditing/AllowDeleting не найдены. Проверьте версию Rocket.Chat.',
    };
  }
  const editR = await updateSetting(baseUrl, authToken, userId, editS._id, false);
  const delR = await updateSetting(baseUrl, authToken, userId, delS._id, false);
  return editR.ok && delR.ok
    ? { ok: true }
    : { ok: false, error: editR.error || delR.error || 'Не удалось обновить одну из настроек' };
}

export function checkMessageEditDelete(
  allowEdit: unknown,
  allowDel: unknown
): boolean {
  return allowEdit === false && allowDel === false;
}

const AVATAR_SIZE_BYTES = 200 * 1024 * 1024; // 200 MB

export async function applyAvatarSize(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  const s =
    settings.find(
      (x) =>
        x._id === 'Avatar_MaxFileSize' ||
        x._id === 'Accounts_AvatarSize' ||
        (x._id &&
          x._id.toLowerCase().includes('avatar') &&
          (x._id.toLowerCase().includes('size') || x._id.toLowerCase().includes('file')))
    ) || settings.find((x) => x._id === 'FileUpload_MaxFileSize');
  if (!s?._id) {
    return { ok: false, error: 'Настройка размера аватара не найдена. Установите вручную: Настройки → Аватар.' };
  }
  const r = await updateSetting(baseUrl, authToken, userId, s._id, AVATAR_SIZE_BYTES);
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Не удалось обновить' };
}

export function checkAvatarSize(value: unknown): boolean {
  const n = Number(value);
  return !isNaN(n) && n >= AVATAR_SIZE_BYTES;
}

const FILE_UPLOAD_SIZE = 25000000;

export async function applyFileUploadSize(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const settings = await fetchSettings(baseUrl, authToken, userId);
  // Только FileUpload — не путать с Avatar_MaxFileSize
  const id = (x: RcSetting) => (x._id || '').toLowerCase();
  const s =
    settings.find((x) => x._id === 'FileUpload_MaxFileSize') ||
    settings.find((x) => x._id === 'fileupload_maxfilesize') ||
    settings.find(
      (x) =>
        id(x).includes('fileupload') &&
        id(x).includes('maxfilesize') &&
        !id(x).includes('avatar')
    );
  if (!s?._id) {
    const similar = settings
      .filter((x) => x._id?.toLowerCase().includes('file') || x._id?.toLowerCase().includes('upload'))
      .map((x) => x._id);
    return {
      ok: false,
      error: similar.length
        ? `Настройка FileUpload_MaxFileSize не найдена. Похожие: ${similar.slice(0, 5).join(', ')}`
        : 'Настройка FileUpload_MaxFileSize не найдена. Проверьте версию Rocket.Chat.',
    };
  }
  // RC может ожидать number или string — пробуем number
  let r = await updateSetting(baseUrl, authToken, userId, s._id, FILE_UPLOAD_SIZE);
  if (!r.ok) r = await updateSetting(baseUrl, authToken, userId, s._id, String(FILE_UPLOAD_SIZE));
  return r.ok ? { ok: true } : { ok: false, error: r.error || 'Не удалось обновить' };
}

export function checkFileUploadSize(value: unknown): boolean {
  const n = Number(value);
  return !isNaN(n) && n === FILE_UPLOAD_SIZE;
}

// ——— Права доступа (permissions): create-c, delete-d ———

async function fetchPermissions(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ _id: string; roles: string[] }[]> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/permissions.listAll`, {
    headers: { 'X-Auth-Token': authToken, 'X-User-Id': userId },
  });
  if (!res.ok) return [];
  const data = await res.json().catch(() => ({}));
  return data.update ?? [];
}

async function updatePermission(
  baseUrl: string,
  authToken: string,
  userId: string,
  permissionId: string,
  roles: string[]
): Promise<boolean> {
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/v1/permissions.update`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Auth-Token': authToken, 'X-User-Id': userId },
    body: JSON.stringify({ permissions: [{ _id: permissionId, roles }] }),
  });
  const data = await res.json().catch(() => ({}));
  return data.success === true;
}

/** create-c: убрать user, добавить moderator (создание публичных каналов). */
export async function applyPermissionCreateC(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const perms = await fetchPermissions(baseUrl, authToken, userId);
  const createC = perms.find((p) => p._id === 'create-c');
  if (!createC) return { ok: false, error: 'Право create-c не найдено' };
  const current = new Set(createC.roles || []);
  current.delete('user');
  current.add('moderator');
  current.add('admin');
  current.add('owner');
  const roles = Array.from(current);
  const ok = await updatePermission(baseUrl, authToken, userId, 'create-c', roles);
  return ok ? { ok: true } : { ok: false, error: 'Не удалось обновить' };
}

export function checkPermissionCreateC(roles: string[]): boolean {
  const set = new Set(roles || []);
  return set.has('moderator') && !set.has('user');
}

/** delete-d: добавить moderator (удаление личных сообщений). */
export async function applyPermissionDeleteD(
  baseUrl: string,
  authToken: string,
  userId: string
): Promise<{ ok: boolean; error?: string }> {
  const perms = await fetchPermissions(baseUrl, authToken, userId);
  const deleteD = perms.find((p) => p._id === 'delete-d');
  if (!deleteD) return { ok: false, error: 'Право delete-d не найдено' };
  const current = new Set(deleteD.roles || []);
  current.add('moderator');
  current.add('admin');
  current.add('owner');
  const roles = Array.from(current);
  const ok = await updatePermission(baseUrl, authToken, userId, 'delete-d', roles);
  return ok ? { ok: true } : { ok: false, error: 'Не удалось обновить' };
}

export function checkPermissionDeleteD(roles: string[]): boolean {
  return (roles || []).includes('moderator');
}
