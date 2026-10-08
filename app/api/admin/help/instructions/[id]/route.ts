import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { sanitizeHelpHtml } from '@/lib/sanitize';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { assertGlobalHelpInstruction, helpAdminErrorResponse } from '@/lib/help-admin';

const ALLOWED_ROLES = ['SUP', 'ADM', 'VOL', 'MEMBER'];

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    await assertGlobalHelpInstruction(id);
    const body = await request.json();
    const data: { title?: string; content?: string; order?: number; roles?: string[] } = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    if (typeof body.content === 'string') data.content = sanitizeHelpHtml(body.content);
    if (typeof body.order === 'number') data.order = body.order;
    if (body.roles !== undefined) {
      data.roles = Array.isArray(body.roles)
        ? (body.roles as string[]).filter((r) => ALLOWED_ROLES.includes(String(r)))
        : [];
    }
    await prisma.helpInstruction.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help instruction PATCH error:');
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
    await assertGlobalHelpInstruction(id);
    await prisma.helpInstruction.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help instruction DELETE error:');
  }
}
