import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { resolveEmojiWorkspace } from '@/lib/emoji-workspace';
import { isSsrfUrl, safeFetch } from '@/lib/ssrf';
import {
  classifyEmojiImage,
  isSafeEmojiKey,
  leadingJunkOffset,
  normalizeEmojiExt,
  EMOJI_IMAGE_MAX_BYTES,
  EMOJI_SVG_MAX_BYTES,
  RASTER_CONTENT_TYPE,
} from '@/lib/emoji-image';
import { readBodyLimited } from '@/lib/emoji-safe-fetch';

/** Картинки эмодзи меняются редко; в URL есть &t=<updatedAt>, поэтому кэш безопасен. private — ответ зависит от сессии. */
const OK_CACHE = 'private, max-age=3600';
/** Ошибки кэшируем ненадолго, чтобы не долбить RC на каждый рендер, но и не «залипать». */
const ERR_CACHE = 'private, max-age=30';
const RC_IMAGE_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
/** Защита от «пиксельной бомбы» при растеризации SVG/конвертации. */
const SHARP_LIMIT_PIXELS = 16_000_000;

/**
 * Заголовки ответа-картинки: тип зафиксирован, nosniff, а CSP sandbox не даёт исполнить что-либо,
 * даже если ответ откроют напрямую в браузере (защита от stored XSS через SVG/HTML от сервера RC).
 */
const imageHeaders = (contentType: string) => ({
  'Content-Type': contentType,
  'Cache-Control': OK_CACHE,
  'X-Content-Type-Options': 'nosniff',
  'Content-Security-Policy': "default-src 'none'; sandbox",
  'Content-Disposition': 'inline; filename="emoji"',
});

const errorResponse = (status: number) =>
  new NextResponse(null, {
    status,
    headers: { 'Cache-Control': ERR_CACHE, 'X-Content-Type-Options': 'nosniff' },
  });
const notFound = () => errorResponse(404);

/**
 * GET к RC без автоматических редиректов: следуем только за редиректами на тот же origin
 * (иначе X-Auth-Token/X-User-Id ушли бы на чужой хост, а редирект мог бы вести во внутреннюю сеть).
 */
