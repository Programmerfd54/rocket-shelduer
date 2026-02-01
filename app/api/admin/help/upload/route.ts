import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';

const UPLOAD_DIR = path.join(process.cwd(), 'public', 'help-uploads');
const MAX_IMAGE = 5 * 1024 * 1024; // 5MB
const MAX_MEDIA = 50 * 1024 * 1024; // 50MB для видео/аудио
const MAX_FILE = 20 * 1024 * 1024; // 20MB для файлов

const ALLOWED_IMAGES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
const ALLOWED_VIDEO = ['video/mp4', 'video/webm', 'video/ogg'];
const ALLOWED_AUDIO = ['audio/mpeg', 'audio/mp3', 'audio/wav', 'audio/ogg', 'audio/webm', 'audio/mp4'];
const ALLOWED_FILES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'text/plain',
  'text/csv',
];
const SAFE_EXT = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.mp4', '.webm', '.ogg', '.mp3', '.wav', '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'];

const IMAGE_MAGIC: { type: string; sig: number[] }[] = [
  { type: 'image/jpeg', sig: [0xff, 0xd8, 0xff] },
  { type: 'image/png', sig: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  { type: 'image/gif', sig: [0x47, 0x49, 0x46, 0x38] },
  { type: 'image/webp', sig: [0x52, 0x49, 0x46, 0x46] },
];

function checkImageMagic(buf: Buffer, declaredType: string): boolean {
  if (!buf.length) return false;
  if (ALLOWED_IMAGES.includes(declaredType)) {
    if (declaredType === 'image/webp') {
      return buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x52 && buf[3] === 0x46 &&
        buf.length >= 12 && buf[8] === 0x57 && buf[9] === 0x45 && buf[10] === 0x42 && buf[11] === 0x50;
    }
    const m = IMAGE_MAGIC.find((x) => x.type === declaredType);
    if (m && buf.length >= m.sig.length) {
      return m.sig.every((b, i) => buf[i] === b);
    }
  }
  return true;
}

function getExt(name: string, type: string): string {
  const fromName = path.extname(name).toLowerCase();
  if (fromName && SAFE_EXT.includes(fromName)) return fromName;
  if (type.includes('pdf')) return '.pdf';
  if (type.includes('word') || type.includes('document')) return '.docx';
  if (type.includes('sheet') || type.includes('excel')) return '.xlsx';
  if (type.includes('mp4')) return '.mp4';
  if (type.includes('webm')) return '.webm';
  if (type.includes('mpeg') || type.includes('mp3')) return '.mp3';
  if (type.includes('wav')) return '.wav';
  return '.bin';
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only ADMIN can upload' }, { status: 403 });
    }
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const typeHint = (formData.get('type') as string) || 'image'; // image | video | audio | file
    if (!file || !(file instanceof File)) {
      return NextResponse.json({ error: 'No file' }, { status: 400 });
    }
    const allAllowed = [...ALLOWED_IMAGES, ...ALLOWED_VIDEO, ...ALLOWED_AUDIO, ...ALLOWED_FILES];
    if (!allAllowed.includes(file.type) && !file.type.startsWith('video/') && !file.type.startsWith('audio/')) {
      return NextResponse.json({ error: 'Invalid file type.' }, { status: 400 });
    }
    let maxSize = MAX_IMAGE;
    if (typeHint === 'video' || ALLOWED_VIDEO.includes(file.type)) maxSize = MAX_MEDIA;
    else if (typeHint === 'audio' || ALLOWED_AUDIO.includes(file.type)) maxSize = MAX_MEDIA;
    else if (typeHint === 'file' || ALLOWED_FILES.includes(file.type)) maxSize = MAX_FILE;
    if (file.size > maxSize) {
      return NextResponse.json({ error: `File too large (max ${Math.round(maxSize / 1024 / 1024)}MB)` }, { status: 400 });
    }
    const buf = Buffer.from(await file.arrayBuffer());
    if (ALLOWED_IMAGES.includes(file.type) && !checkImageMagic(buf, file.type)) {
      return NextResponse.json({ error: 'Invalid file content: image signature does not match type.' }, { status: 400 });
    }
    await mkdir(UPLOAD_DIR, { recursive: true });
    const ext = getExt(file.name, file.type);
    const name = `help-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`;
    const filePath = path.join(UPLOAD_DIR, name);
    await writeFile(filePath, buf);
    const url = `/help-uploads/${name}`;
    return NextResponse.json({ url });
  } catch {
    return NextResponse.json({ error: 'Failed to upload' }, { status: 500 });
  }
}
