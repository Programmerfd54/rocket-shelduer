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
    const catalogId =
      typeof body.catalogId === 'string' && body.catalogId.trim() ? body.catalogId.trim() : null;
    if (catalogId) {
      await assertGlobalHelpCatalog(catalogId);
    }
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    const answer = typeof body.answer === 'string' ? sanitizeHelpHtml(body.answer) : '';
    const order = typeof body.order === 'number' ? body.order : 0;
    const roles = Array.isArray(body.roles)
      ? (body.roles as string[]).filter((r) => ALLOWED_ROLES.includes(String(r)))
      : [];
    const faq = await prisma.helpFAQ.create({
      data: { catalogId, question, answer, order, roles },
    });
    return NextResponse.json({ faq });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help FAQ POST error:');
  }
}
