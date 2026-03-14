import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    await requireAdmin();
    const { id } = await params;
    const body = await request.json();
    const data: { question?: string; answer?: string; order?: number; catalogId?: string | null; roles?: string[] } = {};
    if (typeof body.question === 'string') data.question = body.question.trim();
    if (typeof body.answer === 'string') data.answer = body.answer;
    if (typeof body.order === 'number') data.order = body.order;
    if (body.catalogId !== undefined) {
      if (body.catalogId === null || (typeof body.catalogId === 'string' && !body.catalogId.trim())) {
        data.catalogId = null;
      } else if (typeof body.catalogId === 'string') {
        const catalogId = body.catalogId.trim();
        const catalog = await prisma.helpCatalog.findUnique({ where: { id: catalogId } });
        if (!catalog) {
          return NextResponse.json({ error: 'Catalog not found' }, { status: 400 });
        }
        data.catalogId = catalogId;
      }
    }
    if (body.roles !== undefined) {
      const allowed = ['SUPPORT', 'ADM', 'VOL'];
      data.roles = Array.isArray(body.roles)
        ? (body.roles as string[]).filter((r) => allowed.includes(String(r)))
        : [];
    }
    await prisma.helpFAQ.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isForbiddenError(e)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Admin help FAQ PATCH error:', e);
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
    await prisma.helpFAQ.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    if (isForbiddenError(e)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    console.error('Admin help FAQ DELETE error:', e);
    return NextResponse.json({ error: 'Failed to delete' }, { status: 500 });
  }
}
