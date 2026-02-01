import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

const FEATURE_KEYS = [
  'sendAsEnabledSup',
  'sendAsEnabledAdm',
  'activityViewVolSup',
  // Ограничение вкладок пространства для SUP/ADM (ADMIN может отключать)
  'workspaceTabTemplatesSup',
  'workspaceTabEmojiImportSup',
  'workspaceTabUsersAddSup',
  'workspaceTabTemplatesAdm',
  // Видимость разделов для пользователей (ADMIN может скрывать)
  'templatesTabVisible',   // false = только ADMIN видит вкладку «Шаблоны», остальные — «обновляет»
  'helpMainVisible',       // false = вкладка «Основные моменты» скрыта, пользователи видят «обновляет»
  'helpAdminVisible',      // false = вкладка «От Администратора» скрыта, пользователи видят «обновляет»
] as const;

/** Строковые настройки (не true/false), например контакт для страницы «Заблокирован» */
const STRING_KEYS = ['adminContact'] as const;
const ALL_KEYS = [...FEATURE_KEYS, ...STRING_KEYS];

export async function GET() {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can read system settings' },
        { status: 403 }
      );
    }

    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: [...ALL_KEYS] } },
    });
    const settings: Record<string, string> = {};
    FEATURE_KEYS.forEach((k) => {
      const row = rows.find((r) => r.key === k);
      settings[k] = row?.value ?? 'true';
    });
    STRING_KEYS.forEach((k) => {
      const row = rows.find((r) => r.key === k);
      settings[k] = row?.value ?? '';
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Get system settings error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch settings' },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const user = await requireAuth();
    if (user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Only superuser can update system settings' },
        { status: 403 }
      );
    }

    const body = await request.json();
    if (typeof body !== 'object' || body === null) {
      return NextResponse.json(
        { error: 'Body must be an object of key-value pairs' },
        { status: 400 }
      );
    }

    for (const [key, value] of Object.entries(body)) {
      if (STRING_KEYS.includes(key as any)) {
        const str = value == null ? '' : String(value);
        await prisma.systemSetting.upsert({
          where: { key },
          create: { key, value: str },
          update: { value: str },
        });
        continue;
      }
      if (!FEATURE_KEYS.includes(key as any)) continue;
      const str = value === true || value === 'true' ? 'true' : value === false || value === 'false' ? 'false' : String(value);
      await prisma.systemSetting.upsert({
        where: { key },
        create: { key, value: str },
        update: { value: str },
      });
    }

    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: [...ALL_KEYS] } },
    });
    const settings: Record<string, string> = {};
    FEATURE_KEYS.forEach((k) => {
      const row = rows.find((r) => r.key === k);
      settings[k] = row?.value ?? 'true';
    });
    STRING_KEYS.forEach((k) => {
      const row = rows.find((r) => r.key === k);
      settings[k] = row?.value ?? '';
    });

    return NextResponse.json({ settings });
  } catch (error) {
    console.error('Update system settings error:', error);
    return NextResponse.json(
      { error: 'Failed to update settings' },
      { status: 500 }
    );
  }
}