async function fetchRc(url: string, origin: string, headers: Record<string, string>): Promise<Response | null> {
  let current = url;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    // safeFetch: DNS-проверка + проверка адреса в момент подключения (DNS rebinding)
    const res = await safeFetch(current, {
      headers,
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(RC_IMAGE_TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const loc = res.headers.get('location');
      await res.body?.cancel().catch(() => {});
      if (!loc) return null;
      const next = new URL(loc, current);
      if (next.origin !== origin) return null;
      current = next.toString();
      continue;
    }
    return res;
  }
  return null;
}

/**
 * Прокси изображений кастомных эмодзи Rocket.Chat.
 * Запрос с нашего домена устраняет CORS — картинки отображаются в пикере и в предпросмотре.
 * Доступ и креды — как у /emojis (своё подключение, назначение ADM, «эффективное» подключение к тому же RC).
 * Отдаются только растровые картинки (png/gif/jpeg/webp); SVG растеризуется в PNG, SVG/HTML как есть не отдаются никогда.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceParam } = await params;
    const { searchParams } = new URL(request.url);
    const rawName = searchParams.get('name');
    const rawId = searchParams.get('id');
    // name/id подставляются в путь RC: отбрасываем «.», «..», разделители пути, управляющие символы
    const name = isSafeEmojiKey(rawName) ? rawName : null;
    const emojiId = isSafeEmojiKey(rawId) ? rawId : null;
    const extension = normalizeEmojiExt(searchParams.get('ext'));

    if (!name && !emojiId) {
      return NextResponse.json(
        { error: 'Missing name or id' },
        { status: 400 }
      );
    }

    const access = await resolveEmojiWorkspace(user.id, workspaceParam);
    if (!access?.workspaceUrl) {
      return notFound();
    }

    const baseUrl = access.workspaceUrl.replace(/\/$/, '');
    // URL воркспейса проверяется при сохранении; повторная проверка — защита от старых/изменённых записей.
    if (!/^https?:\/\//i.test(baseUrl) || isSsrfUrl(baseUrl)) {
      return notFound();
    }
    const origin = new URL(baseUrl).origin;
    const authHeaders: Record<string, string> = {}
    if (access.auth) {
      authHeaders['X-Auth-Token'] = access.auth.authToken
      authHeaders['X-User-Id'] = access.auth.userId_RC
    }

    // Rocket.Chat раздаёт картинки по ИМЕНИ: /emoji-custom/{name}.{ext} (не по _id).
    // Сначала пробуем имя с заявленным расширением, затем прочие расширения, и только потом _id как запасной вариант.
    const pathsToTry: string[] = []
    const push = (p: string) => { if (!pathsToTry.includes(p)) pathsToTry.push(p) }
    const extNorm = extension === 'jpeg' ? 'jpg' : extension
    const otherExts = ['png', 'gif', 'jpg', 'svg', 'webp'].filter((e) => e !== extNorm && e !== extension)
    if (name) {
      const enc = encodeURIComponent(name)
      push(`emoji-custom/${enc}.${extension}`)
      if (extNorm !== extension) push(`emoji-custom/${enc}.${extNorm}`)
      for (const e of otherExts) push(`emoji-custom/${enc}.${e}`)
      push(`emoji-custom/${enc}`)
    }
    if (emojiId) {
      const enc = encodeURIComponent(emojiId)
      push(`emoji-custom/${enc}.${extension}`)
      push(`emoji-custom/${enc}`)
    }

    // Без кэша Next.js — иначе может отдать закэшированный 404/HTML. Кэшируем только ответ браузеру (Cache-Control).
    // HTML-ответ (SPA-заглушка RC для неизвестного пути, статус 200) считаем «не найдено» и пробуем следующий путь.
    let imageRes: Response | null = null
    for (const path of pathsToTry) {
      const imageUrl = `${baseUrl}/${path}`
      try {
        const res = await fetchRc(
          imageUrl,
          origin,
          { Accept: 'image/png, image/gif, image/jpeg, image/webp, image/svg+xml, image/*', ...authHeaders }
        )
        imageRes = res
        if (!res) continue
        const ct = res.headers.get('content-type') || ''
        if (res.ok && !ct.toLowerCase().includes('text/html')) break
        await res.body?.cancel().catch(() => {})
        if (res.ok) imageRes = null
      } catch (e) {
        imageRes = null
        console.warn('[emoji-image] fetch failed:', path, (e as Error).message)
      }
    }

    if (!imageRes || !imageRes.ok) {
      console.warn('[emoji-image] Not found:', { name, emojiId, tried: pathsToTry.length, status: imageRes?.status })
      return notFound()
    }

    let raw: Uint8Array
    try {
      raw = await readBodyLimited(imageRes, EMOJI_IMAGE_MAX_BYTES)
    } catch {
      console.warn('[emoji-image] Image too large:', { name, emojiId })
      return errorResponse(502)
    }
    const contentType = imageRes.headers.get('content-type') || ''

    // Убираем BOM и ведущие пробелы — RC иногда отдаёт с префиксом, тогда сигнатура не совпадает
    const bytes = raw.subarray(leadingJunkOffset(raw))
    const kind = classifyEmojiImage(bytes, contentType)

    if (kind === 'html') {
      console.warn('[emoji-image] Response is HTML, not image:', { name, emojiId })
      return errorResponse(502)
    }

    // Растровые форматы — отдаём как есть (тело без префикса, если срезали), тип — по сигнатуре
    if (kind === 'png' || kind === 'gif' || kind === 'jpeg' || kind === 'webp') {
      return new NextResponse(new Uint8Array(bytes), { headers: imageHeaders(RASTER_CONTENT_TYPE[kind]) })
    }

    const sharp = (await import('sharp')).default

    // SVG — конвертируем в PNG с фиксированным размером (иначе sharp может выдать 0×0 и пустой квадрат).
    // Сам SVG клиенту не отдаём никогда: при открытии напрямую он исполнился бы как документ на нашем origin.
    if (kind === 'svg') {
      if (bytes.length > EMOJI_SVG_MAX_BYTES) return errorResponse(502)
      let svgText = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      svgText = svgText
        .replace(/\bfill\s*=\s*["']currentColor["']/gi, 'fill="#333333"')
        .replace(/\bstroke\s*=\s*["']currentColor["']/gi, 'stroke="#333333"')
      try {
        const pngBuffer = await sharp(Buffer.from(svgText, 'utf-8'), { limitInputPixels: SHARP_LIMIT_PIXELS })
          .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer()
        return new NextResponse(new Uint8Array(pngBuffer), { headers: imageHeaders('image/png') })
      } catch (sharpError) {
        console.warn('[emoji-image] SVG→PNG failed:', (sharpError as Error).message)
        return errorResponse(502)
      }
    }

    // Неизвестная сигнатура (avif, bmp, tiff, …) — пробуем перекодировать в PNG; не картинка — не отдаём.
    try {
      const pngBuffer = await sharp(Buffer.from(bytes), { limitInputPixels: SHARP_LIMIT_PIXELS }).png().toBuffer()
      return new NextResponse(new Uint8Array(pngBuffer), { headers: imageHeaders('image/png') })
    } catch {
      console.warn('[emoji-image] Unknown format:', { name, emojiId, first: Array.from(bytes.slice(0, 12)) })
      return errorResponse(415)
    }
  } catch (error) {
    console.error('Emoji image proxy error:', error);
    return errorResponse(500);
  }
}
