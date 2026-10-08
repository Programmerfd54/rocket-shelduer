"use client"

import { useState, useRef, useEffect } from 'react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import * as PopoverPrimitive from '@radix-ui/react-popover'
import { Popover, PopoverTrigger } from '@/components/ui/popover'
import EmojiPicker from './EmojiPicker'
import { 
  Bold, 
  Italic, 
  Strikethrough, 
  Code, 
  Link as LinkIcon,
  Smile,
  Type
} from 'lucide-react'

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
  /** Вызывается с вставленным текстом вида `:shortcode:` */
  onEmojiSelect?: (emoji: string) => void
  /** Идёт загрузка эмодзи воркспейса (показывается скелетон в пикере) */
  emojisLoading?: boolean
  /** Ошибка загрузки эмодзи воркспейса (строка — текст ошибки) */
  emojisError?: string | boolean | null
  /** Повторить загрузку эмодзи воркспейса */
  onRetryEmojis?: () => void
}

export default function MessageEditor({
  value,
  onChange,
  placeholder = "Введите текст сообщения...",
  maxLength = 5000,
  emojis = [],
  workspaceId,
  workspaceUrl,
  onEmojiSelect,
  emojisLoading = false,
  emojisError = null,
  onRetryEmojis,
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

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!(e.ctrlKey || e.metaKey) || e.shiftKey || e.altKey) return
    const key = e.key.toLowerCase()
    if (key === 'b') {
      e.preventDefault()
      formatBold()
    } else if (key === 'i') {
      e.preventDefault()
      formatItalic()
    }
  }

  return (
    <div className="space-y-3 min-w-0">
      {/* Toolbar */}
      <div role="toolbar" aria-label="Форматирование текста" className="flex flex-wrap items-center gap-0.5 p-1 rounded-md border bg-muted/40">
        {/* Emoji Picker */}
        <Popover open={showEmojiPicker} onOpenChange={setShowEmojiPicker}>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              title="Эмодзи"
              aria-label="Вставить эмодзи"
            >
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          {/* Примитив напрямую: PopoverContent из ui не пробрасывает className (ширина w-72 и p-4 зашиты) */}
          <PopoverPrimitive.Portal>
            <PopoverPrimitive.Content
              align="start"
              sideOffset={4}
              collisionPadding={8}
              onCloseAutoFocus={(e) => {
                e.preventDefault()
                textareaRef.current?.focus()
              }}
              className="z-50 w-[340px] max-w-[calc(100vw-16px)] rounded-md border bg-popover text-popover-foreground shadow-md outline-none data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95"
            >
              <EmojiPicker
                customEmojis={emojis}
                workspaceId={workspaceId}
                loading={emojisLoading}
                error={emojisError}
                onRetry={onRetryEmojis}
                onSelect={insertEmoji}
              />
            </PopoverPrimitive.Content>
          </PopoverPrimitive.Portal>
        </Popover>

        <div className="h-5 w-px bg-border mx-1" aria-hidden />

        {/* Formatting Buttons */}
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatBold}
          title="Жирный (Ctrl+B)"
          aria-label="Жирный"
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
          aria-label="Курсив"
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
          aria-label="Зачёркнутый"
        >
          <Strikethrough className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border mx-1" aria-hidden />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatInlineCode}
          title="Инлайн код"
          aria-label="Код в строке"
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
          aria-label="Блок кода"
        >
          <Type className="h-4 w-4" />
        </Button>

        <div className="h-5 w-px bg-border mx-1" aria-hidden />

        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={formatLink}
          title="Вставить ссылку"
          aria-label="Вставить ссылку"
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
        onKeyDown={handleKeyDown}
        className="resize-none font-mono text-sm rounded-md bg-background min-w-0 w-full break-words"
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
