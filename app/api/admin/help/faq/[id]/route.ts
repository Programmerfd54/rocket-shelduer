import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { sanitizeHelpHtml } from '@/lib/sanitize';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { assertGlobalHelpCatalog, assertGlobalHelpFaq, helpAdminErrorResponse } from '@/lib/help-admin';

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
    await assertGlobalHelpFaq(id);
    const body = await request.json();
    const data: { question?: string; answer?: string; order?: number; catalogId?: string | null; roles?: string[] } = {};
    if (typeof body.question === 'string') data.question = body.question.trim();
    if (typeof body.answer === 'string') data.answer = sanitizeHelpHtml(body.answer);
    if (typeof body.order === 'number') data.order = body.order;
    if (body.catalogId !== undefined) {
      if (body.catalogId === null || (typeof body.catalogId === 'string' && !body.catalogId.trim())) {
        data.catalogId = null;
      } else if (typeof body.catalogId === 'string') {
        const catalogId = body.catalogId.trim();
        try {
          await assertGlobalHelpCatalog(catalogId);
        } catch {
          return NextResponse.json({ error: 'Catalog not found' }, { status: 400 });
        }
        data.catalogId = catalogId;
      }
    }
    if (body.roles !== undefined) {
      data.roles = Array.isArray(body.roles)
        ? (body.roles as string[]).filter((r) => ALLOWED_ROLES.includes(String(r)))
        : [];
    }
    await prisma.helpFAQ.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help FAQ PATCH error:');
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
    await assertGlobalHelpFaq(id);
    await prisma.helpFAQ.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help FAQ DELETE error:');
  }
}
