/**
 * Guards для API-роутов: как в lib/auth, но дополнительно отклоняют заблокированных пользователей
 * (isBlocked админом или волонтёр MEMBER с истёкшим volunteerExpiresAt).
 *
 * Заблокированный пользователь сохраняет сессию (чтобы видеть страницу /dashboard/blocked через
 * /api/auth/me и выйти через /api/auth/logout), но не должен иметь доступа к остальному API.
 * Ошибка — 'Forbidden' (совместимо с isForbiddenError → 403 в роутах).
 */
import {
  requireAuth as requireSession,
  getCurrentUser as getSessionUser,
  type CurrentUser,
} from '@/lib/auth';

type BlockFields = Pick<CurrentUser, 'role'> &
  Partial<Pick<CurrentUser, 'isBlocked' | 'volunteerExpiresAt'>>;

/** То же правило, что isUserEffectivelyBlocked в lib/auth (дублируется, чтобы не зависеть от моков в тестах). */
export function isAccountBlocked(user: BlockFields, now: Date = new Date()): boolean {
  if (user.isBlocked) return true;
  if (user.role !== 'MEMBER' || !user.volunteerExpiresAt) return false;
  return now > new Date(user.volunteerExpiresAt);
}

/** Авторизованный и не заблокированный пользователь. Иначе 'Unauthorized' / 'Forbidden'. */
export async function requireAuth(): Promise<CurrentUser> {
  const user = await requireSession();
  if (isAccountBlocked(user)) throw new Error('Forbidden');
  return user;
}

/** Как getCurrentUser, но для заблокированного пользователя возвращает null. */
export async function getCurrentUser(): Promise<CurrentUser | null> {
  const user = await getSessionUser();
  if (!user || isAccountBlocked(user)) return null;
  return user;
}

/** Lead_SUP. */
export async function requireAdmin(): Promise<CurrentUser> {
  const user = await requireAuth();
  if (user.role !== 'LEAD_SUP') throw new Error('Forbidden');
  return user;
}

/** SUP или Lead_SUP. */
export async function requireSupportOrAdmin(): Promise<CurrentUser> {
  const user = await requireAuth();
  if (user.role !== 'SUP' && user.role !== 'LEAD_SUP') throw new Error('Forbidden');
  return user;
}

/** SUP, ADM или Lead_SUP. */
export async function requireSupportAdmOrAdmin(): Promise<CurrentUser> {
  const user = await requireAuth();
  if (user.role !== 'SUP' && user.role !== 'ADM' && user.role !== 'LEAD_SUP') {
    throw new Error('Forbidden');
  }
  return user;
}
