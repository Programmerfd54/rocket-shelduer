import { NextResponse } from 'next/server';
import { sendScheduledMessages } from '@/scripts/send-scheduled-messages';

// Этот эндпоинт будет вызываться через Vercel Cron Jobs
export async function GET(request: Request) {
  try {
    // В production CRON_SECRET обязателен; без него отклоняем запрос
    const authHeader = request.headers.get('authorization');
    const cronSecret = process.env.CRON_SECRET;
    if (process.env.NODE_ENV === 'production') {
      if (!cronSecret) {
        return NextResponse.json({ error: 'CRON_SECRET must be set in production' }, { status: 503 });
      }
      if (authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    } else if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const result = await sendScheduledMessages();

    return NextResponse.json({
      success: true,
      ...result,
      timestamp: new Date().toISOString(),
    });

  } catch (error) {
    console.error('Cron job error:', error);
    return NextResponse.json(
      {
        error: 'Failed to process scheduled messages',
        ...(process.env.NODE_ENV !== 'production' && { details: error instanceof Error ? error.message : 'Unknown error' }),
      },
      { status: 500 }
    );
  }
}

// Разрешаем POST для ручного запуска через API
export async function POST(request: Request) {
  return GET(request);
}