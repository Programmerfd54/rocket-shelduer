/**
 * Роли приложения:
 * LEAD_SUP (бывш. ADMIN) — верхняя роль: пользователи, настройки, справка, шаблоны.
 * SUP (бывш. SUPPORT) — поддержка с ограниченными правами в разделе «Пользователи».
 * ADM (бывш. CITY_ADMIN / ADM) — администратор пространств.
 * MEMBER (бывш. USER / VOL) — участник; волонтёр, если задан volunteerExpiresAt.
 */

export const APP_ROLES = ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'] as const;

export type AppRole = (typeof APP_ROLES)[number];

/** Подписи ролей для UI. */
export const ROLE_LABELS: Record<AppRole, string> = {
  LEAD_SUP: 'Lead_SUP',
  SUP: 'SUP',
  ADM: 'ADM',
  MEMBER: 'MEMBER',
};

export function isAppRole(value: unknown): value is AppRole {
  return typeof value === 'string' && (APP_ROLES as readonly string[]).includes(value);
}

export function isVolunteerMember(user: {
  role: string;
  volunteerExpiresAt?: Date | string | null;
}): boolean {
  return user.role === 'MEMBER' && user.volunteerExpiresAt != null;
}

export function isAdmRole(role: string): boolean {
  return role === 'ADM';
}

/** Верхняя роль системы. */
export function isLeadSup(role: string): boolean {
  return role === 'LEAD_SUP';
}

/** Синоним isLeadSup (историческое имя «системный администратор»). */
export function isSystemAdmin(role: string): boolean {
  return role === 'LEAD_SUP';
}

export function isSupport(role: string): boolean {
  return role === 'SUP';
}

/** Глобальный персонал: Lead_SUP и SUP. */
export function isGlobalStaffRole(role: string): boolean {
  return role === 'LEAD_SUP' || role === 'SUP';
}

/** Доступ к операциям «как админ пространства»: ADM, SUP, Lead_SUP. */
export function isWorkspaceStaffRole(role: string): boolean {
  return role === 'ADM' || role === 'SUP' || role === 'LEAD_SUP';
}

/** Ссылка «Админ панель» (раздел «Пользователи») в сайдбаре: Lead_SUP и SUP (у SUP — ограниченные действия). */
export function canSeeAdminPanel(role: string, restrictedFeatures: string[] = []): boolean {
  if (restrictedFeatures.includes('adminPanel')) return false;
  return role === 'LEAD_SUP' || role === 'SUP';
}

/** Шаблоны в зоне ответственности «ADM». */
export function isTemplatesAdmScope(role: string): boolean {
  return role === 'ADM' || role === 'LEAD_SUP';
}

/**
 * Роли, которые пользователь может выдать при приглашении / создании пользователя.
 * Lead_SUP — SUP, ADM, MEMBER. SUP — ADM, MEMBER. Остальные — никакие.
 * (Роль Lead_SUP выдаётся только сменой роли существующему пользователю.)
 */
export function inviteAssignableRoles(actorRole: string): AppRole[] {
  if (actorRole === 'LEAD_SUP') return ['SUP', 'ADM', 'MEMBER'];
  if (actorRole === 'SUP') return ['ADM', 'MEMBER'];
  return [];
}

/**
 * Роли, которые пользователь может назначить при смене роли существующему пользователю.
 * Lead_SUP — любые. SUP — ADM и MEMBER (и не может менять Lead_SUP / SUP).
 */
export function roleChangeAssignableRoles(actorRole: string): AppRole[] {
  if (actorRole === 'LEAD_SUP') return ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'];
  if (actorRole === 'SUP') return ['ADM', 'MEMBER'];
  return [];
}

/** Может ли actor управлять (блокировать, менять роль, сбрасывать пароль) пользователем с ролью targetRole. */
export function canManageUserWithRole(actorRole: string, targetRole: string): boolean {
  if (actorRole === 'LEAD_SUP') return true;
  if (actorRole === 'SUP') return targetRole === 'ADM' || targetRole === 'MEMBER';
  return false;
}
