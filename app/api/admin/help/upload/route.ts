import { NextResponse } from 'next/server';
import { isForbiddenError } from '@/lib/auth';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import {
  HELP_MAX_REQUEST_BYTES,
  checkHelpUploadMeta,
  checkHelpUploadContent,
  randomHelpUploadName,
} from '@/lib/help-upload-validation';
import { checkUploadQuota, helpUploadQuotaFromEnv, listUploadEntries } from '@/lib/uploaded-files';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'help-uploads');
const DAY_MS = 24 * 60 * 60 * 1000;

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help:upload');
    // Отсекаем заведомо слишком большие тела до разбора multipart (иначе всё тело читается в память).
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > HELP_MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'File too large' }, { status: 413 });
    }
    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file' }, { status: 400 });
    }
    // Тип и лимит — по фактическому MIME (allow-list); подсказка клиента не поднимает лимит до медиа.
    const typeHint = formData.get('type');
    const meta = checkHelpUploadMeta(file, typeof typeHint === 'string' ? typeHint : null);
    if (!meta.ok) {
      return NextResponse.json({ error: meta.error }, { status: meta.status });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (buf.length > meta.maxSize) {
      return NextResponse.json({ error: 'File too large' }, { status: 400 });
    }
    if (!checkHelpUploadContent(file.type, meta.ext, buf)) {
      return NextResponse.json({ error: 'Invalid file content: signature does not match type.' }, { status: 400 });
    }
    // Суточная квота (число файлов и объём за 24 ч) — защита диска от заполнения; считается по файлам
    // каталога, поэтому общая для всех реплик с общим томом и не требует таблицы в БД.
    const now = Date.now();
    const quota = checkUploadQuota(await listUploadEntries(UPLOAD_DIR, now - DAY_MS), buf.length, helpUploadQuotaFromEnv(), now);
    if (!quota.ok) {
      return NextResponse.json(
        {
          error:
            quota.reason === 'files'
              ? 'Превышен суточный лимит количества загрузок справки. Попробуйте позже.'
              : 'Превышен суточный лимит объёма загрузок справки. Попробуйте позже.',
        },
        { status: 429, headers: { 'Retry-After': '3600' } }
      );
    }
    await mkdir(UPLOAD_DIR, { recursive: true });
    const name = randomHelpUploadName(meta.ext);
    const filePath = path.join(UPLOAD_DIR, name);
    // wx — не перезаписывать существующий файл
    await writeFile(filePath, buf, { flag: 'wx' });
    const url = `/help-uploads/${name}`;
    return NextResponse.json({ url });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    if (e instanceof Error && e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    console.error('Admin help upload error:', e);
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
