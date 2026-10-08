/** Локальные настройки левой колонки админки + синхронизация между вкладками */

export const ADMIN_ASIDE_COLLAPSED_KEY = 'rc-admin-aside-collapsed';
export const ADMIN_PREFS_CHANGED_EVENT = 'rc-admin-prefs-changed';

function readStorageBool(key: string, defaultVal: boolean): boolean {
  if (typeof window === 'undefined') return defaultVal;
  try {
    const v = localStorage.getItem(key);
    if (v === null) return defaultVal;
    return v === '1' || v === 'true';
  } catch {
    return defaultVal;
  }
}

function writeStorageBool(key: string, val: boolean) {
  try {
    localStorage.setItem(key, val ? '1' : '0');
  } catch {
    /* ignore */
  }
}

export function readAsideCollapsed(): boolean {
  return readStorageBool(ADMIN_ASIDE_COLLAPSED_KEY, false);
}

export function writeAsideCollapsed(val: boolean) {
  writeStorageBool(ADMIN_ASIDE_COLLAPSED_KEY, val);
  notifyAdminPrefsChanged();
}

export function notifyAdminPrefsChanged() {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(ADMIN_PREFS_CHANGED_EVENT));
}
