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
  | 'admin:users:create'
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
  // Редактор официальных шаблонов и словарь каналов (docs/templates-api.md)
  | 'templates:official:manage'
  | 'templates:channels:view'
  | 'templates:channels:manage'
  | 'activity:view'
  | 'dashboard:stats'
  | 'queue:status'
  // Интенсивы (docs/intensives-api.md)
  | 'intensives:view'
  | 'intensives:manage'
  | 'intensives:link-messages'
  | 'org-spaces:manage';

/** Роли, которым разрешено действие. */
const ACTION_ROLES: Record<Action, string[]> = {
  'admin:panel': ['LEAD_SUP', 'SUP'],
  'admin:users': ['LEAD_SUP', 'SUP'],
  'admin:users:edit': ['LEAD_SUP', 'SUP'],
  'admin:users:block': ['LEAD_SUP', 'SUP'],
  'admin:users:reset-password': ['LEAD_SUP', 'SUP'],
  'admin:users:edit-role': ['LEAD_SUP', 'SUP'],
  'admin:users:edit-restrictions': ['LEAD_SUP'],
  'admin:users:notes': ['LEAD_SUP', 'SUP'],
  'admin:users:extend-vol': ['LEAD_SUP', 'SUP'],
  'admin:users:bulk-extend': ['LEAD_SUP', 'SUP'],
  'admin:users:assign-workspace': ['LEAD_SUP', 'SUP'],
  'admin:help': ['LEAD_SUP'],
  'admin:help:upload': ['LEAD_SUP'],
  'admin:settings': ['LEAD_SUP'],
  'admin:security': ['LEAD_SUP'],
  'admin:audit': ['LEAD_SUP', 'SUP'],
  'admin:health': ['LEAD_SUP'],
  'admin:invite': ['LEAD_SUP', 'SUP'],
  'admin:users:create': ['LEAD_SUP', 'SUP'],
  'admin:workspaces:check': ['LEAD_SUP', 'SUP'],
  'admin:workspaces:assign-adm': ['LEAD_SUP', 'SUP'],
  'admin:templates:edit': ['LEAD_SUP'],
  'workspace:archive': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:archive:restore': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:add': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  'workspace:leave': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:confirm-assignment': ['ADM', 'MEMBER'],
  'workspace:users:add': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:users:remove': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:admin:reset-password': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:emoji-import': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:space-settings': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:channels:create': ['LEAD_SUP', 'SUP', 'ADM'],
  'workspace:channels:set-default': ['LEAD_SUP', 'SUP', 'ADM'],
  'messages:create': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  'messages:edit': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  'messages:delete': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  'messages:retry': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  'messages:send-as': ['LEAD_SUP', 'SUP', 'ADM'],
  'templates:official': ['LEAD_SUP', 'SUP', 'ADM'],
  'templates:mine': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  // Создать/изменить/удалить/восстановить официальные шаблоны SUP и ADM
  'templates:official:manage': ['LEAD_SUP'],
  // Список каналов для селекторов (не секретен)
  'templates:channels:view': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  // Добавить/удалить канал в словаре
  'templates:channels:manage': ['LEAD_SUP'],
  'activity:view': ['LEAD_SUP', 'SUP', 'ADM'],
  'dashboard:stats': ['LEAD_SUP', 'SUP', 'ADM'],
  'queue:status': ['LEAD_SUP', 'SUP'],
  // Смотреть опубликованные интенсивы своих OrgSpace (доступ к пространству проверяется отдельно)
  'intensives:view': ['LEAD_SUP', 'SUP', 'ADM', 'MEMBER'],
  // Создать/изменить/опубликовать/отменить/архивировать интенсив, состав плана, пропуск пункта
  'intensives:manage': ['LEAD_SUP'],
  // Инструмент привязки старых сообщений к пунктам плана
  'intensives:link-messages': ['LEAD_SUP'],
  // OrgSpace: создание, привязка подключений
  'org-spaces:manage': ['LEAD_SUP'],
};

/** Ограничения по restrictedFeatures (ключи). */
const ACTION_RESTRICTIONS: Partial<Record<Action, string>> = {
  'admin:panel': 'adminPanel',
  'messages:send-as': 'sendAs',
};

/**
 * Действия раздела «Админ панель → Пользователи». Ограничение adminPanel (restrictedFeatures)
 * скрывает не только ссылку, но и запрещает эти действия через API.
 */
const ADMIN_PANEL_ACTIONS: ReadonlySet<Action> = new Set<Action>([
  'admin:panel',
  'admin:users',
  'admin:users:edit',
  'admin:users:block',
  'admin:users:reset-password',
  'admin:users:edit-role',
  // 'admin:users:edit-restrictions' не включаем: Lead_SUP должен иметь возможность снять ограничение
  'admin:users:notes',
  'admin:users:extend-vol',
  'admin:users:bulk-extend',
  'admin:users:create',
  'admin:invite',
  'admin:audit',
]);

export function canPerformAction(user: CurrentUser, action: Action): boolean {
  if (user.isBlocked) return false;
  const roles = ACTION_ROLES[action];
  if (!roles?.includes(user.role)) return false;
  const restricted = user.restrictedFeatures ?? [];
  const restrictionKey = ACTION_RESTRICTIONS[action];
  if (restrictionKey && restricted.includes(restrictionKey)) return false;
  if (ADMIN_PANEL_ACTIONS.has(action) && restricted.includes('adminPanel')) return false;
  return true;
}

export function requireAction(user: CurrentUser, action: Action): void {
  if (!canPerformAction(user, action)) {
    throw new Error('Forbidden');
  }
}

export function requireAdmin(user: CurrentUser): void {
  if (user.role !== 'LEAD_SUP') throw new Error('Forbidden');
}

// requireSupportOrAdmin / requireSupportAdmOrAdmin удалены: не использовались и не проверяли блокировку.
// Для API используйте guards из lib/api-auth (они отклоняют заблокированных) или requireAction.
