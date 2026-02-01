import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only ADMIN can read help main' }, { status: 403 });
    }
    const row = await prisma.helpMainContent.findFirst({ orderBy: { updatedAt: 'desc' } });
    return NextResponse.json({ content: row?.content ?? '' });
  } catch (e) {
    console.error('Admin help main GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only ADMIN can update help main' }, { status: 403 });
    }
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
    console.error('Admin help main PATCH error:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}
