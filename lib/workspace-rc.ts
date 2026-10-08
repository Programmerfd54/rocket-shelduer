import prisma from '@/lib/prisma';
import { decryptAuthToken } from '@/lib/encryption';

const normalizeUrl = (u: string) => (u || '').trim().replace(/\/+$/, '').toLowerCase();

/** host:port для одного инстанса RC (учёт http/https и порта по умолчанию). */
function hostPortKey(raw: string): string | null {
  const u = (raw || '').trim();
  if (!u) return null;
  try {
    const href = /^https?:\/\//i.test(u) ? u : `https://${u}`;
    const url = new URL(href);
    const port =
      url.port ||
      (url.protocol === 'https:' ? '443' : url.protocol === 'http:' ? '80' : '');
    return `${url.hostname.toLowerCase()}:${port}`;
  } catch {
    return null;
  }
}

/**
 * Один и тот же сервер Rocket.Chat: совпадает строка после trim/slash или тот же host:port.
 * Нужно для многопользовательских пространств: после правки URL у владельца (протокол, слэш, порт)
 * назначенный пользователь всё ещё находит «своё» подключение к тому же инстансу.
 */
export function sameRcInstanceUrl(a: string, b: string): boolean {
  if (normalizeUrl(a) === normalizeUrl(b)) return true;
  const ka = hostPortKey(a);
  const kb = hostPortKey(b);
  return ka != null && kb != null && ka === kb;
}

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

  // Назначенное: есть ли у пользователя своё подключение к тому же инстансу RC?
  const ownList = await prisma.workspaceConnection.findMany({
    where: { userId },
    select: { id: true, workspaceUrl: true, authToken: true, userId_RC: true, userId: true, username: true },
  });
  const own = ownList.find(
    (c) =>
      sameRcInstanceUrl(c.workspaceUrl, workspace.workspaceUrl) && c.authToken && c.userId_RC
  );
  if (own) {
    const ownDecrypted = decryptAuthToken(own.authToken);
    if (ownDecrypted) return toConnection(own, ownDecrypted);
  }

  // Назначенный без своего подключения: не используем креды владельца (RC вернёт 401), чтобы фронт показал форму «Подключиться»
  return null;
}
