/**
 * Разбор YAML-каталога эмодзи для импорта (emoji-import, emoji-import/preview).
 * Чистая функция — покрыта unit-тестами.
 */
import yaml from 'js-yaml'
import { checkPublicHttpUrl } from '@/lib/emoji-safe-fetch'
import { isValidImportEmojiName, normalizeEmojiExt } from '@/lib/emoji-image'

/** Размер YAML-каталога. */
export const EMOJI_CATALOG_MAX_BYTES = 2 * 1024 * 1024
/** Максимум эмодзи в одном импорте (защита от бесконечного цикла загрузок/DoS RC). */
export const EMOJI_CATALOG_MAX_ITEMS = 5000

export interface CatalogEmoji {
  name: string
  src: string
  ext: string
  contentType: string
}

export interface ParsedCatalog {
  emojis: CatalogEmoji[]
  /** Сколько записей отброшено (нет имени, недопустимое имя, ссылка не http(s)/внутренний адрес, дубликат). */
  rejected: number
  /** Сколько записей не вошло из-за лимита EMOJI_CATALOG_MAX_ITEMS. */
  truncated: number
}

function contentTypeFor(ext: string): string {
  // Как и раньше: gif/jpeg, всё остальное — image/png
  return ext === 'gif' ? 'image/gif' : ext === 'jpeg' || ext === 'jpg' ? 'image/jpeg' : 'image/png'
}

export function parseEmojiCatalog(yamlText: string): ParsedCatalog {
  // js-yaml v4: load() по умолчанию безопасен (нет !!js/function); JSON_SCHEMA — ещё строже.
  // json: true — повторяющиеся ключи не роняют разбор (берётся последний). Алиасы YAML — ссылки, не копии.
  const parsed = yaml.load(yamlText, { schema: yaml.JSON_SCHEMA, json: true }) as { emojis?: unknown } | null
  const raw: unknown[] = Array.isArray(parsed?.emojis) ? (parsed!.emojis as unknown[]) : []
  const emojis: CatalogEmoji[] = []
  const seen = new Set<string>()
  let rejected = 0
  let truncated = 0
  for (const item of raw) {
    const rawName = (item as { name?: unknown })?.name
    // YAML превращает `name: 100` в число — эмодзи :100: должен остаться валидным
    const name = typeof rawName === 'number' && Number.isFinite(rawName) ? String(rawName) : rawName
    const src = (item as { src?: unknown })?.src
    if (!isValidImportEmojiName(name) || typeof src !== 'string' || seen.has(name)) {
      rejected++
      continue
    }
    const check = checkPublicHttpUrl(src)
    if (!check.ok) {
      rejected++
      continue
    }
    if (emojis.length >= EMOJI_CATALOG_MAX_ITEMS) {
      truncated++
      continue
    }
    const lastSegment = check.url.pathname.split('/').pop() || ''
    const dot = lastSegment.lastIndexOf('.')
    const ext = normalizeEmojiExt(dot > 0 ? lastSegment.slice(dot + 1) : 'png')
    seen.add(name)
    emojis.push({ name, src: check.url.toString(), ext, contentType: contentTypeFor(ext) })
  }
  return { emojis, rejected, truncated }
}
