import { NextResponse } from 'next/server';
import { verifyCronRequest } from '@/lib/security';
import { sendScheduledMessages } from '@/scripts/send-scheduled-messages';
import { runReactionRatingTick } from '@/lib/reactions/service';

// Этот эндпоинт будет вызываться через Vercel Cron Jobs
export async function GET(request: Request) {
  try {
    // Bearer CRON_SECRET: сравнение за постоянное время, в production секрет обязателен
    const denied = verifyCronRequest(request);
    if (denied) {
      return NextResponse.json({ error: denied.error }, { status: denied.status });
    }

    const result = await sendScheduledMessages();
    // Рейтинг реакций: синхронизация и автопубликации в фоне, чтобы не задерживать ответ cron
    void runReactionRatingTick().catch((e) => console.error('Reactions tick error:', e));

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Cron job error:', error instanceof Error ? error.message : 'Unknown error');
    return NextResponse.json(
      { error: 'Failed to process scheduled messages' },
      { status: 500 }
    );
  }
}

// Разрешаем POST для ручного запуска через API
export async function POST(request: Request) {
  return GET(request);
}