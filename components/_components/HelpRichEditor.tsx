'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { Tiptap, useEditor, useTiptap, useTiptapState, type Editor } from '@tiptap/react'
import { BubbleMenu } from '@tiptap/react/menus'
import StarterKit from '@tiptap/starter-kit'
import Image from '@tiptap/extension-image'
import Link from '@tiptap/extension-link'
import Placeholder from '@tiptap/extension-placeholder'
import { TextStyle, Color, BackgroundColor } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { NodeSelection } from '@tiptap/pm/state'
import { BlockHighlight, HelpIcon } from '@/lib/helpEditorExtensions'
import { HELPDOC_ICONS, HELPDOC_ICON_NAMES } from '@/lib/helpIcons'
import { sanitizeSvgIcon } from '@/lib/sanitize'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
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
  Unlink,
  ImagePlus,
  Loader2,
  Code,
  SquareCode,
  Minus,
  Plus,
  Video,
  Music,
  FileText,
  Bookmark,
  Palette,
  Highlighter,
  MessageSquareQuote,
  Smile,
  Undo2,
  Redo2,
  X,
} from 'lucide-react'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { ScrollArea } from '@/components/ui/scroll-area'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'

const HELP_ROLE_OPTIONS = [
  { value: '', label: 'Для всех' },
  { value: 'SUP', label: 'SUP' },
  { value: 'ADM', label: 'ADM' },
  { value: 'MEMBER', label: 'MEMBER (волонтёр)' },
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

/** Цвета выносок (callout): значения совпадают с классами help-block-* / data-color в globals.css. */
const BLOCK_HIGHLIGHT_COLORS = [
  { name: 'Жёлтая', value: 'amber', swatch: 'rgb(254 243 199)' },
  { name: 'Синяя', value: 'blue', swatch: 'rgb(219 234 254)' },
  { name: 'Зелёная', value: 'green', swatch: 'rgb(220 252 231)' },
  { name: 'Красная', value: 'red', swatch: 'rgb(254 226 226)' },
  { name: 'Фиолетовая', value: 'violet', swatch: 'rgb(237 233 254)' },
  { name: 'Серая', value: 'slate', swatch: 'rgb(241 245 249)' },
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

/** Лимиты совпадают с /api/admin/help/upload. */
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_MEDIA_BYTES = 50 * 1024 * 1024
const MAX_FILE_BYTES = 20 * 1024 * 1024

/** Старые записи справки хранят роль волонтёра как 'VOL' — в редакторе показываем её как MEMBER. */
function normalizeHelpRoles(roles: unknown): string[] {
  if (!Array.isArray(roles)) return []
  return Array.from(new Set(roles.map((r) => (r === 'VOL' ? 'MEMBER' : String(r)))))
}

export { HELP_ROLE_OPTIONS, normalizeHelpRoles }

/* ---------- утилиты ---------- */

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

/**
 * Проверка и нормализация ссылки: http(s), mailto, tel, внутренние пути («/…», «#…»).
 * Без протокола подставляется https://. Возвращает null, если ссылка некорректна.
 */
function normalizeUrl(raw: string): string | null {
  const v = raw.trim()
  if (!v || /\s/.test(v)) return null
  if (/^[/#]/.test(v) && !v.startsWith('//')) return v
  if (/^(mailto|tel):\S+$/i.test(v)) return v
  const withProto = /^[a-z][a-z0-9+.-]*:/i.test(v) ? v : `https://${v}`
  try {
    const u = new URL(withProto)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null
    if (!u.hostname.includes('.') && u.hostname !== 'localhost') return null
    return withProto
  } catch {
    return null
  }
}

const URL_ERROR = 'Введите корректную ссылку, например https://example.com'

function buildAnchor(url: string, label: string): string {
  return `<a href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`
}

function errorText(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

function shallowEqual<T extends Record<string, unknown>>(a: T, b: T | null): boolean {
  if (!b) return false
  const ka = Object.keys(a)
  if (ka.length !== Object.keys(b).length) return false
  return ka.every((k) => a[k] === b[k])
}

/* ---------- редактор ---------- */

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
  // Актуальные value/onChange для колбэка onUpdate (редактор создаётся один раз).
  // Ref обновляем в эффекте, а не во время рендера.
  const valueRef = useRef(value)
  const onChangeRef = useRef(onChange)
  useEffect(() => {
    valueRef.current = value
    onChangeRef.current = onChange
  }, [value, onChange])

  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          heading: { levels: [1, 2, 3] },
          // Link подключаем ниже со своими настройками
          link: false,
          codeBlock: { HTMLAttributes: { class: 'rounded-md bg-muted/50 p-4 font-mono text-sm' } },
        }),
        Image.configure({
          HTMLAttributes: { class: 'rounded-md h-auto cursor-pointer' },
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
        Placeholder.configure({ placeholder }),
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
          class:
            'prose prose-sm dark:prose-invert max-w-none min-h-[120px] px-3 py-2.5 focus:outline-none [&_.ProseMirror]:outline-none',
          role: 'textbox',
          'aria-multiline': 'true',
          'aria-label': 'Редактор текста',
        },
      },
      onUpdate: ({ editor }) => {
        const html = editor.getHTML()
        if (html !== valueRef.current) onChangeRef.current(html)
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
    <div
      className={cn(
        'overflow-hidden rounded-md border border-input bg-background transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30',
        className
      )}
    >
      {editor && (
        <Tiptap editor={editor}>
          <HelpEditorToolbar />
          <BubbleMenu
            options={{ placement: 'top' }}
            pluginKey="imageSize"
            shouldShow={({ state }) => {
              const node = state.selection instanceof NodeSelection ? state.selection.node : null
              return node?.type?.name === 'image'
            }}
          >
            <ImageSizeMenu />
          </BubbleMenu>
          <BubbleMenu
            options={{ placement: 'top' }}
            pluginKey="helpIconColor"
            shouldShow={({ state }) => {
              const node = state.selection instanceof NodeSelection ? state.selection.node : null
              return node?.type?.name === 'helpIcon'
            }}
          >
            <HelpIconColorMenu />
          </BubbleMenu>
          <div
            className="tiptap-editor-wrap cursor-text bg-background"
            style={{ minHeight }}
            onClick={(e) => {
              // Клик по пустому месту под текстом — фокус в редактор
              if (e.target === e.currentTarget) editor.commands.focus('end')
            }}
          >
            <Tiptap.Content />
          </div>
        </Tiptap>
      )}
    </div>
  )
}

/* ---------- всплывающие меню над выделенным объектом ---------- */

function ImageSizeMenu() {
  const { editor } = useTiptap()
  if (!editor) return null
  const setImageSize = (width: number | null) => {
    editor.chain().focus().updateAttributes('image', { width: width ?? undefined, height: undefined }).run()
  }
  return (
    <div
      role="toolbar"
      aria-label="Размер изображения"
      className="flex items-center gap-0.5 rounded-md border bg-popover p-0.5 shadow-md"
    >
      <span className="px-2 text-xs text-muted-foreground">Размер</span>
      {IMAGE_SIZES.map((s) => (
        <Button
          key={s.label}
          type="button"
          variant="ghost"
          size="xs"
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
  const { editor } = useTiptap()
  if (!editor) return null
  return (
    <div
      role="toolbar"
      aria-label="Цвет иконки"
      className="flex items-center gap-1 rounded-md border bg-popover p-1 shadow-md"
    >
      <span className="px-1.5 text-xs text-muted-foreground">Цвет иконки</span>
      {ICON_COLORS.map((c) => (
        <Swatch
          key={c.value || 'default'}
          label={c.name}
          color={c.value}
          onPick={() => editor.chain().focus().setHelpIconColor(c.value || null).run()}
        />
      ))}
    </div>
  )
}

/** Квадратик выбора цвета; пустое значение = «сбросить». */
function Swatch({
  label,
  color,
  onPick,
  selected = false,
}: {
  label: string
  color: string
  onPick: () => void
  selected?: boolean
}) {
  return (
    <button
      type="button"
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-sm border outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40',
        !color && 'border-dashed text-muted-foreground',
        selected && 'ring-2 ring-ring ring-offset-1 ring-offset-popover'
      )}
      style={color ? { backgroundColor: color, borderColor: color } : undefined}
      title={label}
      aria-label={label}
      aria-pressed={selected}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      {!color && <X className="size-3" aria-hidden />}
    </button>
  )
}

/* ---------- панель инструментов ---------- */

type InsertMediaType = 'video' | 'audio' | 'file' | 'bookmark'

const INSERT_TITLES: Record<InsertMediaType, string> = {
  video: 'Вставить видео',
  audio: 'Вставить аудио',
  file: 'Вставить файл',
  bookmark: 'Веб-закладка',
}

const INSERT_DEFAULT_LABEL: Record<InsertMediaType, string> = {
  video: 'Видео',
  audio: 'Аудио',
  file: 'Файл',
  bookmark: '',
}

const TOOL_BTN = 'size-7 shrink-0 text-muted-foreground hover:text-foreground'

/** Подсказка-тултип для кнопки панели. */
function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip delayDuration={400}>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent side="bottom">{label}</TooltipContent>
    </Tooltip>
  )
}

function ToolbarButton({
  onClick,
  active = false,
  disabled = false,
  label,
  children,
}: {
  onClick: () => void
  active?: boolean
  disabled?: boolean
  /** Подсказка и aria-label (можно с горячей клавишей) */
  label: string
  children: React.ReactNode
}) {
  return (
    <Tip label={label}>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        className={cn(TOOL_BTN, active && 'bg-accent text-foreground')}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        // mousedown: не терять выделение в редакторе при нажатии на кнопку
        onMouseDown={(e) => e.preventDefault()}
        onClick={onClick}
      >
        {children}
      </Button>
    </Tip>
  )
}

function ToolbarDivider() {
  return <span className="mx-1 h-4 w-px bg-border" aria-hidden />
}

function HelpEditorToolbar() {
  const { editor } = useTiptap()
  if (!editor) return null
  return <HelpEditorToolbarInner editor={editor} />
}

function HelpEditorToolbarInner({ editor }: { editor: Editor }) {
  // Подписка на состояние редактора: подсветка активных кнопок обновляется при каждом изменении
  const st = useTiptapState(
    (s) => ({
      bold: s.editor.isActive('bold'),
      italic: s.editor.isActive('italic'),
      code: s.editor.isActive('code'),
      h1: s.editor.isActive('heading', { level: 1 }),
      h2: s.editor.isActive('heading', { level: 2 }),
      h3: s.editor.isActive('heading', { level: 3 }),
      bulletList: s.editor.isActive('bulletList'),
      orderedList: s.editor.isActive('orderedList'),
      blockquote: s.editor.isActive('blockquote'),
      codeBlock: s.editor.isActive('codeBlock'),
      link: s.editor.isActive('link'),
      canUndo: s.editor.can().undo(),
      canRedo: s.editor.can().redo(),
      textColor: (s.editor.getAttributes('textStyle').color as string | undefined) ?? '',
    }),
    shallowEqual
  )

  const fileRef = useRef<HTMLInputElement>(null)
  const mediaFileRef = useRef<HTMLInputElement>(null)

  const [iconColor, setIconColor] = useState<string | null>(null)

  // Диалог ссылки
  const [linkOpen, setLinkOpen] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkError, setLinkError] = useState<string | null>(null)

  // Диалог вставки видео/аудио/файла/закладки
  const [insertType, setInsertType] = useState<InsertMediaType | null>(null)
  const [insertUrl, setInsertUrl] = useState('')
  const [insertLabel, setInsertLabel] = useState('')
  const [insertError, setInsertError] = useState<string | null>(null)
  const [uploadLoading, setUploadLoading] = useState(false)

  const run = useCallback(
    (fn: () => void) => {
      fn()
      requestAnimationFrame(() => editor.commands.focus())
    },
    [editor]
  )

  /** Загрузка файла на сервер → URL. Показывает toast, проверяет размер на клиенте. */
  const uploadFile = useCallback(async (type: 'image' | InsertMediaType, file: File): Promise<string | null> => {
    const limit = type === 'image' ? MAX_IMAGE_BYTES : type === 'video' || type === 'audio' ? MAX_MEDIA_BYTES : MAX_FILE_BYTES
    if (file.size > limit) {
      toast.error(`Файл слишком большой (максимум ${Math.round(limit / 1024 / 1024)} МБ).`)
      return null
    }
    const toastId = toast.loading('Загрузка файла…')
    try {
      const form = new FormData()
      form.append('file', file)
      if (type !== 'image') form.append('type', type)
      const res = await fetch('/api/admin/help/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Ошибка загрузки')
      }
      const data = await res.json()
      if (!data.url) throw new Error('Сервер не вернул ссылку на файл')
      toast.success('Файл загружен', { id: toastId })
      return data.url as string
    } catch (e: unknown) {
      toast.error(errorText(e, 'Не удалось загрузить файл. Попробуйте ещё раз.'), { id: toastId })
      return null
    }
  }, [])

  const uploadImage = useCallback(
    async (file: File) => {
      const url = await uploadFile('image', file)
      if (url) editor.chain().focus().setImage({ src: url, alt: '' }).run()
    },
    [editor, uploadFile]
  )

  const closeInsert = () => {
    setInsertType(null)
    setInsertUrl('')
    setInsertLabel('')
    setInsertError(null)
  }

  const openInsert = (type: InsertMediaType) => {
    setInsertUrl('')
    setInsertLabel('')
    setInsertError(null)
    setInsertType(type)
  }

  const submitInsert = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    if (!insertType) return
    const url = normalizeUrl(insertUrl)
    if (!url) {
      setInsertError(URL_ERROR)
      return
    }
    const label = insertLabel.trim() || INSERT_DEFAULT_LABEL[insertType] || url
    editor.chain().focus().insertContent(buildAnchor(url, label)).run()
    toast.success('Вставлено в текст')
    closeInsert()
  }

  const uploadMedia = async (type: InsertMediaType, file: File) => {
    setUploadLoading(true)
    const url = await uploadFile(type, file)
    setUploadLoading(false)
    if (!url) return
    const label = insertLabel.trim() || (type === 'file' ? file.name || 'Файл' : INSERT_DEFAULT_LABEL[type])
    editor.chain().focus().insertContent(buildAnchor(url, label)).run()
    closeInsert()
  }

  const onLinkOpenChange = (open: boolean) => {
    setLinkOpen(open)
    if (open) {
      setLinkUrl((editor.getAttributes('link').href as string | undefined) ?? '')
      setLinkError(null)
    }
  }

  const applyLink = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const url = normalizeUrl(linkUrl)
    if (!url) {
      setLinkError(URL_ERROR)
      return
    }
    if (editor.state.selection.empty && !editor.isActive('link')) {
      // Нет выделенного текста — вставляем ссылку с URL в качестве подписи
      editor.chain().focus().insertContent(buildAnchor(url, url)).run()
    } else {
      editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
    }
    setLinkOpen(false)
    toast.success('Ссылка добавлена')
  }

  const removeLink = () => {
    editor.chain().focus().extendMarkRange('link').unsetLink().run()
    setLinkOpen(false)
    toast.success('Ссылка удалена')
  }

  return (
    <div
      role="toolbar"
      aria-label="Форматирование текста"
      className="flex flex-wrap items-center gap-0.5 border-b bg-muted/30 px-1.5 py-1"
    >
      <ToolbarButton
        label="Отменить (Ctrl+Z)"
        disabled={!st.canUndo}
        onClick={() => run(() => editor.chain().focus().undo().run())}
      >
        <Undo2 />
      </ToolbarButton>
      <ToolbarButton
        label="Повторить (Ctrl+Shift+Z)"
        disabled={!st.canRedo}
        onClick={() => run(() => editor.chain().focus().redo().run())}
      >
        <Redo2 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        label="Жирный (Ctrl+B)"
        active={st.bold}
        onClick={() => run(() => editor.chain().focus().toggleBold().run())}
      >
        <Bold />
      </ToolbarButton>
      <ToolbarButton
        label="Курсив (Ctrl+I)"
        active={st.italic}
        onClick={() => run(() => editor.chain().focus().toggleItalic().run())}
      >
        <Italic />
      </ToolbarButton>
      <ToolbarButton
        label="Код в строке"
        active={st.code}
        onClick={() => run(() => editor.chain().focus().toggleCode().run())}
      >
        <Code />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        label="Заголовок 1"
        active={st.h1}
        onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 1 }).run())}
      >
        <Heading1 />
      </ToolbarButton>
      <ToolbarButton
        label="Заголовок 2"
        active={st.h2}
        onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 2 }).run())}
      >
        <Heading2 />
      </ToolbarButton>
      <ToolbarButton
        label="Заголовок 3"
        active={st.h3}
        onClick={() => run(() => editor.chain().focus().toggleHeading({ level: 3 }).run())}
      >
        <Heading3 />
      </ToolbarButton>
      <ToolbarDivider />
      <ToolbarButton
        label="Маркированный список"
        active={st.bulletList}
        onClick={() => run(() => editor.chain().focus().toggleBulletList().run())}
      >
        <List />
      </ToolbarButton>
      <ToolbarButton
        label="Нумерованный список"
        active={st.orderedList}
        onClick={() => run(() => editor.chain().focus().toggleOrderedList().run())}
      >
        <ListOrdered />
      </ToolbarButton>
      <ToolbarButton
        label="Цитата"
        active={st.blockquote}
        onClick={() => run(() => editor.chain().focus().toggleBlockquote().run())}
      >
        <Quote />
      </ToolbarButton>
      <ToolbarButton
        label="Блок кода"
        active={st.codeBlock}
        onClick={() => run(() => editor.chain().focus().toggleCodeBlock().run())}
      >
        <SquareCode />
      </ToolbarButton>
      <ToolbarButton
        label="Разделитель"
        onClick={() => run(() => editor.chain().focus().setHorizontalRule().run())}
      >
        <Minus />
      </ToolbarButton>

      {/* Ссылка */}
      <Popover open={linkOpen} onOpenChange={onLinkOpenChange}>
        <Tip label="Ссылка">
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={cn(TOOL_BTN, st.link && 'bg-accent text-foreground')}
              aria-label="Ссылка"
              aria-pressed={st.link}
              onMouseDown={(e) => e.preventDefault()}
            >
              <LinkIcon />
            </Button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent align="start" className="w-80 p-3">
          <form onSubmit={applyLink} className="space-y-3" noValidate>
            <Field label="Адрес ссылки" htmlFor="help-link-url" error={linkError ?? undefined}>
              <Input
                id="help-link-url"
                value={linkUrl}
                onChange={(e) => {
                  setLinkUrl(e.target.value)
                  setLinkError(null)
                }}
                placeholder="https://example.com"
                aria-invalid={!!linkError}
                autoFocus
              />
            </Field>
            <div className="flex items-center justify-between gap-2">
              {st.link ? (
                <Button type="button" variant="ghost" size="sm" onClick={removeLink}>
                  <Unlink />
                  Убрать
                </Button>
              ) : (
                <span />
              )}
              <Button type="submit" size="sm" disabled={!linkUrl.trim()}>
                Применить
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>
      <ToolbarDivider />

      {/* Цвет текста */}
      <Popover>
        <Tip label="Цвет текста">
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={TOOL_BTN}
              aria-label="Цвет текста"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Palette style={st.textColor ? { color: st.textColor } : undefined} />
            </Button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-5 gap-1.5">
            {TEXT_COLORS.map((c) => (
              <Swatch
                key={c.value || 'default'}
                label={c.name}
                color={c.value}
                selected={c.value === st.textColor}
                onPick={() => {
                  if (c.value) editor.chain().focus().setColor(c.value).run()
                  else editor.chain().focus().unsetColor().run()
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Подсветка текста */}
      <Popover>
        <Tip label="Подсветка текста">
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={TOOL_BTN}
              aria-label="Подсветка текста"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Highlighter />
            </Button>
          </PopoverTrigger>
        </Tip>
        <PopoverContent className="w-auto p-2" align="start">
          <div className="grid grid-cols-6 gap-1.5">
            {HIGHLIGHT_COLORS.map((c) => (
              <Swatch
                key={c.value || 'none'}
                label={c.name}
                color={c.value}
                onPick={() => {
                  if (c.value) editor.chain().focus().setHighlight({ color: c.value }).run()
                  else editor.chain().focus().unsetHighlight().run()
                }}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>

      {/* Выноска (callout) */}
      <DropdownMenu>
        <Tip label="Выноска">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={TOOL_BTN}
              aria-label="Выноска"
              onMouseDown={(e) => e.preventDefault()}
            >
              <MessageSquareQuote />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="min-w-[160px]">
          {BLOCK_HIGHLIGHT_COLORS.map((c) => (
            <DropdownMenuItem
              key={c.value}
              onMouseDown={(e) => e.preventDefault()}
              onSelect={(e) => {
                e.preventDefault()
                editor.chain().focus().toggleBlockHighlight(c.value).run()
              }}
            >
              <span
                className="size-4 shrink-0 rounded-sm border"
                style={{ backgroundColor: c.swatch }}
                aria-hidden
              />
              {c.name}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Иконка */}
      <DropdownMenu>
        <Tip label="Вставить иконку">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={TOOL_BTN}
              aria-label="Вставить иконку"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Smile />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="min-w-[240px] max-h-[340px] p-2">
          <p className="mb-1.5 text-xs text-muted-foreground">Цвет иконки</p>
          <div className="mb-2 flex flex-wrap gap-1.5">
            {ICON_COLORS.map((c) => (
              <Swatch
                key={c.value || 'default'}
                label={c.name}
                color={c.value}
                selected={(c.value || null) === iconColor}
                onPick={() => setIconColor(c.value || null)}
              />
            ))}
          </div>
          <ScrollArea className="h-[220px]">
            <div className="grid grid-cols-5 gap-1">
              {HELPDOC_ICON_NAMES.map((name) => (
                <button
                  key={name}
                  type="button"
                  className="flex size-9 items-center justify-center rounded-md border hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/40 outline-none"
                  title={name}
                  aria-label={`Иконка ${name}`}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => run(() => editor.chain().focus().insertHelpIcon(name, iconColor).run())}
                  dangerouslySetInnerHTML={{ __html: sanitizeSvgIcon(HELPDOC_ICONS[name] || '') }}
                />
              ))}
            </div>
          </ScrollArea>
        </DropdownMenuContent>
      </DropdownMenu>
      <ToolbarDivider />

      {/* Вставка: изображение, видео, аудио, файл, закладка */}
      <input
        ref={fileRef}
        type="file"
        accept="image/jpeg,image/png,image/gif,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void uploadImage(file)
          e.target.value = ''
        }}
      />
      <DropdownMenu>
        <Tip label="Вставить: изображение, видео, аудио, файл, закладка">
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              className={TOOL_BTN}
              aria-label="Вставить: изображение, видео, аудио, файл, закладка"
              onMouseDown={(e) => e.preventDefault()}
            >
              <Plus />
            </Button>
          </DropdownMenuTrigger>
        </Tip>
        <DropdownMenuContent align="start" className="min-w-[180px]">
          <DropdownMenuItem
            onMouseDown={(e) => e.preventDefault()}
            onSelect={(e) => {
              e.preventDefault()
              fileRef.current?.click()
            }}
          >
            <ImagePlus />
            Изображение
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openInsert('video')}>
            <Video />
            Видео
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openInsert('audio')}>
            <Music />
            Аудио
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openInsert('file')}>
            <FileText />
            Файл
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => openInsert('bookmark')}>
            <Bookmark />
            Веб-закладка
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={insertType !== null} onOpenChange={(open) => !open && !uploadLoading && closeInsert()}>
        <DialogContent
          className="sm:max-w-md"
          aria-describedby={undefined}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <DialogHeader>
            <DialogTitle>{insertType ? INSERT_TITLES[insertType] : ''}</DialogTitle>
          </DialogHeader>
          <form onSubmit={submitInsert} className="space-y-4" noValidate>
            <Field
              label={insertType === 'bookmark' ? 'Адрес страницы' : 'Ссылка'}
              htmlFor="help-insert-url"
              error={insertError ?? undefined}
            >
              <Input
                id="help-insert-url"
                value={insertUrl}
                onChange={(e) => {
                  setInsertUrl(e.target.value)
                  setInsertError(null)
                }}
                placeholder="https://…"
                disabled={uploadLoading}
                aria-invalid={!!insertError}
                autoFocus
              />
            </Field>
            <Field
              label="Подпись"
              htmlFor="help-insert-label"
              hint={
                insertType === 'bookmark'
                  ? 'Необязательно. По умолчанию — адрес страницы.'
                  : `Необязательно. По умолчанию — «${insertType ? INSERT_DEFAULT_LABEL[insertType] : ''}».`
              }
            >
              <Input
                id="help-insert-label"
                value={insertLabel}
                onChange={(e) => setInsertLabel(e.target.value)}
                placeholder="Текст ссылки"
                disabled={uploadLoading}
              />
            </Field>
            {insertType && insertType !== 'bookmark' && (
              <div className="space-y-2 border-t pt-4">
                <p className="text-[13px] font-medium">Или загрузить файл</p>
                <input
                  ref={mediaFileRef}
                  type="file"
                  accept={
                    insertType === 'video'
                      ? 'video/mp4,video/webm,video/ogg'
                      : insertType === 'audio'
                        ? 'audio/mpeg,audio/mp3,audio/wav,audio/ogg,audio/webm,audio/mp4'
                        : 'application/pdf,.doc,.docx,.xls,.xlsx,text/plain,text/csv'
                  }
                  className="hidden"
                  disabled={uploadLoading}
                  onChange={(e) => {
                    const file = e.target.files?.[0]
                    if (file && insertType) void uploadMedia(insertType, file)
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
                  {uploadLoading && <Loader2 className="animate-spin" />}
                  {uploadLoading ? 'Загрузка…' : 'Выбрать файл'}
                </Button>
                <p className="text-xs text-muted-foreground">
                  {insertType === 'file' ? 'До 20 МБ: PDF, Word, Excel, TXT, CSV.' : 'До 50 МБ.'}
                </p>
              </div>
            )}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={closeInsert} disabled={uploadLoading}>
                Отмена
              </Button>
              <Button type="submit" disabled={!insertUrl.trim() || uploadLoading}>
                Вставить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  )
}
