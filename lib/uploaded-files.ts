/**
 * Раздача пользовательских загрузок (/help-uploads/*, /uploads/avatars/*) только авторизованным.
 *
 * Файлы лежат в public/, но статикой Next их больше не отдаёт: next.config.ts (rewrites.beforeFiles)
 * направляет эти URL в /api/uploads/[bucket]/[name], где проверяется сессия. URL в БД/HTML не меняются.
 * Попутно это чинит production: `next start` индексирует public/ только при старте, и файлы,
 * загруженные после запуска, отдавались бы 404 до перезапуска.
 *
 * Здесь — чистые помощники (типы, заголовки, Range, квоты); fs — только в serveUploadedFile.
 */
import path from 'node:path';
import { createReadStream } from 'node:fs';
import { readdir, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';

export type UploadBucket = 'help' | 'avatars';

export const UPLOAD_DIRS: Record<UploadBucket, string> = {
  help: path.join(process.cwd(), 'public', 'help-uploads'),
  avatars: path.join(process.cwd(), 'public', 'uploads', 'avatars'),
};

export function isUploadBucket(value: string | null | undefined): value is UploadBucket {
  return value === 'help' || value === 'avatars';
}

/** Один сегмент пути: без `..`, разделителей, управляющих символов. */
export function isSafeUploadName(name: string | null | undefined): name is string {
  if (!name || typeof name !== 'string') return false;
  if (name.length > 200 || name.includes('..')) return false;
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name);
}

const IMAGE_TYPES: Record<string, string> = {
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

const MEDIA_TYPES: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.ogv': 'video/ogg',
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
};

export type UploadKind = 'image' | 'media' | 'download';

export function classifyUploadName(name: string): { kind: UploadKind; contentType: string } {
  const ext = path.extname(name).toLowerCase();
  if (IMAGE_TYPES[ext]) return { kind: 'image', contentType: IMAGE_TYPES[ext] };
  if (MEDIA_TYPES[ext]) return { kind: 'media', contentType: MEDIA_TYPES[ext] };
  // PDF/Office/текст/неизвестное — только скачивание: браузер не рендерит их в нашем origin
  return { kind: 'download', contentType: 'application/octet-stream' };
}

/** CSP для ответа-файла: даже открытый напрямую файл ничего не исполняет (sandbox, без скриптов). */
export const UPLOAD_CSP = "default-src 'none'; img-src 'self'; media-src 'self'; style-src 'unsafe-inline'; sandbox";
export const UPLOAD_CACHE_CONTROL = 'private, max-age=3600';

export function uploadResponseHeaders(name: string, size: number, mtimeMs: number): Record<string, string> {
  const { kind, contentType } = classifyUploadName(name);
  const safeName = name.replace(/[^A-Za-z0-9._-]/g, '_');
  return {
    'Content-Type': contentType,
    'Content-Disposition': kind === 'download' ? `attachment; filename="${safeName}"` : 'inline',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': UPLOAD_CSP,
    'Cache-Control': UPLOAD_CACHE_CONTROL,
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Accept-Ranges': 'bytes',
    ETag: makeEtag(size, mtimeMs),
    'Last-Modified': new Date(Math.floor(mtimeMs / 1000) * 1000).toUTCString(),
  };
}

export function makeEtag(size: number, mtimeMs: number): string {
  return `W/"${size.toString(16)}-${Math.floor(mtimeMs).toString(16)}"`;
}

/**
 * Разбор заголовка Range (один диапазон bytes=a-b / a- / -n). Нужен для <video>/<audio> (Safari
 * без Range не воспроизводит mp4). null — заголовка нет/несколько диапазонов (отдаём целиком);
 * 'unsatisfiable' — 416.
 */
export function parseRange(header: string | null, size: number): { start: number; end: number } | null | 'unsatisfiable' {
  if (!header) return null;
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return null;
  const [, a, b] = m;
  if (a === '' && b === '') return null;
  let start: number;
  let end: number;
  if (a === '') {
    const suffix = Number(b);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return 'unsatisfiable';
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(a);
    end = b === '' ? size - 1 : Math.min(Number(b), size - 1);
  }
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= size) return 'unsatisfiable';
  return { start, end };
}

