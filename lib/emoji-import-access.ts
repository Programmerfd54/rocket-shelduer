import prisma from '@/lib/prisma';
import { RocketChatClient } from '@/lib/rocketchat';

export async function resolveWorkspaceForEmojiImport(userId: string, workspaceId: string) {
  let workspace = await prisma.workspaceConnection.findFirst({
    where: { id: workspaceId, userId },
  });
  if (!workspace) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { workspaceId, userId },
    });
    if (assignment) {
      workspace = await prisma.workspaceConnection.findUnique({ where: { id: workspaceId } });
    }
  }
  return workspace;
}

export async function loginRcEmojiAdmin(
  workspaceUrl: string,
  adminUsername: string,
  adminPassword: string
): Promise<
  | { ok: true; authToken: string; userId: string; rc: RocketChatClient }
  | { ok: false; error: string; code?: string; details?: string }
> {
  const rc = new RocketChatClient(workspaceUrl);
  try {
    const loginResult = await rc.login(adminUsername, adminPassword);
    return { ok: true, authToken: loginResult.authToken, userId: loginResult.userId, rc };
  } catch (loginError: unknown) {
    const message = loginError instanceof Error ? loginError.message : 'Login failed';
    return {
      ok: false,
      code: 'RC_LOGIN_FAILED',
      error:
        'Не удалось войти с указанными учётными данными. Проверьте логин и пароль администратора для этого сервера Rocket.Chat.',
      details: message,
    };
  }
}
