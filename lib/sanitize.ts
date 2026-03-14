/**
 * Санитизация HTML для защиты от XSS.
 * Используется во всех местах с dangerouslySetInnerHTML и innerHTML.
 */
import DOMPurify from 'isomorphic-dompurify'

/** HTML справки (инструкции, FAQ, каталоги) */
export function sanitizeHelpHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'u', 's', 'a', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'code', 'pre', 'span', 'div', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel', 'style', 'data-icon', 'data-icon-color'],
  })
}

/** HTML сообщений (предпросмотр Rocket.Chat markdown) */
export function sanitizeMessageHtml(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['span', 'img', 'a', 'strong', 'em', 'del', 'code', 'pre', 'br'],
    ALLOWED_ATTR: ['href', 'src', 'alt', 'title', 'class', 'target', 'rel'],
    ADD_ATTR: ['target', 'rel'],
  })
}

/** SVG-иконки из HELPDOC_ICONS (доверенный источник, но санитизация для SAST) */
export function sanitizeSvgIcon(svg: string): string {
  if (!svg || typeof svg !== 'string') return ''
  return DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: ['svg', 'path', 'circle', 'line', 'polyline', 'rect', 'polygon'],
    ALLOWED_ATTR: ['xmlns', 'width', 'height', 'viewbox', 'viewBox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'class', 'd', 'cx', 'cy', 'r', 'x1', 'x2', 'y1', 'y2', 'points', 'x', 'y'],
  })
}
