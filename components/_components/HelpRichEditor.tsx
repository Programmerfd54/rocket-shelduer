'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tiptap, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { useTiptap } from '@tiptap/react'
import { NodeSelection } from '@tiptap/pm/state'
import { BlockHighlight, HelpIcon } from '@/lib/helpEditorExtensions'
import { HELPDOC_ICONS, HELPDOC_ICON_NAMES } from '@/lib/helpIcons'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Bold,
  Italic,
  List,
  ListOrdered,
  Heading1,
  Heading2,
  Heading3,
  Quote,
  Link as LinkIcon,
  ImagePlus,
  Loader2,
  Code,
  Minus,
  Plus,
  Video,
  Music,
  FileText,
  Bookmark,
  Palette,
  Highlighter,
  Square,
  Smile,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const HELP_ROLE_OPTIONS = [
  { value: '', label: 'Для всех' },
  { value: 'SUPPORT', label: 'SUPPORT' },
  { value: 'ADM', label: 'ADM' },
  { value: 'VOL', label: 'VOL' },
] as const

const IMAGE_SIZES = [
  { label: 'Маленький', width: 200 },
  { label: 'Средний', width: 400 },
  { label: 'Большой', width: 600 },
  { label: 'По ширине', width: null },
] as const

const TEXT_COLORS = [
  { name: 'По умолчанию', value: '' },
  { name: 'Красный', value: '#dc2626' },
  { name: 'Оранжевый', value: '#ea580c' },
  { name: 'Жёлтый', value: '#ca8a04' },
  { name: 'Зелёный', value: '#16a34a' },
  { name: 'Бирюзовый', value: '#0d9488' },
  { name: 'Синий', value: '#2563eb' },
  { name: 'Фиолетовый', value: '#7c3aed' },
  { name: 'Розовый', value: '#db2777' },
]

const HIGHLIGHT_COLORS = [
  { name: 'Жёлтый', value: '#fef08a' },
  { name: 'Зелёный', value: '#bbf7d0' },
  { name: 'Голубой', value: '#bae6fd' },
  { name: 'Розовый', value: '#fbcfe8' },
  { name: 'Оранжевый', value: '#fed7aa' },
  { name: 'Сбросить', value: '' },
]

const BLOCK_HIGHLIGHT_COLORS = [
  { name: 'Жёлтый (amber)', value: 'amber' },
  { name: 'Синий', value: 'blue' },
  { name: 'Зелёный', value: 'green' },
  { name: 'Красный', value: 'red' },
  { name: 'Фиолетовый', value: 'violet' },
  { name: 'Серый', value: 'slate' },
]

const ICON_COLORS = [
  { name: 'По умолчанию', value: '' },
  { name: 'Красный', value: '#dc2626' },
  { name: 'Оранжевый', value: '#ea580c' },
  { name: 'Жёлтый', value: '#ca8a04' },
  { name: 'Зелёный', value: '#16a34a' },
  { name: 'Синий', value: '#2563eb' },
  { name: 'Фиолетовый', value: '#7c3aed' },
  { name: 'Розовый', value: '#db2777' },
]

export { HELP_ROLE_OPTIONS }

interface HelpRichEditorProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: string
  className?: string
  onImageUpload?: (url: string) => void
}

