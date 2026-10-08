import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isForbiddenError } from '@/lib/auth';
import { requireAdmin } from '@/lib/api-auth';

const FEATURE_KEYS = [
  'sendAsEnabledSup',
  'sendAsEnabledAdm',
  'activityViewVolSup',
  // Ограничение вкладок пространства для SUP/ADM (Lead_SUP в админке может отключать)
  'workspaceTabTemplatesSup',
  'workspaceTabEmojiImportSup',
  'workspaceTabUsersAddSup',
  'workspaceTabTemplatesAdm',
  'workspaceTabEmojiImportAdm',
  // Видимость разделов для пользователей (Lead_SUP может скрывать)
  'templatesTabVisible',   // false = только Lead_SUP видит вкладку «Шаблоны», остальные — «обновляет»
  'helpMainVisible',       // false = вкладка «Основные моменты» скрыта, пользователи видят «обновляет»
  'helpAdminVisible',      // false = вкладка «От Администратора» скрыта, пользователи видят «обновляет»
  // Интенсивы и годовой календарь (docs/intensives-api.md): false = новые API отвечают 404, данные не удаляются,
  // запланированные сообщения продолжают отправляться
  'feature:intensives',
] as const;

/** Строковые настройки (не true/false), например контакт для страницы «Заблокирован» */
const STRING_KEYS = ['adminContact'] as const;
const ALL_KEYS = [...FEATURE_KEYS, ...STRING_KEYS];

export async function GET() {
  try {
    await requireAdmin();

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
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Get system settings error:', e);
    return NextResponse.json({ error: 'Failed to fetch settings' }, { status: 500 });
  }
}

export async function PATCH(request: Request) {
  try {
    await requireAdmin();

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
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    console.error('Update system settings error:', e);
    return NextResponse.json({ error: 'Failed to update settings' }, { status: 500 });
  }
}
