/**
 * Парсер Rocket.Chat markdown → HTML для предпросмотра сообщения.
 *
 * Безопасность:
 * 1. Сначала экранируется ВЕСЬ пользовательский текст (никакого «сырого» HTML: <script>, <img onerror> и т.п.
 *    показываются как текст — так же, как их отправит Rocket.Chat).
 * 2. Код, эмодзи и ссылки заменяются плейсхолдерами, чтобы последующие правила (@mention, **bold**, *italic*)
 *    не попадали внутрь атрибутов (href/src) и блоков кода.
 * 3. Ссылки — только http(s) и mailto; атрибуты экранируются.
 * 4. Результат дополнительно проходит sanitizeMessageHtml (DOMPurify) в компоненте — defense in depth.
 */
import { emojiByShortcode, customEmojiImageUrl } from '@/lib/emoji-data'

export type PreviewEmoji = {
  name: string
  aliases?: string[]
  _id?: string
  extension?: string
  _updatedAt?: string
}

export const escapeHtml = (v: string) =>
  v
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const unescapeHtml = (v: string) =>
  v
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')

/** Ссылка из markdown допустима, только если это http(s) или mailto. */
export function safeMarkdownHref(raw: string): string | null {
  const v = raw.trim()
  if (!v || /[\s\u0000-\u001f]/.test(v)) return null
  if (!/^(https?:\/\/|mailto:)/i.test(v)) return null
  try {
    const u = new URL(v)
    if (u.protocol !== 'http:' && u.protocol !== 'https:' && u.protocol !== 'mailto:') return null
  } catch {
    return null
  }
  return v
}

/** Плейсхолдер: \u0000<n>\u0000 (NUL из входного текста предварительно удаляется). */
const PH_RE = /\u0000(\d+)\u0000/g

export function parseRocketChatMarkdown(
  text: string,
  workspaceId?: string,
  emojis?: PreviewEmoji[]
): string {
  // Имя/алиас → эмодзи воркспейса
  const customByName = new Map<string, PreviewEmoji>()
  if (emojis) {
    for (const e of emojis) {
      if (e && typeof e.name === 'string') customByName.set(e.name, e)
    }
    for (const e of emojis) {
      for (const alias of e?.aliases ?? []) if (!customByName.has(alias)) customByName.set(alias, e)
    }
  }

  const fragments: string[] = []
  const placeholder = (html: string) => {
    fragments.push(html)
    return `\u0000${fragments.length - 1}\u0000`
  }

  let html = escapeHtml(String(text ?? '').replace(/\u0000/g, ''))

  // Code blocks: ```code``` (внутри кода ничего не форматируем)
  html = html.replace(/```([\s\S]*?)```/g, (_m, code: string) =>
    placeholder(
      `<pre class="bg-muted p-3 rounded-lg overflow-x-auto my-2"><code class="text-sm font-mono">${code.trim()}</code></pre>`
    )
  )

  // Inline code: `code`
  html = html.replace(/`([^`\n]+)`/g, (_m, code: string) =>
    placeholder(`<code class="bg-muted px-1.5 py-0.5 rounded text-sm font-mono">${code}</code>`)
  )

  // Эмодзи Rocket.Chat: :emoji_name:
  // Кастомные (приоритет, как в RC) — картинка через прокси; стандартные — unicode-символ.
  const replaceEmoji = (s: string) =>
    s.replace(/:([a-zA-Z0-9_+-]+):/g, (match, emojiName: string) => {
      const shortcode = `:${emojiName}:`
      const custom = customByName.get(emojiName)
      if (custom && workspaceId) {
        const imgUrl = escapeHtml(customEmojiImageUrl(workspaceId, custom))
        return placeholder(
          `<img src="${imgUrl}" alt="${shortcode}" title="${shortcode}" class="rc-custom-emoji inline-block w-5 h-5 align-middle object-contain" />`
        )
      }
      const std = emojiByShortcode(emojiName)
      if (std) {
        return placeholder(
          `<span class="inline-block align-middle text-lg leading-none" title="${shortcode}">${escapeHtml(std.char)}</span>`
        )
      }
      // Неизвестный shortcode (например, кастомный, пока список не загружен) оставляем как текст
      return match
    })

  const formatInline = (s: string) => {
    // Mentions: @username или @all
    s = s.replace(/@(\w+)/g, '<span class="text-primary font-medium">@$1</span>')
    // Strikethrough: ~~text~~
    s = s.replace(/~~(.+?)~~/g, '<del class="line-through">$1</del>')
    // Bold: **text**
    s = s.replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold">$1</strong>')
    // Italic: *text* (но не **text**)
    s = s.replace(/(?<!\*)\*([^*]+?)\*(?!\*)/g, '<em class="italic">$1</em>')
    return s
  }

  // Links: [text](url) — до эмодзи/форматирования, чтобы правила не попадали в href.
  // Только http(s)/mailto; иначе оставляем как текст.
  html = html.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (match, label: string, rawUrl: string) => {
    const href = safeMarkdownHref(unescapeHtml(rawUrl))
    if (!href) return match
    return placeholder(
      `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer" class="text-primary hover:underline">${formatInline(replaceEmoji(label))}</a>`
    )
  })

  html = replaceEmoji(html)
  html = formatInline(html)

  // Line breaks
  html = html.replace(/\n/g, '<br />')

  // Возвращаем фрагменты (ссылки могут содержать плейсхолдеры эмодзи — раскрываем рекурсивно)
  const restore = (s: string, depth = 0): string =>
    depth > 3 ? s.replace(PH_RE, '') : s.replace(PH_RE, (_m, i: string) => restore(fragments[Number(i)] ?? '', depth + 1))
  return restore(html)
}
