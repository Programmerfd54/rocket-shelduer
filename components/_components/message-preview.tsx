"use client"

import { Card, CardContent } from '@/components/ui/card'
import { sanitizeMessageHtml } from '@/lib/sanitize'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Hash } from 'lucide-react'
import { useEffect, useRef } from 'react'
import { parseRocketChatMarkdown } from '@/lib/rc-markdown'

interface MessagePreviewProps {
  message: string
  username: string
  channelName: string
  workspaceName?: string
  workspaceId?: string
  workspaceUrl?: string
  /** Список эмодзи воркспейса — для картинок кастомных эмодзи в предпросмотре */
  emojis?: Array<{ name: string; aliases?: string[]; _id?: string; extension?: string; _updatedAt?: string }>
}

export default function MessagePreview({ 
  message, 
  username, 
  channelName,
  workspaceName,
  workspaceId,
  workspaceUrl,
  emojis,
}: MessagePreviewProps) {
  const bodyRef = useRef<HTMLDivElement>(null)

  // Если картинка кастомного эмодзи не загрузилась — показываем :shortcode: текстом.
  // (inline onerror санитайзер вырезает, поэтому слушаем событие на контейнере; error не всплывает — ловим в capture-фазе)
  useEffect(() => {
    const root = bodyRef.current
    if (!root) return
    const onError = (e: Event) => {
      const t = e.target
      if (t instanceof HTMLImageElement && t.classList.contains('rc-custom-emoji')) {
        const span = document.createElement('span')
        span.className = 'text-sm text-muted-foreground'
        span.textContent = t.alt
        t.replaceWith(span)
      }
    }
    root.addEventListener('error', onError, true)
    return () => root.removeEventListener('error', onError, true)
  }, [message])

  if (!message.trim()) return null

  const parsedMessage = sanitizeMessageHtml(parseRocketChatMarkdown(message, workspaceId, emojis))
  const userInitials = username.charAt(0).toUpperCase()

  return (
    <Card className="rounded-lg border bg-muted/50 shadow-none overflow-hidden">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Header */}
          <div className="flex items-center gap-2 text-sm">
            <div className="flex items-center gap-2 text-muted-foreground">
              <Hash className="w-4 h-4 shrink-0" />
              <span className="font-medium text-foreground">{channelName}</span>
            </div>
            {workspaceName && (
              <>
                <span className="text-border">•</span>
                <span className="text-muted-foreground text-xs">{workspaceName}</span>
              </>
            )}
          </div>

          {/* Message bubble */}
          <div className="flex items-start gap-3">
            <Avatar className="h-8 w-8 rounded-md shrink-0">
              <AvatarFallback className="rounded-md bg-primary text-primary-foreground text-xs font-semibold">
                {userInitials}
              </AvatarFallback>
            </Avatar>
            
            <div className="flex-1 min-w-0 space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm">{username}</span>
                <span className="text-xs text-muted-foreground">
                  {new Date().toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
              
              <div 
                ref={bodyRef}
                className="text-sm text-foreground break-words [&_strong]:font-semibold [&_em]:italic [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted/80 [&_pre]:p-3 [&_pre]:rounded-md [&_pre]:overflow-x-auto [&_pre]:max-w-full [&_pre]:my-2 [&_pre]:border [&_pre]:border-border/60 [&_del]:line-through [&_a]:text-primary [&_a]:hover:underline [&_img]:inline-block [&_img]:w-5 [&_img]:h-5 [&_img]:align-middle [&_span]:inline-flex [&_span]:items-center [&_span]:gap-1"
                dangerouslySetInnerHTML={{ __html: parsedMessage }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
