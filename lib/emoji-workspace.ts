import prisma from '@/lib/prisma'
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc'

export interface EmojiWorkspaceAccess {
  /** id подключения (WorkspaceConnection), к которому у пользователя есть доступ */
  workspaceId: string
  workspaceUrl: string
  /** Учётные данные RC, если у пользователя есть действующее подключение (своё или к тому же инстансу). */
  auth: { authToken: string; userId_RC: string } | null
}

const looksLikeUrl = (raw: string) =>
  /^https?:\//i.test(raw) || raw.includes('://') || /^[a-z0-9.-]+\.(ru|com|org)/i.test(raw)

/**
 * Единая логика доступа к воркспейсу для маршрутов эмодзи.
 * - принимает id подключения или (для старых закладок) URL воркспейса;
 * - доступ: своё подключение ИЛИ назначение администратором (WorkspaceAdminAssignment);
 * - креды RC берутся через getEffectiveConnectionForRc (для назначенных — их собственное подключение
 *   к тому же инстансу RC; креды владельца не используются).
 * Возвращает null, если воркспейс не найден или нет доступа.
 */
export async function resolveEmojiWorkspace(
  userId: string,
  rawId: string
): Promise<EmojiWorkspaceAccess | null> {
  let workspaceId = rawId

  if (looksLikeUrl(rawId)) {
    const stripped = rawId.replace(/^https?:\/+/i, '').replace(/\/+$/, '')
    const candidates = Array.from(
      new Set([rawId, `https://${stripped}`, `https://${stripped}/`, `http://${stripped}`, `http://${stripped}/`])
    )
    const byUrl = await prisma.workspaceConnection.findFirst({
      where: { userId, workspaceUrl: { in: candidates } },
      select: { id: true },
    })
    if (!byUrl) return null
    workspaceId = byUrl.id
  }

  let workspace = await prisma.workspaceConnection.findFirst({
    where: { id: workspaceId, userId },
    select: { id: true, workspaceUrl: true },
  })
  if (!workspace) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { workspaceId, userId },
      select: { id: true },
    })
    if (assignment) {
      workspace = await prisma.workspaceConnection.findUnique({
        where: { id: workspaceId },
        select: { id: true, workspaceUrl: true },
      })
    }
  }
  if (!workspace?.workspaceUrl) return null

  const effective = await getEffectiveConnectionForRc(userId, workspaceId)
  return {
    workspaceId: workspace.id,
    workspaceUrl: effective?.workspaceUrl || workspace.workspaceUrl,
    auth:
      effective?.authToken && effective.userId_RC
        ? { authToken: effective.authToken, userId_RC: effective.userId_RC }
        : null,
  }
}
