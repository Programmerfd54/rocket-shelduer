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
    const row = await prisma.helpMainContent.findFirst({
      where: { ...GLOBAL_SCOPE },
      orderBy: { updatedAt: 'desc' },
    });
    return NextResponse.json({ content: row?.content ?? '' });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help main GET error:');
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const body = await request.json().catch(() => ({}));
    const text = typeof body.content === 'string' ? sanitizeHelpHtml(body.content) : '';
    const existing = await prisma.helpMainContent.findFirst({
      where: { ...GLOBAL_SCOPE },
      orderBy: { updatedAt: 'desc' },
    });
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
    return helpAdminErrorResponse(e, 'Admin help main PATCH error:');
  }
}
