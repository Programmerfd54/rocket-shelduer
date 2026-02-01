import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/auth';
import prisma from '@/lib/prisma';
import { writeFile, mkdir } from 'fs/promises';
import path from 'path';
import sharp from 'sharp';

const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const AVATAR_SIZE = 256;
const ALLOWED_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

/** POST — загрузить аватар текущего пользователя. multipart/form-data, поле "file". */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();

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
    const resized = await sharp(buffer)
      .resize(AVATAR_SIZE, AVATAR_SIZE, { fit: 'cover' })
      .webp({ quality: 85 })
      .toBuffer();

    const dir = path.join(process.cwd(), 'public', 'uploads', 'avatars');
    await mkdir(dir, { recursive: true });
    const filename = `${user.id}.webp`;
    const filePath = path.join(dir, filename);
    await writeFile(filePath, resized);

    const avatarUrl = `/uploads/avatars/${filename}`;
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
