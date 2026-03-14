import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

export async function POST(request: Request) {
  try {
    await requireAdmin();
    const body = await request.json();
    const catalogId = body.catalogId === null || body.catalogId === undefined ? null : (body.catalogId as string);
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const answer = typeof body.answer === 'string' ? body.answer : '';
    const order = typeof body.order === 'number' ? body.order : 0;
    const allowed = ['SUPPORT', 'ADM', 'VOL'];
    const roles = Array.isArray(body.roles)
      ? (body.roles as string[]).filter((r) => allowed.includes(String(r)))
      : [];
    const faq = await prisma.helpFAQ.create({
      data: { catalogId, question, answer, order, roles },
    });
    return NextResponse.json({ faq });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help FAQ POST error:', e);
    return NextResponse.json({ error: 'Failed to create' }, { status: 500 });
  }
}
