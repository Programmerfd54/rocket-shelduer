import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

export async function GET() {
  try {
    await requireAdmin();
    const catalogs = await prisma.helpCatalog.findMany({
      orderBy: { order: 'asc' },
      include: {
        instructions: { orderBy: { order: 'asc' } },
        faqs: { orderBy: { order: 'asc' } },
      },
    });
    return NextResponse.json({ catalogs });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help catalogs GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : 'Каталог';
    const order = typeof body.order === 'number' ? body.order : 0;
    const allowed = ['SUPPORT', 'ADM', 'VOL'];
    const roles = Array.isArray(body.roles)
      ? (body.roles as string[]).filter((r) => allowed.includes(String(r)))
      : [];
    const catalog = await prisma.helpCatalog.create({
      data: { title, order, roles },
    });
    return NextResponse.json({ catalog });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help catalogs POST error:', e);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
