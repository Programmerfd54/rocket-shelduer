import { NextResponse } from 'next/server';
import sharp from 'sharp';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

/**
 * Прокси изображений кастомных эмодзи Rocket.Chat.
 * Запрос с нашего домена устраняет CORS — картинки отображаются в пикере и в предпросмотре.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: rawId } = await params;
    const { searchParams } = new URL(request.url);
    const name = searchParams.get('name');
    const emojiId = searchParams.get('id');
    const extension = searchParams.get('ext') || 'png';

    if (!name && !emojiId) {
      return NextResponse.json(
        { error: 'Missing name or id' },
        { status: 400 }
      );
    }

    // Если в путь попал URL воркспейса (например из закладки), ищем по workspaceUrl
    const looksLikeUrl = /^https?:\//i.test(rawId) || rawId.includes('://') || /^[a-z0-9.-]+\.(ru|com|org)/i.test(rawId);
    const normalizeUrl = (u: string) => u.replace(/^https?:\/+/, 'https://').replace(/([^:])\/+/g, '$1/').replace(/\/$/, '');
    const normalized = looksLikeUrl ? normalizeUrl(rawId) : null;
    const workspace = await prisma.workspaceConnection.findFirst({
      where: looksLikeUrl
        ? {
            userId: user.id,
            OR: [
              { workspaceUrl: rawId },
              { workspaceUrl: normalized! },
              { workspaceUrl: `${normalized}/` },
              { workspaceUrl: rawId.startsWith('http') ? rawId : `https://${rawId}` },
            ],
          }
        : {
            id: rawId,
            userId: user.id,
          },
      select: { workspaceUrl: true, authToken: true, userId_RC: true },
    });

    if (!workspace?.workspaceUrl) {
      return new NextResponse(null, { status: 404 });
    }

    const baseUrl = workspace.workspaceUrl.replace(/\/$/, '');
    const authHeaders: Record<string, string> = {}
    if (workspace.authToken && workspace.userId_RC) {
      authHeaders['X-Auth-Token'] = workspace.authToken
      authHeaders['X-User-Id'] = workspace.userId_RC
    }

    // Rocket.Chat отдаёт картинки по пути /emoji-custom/{_id}.{ext} или по имени (пробуем с auth)
    const pathsToTry: string[] = []
    const extNorm = extension === 'jpeg' ? 'jpg' : extension
    if (emojiId) {
      pathsToTry.push(`emoji-custom/${emojiId}.${extension}`)
      if (extension === 'jpeg') pathsToTry.push(`emoji-custom/${emojiId}.jpg`)
      pathsToTry.push(`emoji-custom/${emojiId}.${extNorm}`)
      pathsToTry.push(`emoji-custom/${emojiId}`)
      if (extension !== 'gif') pathsToTry.push(`emoji-custom/${emojiId}.gif`)
    }
    if (name) {
      const enc = encodeURIComponent(name)
      pathsToTry.push(`emoji-custom/${enc}.${extension}`)
      pathsToTry.push(`emoji-custom/${name}.${extension}`)
      if (extension === 'jpeg') {
        pathsToTry.push(`emoji-custom/${enc}.jpg`)
        pathsToTry.push(`emoji-custom/${name}.jpg`)
      }
      pathsToTry.push(`emoji-custom/${enc}`)
      pathsToTry.push(`emoji-custom/${name}`)
      if (extension !== 'gif') {
        pathsToTry.push(`emoji-custom/${enc}.gif`)
        pathsToTry.push(`emoji-custom/${name}.gif`)
      }
    }

    // Без кэша — иначе Next.js может отдать закэшированный 404/HTML и картинки не появятся
    let imageRes: Response | null = null
    for (const path of pathsToTry) {
      const imageUrl = `${baseUrl}/${path}`
      imageRes = await fetch(imageUrl, {
        headers: { Accept: 'image/png, image/gif, image/jpeg, image/webp, image/*', ...authHeaders },
        cache: 'no-store',
      })
      if (imageRes.ok) break
    }

    if (!imageRes || !imageRes.ok) {
      console.warn('[emoji-image] Not found:', { name, emojiId, baseUrl, tried: pathsToTry.length, status: imageRes?.status })
      return new NextResponse(null, { status: 404 })
    }

    const blob = await imageRes.arrayBuffer()
    let bytes = new Uint8Array(blob)
    const contentType = imageRes.headers.get('content-type') || ''

    // Убираем BOM и ведущие пробелы — RC иногда отдаёт с префиксом, тогда сигнатура не совпадает
    let offset = 0
    while (offset < Math.min(32, bytes.length) && (bytes[offset] === 0xef && bytes[offset + 1] === 0xbb && bytes[offset + 2] === 0xbf || bytes[offset] <= 0x20)) {
      if (bytes[offset] === 0xef && bytes[offset + 1] === 0xbb && bytes[offset + 2] === 0xbf) offset += 3
      else offset += 1
    }
    if (offset > 0) bytes = bytes.subarray(offset)

    const peek = new TextDecoder('utf-8', { fatal: false }).decode(bytes.slice(0, 256))
    const looksLikeHtml = /^\s*<!DOCTYPE/i.test(peek) || /^\s*<html[\s>]/i.test(peek)
    const looksLikeSvg = /^\s*(<\?xml|<\s*svg)/i.test(peek)
    const pngSig = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
    const gifSig = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
    const jpegSig = bytes[0] === 0xff && bytes[1] === 0xd8

    if (looksLikeHtml || contentType.toLowerCase().includes('text/html')) {
      console.warn('[emoji-image] Response is HTML, not image:', { name, emojiId })
      return new NextResponse(null, { status: 502 })
    }

    // Растровые форматы — отдаём как есть (тело без префикса, если срезали)
    if (pngSig || gifSig || jpegSig) {
      const body = offset > 0 ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : blob
      return new NextResponse(body, {
        headers: {
          'Content-Type': pngSig ? 'image/png' : gifSig ? 'image/gif' : 'image/jpeg',
          'Cache-Control': 'public, max-age=3600',
        },
      })
    }

    // SVG — конвертируем в PNG с фиксированным размером (иначе sharp может выдать 0×0 и пустой квадрат)
    let bodyToSend: ArrayBuffer | Buffer = offset > 0 ? bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) : blob
    let finalContentType = contentType.toLowerCase().includes('svg') ? 'image/svg+xml' : 'image/png'
    if (looksLikeSvg && bytes.length > 0 && bytes.length < 500 * 1024) {
      let svgText = new TextDecoder('utf-8', { fatal: false }).decode(bytes)
      svgText = svgText
        .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/\s+on\w+\s*=\s*["'][^"']*["']/gi, '')
        .replace(/\s+on\w+\s*=\s*[^\s>]*/gi, '')
      svgText = svgText
        .replace(/\bfill\s*=\s*["']currentColor["']/gi, 'fill="#333333"')
        .replace(/\bstroke\s*=\s*["']currentColor["']/gi, 'stroke="#333333"')
      const svgBuffer = Buffer.from(svgText, 'utf-8')
      try {
        const pngBuffer = await sharp(svgBuffer)
          .resize(64, 64, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
          .png()
          .toBuffer()
        bodyToSend = pngBuffer
        finalContentType = 'image/png'
      } catch (sharpError) {
        console.warn('[emoji-image] SVG→PNG failed:', (sharpError as Error).message)
        bodyToSend = Buffer.from(svgText, 'utf-8')
        finalContentType = 'image/svg+xml; charset=utf-8'
      }
    } else if (!looksLikeSvg) {
      console.warn('[emoji-image] Unknown format:', { name, emojiId, first: Array.from(bytes.slice(0, 12)) })
    }

    const body: BodyInit = Buffer.isBuffer(bodyToSend)
      ? new Uint8Array(bodyToSend)
      : bodyToSend
    return new NextResponse(body, {
      headers: {
        'Content-Type': finalContentType,
        'Cache-Control': 'public, max-age=3600',
      },
    })
  } catch (error) {
    console.error('Emoji image proxy error:', error);
    return new NextResponse(null, { status: 500 });
  }
}