/** Отдать файл из каталога загрузок (имя уже проверено isSafeUploadName). null — файла нет. */
export async function serveUploadedFile(bucket: UploadBucket, name: string, request: Request): Promise<Response | null> {
  const dir = path.resolve(UPLOAD_DIRS[bucket]);
  const filePath = path.resolve(dir, name);
  if (path.dirname(filePath) !== dir) return null;
  let st;
  try {
    st = await stat(filePath);
  } catch {
    return null;
  }
  if (!st.isFile()) return null;
  const headers = uploadResponseHeaders(name, st.size, st.mtimeMs);
  const inm = request.headers.get('if-none-match');
  if (inm && inm.split(',').some((t) => t.trim() === headers.ETag)) {
    return new Response(null, { status: 304, headers: { ETag: headers.ETag, 'Cache-Control': headers['Cache-Control'] } });
  }
  const range = parseRange(request.headers.get('range'), st.size);
  if (range === 'unsatisfiable') {
    return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${st.size}`, ...headers } });
  }
  const start = range ? range.start : 0;
  const end = range ? range.end : st.size - 1;
  const length = st.size === 0 ? 0 : end - start + 1;
  const body =
    request.method === 'HEAD' || length === 0
      ? null
      : (Readable.toWeb(createReadStream(filePath, { start, end })) as unknown as ReadableStream<Uint8Array>);
  return new Response(body, {
    status: range ? 206 : 200,
    headers: {
      ...headers,
      'Content-Length': String(length),
      ...(range ? { 'Content-Range': `bytes ${start}-${end}/${st.size}` } : {}),
    },
  });
}

/* ------------------------------------------------------------------ */
/* Суточная квота загрузок справки (без БД: по файлам в каталоге)       */
/* ------------------------------------------------------------------ */

const DAY_MS = 24 * 60 * 60 * 1000;

export interface UploadQuotaLimits {
  maxFiles: number;
  maxBytes: number;
}

function positiveIntEnv(raw: string | undefined, fallback: number): number {
  const n = Number.parseInt(String(raw ?? '').trim(), 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}

/** HELP_UPLOAD_DAILY_MAX_FILES (по умолчанию 200) и HELP_UPLOAD_DAILY_MAX_MB (по умолчанию 1024). */
export function helpUploadQuotaFromEnv(env: Record<string, string | undefined> = process.env): UploadQuotaLimits {
  return {
    maxFiles: positiveIntEnv(env.HELP_UPLOAD_DAILY_MAX_FILES, 200),
    maxBytes: positiveIntEnv(env.HELP_UPLOAD_DAILY_MAX_MB, 1024) * 1024 * 1024,
  };
}

/** Время загрузки из имени help-<ts>-<rand>.<ext> (null — имя другого формата). */
export function helpUploadTimestamp(name: string): number | null {
  const m = /^help-(\d{10,16})-/.exec(name);
  if (!m) return null;
  const ts = Number(m[1]);
  return Number.isSafeInteger(ts) ? ts : null;
}

/**
 * Проверка квоты за последние 24 часа. entries — файлы каталога (имя, размер, mtime);
 * время берётся из имени файла, иначе из mtime.
 */
export function checkUploadQuota(
  entries: Array<{ name: string; size: number; mtimeMs: number }>,
  incomingBytes: number,
  limits: UploadQuotaLimits,
  now: number = Date.now()
): { ok: true; usedFiles: number; usedBytes: number } | { ok: false; reason: 'files' | 'bytes'; usedFiles: number; usedBytes: number } {
  let usedFiles = 0;
  let usedBytes = 0;
  for (const e of entries) {
    const ts = helpUploadTimestamp(e.name) ?? e.mtimeMs;
    if (now - ts < DAY_MS && ts <= now + 60_000) {
      usedFiles++;
      usedBytes += e.size;
    }
  }
  if (usedFiles + 1 > limits.maxFiles) return { ok: false, reason: 'files', usedFiles, usedBytes };
  if (usedBytes + incomingBytes > limits.maxBytes) return { ok: false, reason: 'bytes', usedFiles, usedBytes };
  return { ok: true, usedFiles, usedBytes };
}

/**
 * Список файлов каталога для checkUploadQuota (каталога нет — пусто).
 * sinceMs: файлы help-<ts>-… старше этого времени не stat'ятся (их квота не учитывает).
 */
export async function listUploadEntries(
  dir: string,
  sinceMs = 0
): Promise<Array<{ name: string; size: number; mtimeMs: number }>> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const out: Array<{ name: string; size: number; mtimeMs: number }> = [];
  for (const name of names) {
    const ts = helpUploadTimestamp(name);
    if (ts != null && ts < sinceMs) continue;
    try {
      const st = await stat(path.join(dir, name));
      if (st.isFile()) out.push({ name, size: st.size, mtimeMs: st.mtimeMs });
    } catch {
      /* файл удалён между readdir и stat */
    }
  }
  return out;
}
