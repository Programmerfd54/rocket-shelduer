import prisma from '@/lib/prisma';
import { RocketChatClient } from '@/lib/rocketchat';
import { RocketChatApiError } from '@/lib/rc-api-error';
import { connectionAad, decryptPassword, encryptAuthToken } from '@/lib/encryption';

/**
 * Автоматическое обновление сессии Rocket.Chat по сохранённому (зашифрованному) паролю.
 *
 * Когда вызов RC вернул 401 для подключения со способом входа «логин/пароль» и без 2FA,
 * пароль расшифровывается, выполняется ОДИН повторный вход, новый токен шифруется и сохраняется,
 * вызов повторяется. Защита от блокировки учётки в LDAP/RC: не чаще одной попытки на подключение
 * за 30 минут (отметка в SystemSetting `rc-relogin:<id>` — общая для реплик, плюс in-memory),
 * никогда — для подключений с 2FA или личным токеном, и если пароль не сохранён.
 * Пароль не логируется и не покидает этот модуль.
 */
export const RC_RELOGIN_COOLDOWN_MS = 30 * 60 * 1000;
const RELOGIN_KEY_PREFIX = 'rc-relogin:';
const MAX_MEMORY_ENTRIES = 5_000;
const memoryAttempts = new Map<string, number>();

export type RefreshedRcSession = { authToken: string; userId_RC: string; workspaceUrl: string };

/** Ответ RC «не авторизован» (токен истёк/отозван). */
export function isRcUnauthorizedError(error: unknown): boolean {
  if (error instanceof RocketChatApiError && error.status === 401) return true;
  if (error && typeof error === 'object' && (error as { status?: unknown }).status === 401) return true;
  const msg = error instanceof Error ? error.message : typeof error === 'string' ? error : '';
  return /\bUnauthorized\b|\b401\b|must be logged in/i.test(msg);
}

function claimInMemory(connectionId: string, now: number): boolean {
  const last = memoryAttempts.get(connectionId);
  if (last !== undefined && now - last < RC_RELOGIN_COOLDOWN_MS) return false;
  memoryAttempts.delete(connectionId);
  memoryAttempts.set(connectionId, now);
  while (memoryAttempts.size > MAX_MEMORY_ENTRIES) {
    const first = memoryAttempts.keys().next();
    if (first.done) break;
    memoryAttempts.delete(first.value);
  }
  return true;
}

/** Атомарно занять «слот» повторного входа (не чаще раза в 30 минут на подключение, общий для реплик). */
async function claimReloginSlot(connectionId: string): Promise<boolean> {
  const now = Date.now();
  if (!claimInMemory(connectionId, now)) return false;
  const key = RELOGIN_KEY_PREFIX + connectionId;
  const value = new Date(now).toISOString();
  try {
    try {
      await prisma.systemSetting.create({ data: { key, value } });
      return true;
    } catch (e) {
      if ((e as { code?: string })?.code !== 'P2002') throw e;
    }
    // Запись уже есть: занимаем, только если прошлая попытка была раньше окна (compare-and-swap по updatedAt)
    const res = await prisma.systemSetting.updateMany({
      where: { key, updatedAt: { lt: new Date(now - RC_RELOGIN_COOLDOWN_MS) } },
      data: { value },
    });
    return res.count === 1;
  } catch {
    // БД недоступна — без повторного входа (безопаснее для учётки)
    return false;
  }
}

/**
 * Один повторный вход по сохранённому паролю. null — подключение не подходит (токен/2FA/нет пароля/архив),
 * лимит исчерпан или вход не удался; тогда вызывающий код ведёт себя как раньше (деактивация и т.п.).
 */
export async function tryRefreshRcSession(connectionId: string): Promise<RefreshedRcSession | null> {
  const conn = await prisma.workspaceConnection
    .findUnique({
      where: { id: connectionId },
      select: {
        id: true,
        userId: true,
        workspaceUrl: true,
        username: true,
        encryptedPassword: true,
        rcAuthMethod: true,
        has2FA: true,
        isArchived: true,
      },
    })
    .catch(() => null);
  if (!conn || conn.isArchived) return null;
  if (conn.rcAuthMethod !== 'password' || conn.has2FA) return null;
  if (!conn.encryptedPassword || !conn.username?.trim()) return null;
  if (!(await claimReloginSlot(conn.id))) return null;

  const aad = connectionAad(conn.userId);
  let password: string;
  try {
    password = decryptPassword(conn.encryptedPassword, aad);
  } catch {
    console.warn(`[rc-session] connection ${conn.id}: stored password is unreadable — reconnect required`);
    return null;
  }
  if (!password) return null;

  try {
    const rc = new RocketChatClient(conn.workspaceUrl);
    const login = await rc.login(conn.username.trim(), password);
    // Сохраняем, только если креды не поменяли параллельно (иначе не затираем новое подключение)
    const updated = await prisma.workspaceConnection.updateMany({
      where: { id: conn.id, encryptedPassword: conn.encryptedPassword, isArchived: false },
      data: {
        authToken: encryptAuthToken(login.authToken, aad),
        userId_RC: login.userId,
        isActive: true,
        lastConnected: new Date(),
      },
    });
    if (updated.count !== 1) return null;
    console.info(`[rc-session] connection ${conn.id}: Rocket.Chat session refreshed automatically`);
    return { authToken: login.authToken, userId_RC: login.userId, workspaceUrl: conn.workspaceUrl };
  } catch (e) {
    const status = e instanceof RocketChatApiError ? ` status=${e.status}` : '';
    console.warn(`[rc-session] connection ${conn.id}: automatic re-login failed${status}`);
    return null;
  }
}

/**
 * Выполнить вызов RC; при 401 — один раз обновить сессию по сохранённому паролю и повторить.
 * Если обновить нельзя — пробрасывает исходную ошибку (поведение как раньше).
 */
export async function withRcSessionRetry<T>(
  conn: { id: string; authToken: string; userId_RC: string },
  call: (authToken: string, rcUserId: string) => Promise<T>
): Promise<T> {
  try {
    return await call(conn.authToken, conn.userId_RC);
  } catch (error) {
    if (!isRcUnauthorizedError(error)) throw error;
    const refreshed = await tryRefreshRcSession(conn.id);
    if (!refreshed) throw error;
    conn.authToken = refreshed.authToken;
    conn.userId_RC = refreshed.userId_RC;
    return call(refreshed.authToken, refreshed.userId_RC);
  }
}
