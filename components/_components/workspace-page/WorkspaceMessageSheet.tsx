"use client"

import { useEffect, useState } from 'react'

import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet'
import { MessageDetailPanel } from '@/components/dashboard/MessageDetailPanel'
import type { QueueMessage } from '@/components/dashboard/types'
import type { ActionViewer } from '@/lib/message-actions'

/**
 * Детали существующего сообщения (для «Открыть сообщение» / «Посмотреть отправку» / «Открыть ошибку»):
 * та же панель, что на дашборде. Данные из списка пространства показываются сразу, свежие подгружаются панелью.
 * Изменение — через существующий MessageDialog, повтор — через существующий роут retry (их передаёт страница).
 */
export function WorkspaceMessageSheet({
  messageId,
  fallback,
  messages,
  viewer,
  busy,
  onClose,
  onEdit,
  onRetry,
  onDelete,
}: {
  messageId: string | null
  /** Известные поля отправки (если сообщения нет в списке пространства — например, другое подключение) */
  fallback?: Partial<QueueMessage> | null
  messages: QueueMessage[]
  viewer: ActionViewer | null
  busy: boolean
  onClose: () => void
  onEdit: (message: QueueMessage) => void
  onRetry: (message: QueueMessage) => void
  onDelete: (message: QueueMessage) => void
}) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    if (!messageId) return
    const t = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(t)
  }, [messageId])

  if (!messageId) return null
  const fromList = messages.find((m) => m.id === messageId)
  const message: QueueMessage = fromList ?? {
    id: messageId,
    status: fallback?.status ?? '',
    scheduledFor: fallback?.scheduledFor ?? '',
    ...fallback,
  }

  return (
    <Sheet
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-full gap-0 p-0 sm:max-w-md">
        <SheetTitle className="sr-only">Детали сообщения</SheetTitle>
        <SheetDescription className="sr-only">Время, статус, текст и действия с сообщением.</SheetDescription>
        <MessageDetailPanel
          key={message.id}
          layout="sheet"
          message={message}
          inList
          viewer={viewer}
          now={now}
          busy={busy}
          justSaved={false}
          onClose={onClose}
          onEdit={onEdit}
          onRetry={onRetry}
          onDelete={onDelete}
        />
      </SheetContent>
    </Sheet>
  )
}
