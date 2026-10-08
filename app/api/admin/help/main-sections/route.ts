import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sanitizeHelpHtml } from '@/lib/sanitize';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';
import { helpAdminErrorResponse } from '@/lib/help-admin';

export async function GET() {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const sections = await prisma.helpMainSection.findMany({
      where: { ...GLOBAL_SCOPE },
      orderBy: { order: 'asc' },
    });
    return NextResponse.json({ sections });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help main-sections GET error:');
  }
}

/** Создать раздел «Основные моменты». */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : 'Новый раздел';
    const order = typeof body.order === 'number' ? body.order : 0;
    const content = typeof body.content === 'string' ? sanitizeHelpHtml(body.content) : '';
    const section = await prisma.helpMainSection.create({
      data: { title, order, content },
    });
    return NextResponse.json({ section });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help main-sections POST error:');
  }
}
