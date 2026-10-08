import { NextResponse } from 'next/server';
import { getCurrentUser } from '@/lib/api-auth';
import { getClientIp, logSecurityEvent, SecurityEventType } from '@/lib/security';
import path from 'path';
import fs from 'fs';
import { isSafeHelpFileName } from '@/lib/help-upload-validation';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'help-uploads');

/** Скачать файл из help-uploads с заголовком Content-Disposition: attachment */
export async function GET(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }
    const { searchParams } = new URL(request.url);
    const file = searchParams.get('file');
    
    // ИСПРАВЛЕНО: проверка на null перед использованием
    if (!isSafeHelpFileName(file)) {
      await logSecurityEvent({
        type: SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
        path: '/api/help/download',
        method: 'GET',
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent') ?? undefined,
        details: `Подозрительный параметр file: ${file != null ? JSON.stringify(String(file).slice(0, 100)) : 'null'}`,
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json({ error: 'Invalid file' }, { status: 400 });
    }
    
    const rawPath = path.join(UPLOAD_DIR, file);
    const resolvedPath = path.resolve(rawPath);
    const resolvedDir = path.resolve(UPLOAD_DIR);
    
    if (resolvedPath !== resolvedDir && !resolvedPath.startsWith(resolvedDir + path.sep)) {
      await logSecurityEvent({
        type: SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
        path: '/api/help/download',
        method: 'GET',
        ipAddress: getClientIp(request),
        userAgent: request.headers.get('user-agent') ?? undefined,
        details: `Путь вне каталога загрузок: ${file.slice(0, 100)}`,
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    
    if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    // Экранирование filename для защиты от header injection (CRLF, кавычки)
    // (isSafeHelpFileName уже допускает только [A-Za-z0-9._-]; замена — дополнительная страховка)
    const safeFilename = file.replace(/[\r\n"\\]/g, '_');
    const buf = fs.readFileSync(resolvedPath);
    return new NextResponse(buf, {
      headers: {
        'Content-Disposition': `attachment; filename="${safeFilename}"`,
        'Content-Type': 'application/octet-stream',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "default-src 'none'; sandbox",
      },
    });
  } catch {
    return NextResponse.json({ error: 'Failed to download' }, { status: 500 });
  }
}