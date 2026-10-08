import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { sanitizeHelpHtml } from '@/lib/sanitize';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { assertGlobalHelpMainSection, helpAdminErrorResponse } from '@/lib/help-admin';

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    await assertGlobalHelpMainSection(id);
    const body = await request.json();
    const data: { title?: string; order?: number; content?: string } = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    if (typeof body.order === 'number') data.order = body.order;
    if (typeof body.content === 'string') data.content = sanitizeHelpHtml(body.content);
    await prisma.helpMainSection.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help main-section PATCH error:');
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    await assertGlobalHelpMainSection(id);
    await prisma.helpMainSection.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help main-section DELETE error:');
  }
}
