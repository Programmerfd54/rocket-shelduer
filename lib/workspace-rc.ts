import prisma from '@/lib/prisma';

const normalizeUrl = (u: string) => (u || '').trim().replace(/\/+$/, '').toLowerCase();

/**
 * Возвращает подключение для вызовов RC API.
 * Если пользователь открывает назначенное пространство (A) и у него есть своё подключение (B) к тому же URL,
 * используем B (чтобы не просить креды и не дублировать пространства в списке).
 */
export async function getEffectiveConnectionForRc(
  userId: string,
  workspaceId: string
): Promise<{
  id: string;
  workspaceUrl: string;
  authToken: string;
  userId_RC: string;
  userId: string;
} | null> {
  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, workspaceUrl: true, authToken: true, userId_RC: true, userId: true },
  });
  if (!workspace?.authToken || !workspace.userId_RC) return null;

  const toConnection = (w: typeof workspace) => ({
    id: w.id,
    userId: w.userId,
    workspaceUrl: w.workspaceUrl,
    authToken: w.authToken!,
    userId_RC: w.userId_RC!,
  });

  // Своё подключение — используем как есть
  if (workspace.userId === userId) {
    return toConnection(workspace);
  }

  // Назначенное: есть ли у пользователя своё подключение к тому же URL? (сравниваем по нормализованному URL)
  const norm = normalizeUrl(workspace.workspaceUrl);
  const ownList = await prisma.workspaceConnection.findMany({
    where: { userId },
    select: { id: true, workspaceUrl: true, authToken: true, userId_RC: true, userId: true },
  });
  const own = ownList.find((c) => normalizeUrl(c.workspaceUrl) === norm && c.authToken && c.userId_RC);
  if (own) {
    return toConnection(own);
  }

  // Назначенный без своего подключения: не используем креды владельца (RC вернёт 401), чтобы фронт показал форму «Подключиться»
  return null;
}
