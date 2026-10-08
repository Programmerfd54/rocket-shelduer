import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';
import { assertGlobalHelpCatalog, helpAdminErrorResponse } from '@/lib/help-admin';

const ALLOWED_ROLES = ['SUP', 'ADM', 'VOL', 'MEMBER'];

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const catalog = await prisma.helpCatalog.findFirst({
      where: { id, ...GLOBAL_SCOPE },
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
    return helpAdminErrorResponse(e, 'Admin help catalog GET error:');
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    await assertGlobalHelpCatalog(id);
    const body = await request.json();
    const data: { title?: string; order?: number; roles?: string[] } = {};
    if (typeof body.title === 'string') data.title = body.title.trim();
    if (typeof body.order === 'number') data.order = body.order;
    if (body.roles !== undefined) {
      data.roles = Array.isArray(body.roles)
        ? (body.roles as string[]).filter((r) => ALLOWED_ROLES.includes(String(r)))
        : [];
    }
    await prisma.helpCatalog.update({ where: { id }, data });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help catalog PATCH error:');
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
    await assertGlobalHelpCatalog(id);
    await prisma.helpCatalog.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help catalog DELETE error:');
  }
}
