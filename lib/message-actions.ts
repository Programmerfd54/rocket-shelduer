/**
 * Какие действия показывать для сообщения. Правила повторяют существующие:
 *  - по статусу — как в CompactMessage: изменить = PENDING/SENT, удалить = всё, кроме SENT, повторить = FAILED;
 *  - по правам — как проверяет сервер (PATCH/DELETE: только автор `userId`; retry: автор или SUP).
 * Это лишь скрывает кнопки, которые сервер всё равно отклонил бы; сами проверки остаются на сервере.
 */
export interface ActionMessageLike {
  status: string
  user?: { id?: string | null } | null
}

export interface ActionViewer {
  id?: string | null
  role?: string | null
}

export interface MessageActions {
  canEdit: boolean
  canDelete: boolean
  canRetry: boolean
  /** Автор неизвестен или не совпадает с текущим пользователем (и он не SUP) */
  notOwner: boolean
}

export function getMessageActions(message: ActionMessageLike, viewer: ActionViewer | null | undefined): MessageActions {
  const authorId = message.user?.id ?? null
  const viewerId = viewer?.id ?? null
  // Если автор или текущий пользователь неизвестен — решает сервер, кнопки не прячем
  const isOwner = !authorId || !viewerId ? true : authorId === viewerId
  const canRetryByRole = isOwner || viewer?.role === 'SUP'
  return {
    canEdit: (message.status === 'PENDING' || message.status === 'SENT') && isOwner,
    canDelete: message.status !== 'SENT' && isOwner,
    canRetry: message.status === 'FAILED' && canRetryByRole,
    notOwner: !isOwner,
  }
}
