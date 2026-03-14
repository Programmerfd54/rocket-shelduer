import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

export async function GET() {
  try {
    await requireAdmin();
    const row = await prisma.helpMainContent.findFirst({ orderBy: { updatedAt: 'desc' } });
    return NextResponse.json({ content: row?.content ?? '' });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help main GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
    const { content } = await request.json();
    const text = typeof content === 'string' ? content : '';
    const existing = await prisma.helpMainContent.findFirst({ orderBy: { updatedAt: 'desc' } });
    if (existing) {
      await prisma.helpMainContent.update({
        where: { id: existing.id },
        data: { content: text },
      });
    } else {
      await prisma.helpMainContent.create({ data: { content: text } });
    }
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help main PATCH error:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
