import prisma from '@/lib/prisma';
import { connectionAad, decryptAuthToken } from '@/lib/encryption';
import { tryRefreshRcSession } from '@/lib/rc-session-refresh';

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

type ConnRow = {
  id: string;
  workspaceUrl: string;
  authToken: string | null;
  userId_RC: string | null;
  userId: string;
  username: string;
  isActive: boolean;
  isArchived: boolean;
};

const CONN_SELECT = {
  id: true,
  workspaceUrl: true,
  authToken: true,
  userId_RC: true,
  userId: true,
  username: true,
  isActive: true,
  isArchived: true,
} as const;

/**
 * Токен подключения. Если сессия заведомо мертва (подключение деактивировано после 401 или токен
 * не читается) — одна попытка обновить её по сохранённому паролю (lib/rc-session-refresh: только
 * логин/пароль без 2FA, не чаще раза в 30 минут). Иначе — как раньше.
 */
async function resolveConnectionToken(row: ConnRow): Promise<string | null> {
  let token = row.authToken ? decryptAuthToken(row.authToken, connectionAad(row.userId)) : null;
  if (!row.isArchived && (!token || !row.isActive)) {
    const refreshed = await tryRefreshRcSession(row.id);
    if (refreshed) {
      token = refreshed.authToken;
      row.userId_RC = refreshed.userId_RC;
      row.isActive = true;
    }
  }
  return token;
}

/**
 * Возвращает подключение для вызовов RC API.
 * authToken расшифровывается при чтении (хранится зашифрованным, привязан к владельцу подключения).
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
  const workspace: ConnRow | null = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: CONN_SELECT,
  });
  if (!workspace) return null;
  // Сессию обновляем только для своего подключения (у чужого — креды владельца, их не трогаем)
  const decrypted =
    workspace.userId === userId
      ? await resolveConnectionToken(workspace)
      : workspace.authToken
        ? decryptAuthToken(workspace.authToken, connectionAad(workspace.userId))
        : null;
  if (!decrypted || !workspace.userId_RC) return null;

  const toConnection = (w: ConnRow, token: string) => ({
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
    select: CONN_SELECT,
  });
  const own = ownList.find(
    (c) =>
      sameRcInstanceUrl(c.workspaceUrl, workspace.workspaceUrl) && c.authToken && c.userId_RC
  );
  if (own) {
    const ownDecrypted = await resolveConnectionToken(own);
    if (ownDecrypted && own.userId_RC) return toConnection(own, ownDecrypted);
  }

  // Назначенный без своего подключения: не используем креды владельца (RC вернёт 401), чтобы фронт показал форму «Подключиться»
  return null;
}
