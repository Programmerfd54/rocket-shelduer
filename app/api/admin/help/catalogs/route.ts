import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';
import { helpAdminErrorResponse } from '@/lib/help-admin';

const ALLOWED_ROLES = ['SUP', 'ADM', 'VOL', 'MEMBER'];

export async function GET() {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const catalogs = await prisma.helpCatalog.findMany({
      where: { ...GLOBAL_SCOPE },
      orderBy: { order: 'asc' },
      include: {
        instructions: { orderBy: { order: 'asc' } },
        faqs: { orderBy: { order: 'asc' } },
      },
    });
    return NextResponse.json({ catalogs });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help catalogs GET error:');
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
    const body = await request.json();
    const title = typeof body.title === 'string' ? body.title.trim() : 'Каталог';
    const order = typeof body.order === 'number' ? body.order : 0;
    const roles = Array.isArray(body.roles)
      ? (body.roles as string[]).filter((r) => ALLOWED_ROLES.includes(String(r)))
      : [];
    const catalog = await prisma.helpCatalog.create({
      data: { title, order, roles },
    });
    return NextResponse.json({ catalog });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help catalogs POST error:');
  }
}
