import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const KEYS = ['templatesTabVisible', 'helpMainVisible', 'helpAdminVisible'] as const;

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json({ error: 'Only ADMIN can update visibility' }, { status: 403 });
    }
    const body = await request.json().catch(() => ({}));
    for (const key of KEYS) {
      if (body[key] === undefined) continue;
      const value = body[key] === true || body[key] === 'true' ? 'true' : 'false';
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value },
        update: { value },
      });
    }
    const rows = await prisma.systemSetting.findMany({ where: { key: { in: [...KEYS] } } });
    const get = (k: string) => rows.find((r) => r.key === k)?.value ?? 'true';
    return NextResponse.json({
      templatesTabVisible: get('templatesTabVisible') !== 'false',
      helpMainVisible: get('helpMainVisible') !== 'false',
      helpAdminVisible: get('helpAdminVisible') !== 'false',
    });
  } catch (e) {
    console.error('Admin help visibility error:', e);
    return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  }
}
