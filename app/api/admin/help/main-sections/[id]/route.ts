import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only ADMIN' }, { status: 403 });
    }
    const { id } = await params;
    const body = await request.json();
    const data: { title?: string; order?: number; content?: string } = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    if (typeof body.order === 'number') data.order = body.order;
    if (typeof body.content === 'string') data.content = body.content;
    await prisma.helpMainSection.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Admin help main-section PATCH error:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only ADMIN' }, { status: 403 });
    }
    const { id } = await params;
    await prisma.helpMainSection.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    console.error('Admin help main-section DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
