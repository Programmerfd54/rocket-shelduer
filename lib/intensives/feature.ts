import prisma from '@/lib/prisma';

/** Ключ SystemSetting флага функции «Интенсивы». Значение 'false' выключает новые API (404), данные не трогаются. */
export const INTENSIVES_FEATURE_KEY = 'feature:intensives';

/** Флаг включён по умолчанию (нет строки или любое значение, кроме 'false'). */
export async function isIntensivesEnabled(): Promise<boolean> {
  try {
    const row = await prisma.systemSetting.findUnique({
      where: { key: INTENSIVES_FEATURE_KEY },
      select: { value: true },
    });
    return row?.value !== 'false';
  } catch {
    return true;
  }
}
