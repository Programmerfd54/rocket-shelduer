import prisma from '@/lib/prisma';
import { decryptAuthToken } from '@/lib/encryption';

const normalizeUrl = (u: string) => (u || '').trim().replace(/\/+$/, '').toLowerCase();

/**
 * Возвращает подключение для вызовов RC API.
 * authToken расшифровывается при чтении (хранится зашифрованным).
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
  rcUsername: string;
} | null> {
  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, workspaceUrl: true, authToken: true, userId_RC: true, userId: true, username: true },
  });
  const decrypted = workspace?.authToken ? decryptAuthToken(workspace.authToken) : null;
  if (!decrypted || !workspace?.userId_RC) return null;

  const toConnection = (w: typeof workspace, token: string) => ({
    id: w.id,
    userId: w.userId,
    workspaceUrl: w.workspaceUrl,
    authToken: token,
    userId_RC: w.userId_RC!,
    rcUsername: w.username || '',
  });

  // Своё подключение — используем как есть
  if (workspace.userId === userId) {
    return toConnection(workspace, decrypted);
  }

  // Назначенное: есть ли у пользователя своё подключение к тому же URL?
  const norm = normalizeUrl(workspace.workspaceUrl);
  const ownList = await prisma.workspaceConnection.findMany({
    where: { userId },
    select: { id: true, workspaceUrl: true, authToken: true, userId_RC: true, userId: true, username: true },
  });
  const own = ownList.find((c) => normalizeUrl(c.workspaceUrl) === norm && c.authToken && c.userId_RC);
  if (own) {
    const ownDecrypted = decryptAuthToken(own.authToken);
    if (ownDecrypted) return toConnection(own, ownDecrypted);
  }

  // Назначенный без своего подключения: не используем креды владельца (RC вернёт 401), чтобы фронт показал форму «Подключиться»
  return null;
}
