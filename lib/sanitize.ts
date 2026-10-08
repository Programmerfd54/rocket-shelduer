/**
 * Санитизация HTML для защиты от XSS.
 * Используется во всех местах с dangerouslySetInnerHTML и innerHTML.
 */
import DOMPurify from 'isomorphic-dompurify'

/**
 * Разрешённые схемы URL (href/src): http(s), mailto, tel и относительные пути («/…», «#…», «?…»).
 * Это стандартное выражение DOMPurify без ftp/sms/xmpp/cid/callto/matrix.
 * javascript:, vbscript:, data: (кроме data: в <img>, который DOMPurify разрешает отдельно) — отклоняются.
 */
const HELP_URI_REGEXP = /^(?:(?:https?|mailto|tel):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i
const MESSAGE_URI_REGEXP = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i

/**
 * CSS-свойства, которые может выставлять редактор справки (TipTap: Color, BackgroundColor, Highlight,
 * выравнивание, размер картинки, цвет иконки). Всё остальное (position, z-index, inset, transform,
 * background-image, …) вырезается — иначе автор справки может перекрыть интерфейс (UI redressing / фишинг).
 */
const ALLOWED_STYLE_PROPS = new Set([
  'color',
  'background-color',
  'text-align',
  'text-decoration',
  'font-weight',
  'font-style',
  'vertical-align',
  'width',
  'height',
  'max-width',
])
/** Значение CSS: цвета (#hex, rgb(), hsl(), var(--x)), размеры, ключевые слова. Без url(), expression, кавычек, `\`. */
const SAFE_STYLE_VALUE = /^[#a-z0-9\s.,%()+-]+$/i
const UNSAFE_STYLE_VALUE = /url\s*\(|expression\s*\(|image-set|@import|javascript:|\/\*|\\/i

/**
 * Tailwind-классы, позволяющие вынести контент за пределы карточки справки и перекрыть страницу
 * (`fixed inset-0 z-50 …`). Проверяется последний сегмент после вариантов (`md:fixed` → `fixed`).
 */
const UNSAFE_CLASS =
  /^(fixed|absolute|sticky|inset(-.+)?|-?(top|right|bottom|left|start|end)-.+|-?z-.+|(w|h|min-w|min-h|max-w|max-h|size)-(screen|dvh|svh|lvh|dvw|svw|lvw)|pointer-events-.+|-?translate-.+|-?scale-.+|-?rotate-.+|-?skew-.+|transform.*|invisible|opacity-0|sr-only)$/

type SanitizeMode = 'help' | 'message' | null
/** Хуки DOMPurify глобальные для инстанса; режим выставляется на время синхронного вызова sanitize(). */
let mode: SanitizeMode = null

export function filterHelpStyle(style: string): string {
  const out: string[] = []
  for (const decl of style.split(';')) {
    const idx = decl.indexOf(':')
    if (idx <= 0) continue
    const prop = decl.slice(0, idx).trim().toLowerCase()
    const value = decl.slice(idx + 1).trim()
    if (!ALLOWED_STYLE_PROPS.has(prop) || !value) continue
    if (UNSAFE_STYLE_VALUE.test(value) || !SAFE_STYLE_VALUE.test(value)) continue
    out.push(`${prop}: ${value}`)
  }
  return out.join('; ')
}

export function filterHelpClass(cls: string): string {
  return cls
    .split(/\s+/)
    .filter((token) => {
      if (!token) return false
      const base = token.split(':').pop()!.replace(/^!/, '')
      return !UNSAFE_CLASS.test(base)
    })
    .join(' ')
}

function enforceSafeTarget(el: Element) {
  if (!el.hasAttribute('target')) return
  if (el.getAttribute('target') !== '_blank') {
    el.removeAttribute('target')
    return
  }
  // target=_blank без noopener даёт доступ к window.opener (reverse tabnabbing)
  el.setAttribute('rel', 'noopener noreferrer')
}

DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (!mode || !(node as Element).getAttribute) return
  const el = node as Element
  enforceSafeTarget(el)
  if (mode !== 'help') return
  const style = el.getAttribute('style')
  if (style != null) {
    const filtered = filterHelpStyle(style)
    if (filtered) el.setAttribute('style', filtered)
    else el.removeAttribute('style')
  }
  const cls = el.getAttribute('class')
  if (cls != null) {
    const filtered = filterHelpClass(cls)
    if (filtered) el.setAttribute('class', filtered)
    else el.removeAttribute('class')
  }
})

function withMode<T>(m: SanitizeMode, fn: () => T): T {
  const prev = mode
  mode = m
  try {
    return fn()
  } finally {
    mode = prev
  }
}

/** HTML справки (инструкции, FAQ, каталоги) */
export function sanitizeHelpHtml(html: string): string {
  if (!html || typeof html !== 'string') return ''
  return withMode('help', () =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: [
        'p', 'br', 'hr', 'strong', 'b', 'em', 'i', 'u', 's', 'mark', 'a', 'ul', 'ol', 'li',
        'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'span', 'div', 'img',
        'table', 'thead', 'tbody', 'tr', 'th', 'td',
      ],
      ALLOWED_ATTR: [
        'href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'style', 'width', 'height', 'start',
        'colspan', 'rowspan', 'data-icon', 'data-icon-color', 'data-color', 'data-type',
      ],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: HELP_URI_REGEXP,
    })
  )
}

/** HTML сообщений (предпросмотр Rocket.Chat markdown) */
export function sanitizeMessageHtml(html: string): string {
  if (!html || typeof html !== 'string') return ''
  return withMode('message', () =>
    DOMPurify.sanitize(html, {
      ALLOWED_TAGS: ['span', 'img', 'a', 'strong', 'em', 'del', 'code', 'pre', 'br'],
      ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
      ALLOW_DATA_ATTR: false,
      ALLOWED_URI_REGEXP: MESSAGE_URI_REGEXP,
    })
  )
}

/** SVG-иконки из HELPDOC_ICONS (доверенный источник, но санитизация для SAST) */
export function sanitizeSvgIcon(svg: string): string {
  if (!svg || typeof svg !== 'string') return ''
  return DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: ['svg', 'path', 'circle', 'line', 'polyline', 'rect', 'polygon'],
    ALLOWED_ATTR: ['xmlns', 'width', 'height', 'viewbox', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'class', 'd', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'points', 'x', 'y'],
  })
}

/**
 * Внешняя ссылка из пользовательских данных: только http(s)/mailto. Иначе — null (не рендерить href).
 */
export function safeExternalHref(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null
  const v = raw.trim()
  try {
    const u = new URL(v)
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return v
  } catch {
    /* не URL */
  }
  return null
}
