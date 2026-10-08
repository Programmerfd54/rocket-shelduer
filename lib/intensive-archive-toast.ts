/** Пользователь отключил напоминание о завершённых интенсивах (архив). */
export const INTENSIVE_ARCHIVE_TOAST_STORAGE_KEY = 'dismiss_intensive_archive_toast_v1';

export function isIntensiveArchiveToastDismissed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(INTENSIVE_ARCHIVE_TOAST_STORAGE_KEY) === '1';
}

export function setIntensiveArchiveToastDismissed(): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(INTENSIVE_ARCHIVE_TOAST_STORAGE_KEY, '1');
}
