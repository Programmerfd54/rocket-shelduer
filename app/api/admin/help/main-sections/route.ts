import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

/** Список разделов (вкладок) «Основные моменты». Только ADMIN. */
export async function GET() {
  try {
    await requireAdmin();
    const sections = await prisma.helpMainSection.findMany({
      orderBy: { order: 'asc' },
    });
    return NextResponse.json({ sections });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help main-sections GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

/** Создать раздел «Основные моменты». */
export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : 'Новый раздел';
    const order = typeof body.order === 'number' ? body.order : 0;
    const content = typeof body.content === 'string' ? body.content : '';
    const section = await prisma.helpMainSection.create({
      data: { title, order, content },
    });
    return NextResponse.json({ section });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help main-sections POST error:', e);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
