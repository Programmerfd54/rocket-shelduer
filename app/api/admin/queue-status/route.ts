import { NextResponse } from 'next/server';
import { isForbiddenError } from '@/lib/auth';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction } from '@/lib/permissions';
import { readQueueStatus } from '@/lib/queue-heartbeat';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

/**
 * Состояние очереди: когда планировщик последний раз завершил тик отправки.
 * Только чтение; доступно Lead_SUP и SUP. Секретов в ответе нет.
 */
export async function GET() {
  try {
    const user = await requireAuth();
    if (!canPerformAction(user, 'queue:status')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    const status = await readQueueStatus();
    return NextResponse.json(status, { headers: { 'Cache-Control': 'no-store' } });
  } catch (error) {
    if (isForbiddenError(error)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Queue status error:', error instanceof Error ? error.message : 'unknown');
    return NextResponse.json({ error: 'Failed to load queue status' }, { status: 500 });
  }
}
