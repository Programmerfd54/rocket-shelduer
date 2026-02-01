import { NextResponse } from 'next/server';
import { sendScheduledMessages } from '@/scripts/send-scheduled-messages';

// Этот эндпоинт будет вызываться через Vercel Cron Jobs
export async function GET(request: Request) {
  try {
    // Проверка авторизации для безопасности
    const authHeader = request.headers.get('authorization');
    
    if (process.env.CRON_SECRET && authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json(
        { error: 'Unauthorized' },
        { status: 401 }
      );
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
        details: error instanceof Error ? error.message : 'Unknown error'
      },
      { status: 500 }
    );
  }
}

// Разрешаем POST для ручного запуска через API
export async function POST(request: Request) {
  return GET(request);
}