import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sanitizeHelpHtml } from '@/lib/sanitize';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { assertGlobalHelpCatalog, helpAdminErrorResponse } from '@/lib/help-admin';

const ALLOWED_ROLES = ['SUP', 'ADM', 'VOL', 'MEMBER'];

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const body = await request.json();
    const catalogId = body.catalogId;
    if (!catalogId || typeof catalogId !== 'string') {
      return NextResponse.json({ error: 'catalogId required' }, { status: 400 });
    }
    await assertGlobalHelpCatalog(catalogId);
    const title = typeof body.title === 'string' ? body.title.trim() : 'Инструкция';
    const content = typeof body.content === 'string' ? sanitizeHelpHtml(body.content) : '';
    const order = typeof body.order === 'number' ? body.order : 0;
    const roles = Array.isArray(body.roles)
      ? (body.roles as string[]).filter((r) => ALLOWED_ROLES.includes(String(r)))
      : [];
    const instruction = await prisma.helpInstruction.create({
      data: { catalogId, title, content, order, roles },
    });
    return NextResponse.json({ instruction });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help instructions POST error:');
  }
}
