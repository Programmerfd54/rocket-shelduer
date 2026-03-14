/**
 * Централизованные проверки прав доступа.
 * Защита от вызова скрытых в UI методов через API.
 */

import type { CurrentUser } from './auth';

export type Action =
  | 'admin:panel'
  | 'admin:users'
  | 'admin:users:edit'
  | 'admin:users:block'
  | 'admin:users:reset-password'
  | 'admin:users:edit-role'
  | 'admin:users:edit-restrictions'
  | 'admin:users:notes'
  | 'admin:users:extend-vol'
  | 'admin:users:bulk-extend'
  | 'admin:users:assign-workspace'
  | 'admin:help'
  | 'admin:help:upload'
  | 'admin:settings'
  | 'admin:security'
  | 'admin:audit'
  | 'admin:health'
  | 'admin:invite'
  | 'admin:workspaces:check'
  | 'admin:workspaces:assign-adm'
  | 'admin:templates:edit'
  | 'workspace:archive'
  | 'workspace:archive:restore'
  | 'workspace:add'
  | 'workspace:leave'
  | 'workspace:confirm-assignment'
  | 'workspace:users:add'
  | 'workspace:users:remove'
  | 'workspace:admin:reset-password'
  | 'workspace:emoji-import'
  | 'workspace:space-settings'
  | 'workspace:channels:create'
  | 'workspace:channels:set-default'
  | 'messages:create'
  | 'messages:edit'
  | 'messages:delete'
  | 'messages:retry'
  | 'messages:send-as'
  | 'templates:official'
  | 'templates:mine'
  | 'activity:view'
  | 'dashboard:stats';

/** Роли, которым разрешено действие. */
const ACTION_ROLES: Record<Action, string[]> = {
  'admin:panel': ['ADMIN', 'SUPPORT', 'ADM'],
  'admin:users': ['ADMIN', 'SUPPORT', 'ADM'],
  'admin:users:edit': ['ADMIN', 'SUPPORT'],
  'admin:users:block': ['ADMIN', 'SUPPORT'],
  'admin:users:reset-password': ['ADMIN', 'SUPPORT'],
  'admin:users:edit-role': ['ADMIN', 'SUPPORT'],
  'admin:users:edit-restrictions': ['ADMIN'],
  'admin:users:notes': ['ADMIN', 'SUPPORT'],
  'admin:users:extend-vol': ['ADMIN', 'SUPPORT'],
  'admin:users:bulk-extend': ['ADMIN', 'SUPPORT'],
  'admin:users:assign-workspace': ['ADMIN', 'SUPPORT'],
  'admin:help': ['ADMIN'],
  'admin:help:upload': ['ADMIN'],
  'admin:settings': ['ADMIN'],
  'admin:security': ['ADMIN'],
  'admin:audit': ['ADMIN', 'SUPPORT'],
  'admin:health': ['ADMIN'],
  'admin:invite': ['ADMIN', 'SUPPORT'],
  'admin:workspaces:check': ['ADMIN', 'SUPPORT'],
  'admin:workspaces:assign-adm': ['ADMIN', 'SUPPORT'],
  'admin:templates:edit': ['ADMIN'],
  'workspace:archive': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:archive:restore': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:add': ['ADMIN', 'SUPPORT', 'ADM', 'VOL'],
  'workspace:leave': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:confirm-assignment': ['ADM', 'VOL'],
  'workspace:users:add': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:users:remove': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:admin:reset-password': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:emoji-import': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:space-settings': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:channels:create': ['ADMIN', 'SUPPORT', 'ADM'],
  'workspace:channels:set-default': ['ADMIN', 'SUPPORT', 'ADM'],
  'messages:create': ['ADMIN', 'SUPPORT', 'ADM', 'VOL'],
  'messages:edit': ['ADMIN', 'SUPPORT', 'ADM', 'VOL'],
  'messages:delete': ['ADMIN', 'SUPPORT', 'ADM', 'VOL'],
  'messages:retry': ['ADMIN', 'SUPPORT', 'ADM', 'VOL'],
  'messages:send-as': ['ADMIN', 'SUPPORT', 'ADM'],
  'templates:official': ['ADMIN', 'SUPPORT', 'ADM'],
  'templates:mine': ['ADMIN', 'SUPPORT', 'ADM', 'VOL'],
  'activity:view': ['ADMIN', 'SUPPORT', 'ADM'],
  'dashboard:stats': ['ADMIN', 'SUPPORT', 'ADM'],
};

/** Ограничения по restrictedFeatures (ключи). */
const ACTION_RESTRICTIONS: Partial<Record<Action, string>> = {
  'admin:panel': 'adminPanel',
  'messages:send-as': 'sendAs',
};

export function canPerformAction(user: CurrentUser, action: Action): boolean {
  if (user.isBlocked) return false;
  const roles = ACTION_ROLES[action];
  if (!roles?.includes(user.role)) return false;
  const restrictionKey = ACTION_RESTRICTIONS[action];
  if (restrictionKey && (user.restrictedFeatures ?? []).includes(restrictionKey)) return false;
  return true;
}

export function requireAction(user: CurrentUser, action: Action): void {
  if (!canPerformAction(user, action)) {
    throw new Error('Forbidden');
  }
}

export function requireAdmin(user: CurrentUser): void {
  if (user.role !== 'ADMIN') throw new Error('Forbidden');
}

export function requireSupportOrAdmin(user: CurrentUser): void {
  if (user.role !== 'SUPPORT' && user.role !== 'ADMIN') throw new Error('Forbidden');
}

export function requireSupportAdmOrAdmin(user: CurrentUser): void {
  if (user.role !== 'SUPPORT' && user.role !== 'ADM' && user.role !== 'ADMIN') throw new Error('Forbidden');
}
