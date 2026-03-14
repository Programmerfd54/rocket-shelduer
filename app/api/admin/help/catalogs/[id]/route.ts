import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const catalog = await prisma.helpCatalog.findUnique({
      where: { id },
      include: {
        instructions: { orderBy: { order: 'asc' } },
        faqs: { orderBy: { order: 'asc' } },
      },
    });
    if (!catalog) {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    return NextResponse.json(catalog);
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help catalog GET error:', e);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data: { title?: string; order?: number; roles?: string[] } = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    if (typeof body.order === 'number') data.order = body.order;
    if (body.roles !== undefined) {
      const allowed = ['SUPPORT', 'ADM', 'VOL'];
      data.roles = Array.isArray(body.roles)
        ? (body.roles as string[]).filter((r) => allowed.includes(String(r)))
        : [];
    }
    await prisma.helpCatalog.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help catalog PATCH error:', e);
    return NextResponse.json({ error: 'Failed to update' }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    await prisma.helpCatalog.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help catalog DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
