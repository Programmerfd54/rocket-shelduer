import { NextResponse } from 'next/server';
import { getClientIp } from '@/lib/security';
import { createFixedWindowLimiter } from '@/lib/http-security';

/**
 * POST — логирование ошибки с клиента (для админ-информации на страницах ошибок).
 * Эндпоинт публичный, поэтому: лимит размера тела, лимит частоты с IP, обрезка полей и удаление
 * управляющих символов (нельзя подделать строки журнала / переполнить логи).
 */
const MAX_BODY_BYTES = 16 * 1024;
const errorLogLimiter = createFixedWindowLimiter({ windowMs: 60 * 1000, max: 20 });

function clean(value: unknown, max: number): string | undefined {
  if (value == null) return undefined;
  const s = typeof value === 'string' ? value : String(value);
  return s.replace(/[\u0000-\u0008\u000b-\u001f\u007f\u2028\u2029]/g, ' ').slice(0, max);
}

export async function POST(request: Request) {
  try {
    if (errorLogLimiter.hit(getClientIp(request) ?? 'unknown')) {
      return NextResponse.json({ ok: false }, { status: 429 });
    }
    const declared = Number(request.headers.get('content-length') ?? '0');
    if (declared > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    const raw = await request.text();
    if (raw.length > MAX_BODY_BYTES) {
      return NextResponse.json({ ok: false }, { status: 413 });
    }
    let body: Record<string, unknown> | null = null;
    try {
      body = JSON.parse(raw);
    } catch {
      return NextResponse.json({ ok: false }, { status: 400 });
    }
    const { errorCode, message, stack, url } = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;

    if (!errorCode || !message) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // JSON.stringify — переводы строк экранируются, одна запись = одна строка журнала
    console.error(
      '[Client Error]',
      JSON.stringify({
        errorCode: clean(errorCode, 32),
        message: clean(message, 500),
        stack: clean(stack, 4000),
        url: clean(url, 500),
      })
    );

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
