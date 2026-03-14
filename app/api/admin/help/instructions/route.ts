import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const catalogId = body.catalogId;
    if (!catalogId || typeof catalogId !== 'string') {
      return NextResponse.json({ error: 'catalogId required' }, { status: 400 });
    }
    const title = typeof body.title === 'string' ? body.title.trim() : 'Инструкция';
    const content = typeof body.content === 'string' ? body.content : '';
    const order = typeof body.order === 'number' ? body.order : 0;
    const allowed = ['SUPPORT', 'ADM', 'VOL'];
    const roles = Array.isArray(body.roles)
      ? (body.roles as string[]).filter((r) => allowed.includes(String(r)))
      : [];
    const instruction = await prisma.helpInstruction.create({
      data: { catalogId, title, content, order, roles },
    });
    return NextResponse.json({ instruction });
  } catch (e) {
    if (isForbiddenError(e)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Admin help instructions POST error:', e);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
