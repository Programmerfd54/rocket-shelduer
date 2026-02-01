"use client"

import { Card, CardContent } from '@/components/ui/card'
import { Avatar, AvatarFallback } from '@/components/ui/avatar'
import { Hash } from 'lucide-react'
import { cn } from '@/lib/utils'

interface MessagePreviewProps {
  message: string
  username: string
  channelName: string
  workspaceName?: string
  workspaceId?: string
  workspaceUrl?: string
  /** Список эмодзи воркспейса — для подстановки _id в URL картинки (Rocket.Chat отдаёт по id) */
  emojis?: Array<{ name: string; _id?: string; extension?: string }>
}

// Парсер markdown для Rocket.Chat форматирования
const parseRocketChatMarkdown = (
  text: string,
  workspaceId?: string,
  emojis?: Array<{ name: string; _id?: string; extension?: string }>
) => {
  const emojiByName = emojis ? new Map(emojis.map((e) => [e.name, e])) : null
  let html = text
  
  // Эмодзи Rocket.Chat: :emoji_name:
  // Для стандартных alias'ов — unicode; для кастомных — картинка через прокси (видно в предпросмотре)
  const aliasToUnicode: Record<string, string> = {
    smile: '😊',
    slightly_smiling_face: '🙂',
    wink: '😉',
    heart: '❤️',
    thumbsup: '👍',
    thumbsdown: '👎',
    fire: '🔥',
    rocket: '🚀',
    tada: '🎉',
    cat_typing: '🐱',
    gandalf: '🧙',
    heart_eyes: '😍',
    laughing: '😆',
    thinking: '🤔',
    clap: '👏',
    ok_hand: '👌',
    wave: '👋',
    raised_hands: '🙌',
    pray: '🙏',
  }

  html = html.replace(/:([a-zA-Z0-9_+-]+):/g, (match, emojiName) => {
    const unicode = aliasToUnicode[emojiName]

    if (unicode) {
      return `<span class="inline-flex items-center gap-1"><span class="inline-block align-middle text-lg">${unicode}</span></span>`
    }

    // Кастомный эмодзи: картинка через наш прокси. При ошибке загрузки показываем короткое имя
    if (workspaceId) {
      const meta = emojiByName?.get(emojiName)
      const ext = meta?.extension || 'png'
      const params = new URLSearchParams()
      params.set('name', emojiName)
      params.set('ext', ext)
      if (meta?._id) params.set('id', meta._id)
      params.set('v', '2')
      const imgUrl = `/api/workspace/${workspaceId}/emoji-image?${params.toString()}`
      const shortcode = `:${emojiName}:`
      return `<span class="inline-flex items-center"><img src="${imgUrl}" alt="${shortcode}" title="${shortcode}" class="inline-block w-5 h-5 align-middle object-contain rounded bg-muted/50" referrerpolicy="no-referrer" decoding="async" onerror="this.style.display='none';var s=document.createElement('span');s.className='text-sm text-muted-foreground';s.textContent=this.alt;this.parentNode.appendChild(s);" /></span>`
    }

    return match
  })
  
  // Mentions: @username или @all
  html = html.replace(/@(\w+)/g, '<span class="text-primary font-medium">@$1</span>')
  
  // Code blocks: ```code```
  html = html.replace(/```([\s\S]*?)```/g, (match, code) => {
    return `<pre class="bg-muted p-3 rounded-lg overflow-x-auto my-2"><code class="text-sm font-mono">${code.trim()}</code></pre>`
  })
  
  // Inline code: `code` (должен быть после code blocks)
  html = html.replace(/`([^`\n]+)`/g, '<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">$1</code>')
  
  // Strikethrough: ~~text~~
  html = html.replace(/~~(.+?)~~/g, '<del class="line-through">$1</del>')
  
  // Bold: **text** (должен быть после code, чтобы не конфликтовать)
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
  
  // Italic: *text* (но не **text** и не в code)
  html = html.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em class="italic">$1</em>')
  
  // Links: [text](url)
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">$1</a>')
  
  // Line breaks
  html = html.replace(/\n/g, '<br />')
  
  return html
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
  if (!message.trim()) return null

  const parsedMessage = parseRocketChatMarkdown(message, workspaceId, emojis)
  const userInitials = username.charAt(0).toUpperCase()

  return (
    <Card className="rounded-xl border-border/80 bg-muted/30 shadow-sm overflow-hidden">
      <CardContent className="p-5">
        <div className="space-y-4">
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
            <Avatar className="h-9 w-9 rounded-lg shrink-0">
              <AvatarFallback className="rounded-lg bg-primary text-primary-foreground text-xs font-semibold">
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
                className="text-sm text-foreground break-words [&_strong]:font-semibold [&_em]:italic [&_code]:bg-muted/80 [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-xs [&_code]:font-mono [&_pre]:bg-muted/80 [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre]:border [&_pre]:border-border/60 [&_del]:line-through [&_a]:text-primary [&_a]:hover:underline [&_img]:inline-block [&_img]:w-5 [&_img]:h-5 [&_img]:align-middle [&_span]:inline-flex [&_span]:items-center [&_span]:gap-1"
                dangerouslySetInnerHTML={{ __html: parsedMessage }}
              />
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
