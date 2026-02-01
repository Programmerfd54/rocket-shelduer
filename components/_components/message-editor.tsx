"use client"

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { 
  Bold, 
  Italic, 
  Strikethrough, 
  Code, 
  Link as LinkIcon,
  Smile,
  Type
} from 'lucide-react'
import { cn } from '@/lib/utils'

interface MessageEditorProps {
  value: string
  onChange: (value: string) => void
  placeholder?: string
  maxLength?: number
  emojis?: Array<{ 
    name: string
    aliases?: string[]
    extension?: string
    _id?: string
  }>
  workspaceId?: string
  workspaceUrl?: string
  onEmojiSelect?: (emoji: string) => void
}

export default function MessageEditor({
  value,
  onChange,
  placeholder = "Введите текст сообщения...",
  maxLength = 4000,
  emojis = [],
  workspaceId,
  workspaceUrl,
  onEmojiSelect,
}: MessageEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [showEmojiPicker, setShowEmojiPicker] = useState(false)
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number } | null>(null)

  // Сохраняем выделение при изменении
  useEffect(() => {
    if (textareaRef.current && selectedRange) {
      textareaRef.current.setSelectionRange(selectedRange.start, selectedRange.end)
      textareaRef.current.focus()
    }
  }, [selectedRange])

  const insertText = (before: string, after: string = '') => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    const newText = value.substring(0, start) + before + selectedText + after + value.substring(end)
    
    if (newText.length <= maxLength) {
      onChange(newText)
      // Восстанавливаем позицию курсора
      setTimeout(() => {
        const newCursorPos = start + before.length + selectedText.length + after.length
        setSelectedRange({ start: newCursorPos, end: newCursorPos })
      }, 0)
    }
  }

  const formatBold = () => insertText('**', '**')
  const formatItalic = () => insertText('*', '*')
  const formatStrikethrough = () => insertText('~~', '~~')
  const formatInlineCode = () => insertText('`', '`')
  const formatCodeBlock = () => {
    const textarea = textareaRef.current
    if (!textarea) return
    
    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    const codeBlock = selectedText ? `\`\`\`\n${selectedText}\n\`\`\`` : '```\n\n```'
    const newText = value.substring(0, start) + codeBlock + value.substring(end)
    
    if (newText.length <= maxLength) {
      onChange(newText)
      setTimeout(() => {
        const newCursorPos = selectedText 
          ? start + codeBlock.length 
          : start + 4 // После открывающего ```
        setSelectedRange({ start: newCursorPos, end: newCursorPos })
      }, 0)
    }
  }

  const formatLink = () => {
    const textarea = textareaRef.current
    if (!textarea) return

    const start = textarea.selectionStart
    const end = textarea.selectionEnd
    const selectedText = value.substring(start, end)
    
    if (selectedText) {
      // Если текст выделен, оборачиваем в ссылку
      insertText('[', `](url)`)
    } else {
      // Если ничего не выделено, вставляем шаблон
      insertText('[текст ссылки](', ')')
    }
  }

  const insertEmoji = (emojiName: string) => {
    const emoji = `:${emojiName}:`
    insertText(emoji, '')
    setShowEmojiPicker(false)
    if (onEmojiSelect) {
      onEmojiSelect(emoji)
    }
  }

  // URL изображения эмодзи через наш API-прокси (избегаем CORS). v=2 — сброс кэша после фикса SVG→PNG
  const getEmojiImageUrl = (emojiName: string, extension: string = 'png', emojiId?: string) => {
    if (!workspaceId) return null
    const params = new URLSearchParams()
    params.set('name', emojiName)
    params.set('ext', extension)
    if (emojiId) params.set('id', emojiId)
    params.set('v', '2')
    return `/api/workspace/${workspaceId}/emoji-image?${params.toString()}`
  }

  // Стандартные популярные эмодзи (всегда доступны для выбора по alias)
  // Здесь только небольшой набор самых частых, чтобы список был компактным и понятным
  const standardEmojiNames = [
    'smile',
    'slightly_smiling_face',
    'wink',
    'heart',
    'thumbsup',
    'thumbsdown',
    'fire',
    'rocket',
    'tada',
    'cat_typing',
    'gandalf',
    'heart_eyes',
    'laughing',
    'thinking',
    'clap',
    'ok_hand',
    'wave',
    'raised_hands',
    'pray',
  ]

  // Разделяем на часто используемые (первые 20 загруженных кастомных) и остальные
  const frequentlyUsed = emojis.slice(0, 20)
  const otherEmojis = emojis.slice(20)

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 rounded-xl border border-border/80 bg-muted/30">
        {/* Emoji Picker */}
        <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
            >
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-96 p-3" align="start">
            <div className="space-y-3 max-h-80 overflow-y-auto">
              {/* Часто используемые */}
              {frequentlyUsed.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 px-1">Часто используемые</p>
                  <div className="grid grid-cols-10 gap-1">
                    {frequentlyUsed.map((emoji: any, index: number) => {
                      const imageUrl = getEmojiImageUrl(emoji.name, emoji.extension || 'png', emoji._id)
                      const shortcode = `:${emoji.name}:`
                      return (
                        <button
                          key={`${emoji._id || emoji.name}-${index}`}
                          type="button"
                          onClick={() => insertEmoji(emoji.name)}
                          className="aspect-square p-1.5 hover:bg-muted rounded transition-colors flex flex-col items-center justify-center gap-0.5 group relative bg-muted/50"
                          title={shortcode}
                        >
                          {imageUrl ? (
                            <>
                              <img
                                src={imageUrl}
                                alt={shortcode}
                                className="w-6 h-6 object-contain shrink-0 rounded-sm bg-background/80"
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  const parent = target.parentElement
                                  if (parent) {
                                    target.style.display = 'none'
                                    let fallback = parent.querySelector('.emoji-shortcode-fallback')
                                    if (!fallback) {
                                      fallback = document.createElement('span')
                                      fallback.className = 'emoji-shortcode-fallback text-[10px] text-muted-foreground group-hover:text-foreground break-all text-center leading-tight px-0.5'
                                      fallback.textContent = shortcode
                                      parent.appendChild(fallback)
                                    }
                                  }
                                }}
                              />
                              <span className="emoji-shortcode-fallback text-[9px] text-muted-foreground truncate w-full text-center opacity-70" title={shortcode}>
                                :{emoji.name}:
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground break-all text-center leading-tight px-0.5">
                              {shortcode}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Остальные эмодзи */}
              {otherEmojis.length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 px-1 mt-3">
                    Все эмодзи
                  </p>
                  <div className="grid grid-cols-10 gap-1">
                    {otherEmojis.map((emoji: any, index: number) => {
                      const imageUrl = getEmojiImageUrl(emoji.name, emoji.extension || 'png', emoji._id)
                      const shortcode = `:${emoji.name}:`
                      return (
                        <button
                          key={`${emoji._id || emoji.name}-${index}`}
                          type="button"
                          onClick={() => insertEmoji(emoji.name)}
                          className="aspect-square p-1.5 hover:bg-muted rounded transition-colors flex flex-col items-center justify-center gap-0.5 group relative bg-muted/50"
                          title={shortcode}
                        >
                          {imageUrl ? (
                            <>
                              <img
                                src={imageUrl}
                                alt={shortcode}
                                className="w-6 h-6 object-contain shrink-0 rounded-sm bg-background/80"
                                loading="lazy"
                                decoding="async"
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  const target = e.target as HTMLImageElement
                                  const parent = target.parentElement
                                  if (parent) {
                                    target.style.display = 'none'
                                    let fallback = parent.querySelector('.emoji-shortcode-fallback')
                                    if (!fallback) {
                                      fallback = document.createElement('span')
                                      fallback.className = 'emoji-shortcode-fallback text-[10px] text-muted-foreground group-hover:text-foreground break-all text-center leading-tight px-0.5'
                                      fallback.textContent = shortcode
                                      parent.appendChild(fallback)
                                    }
                                  }
                                }}
                              />
                              <span className="emoji-shortcode-fallback text-[9px] text-muted-foreground truncate w-full text-center opacity-70" title={shortcode}>
                                :{emoji.name}:
                              </span>
                            </>
                          ) : (
                            <span className="text-[10px] text-muted-foreground group-hover:text-foreground break-all text-center leading-tight px-0.5">
                              {shortcode}
                            </span>
                          )}
                        </button>
                      )
                    })}
                  </div>
                </div>
              )}

              {/* Если с сервера не пришли кастомные эмодзи, показываем компактный список стандартных alias'ов текстом */}
              {emojis.length === 0 && (
                <div>
                  <p className="text-xs font-semibold text-muted-foreground mb-2 px-1 mt-3">
                    Стандартные эмодзи
                  </p>
                  <div className="grid grid-cols-10 gap-1">
                    {standardEmojiNames.map((name, index) => (
                      <button
                        key={`${name}-${index}`}
                        type="button"
                        onClick={() => insertEmoji(name)}
                        className="aspect-square p-1.5 hover:bg-muted rounded transition-colors flex items-center justify-center"
                        title={name}
                      >
                        <span className="text-[10px] text-muted-foreground break-all text-center leading-tight px-0.5">
                          :{name}:
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </PopoverContent>
        </Popover>

        <div className="h-6 w-px bg-border mx-1" />

        {/* Formatting Buttons */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatBold}
          title="Жирный (Ctrl+B)"
        >
          <Bold className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatItalic}
          title="Курсив (Ctrl+I)"
        >
          <Italic className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatStrikethrough}
          title="Зачеркнутый"
        >
          <Strikethrough className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-border mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatInlineCode}
          title="Инлайн код"
        >
          <Code className="h-4 w-4" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatCodeBlock}
          title="Блок кода"
        >
          <Type className="h-4 w-4" />
        </Button>

        <div className="h-6 w-px bg-border mx-1" />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatLink}
          title="Вставить ссылку"
        >
          <LinkIcon className="h-4 w-4" />
        </Button>
      </div>

      {/* Textarea */}
      <Textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          if (e.target.value.length <= maxLength) {
            onChange(e.target.value)
          }
        }}
        placeholder={placeholder}
        rows={8}
        className="resize-none font-mono text-sm rounded-xl border-border/80 bg-background focus-visible:ring-2 focus-visible:ring-primary/20"
        onSelect={(e) => {
          const target = e.target as HTMLTextAreaElement
          setSelectedRange({
            start: target.selectionStart,
            end: target.selectionEnd,
          })
        }}
      />
    </div>
  )
}
