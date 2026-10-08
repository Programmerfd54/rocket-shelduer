import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/auth';
import { isSafeUploadName, isUploadBucket, serveUploadedFile } from '@/lib/uploaded-files';

export const dynamic = 'force-dynamic';

const noStore = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' };

/**
 * Пользовательские загрузки только для авторизованных.
 * Публичные URL /help-uploads/<name> и /uploads/avatars/<name> переписываются сюда (next.config.ts),
 * middleware дополнительно отвечает 401 без валидного JWT. Здесь — полная проверка сессии (БД, device-id).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ bucket: string; name: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401, headers: noStore });
  }
  const { bucket, name } = await params;
  if (!isUploadBucket(bucket) || !isSafeUploadName(name)) {
    return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore });
  }
  const res = await serveUploadedFile(bucket, name, request);
  if (!res) return NextResponse.json({ error: 'Not found' }, { status: 404, headers: noStore });
  return res;
}
