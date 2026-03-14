import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAdmin, isForbiddenError } from '@/lib/auth';

const KEYS = ['templatesTabVisible', 'helpMainVisible', 'helpAdminVisible'] as const;

export async function PATCH(request: Request) {
  try {
    await requireAdmin();
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
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Admin help visibility error:', e);
    return NextResponse.json({ error: 'Failed to update visibility' }, { status: 500 });
  }
}
