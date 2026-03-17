import { NextResponse } from 'next/server';

/** POST — логирование ошибки с клиента (для админ-информации на страницах ошибок) */
export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { errorCode, message, stack, url } = body || {};

    if (!errorCode || !message) {
      return NextResponse.json({ ok: false }, { status: 400 });
    }

    // Логируем в консоль для отладки (в production можно писать в БД или внешний сервис)
    console.error('[Client Error]', { errorCode, message, stack, url });

    // Опционально: сохранять в ActivityLog или отдельную таблицу
    // Пока только console.error — при необходимости можно расширить

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
