/**
 * Чистые валидаторы загрузок справки (/api/admin/help/upload) и скачивания (/api/help/download).
 * Без fs/next — покрываются unit-тестами.
 */
import { randomBytes } from 'crypto'

export const HELP_MAX_IMAGE = 5 * 1024 * 1024 // 5MB
export const HELP_MAX_MEDIA = 50 * 1024 * 1024 // 50MB для видео/аудио
export const HELP_MAX_FILE = 20 * 1024 * 1024 // 20MB для файлов
/** Верхняя граница тела multipart-запроса (самый большой файл + запас на заголовки/поля). */
export const HELP_MAX_REQUEST_BYTES = HELP_MAX_MEDIA + 1024 * 1024

export type HelpUploadKind = 'image' | 'video' | 'audio' | 'file'

type Rule = { kind: HelpUploadKind; exts: string[]; magic?: (b: Uint8Array, ext: string) => boolean }

const startsWith = (b: Uint8Array, sig: number[], offset = 0) =>
  b.length >= offset + sig.length && sig.every((x, i) => b[offset + i] === x)
const ascii = (s: string) => Array.from(s, (c) => c.charCodeAt(0))

const isJpeg = (b: Uint8Array) => startsWith(b, [0xff, 0xd8, 0xff])
const isPng = (b: Uint8Array) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
const isGif = (b: Uint8Array) => startsWith(b, ascii('GIF87a')) || startsWith(b, ascii('GIF89a'))
const isWebp = (b: Uint8Array) => startsWith(b, ascii('RIFF')) && startsWith(b, ascii('WEBP'), 8)
const isPdf = (b: Uint8Array) => startsWith(b, ascii('%PDF-'))
/** OLE2 (doc/xls) */
const isOle = (b: Uint8Array) => startsWith(b, [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
/** ZIP (docx/xlsx) */
const isZip = (b: Uint8Array) => startsWith(b, [0x50, 0x4b, 0x03, 0x04])
/** Текст: без NUL-байтов в первых 8 КБ (бинарник под видом .txt/.csv не принимаем). */
const isText = (b: Uint8Array) => !b.subarray(0, 8192).includes(0)
/** Office: OLE2 или ZIP (зашифрованный .docx/.xlsx — OLE2). Windows шлёт .csv как application/vnd.ms-excel. */
const isOffice = (b: Uint8Array, ext: string) => (ext === '.csv' ? isText(b) : isOle(b) || isZip(b))

/** MIME → допустимые расширения и проверка сигнатуры. SVG/HTML/JS и прочее — запрещены. */
const RULES: Record<string, Rule> = {
  'image/jpeg': { kind: 'image', exts: ['.jpg', '.jpeg'], magic: isJpeg },
  'image/png': { kind: 'image', exts: ['.png'], magic: isPng },
  'image/gif': { kind: 'image', exts: ['.gif'], magic: isGif },
  'image/webp': { kind: 'image', exts: ['.webp'], magic: isWebp },
  'video/mp4': { kind: 'video', exts: ['.mp4'] },
  'video/webm': { kind: 'video', exts: ['.webm'] },
  'video/ogg': { kind: 'video', exts: ['.ogg', '.ogv'] },
  'audio/mpeg': { kind: 'audio', exts: ['.mp3'] },
  'audio/mp3': { kind: 'audio', exts: ['.mp3'] },
  'audio/wav': { kind: 'audio', exts: ['.wav'] },
  'audio/ogg': { kind: 'audio', exts: ['.ogg', '.oga'] },
  'audio/webm': { kind: 'audio', exts: ['.webm'] },
  'audio/mp4': { kind: 'audio', exts: ['.m4a', '.mp4'] },
  'application/pdf': { kind: 'file', exts: ['.pdf'], magic: isPdf },
  'application/msword': { kind: 'file', exts: ['.doc', '.docx'], magic: isOffice },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'file', exts: ['.docx', '.doc'], magic: isOffice },
  'application/vnd.ms-excel': { kind: 'file', exts: ['.xls', '.xlsx', '.csv'], magic: isOffice },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'file', exts: ['.xlsx', '.xls'], magic: isOffice },
  'text/plain': { kind: 'file', exts: ['.txt'], magic: isText },
  'text/csv': { kind: 'file', exts: ['.csv'], magic: isText },
}

