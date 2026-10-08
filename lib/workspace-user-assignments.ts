import { z } from 'zod';
import { rcAdminCredentialsBaseSchema, validateRcAdminCredentials } from '@/lib/rc-admin-credentials';

const identifier = z.string().trim().min(1).max(256);
const channelSchema = z.object({
  id: identifier,
  type: z.enum(['c', 'p']),
  name: z.string().max(256).optional(),
});

export const userAssignmentsSchema = z.object({
  channels: z.array(channelSchema).max(100).default([]),
  roleIds: z.array(identifier).max(50).default([]),
}).transform(({ channels, roleIds }) => ({
  channels: [...new Map(channels.map(channel => [channel.id, channel])).values()],
  roleIds: [...new Set(roleIds)],
}));

export type UserAssignments = z.infer<typeof userAssignmentsSchema>;
export type UserChannel = UserAssignments['channels'][number];

const loginSchema = z.string().trim().transform(value => value.replace(/^@/, ''))
  .pipe(z.string().min(1).max(128));

export const userImportRequestSchema = rcAdminCredentialsBaseSchema.extend({
  users: z.array(z.object({
    login: loginSchema,
    channels: z.array(channelSchema).max(100).optional(),
    roleIds: z.array(identifier).max(50).optional(),
  })).min(1).max(100).optional(),
  logins: z.union([z.array(z.string()).max(100), z.string().max(20000)]).optional(),
  channels: z.array(channelSchema).max(100).optional(),
  roleIds: z.array(identifier).max(50).optional(),
  // Accept requests from the previous UI during a rolling deployment.
  channelId: identifier.optional(),
  channelType: z.enum(['c', 'p']).optional(),
  roleId: identifier.optional(),
  ifUserExists: z.enum(['skip', 'reset_password']).default('skip'),
}).superRefine((value, context) => {
  validateRcAdminCredentials(value, context);
  if (value.channelId && !value.channelType) {
    context.addIssue({ code: 'custom', message: 'Укажите тип канала.', path: ['channelType'] });
  }
});

export type UserImportRequest = z.infer<typeof userImportRequestSchema>;

export function getDefaultAssignments(body: UserImportRequest): UserAssignments {
  return userAssignmentsSchema.parse({
    channels: body.channels ?? (body.channelId && body.channelType
      ? [{ id: body.channelId, type: body.channelType }] : []),
    roleIds: body.roleIds ?? (body.roleId ? [body.roleId] : []),
  });
}

export function getImportUsers(body: UserImportRequest) {
  const defaults = getDefaultAssignments(body);
  const raw = body.users ?? (typeof body.logins === 'string'
    ? body.logins.split(/[\n,;]+/).map(value => value.trim()).filter(Boolean)
    : body.logins ?? []).map(login => ({ login }));
  const entries = z.array(z.object({
    login: loginSchema,
    channels: z.array(channelSchema).optional(),
    roleIds: z.array(identifier).optional(),
  })).min(1, 'Введите хотя бы один логин.').max(100, 'Максимум 100 пользователей за запрос.').parse(raw);
  const seen = new Set<string>();
  return entries.map(entry => {
    const key = entry.login.toLowerCase();
    if (seen.has(key)) throw new Error(`Логин повторяется в списке: ${entry.login}`);
    seen.add(key);
    return {
      login: entry.login,
      assignments: userAssignmentsSchema.parse({
        channels: entry.channels ?? defaults.channels,
        roleIds: entry.roleIds ?? defaults.roleIds,
      }),
    };
  });
}

export function resolveUserAssignments(defaults: UserAssignments, override?: Partial<UserAssignments>): UserAssignments {
  return {
    channels: override?.channels ?? defaults.channels,
    roleIds: override?.roleIds ?? defaults.roleIds,
  };
}