export function HelpRichEditor({
  value,
  onChange,
  placeholder = 'Введите текст инструкции…',
  minHeight = '200px',
  className,
}: HelpRichEditorProps) {
  const valueRef = useRef(value)
  valueRef.current = value

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          codeBlock: { HTMLAttributes: { class: 'rounded-lg bg-muted/50 p-4 font-mono text-sm' } },
        }),
        Image.configure({
          HTMLAttributes: { class: 'rounded-lg h-auto cursor-pointer' },
          allowBase64: false,
          resize: {
            enabled: true,
            minWidth: 100,
            minHeight: 50,
            alwaysPreserveAspectRatio: true,
          },
        }),
        Link.configure({
          openOnClick: false,
          HTMLAttributes: { class: 'text-primary underline' },
        }),
        TextStyle,
        Color,
        Highlight.configure({ multicolor: true }),
        BackgroundColor,
        BlockHighlight,
        HelpIcon,
      ],
      content: value || '',
      immediatelyRender: false,
      editorProps: {
        attributes: {
          class: 'prose prose-sm dark:prose-invert max-w-none min-h-[120px] px-4 py-3 focus:outline-none [&_.ProseMirror]:outline-none',
          'data-placeholder': placeholder,
        },
      },
      onUpdate: ({ editor }) => {
        const html = editor.getHTML()
        if (html !== valueRef.current) onChange(html)
      },
    },
    []
  )

  useEffect(() => {
    if (!editor) return
    const current = editor.getHTML()
    const next = value || ''
    if (next !== current) {
      editor.commands.setContent(next, { emitUpdate: false })
    }
  }, [value, editor])

  return (
    <div className={cn('rounded-xl border border-border/80 bg-background overflow-hidden shadow-sm', className)}>
      {editor && (
        <Tiptap instance={editor}>
          <HelpEditorToolbar onImageUpload={onChange} />
          <Tiptap.BubbleMenu
            options={{ placement: 'top' }}
            pluginKey="imageSize"
            shouldShow={({ state }) => {
              const node = state.selection instanceof NodeSelection ? state.selection.node : null
              return node?.type?.name === 'image'
            }}
          >
            <ImageSizeMenu />
          </Tiptap.BubbleMenu>
          <Tiptap.BubbleMenu
            options={{ placement: 'top' }}
            pluginKey="helpIconColor"
            shouldShow={({ state }) => {
              const node = state.selection instanceof NodeSelection ? state.selection.node : null
              return node?.type?.name === 'helpIcon'
            }}
          >
            <HelpIconColorMenu />
          </Tiptap.BubbleMenu>
          <Tiptap.Loading>
            <div className="flex items-center justify-center p-8 text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin" />
            </div>
          </Tiptap.Loading>
          <div className="tiptap-editor-wrap bg-background" style={{ minHeight }}>
            <Tiptap.Content />
          </div>
        </Tiptap>
      )}
    </div>
  )
}

function ImageSizeMenu() {
  const { editor, isReady } = useTiptap()
  if (!isReady || !editor) return null
  const setImageSize = (width: number | null) => {
    editor.chain().focus().updateAttributes('image', { width: width ?? undefined, height: undefined }).run()
  }
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1 shadow-md">
      <span className="px-2 text-xs text-muted-foreground">Масштаб:</span>
      {IMAGE_SIZES.map((s) => (
        <Button
          key={s.label}
          type="button"
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => setImageSize(s.width)}
        >
          {s.label}
        </Button>
      ))}
    </div>
  )
}

function HelpIconColorMenu() {
  const { editor, isReady } = useTiptap()
  if (!isReady || !editor) return null
  return (
    <div className="flex items-center gap-0.5 rounded-lg border bg-popover p-1.5 shadow-md">
      <span className="px-2 text-xs text-muted-foreground">Цвет иконки:</span>
      {ICON_COLORS.map((c) => (
        <button
          key={c.value || 'default'}
          type="button"
          className={cn(
            'h-7 w-7 rounded border shrink-0',
            !c.value && 'border-dashed'
          )}
          style={c.value ? { backgroundColor: c.value, borderColor: c.value } : undefined}
          title={c.name}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            editor.chain().focus().setHelpIconColor(c.value || null).run()
          }}
        >
          {!c.value && <span className="text-xs">×</span>}
        </button>
      ))}
    </div>
  )
}

type InsertMediaType = 'video' | 'audio' | 'file' | 'bookmark'