/** Прочие video/* и audio/* (quicktime, x-m4a, …) — допускаются, но только с медиа-расширением, иначе .bin. */
const GENERIC_MEDIA_EXTS = ['.mp4', '.webm', '.ogg', '.ogv', '.oga', '.mp3', '.wav', '.m4a', '.mov', '.m4v', '.aac', '.flac']

export function maxSizeFor(kind: HelpUploadKind): number {
  return kind === 'image' ? HELP_MAX_IMAGE : kind === 'file' ? HELP_MAX_FILE : HELP_MAX_MEDIA
}

function extOf(name: string): string {
  const base = String(name || '').split(/[\\/]/).pop() || ''
  const i = base.lastIndexOf('.')
  return i > 0 ? base.slice(i).toLowerCase() : ''
}

export type HelpUploadCheck =
  | { ok: true; kind: HelpUploadKind; ext: string; maxSize: number }
  | { ok: false; status: number; error: string }

/**
 * Проверка метаданных до чтения содержимого: MIME из allow-list, размер по фактическому типу
 * (подсказка клиента `type` больше не может поднять лимит).
 */
export function checkHelpUploadMeta(
  file: { name: string; type: string; size: number },
  typeHint?: string | null
): HelpUploadCheck {
  const type = String(file.type || '').toLowerCase().split(';')[0].trim()
  const rule = RULES[type]
  let kind: HelpUploadKind
  let ext: string
  const nameExt = extOf(file.name)
  if (rule) {
    kind = rule.kind
    ext = rule.exts.includes(nameExt) ? nameExt : rule.exts[0]
  } else if (/^(video|audio)\/[a-z0-9.+-]+$/.test(type)) {
    kind = type.startsWith('video/') ? 'video' : 'audio'
    ext = GENERIC_MEDIA_EXTS.includes(nameExt) ? nameExt : '.bin'
  } else {
    return { ok: false, status: 400, error: 'Invalid file type.' }
  }
  // Картинка, вставленная через «Файл», исторически допускалась до лимита файлов (20MB). Подсказка
  // может выбрать только между лимитами image/file — до 50MB медиа её поднять нельзя.
  const maxSize = kind === 'image' && typeHint === 'file' ? HELP_MAX_FILE : maxSizeFor(kind)
  if (!Number.isFinite(file.size) || file.size <= 0) {
    return { ok: false, status: 400, error: 'Empty file' }
  }
  if (file.size > maxSize) {
    return { ok: false, status: 400, error: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` }
  }
  return { ok: true, kind, ext, maxSize }
}

/** Сверка сигнатуры содержимого с заявленным MIME (для типов, где сигнатура известна). */
export function checkHelpUploadContent(type: string, ext: string, buf: Uint8Array): boolean {
  if (!buf.length) return false
  const rule = RULES[String(type || '').toLowerCase().split(';')[0].trim()]
  if (!rule?.magic) return true
  return rule.magic(buf, ext)
}

/** Случайное имя файла (криптостойкое), формат совместим с прежним: help-<ts>-<rand><ext>. */
export function randomHelpUploadName(ext: string): string {
  const safeExt = /^\.[a-z0-9]{1,8}$/.test(ext) ? ext : '.bin'
  return `help-${Date.now()}-${randomBytes(12).toString('hex')}${safeExt}`
}

/**
 * Имя файла для /api/help/download: один сегмент пути, без `..`, управляющих символов и разделителей.
 */
export function isSafeHelpFileName(name: string | null | undefined): name is string {
  if (!name || typeof name !== 'string') return false
  if (name.length > 200) return false
  if (name.includes('..')) return false
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)
}
