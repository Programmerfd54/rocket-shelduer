export interface QueueUser {
  id?: string
  name?: string | null
  email?: string | null
  username?: string | null
  role?: string
  avatarUrl?: string | null
}

/** Сообщение так, как его отдаёт GET /api/messages (только используемые поля). */
export interface QueueMessage {
  id: string
  status: string
  channelId?: string | null
  channelName?: string | null
  message?: string
  scheduledFor: string
  sentAt?: string | null
  error?: string | null
  messageId_RC?: string | null
  workspaceId?: string
  createdAt?: string
  updatedAt?: string
  workspace?: { id?: string; workspaceName?: string; workspaceUrl?: string; username?: string } | null
  user?: QueueUser | null
  scheduledBy?: QueueUser | null
}

export type ExternalStatus = 'SYNCHRONIZED' | 'EDITED_IN_RC' | 'DELETED_IN_RC' | 'UNKNOWN'

export function userLabel(u: QueueUser | null | undefined): string {
  return (u?.name || u?.username || u?.email || '').trim()
}

export function channelLabel(m: Pick<QueueMessage, 'channelName'>): string {
  const name = String(m.channelName ?? '').replace(/^#/, '').trim()
  return name ? `#${name}` : 'Канал не указан'
}