function HelpEditorToolbar({ onImageUpload }: { onImageUpload?: (html: string) => void }) {
  const { editor, isReady } = useTiptap()
  const inputRef = useRef<HTMLInputElement>(null)
  const [insertDialogType, setInsertDialogType] = useState<InsertMediaType | null>(null)
  const [insertUrl, setInsertUrl] = useState('')
  const [insertLoading, setInsertLoading] = useState(false)
  const [uploadLoading, setUploadLoading] = useState(false)
  const [bookmarkUrl, setBookmarkUrl] = useState('')
  const [bookmarkTitle, setBookmarkTitle] = useState('')
  const [iconColor, setIconColor] = useState<string | null>(null)
  const mediaFileRef = useRef<HTMLInputElement>(null)

  const uploadImage = useCallback(async (file: File) => {
    if (!editor || !isReady) return
    const form = new FormData()
    form.append('file', file)
    try {
      const res = await fetch('/api/admin/help/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Ошибка загрузки')
      }
      const data = await res.json()
      const url = data.url
      if (url) {
        editor.chain().focus().setImage({ src: url, alt: '' }).run()
        onImageUpload?.(editor.getHTML())
      }
    } catch (e: any) {
      toast.error(e.message || 'Не удалось загрузить изображение')
    }
  }, [editor, isReady, onImageUpload])

  const uploadMediaFile = useCallback(async (type: InsertMediaType, file: File) => {
    if (!editor || !isReady) return
    setUploadLoading(true)
    const form = new FormData()
    form.append('file', file)
    form.append('type', type)
    try {
      const res = await fetch('/api/admin/help/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Ошибка загрузки')
      }
      const data = await res.json()
      const url = data.url
      if (url) {
        const label = type === 'video' ? 'Видео' : type === 'audio' ? 'Аудио' : file.name || 'Файл'
        editor.chain().focus().insertContent(`<a href="${url}" target="_blank" rel="noopener">${label}</a>`).run()
        onImageUpload?.(editor.getHTML())
        setInsertDialogType(null)
        setInsertUrl('')
      }
    } catch (e: any) {
      toast.error(e.message || 'Не удалось загрузить файл')
    } finally {
      setUploadLoading(false)
    }
  }, [editor, isReady, onImageUpload])

  const handleInsertByUrl = useCallback(() => {
    if (!editor || !isReady || !insertUrl.trim() || !insertDialogType) return
    setInsertLoading(true)
    const label = insertDialogType === 'video' ? 'Видео' : insertDialogType === 'audio' ? 'Аудио' : 'Файл'
    editor.chain().focus().insertContent(`<a href="${insertUrl.trim()}" target="_blank" rel="noopener">${label}</a>`).run()
    onImageUpload?.(editor.getHTML())
    setInsertLoading(false)
    setInsertDialogType(null)
    setInsertUrl('')
  }, [editor, isReady, insertUrl, insertDialogType, onImageUpload])

  const runCommand = useCallback((fn: () => void) => {
    if (!editor || !isReady) return
    fn()
    requestAnimationFrame(() => editor.commands.focus())
  }, [editor, isReady])

  if (!isReady || !editor) return null

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border/60 bg-muted/20 px-2 py-1.5">
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleBold().run())}
        active={editor.isActive('bold')}
        title="Жирный (Ctrl+B)"
      >
        <Bold className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleItalic().run())}
        active={editor.isActive('italic')}
        title="Курсив (Ctrl+I)"
      >
        <Italic className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleCode().run())}
        active={editor.isActive('code')}
        title="Код (инлайн)"
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <span className="w-px h-5 bg-border/80 mx-0.5" aria-hidden />
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
        active={editor.isActive('heading', { level: 1 })}
        title="Заголовок 1"
      >
        <Heading1 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
        active={editor.isActive('heading', { level: 2 })}
        title="Заголовок 2"
      >
        <Heading2 className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
        active={editor.isActive('heading', { level: 3 })}
        title="Заголовок 3"
      >
        <Heading3 className="h-4 w-4" />
      </ToolbarButton>
      <span className="w-px h-5 bg-border/80 mx-0.5" aria-hidden />
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleBulletList().run())}
        active={editor.isActive('bulletList')}
        title="Маркированный список"
      >
        <List className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleOrderedList().run())}
        active={editor.isActive('orderedList')}
        title="Нумерованный список"
      >
        <ListOrdered className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleBlockquote().run())}
        active={editor.isActive('blockquote')}
        title="Цитата / Callout"
      >
        <Quote className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().toggleCodeBlock().run())}
        active={editor.isActive('codeBlock')}
        title="Блок кода"
      >
        <Code className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => runCommand(() => editor.chain().focus().setHorizontalRule().run())}
        active={false}
        title="Разделитель"
      >
        <Minus className="h-4 w-4" />
      </ToolbarButton>
      <ToolbarButton
        onClick={() => {
          const url = window.prompt('Вставьте ссылку:')
          if (url) runCommand(() => editor.chain().focus().setLink({ href: url }).run())
        }}
        active={editor.isActive('link')}
        title="Ссылка"
      >
        <LinkIcon className="h-4 w-4" />
      </ToolbarButton>
      <span className="w-px h-5 bg-border/80 mx-0.5" aria-hidden />
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            title="Цвет текста"
          >
            <Palette className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="grid grid-cols-3 gap-1">
            {TEXT_COLORS.map((c) => (
              <button
                key={c.value || 'default'}
                type="button"
                className={cn(
                  'h-7 rounded border text-xs',
                  !c.value && 'border-dashed'
                )}
                style={c.value ? { backgroundColor: c.value, borderColor: c.value } : undefined}
                title={c.name}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (c.value) editor.chain().focus().setColor(c.value).run()
                  else editor.chain().focus().unsetColor().run()
                }}
              >
                {!c.value && '×'}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <Popover>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            title="Подсветка текста"
          >
            <Highlighter className="h-4 w-4" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-48 p-2" align="start">
          <div className="grid grid-cols-3 gap-1">
            {HIGHLIGHT_COLORS.map((c) => (
              <button
                key={c.value || 'none'}
                type="button"
                className="h-7 rounded border border-border text-xs"
                style={c.value ? { backgroundColor: c.value } : undefined}
                title={c.name}
                onMouseDown={(e) => {
                  e.preventDefault()
                  if (c.value) editor.chain().focus().setHighlight({ color: c.value }).run()
                  else editor.chain().focus().unsetHighlight().run()
                }}
              >
                {!c.value ? '×' : ''}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            title="Выделить блок"
          >
            <Square className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          {BLOCK_HIGHLIGHT_COLORS.map((c) => (
            <DropdownMenuItem
              key={c.value}
              onMouseDown={(e) => e.preventDefault()}
              onSelect={(e) => {
                e.preventDefault()
                editor.chain().focus().toggleBlockHighlight(c.value).run()
              }}
              className="gap-2"
            >
              <span
                className="h-4 w-4 rounded border border-border shrink-0"
                style={{
                  backgroundColor:
                    c.value === 'amber'
                      ? 'rgb(254 243 199)'
                      : c.value === 'blue'
                        ? 'rgb(219 234 254)'
                        : c.value === 'green'
                          ? 'rgb(220 252 231)'
                          : c.value === 'red'
                            ? 'rgb(254 226 226)'
                            : c.value === 'violet'
                              ? 'rgb(237 233 254)'
                              : 'rgb(241 245 249)',
                }}
              />
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            title="Вставить иконку"
          >
            <Smile className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[240px] max-h-[340px] p-2">
          <div className="mb-2">
            <p className="text-xs text-muted-foreground mb-1.5">Цвет иконки:</p>
            <div className="flex flex-wrap gap-1">
              {ICON_COLORS.map((c) => (
                <button
                  key={c.value || 'default'}
                  type="button"
                  className={cn(
                    'h-6 w-6 rounded border shrink-0',
                    !c.value && 'border-dashed'
                  )}
                  style={c.value ? { backgroundColor: c.value, borderColor: c.value } : undefined}
                  title={c.name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => setIconColor(c.value || null)}
                >
                  {!c.value && <span className="text-[10px]">×</span>}
                </button>
              ))}
            </div>
          </div>
          <ScrollArea className="h-[220px]">
            <div className="grid grid-cols-4 gap-1">
              {HELPDOC_ICON_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="flex h-9 w-9 items-center justify-center rounded border border-border hover:bg-muted/50"
                  title={name}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => {
                    runCommand(() => editor.chain().focus().insertHelpIcon(name, iconColor).run())
                  }}
                  dangerouslySetInnerHTML={{ __html: HELPDOC_ICONS[name] || '' }}
                />
              ))}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
      <span className="w-px h-5 bg-border/80 mx-0.5" aria-hidden />
      <input
        ref={inputRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) uploadImage(file)
          e.target.value = ''
        }}
      />
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="h-8 w-8 shrink-0"
            onMouseDown={(e) => e.preventDefault()}
            title="Вставить: изображение, видео, аудио, код, файл, закладка"
          >
            <Plus className="h-4 w-4" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="min-w-[200px]">
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => { e.preventDefault(); inputRef.current?.click() }}
            className="gap-2"
          >
            <ImagePlus className="h-4 w-4" />
            Изображение
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => { e.preventDefault(); setInsertDialogType('video'); setInsertUrl('') }}
            className="gap-2"
          >
            <Video className="h-4 w-4" />
            Видео
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => { e.preventDefault(); setInsertDialogType('audio'); setInsertUrl('') }}
            className="gap-2"
          >
            <Music className="h-4 w-4" />
            Аудио
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => { e.preventDefault(); runCommand(() => editor.chain().focus().toggleCodeBlock().run()) }}
            className="gap-2"
          >
            <Code className="h-4 w-4" />
            Блок кода
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => { e.preventDefault(); setInsertDialogType('file'); setInsertUrl('') }}
            className="gap-2"
          >
            <FileText className="h-4 w-4" />
            Файл
          </DropdownMenuItem>
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => {
              e.preventDefault()
              setBookmarkUrl('')
              setBookmarkTitle('')
              setInsertDialogType('bookmark')
            }}
            className="gap-2"
          >
            <Bookmark className="h-4 w-4" />
            Веб-закладка
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Диалог вставки видео/аудио/файла / веб-закладки */}
      <Dialog open={insertDialogType !== null} onOpenChange={(open) => {
        if (!open) {
          setInsertDialogType(null)
          setBookmarkUrl('')
          setBookmarkTitle('')
        }
      }}>
        <DialogContent className="sm:max-w-md" onPointerDownOutside={(e) => e.preventDefault()}>
          <DialogHeader>
            <DialogTitle>
              {insertDialogType === 'video' && 'Вставить видео'}
              {insertDialogType === 'audio' && 'Вставить аудио'}
              {insertDialogType === 'file' && 'Вставить файл'}
              {insertDialogType === 'bookmark' && 'Веб-закладка'}
            </DialogTitle>
          </DialogHeader>
          {insertDialogType === 'bookmark' ? (
            <div className="space-y-4 py-2">
              <div className="space-y-2">
                <Label htmlFor="bookmark-url">URL страницы</Label>
                <Input
                  id="bookmark-url"
                  value={bookmarkUrl}
                  onChange={(e) => setBookmarkUrl(e.target.value)}
                  placeholder="https://..."
                  onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), document.getElementById('bookmark-title')?.focus())}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="bookmark-title">Подпись (необязательно)</Label>
                <Input
                  id="bookmark-title"
                  value={bookmarkTitle}
                  onChange={(e) => setBookmarkTitle(e.target.value)}
                  placeholder="Текст ссылки"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault()
                      const url = bookmarkUrl.trim()
                      if (url && editor && isReady) {
                        const title = bookmarkTitle.trim() || url
                        const safeUrl = url.replace(/"/g, '&quot;')
                        const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                        editor.chain().focus().insertContent(`<a href="${safeUrl}" target="_blank" rel="noopener">${safeTitle}</a>`).run()
                        onImageUpload?.(editor.getHTML())
                        setInsertDialogType(null)
                        setBookmarkUrl('')
                        setBookmarkTitle('')
                      }
                    }
                  }}
                />
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInsertDialogType(null)}>
                  Отмена
                </Button>
                <Button
                  type="button"
                  disabled={!bookmarkUrl.trim()}
                  onClick={() => {
                    const url = bookmarkUrl.trim()
                    if (!url || !editor || !isReady) return
                    const title = bookmarkTitle.trim() || url
                    const safeUrl = url.replace(/"/g, '&quot;')
                    const safeTitle = title.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
                    editor.chain().focus().insertContent(`<a href="${safeUrl}" target="_blank" rel="noopener">${safeTitle}</a>`).run()
                    onImageUpload?.(editor.getHTML())
                    setInsertDialogType(null)
                    setBookmarkUrl('')
                    setBookmarkTitle('')
                  }}
                >
                  Вставить
                </Button>
              </DialogFooter>
            </div>
          ) : (
            <>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label>По ссылке (URL)</Label>
                  <Input
                    value={insertUrl}
                    onChange={(e) => setInsertUrl(e.target.value)}
                    placeholder="https://..."
                    disabled={insertLoading || uploadLoading}
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleInsertByUrl}
                    disabled={!insertUrl.trim() || insertLoading || uploadLoading}
                  >
                    {insertLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    Вставить
                  </Button>
                </div>
                <div className="relative border-t pt-4">
                  <Label className="mb-2 block">Или загрузить файл</Label>
                  <input
                    ref={mediaFileRef}
                    type="file"
                    accept={
                      insertDialogType === 'video'
                        ? 'video/mp4,video/webm,video/ogg'
                        : insertDialogType === 'audio'
                          ? 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4'
                          : 'application/pdf,.doc,.docx,.xls,.xlsx,text/plain,text/csv'
                    }
                    className="hidden"
                    disabled={uploadLoading}
                    onChange={(e) => {
                      const file = e.target.files?.[0]
                      if (file && insertDialogType) {
                        uploadMediaFile(insertDialogType, file)
                      }
                      e.target.value = ''
                    }}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    disabled={uploadLoading}
                    onClick={() => mediaFileRef.current?.click()}
                  >
                    {uploadLoading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                    {uploadLoading ? 'Загрузка…' : 'Выбрать файл'}
                  </Button>
                </div>
              </div>
              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setInsertDialogType(null)}>
                  Отмена
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  )
}

function ToolbarButton({
  onClick,
  active,
  title,
  children,
}: {
  onClick: () => void
  active: boolean
  title: string
  children: React.ReactNode
}) {
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      className={cn('h-8 w-8 shrink-0', active && 'bg-muted text-foreground')}
      onMouseDown={(e) => {
        e.preventDefault()
        e.stopPropagation()
        onClick()
      }}
      onClick={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      title={title}
      aria-label={title}
    >
      {children}
    </Button>
  )
}
