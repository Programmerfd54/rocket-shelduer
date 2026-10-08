/**
 * Чистые помощники для прокси картинок эмодзи (/api/workspace/[id]/emoji-image) и импорта эмодзи.
 * Без next/fetch — покрываются unit-тестами.
 */

export type EmojiImageKind = 'png' | 'gif' | 'jpeg' | 'webp' | 'svg' | 'html' | 'unknown'

/** Максимальный размер картинки эмодзи, которую проксируем/импортируем. */
export const EMOJI_IMAGE_MAX_BYTES = 2 * 1024 * 1024
/** SVG больше этого размера не растеризуем. */
export const EMOJI_SVG_MAX_BYTES = 500 * 1024

export const RASTER_CONTENT_TYPE: Record<'png' | 'gif' | 'jpeg' | 'webp', string> = {
  png: 'image/png',
  gif: 'image/gif',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
}

/** Срезает UTF-8 BOM и ведущие пробельные байты (RC иногда отдаёт с префиксом). Возвращает смещение. */
export function leadingJunkOffset(bytes: Uint8Array): number {
  let offset = 0
  while (offset < Math.min(32, bytes.length)) {
    if (bytes[offset] === 0xef && bytes[offset + 1] === 0xbb && bytes[offset + 2] === 0xbf) offset += 3
    else if (bytes[offset] <= 0x20) offset += 1
    else break
  }
  return offset
}

/**
 * Определяет формат по сигнатуре (а не по заявленному Content-Type).
 * HTML распознаётся и по заявленному типу, и по содержимому.
 */
export function classifyEmojiImage(bytes: Uint8Array, declaredContentType = ''): EmojiImageKind {
  const b = bytes
  if (b.length >= 4 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'png'
  if (b.length >= 3 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'gif'
  if (b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg'
  if (
    b.length >= 12 &&
    b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
    b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50
  )
    return 'webp'
  const ct = declaredContentType.toLowerCase()
  const peek = new TextDecoder('utf-8', { fatal: false }).decode(b.subarray(0, 1024))
  if (ct.includes('text/html') || /<!doctype\s+html|<html[\s>]|<head[\s>]|<body[\s>]|<script[\s>]/i.test(peek))
    return 'html'
  if (/^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!doctype\s+svg[^>]*>\s*)?<svg[\s>]/i.test(peek)) return 'svg'
  return 'unknown'
}

/** Имя/id эмодзи для подстановки в путь RC: без разделителей пути, `..`, управляющих символов. */
export function isSafeEmojiKey(value: string | null | undefined): value is string {
  if (!value || typeof value !== 'string') return false
  if (value.length > 128) return false
  if (value === '.' || value === '..') return false
  if (/[\/\\\u0000-\u001f\u007f]/.test(value)) return false
  return true
}

/** Расширение файла эмодзи: только [a-z0-9]{1,5}, иначе png. */
export function normalizeEmojiExt(raw: string | null | undefined): string {
  const v = String(raw || '').toLowerCase()
  return /^[a-z0-9]{1,5}$/.test(v) ? v : 'png'
}

/**
 * Имя кастомного эмодзи для импорта: правила Rocket.Chat (без пробелов, `,:><&"'/\[]()`),
 * плюс без управляющих символов и не длиннее 64 символов.
 */
export function isValidImportEmojiName(name: unknown): name is string {
  if (typeof name !== 'string') return false
  if (name.length === 0 || name.length > 64) return false
  if (/[\s,:><&"'\/\\\[\]\(\)\u0000-\u001f\u007f]/.test(name)) return false
  return name !== '.' && name !== '..'
}
