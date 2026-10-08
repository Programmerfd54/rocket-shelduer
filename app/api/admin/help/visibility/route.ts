import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { getSystemSettings, getBool } from '@/lib/system-settings';
import { helpAdminErrorResponse } from '@/lib/help-admin';

const KEYS = ['templatesTabVisible', 'helpMainVisible', 'helpAdminVisible'] as const;

/** Видимость разделов справки/шаблонов — глобальные настройки платформы (SystemSetting). */
export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'admin:help');
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
    const settings = await getSystemSettings();
    return NextResponse.json({
      templatesTabVisible: getBool(settings, 'templatesTabVisible'),
      helpMainVisible: getBool(settings, 'helpMainVisible'),
      helpAdminVisible: getBool(settings, 'helpAdminVisible'),
    });
  } catch (e) {
    return helpAdminErrorResponse(e, 'Admin help visibility error:');
  }
}
