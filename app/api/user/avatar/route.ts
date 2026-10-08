import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { writeFile, mkdir, unlink } from 'fs/promises';
import path from 'path';
import { createFixedWindowLimiter } from '@/lib/http-security';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
/** Верхняя граница тела multipart (файл + заголовки/поля) — отсекаем до разбора formData. */
const MAX_REQUEST_BYTES = MAX_SIZE + 512 * 1024;
const AVATAR_SIZE = 256;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const AVATAR_DIR = path.join(process.cwd(), 'public', 'uploads', 'avatars');

/**
 * Лимит загрузок аватара: 10 за 10 минут на пользователя (обработка sharp — CPU-дорогая).
 * Счётчик в памяти процесса; общий для реплик лимит — nginx limit_req (deploy/nginx-example.conf).
 */
const avatarUploadLimiter = createFixedWindowLimiter({ windowMs: 10 * 60 * 1000, max: 10, maxKeys: 10_000 });

/** POST — загрузить аватар текущего пользователя. multipart/form-data, поле "file". */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

    if (avatarUploadLimiter.hit(`avatar:${user.id}`)) {
      return NextResponse.json(
        { error: 'Слишком много загрузок аватара. Попробуйте через несколько минут.' },
        { status: 429, headers: { 'Retry-After': '600' } }
      );
    }
    const contentLength = Number(request.headers.get('content-length') || 0);
    if (contentLength > MAX_REQUEST_BYTES) {
      return NextResponse.json({ error: 'Файл слишком большой (макс. 5 МБ)' }, { status: 413 });
    }

    const formData = await request.formData();
    const file = formData.get('file');
    if (!file || !(file instanceof File)) {
      return NextResponse.json(
        { error: 'Файл не выбран' },
        { status: 400 }
      );
    }

    if (file.size > MAX_SIZE) {
      return NextResponse.json(
        { error: 'Файл слишком большой (макс. 5 МБ)' },
        { status: 400 }
      );
    }

    const type = file.type;
    if (!ALLOWED_TYPES.includes(type)) {
      return NextResponse.json(
        { error: 'Допустимы только изображения: JPEG, PNG, WebP, GIF' },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sharp = (await import('sharp')).default;
    // limitInputPixels — защита от «пиксельной бомбы» (маленький файл, огромное разрешение → OOM)
    const resized = await sharp(buffer, { limitInputPixels: 40_000_000 })
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    await mkdir(AVATAR_DIR, { recursive: true });
    const filename = `${user.id}.webp`;
    const filePath = path.join(AVATAR_DIR, filename);
    await writeFile(filePath, resized);

    // ?v= — новая картинка сразу видна, несмотря на Cache-Control: private, max-age=3600 у /uploads/*
    const avatarUrl = `/uploads/avatars/${filename}?v=${Date.now().toString(36)}`;
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl },
    });

    return NextResponse.json({
      success: true,
      avatarUrl,
    });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 });
    }
    console.error('Avatar upload error:', error);
    return NextResponse.json(
      { error: 'Ошибка загрузки аватара' },
      { status: 500 }
    );
  }
}

/** DELETE — удалить аватар текущего пользователя. */
export async function DELETE() {
  try {
    const user = await requireAuth();
    await prisma.user.update({
      where: { id: user.id },
      data: { avatarUrl: null },
    });
    // Файл тоже удаляем: иначе удалённый аватар остаётся доступен по старому URL
    if (/^[A-Za-z0-9_-]+$/.test(user.id)) {
      await unlink(path.join(AVATAR_DIR, `${user.id}.webp`)).catch(() => {});
    }
    return NextResponse.json({ success: true, avatarUrl: null });
  } catch (error: unknown) {
    if (error instanceof Error && error.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Необходима авторизация' }, { status: 401 });
    }
    console.error('Avatar delete error:', error);
    return NextResponse.json(
      { error: 'Ошибка удаления аватара' },
      { status: 500 }
    );
  }
}
