import type { RocketChatClient } from '@/lib/rocketchat';
import type { UserAssignments } from '@/lib/workspace-user-assignments';
import { getSafeErrorMessage } from '@/lib/security';

type AssignmentClient = Pick<RocketChatClient, 'inviteUserToRoom' | 'addUserToRole'>;

export async function applyUserAssignments(
  client: AssignmentClient,
  authToken: string,
  adminId: string,
  userId: string,
  username: string,
  assignments: UserAssignments,
) {
  const pending: UserAssignments = { channels: [], roleIds: [] };
  const errors: string[] = [];
  const attempt = async (action: () => Promise<{ success: boolean; error?: string }>) => {
    try {
      return await action();
    } catch (error) {
      // Исключения здесь — сетевые/внутренние ошибки (ответы RC приходят как { success: false, error }): без деталей в production
      return { success: false, error: getSafeErrorMessage(error, 'Ошибка соединения с Rocket.Chat') };
    }
  };
  for (const channel of assignments.channels) {
    const result = await attempt(() => client.inviteUserToRoom(authToken, adminId, channel.id, channel.type, userId));
    if (!result.success) {
      pending.channels.push(channel);
      errors.push(`Канал ${channel.name || channel.id}: ${result.error || 'не удалось добавить пользователя'}`);
    }
  }
  for (const roleId of assignments.roleIds) {
    const result = await attempt(() => client.addUserToRole(authToken, adminId, roleId, username));
    if (!result.success) {
      pending.roleIds.push(roleId);
      errors.push(`Роль ${roleId}: ${result.error || 'не удалось назначить роль'}`);
    }
  }
  return { pending, errors };
}
