import prisma from '@/lib/prisma';

/** Ключи булевых настроек платформы (как в /api/admin/settings). По умолчанию — включено. */
export const SYSTEM_SETTING_FEATURE_KEYS = [
  'sendAsEnabledSup',
  'sendAsEnabledAdm',
  'activityViewVolSup',
  'workspaceTabTemplatesSup',
  'workspaceTabEmojiImportSup',
  'workspaceTabUsersAddSup',
  'workspaceTabTemplatesAdm',
  'workspaceTabEmojiImportAdm',
  'templatesTabVisible',
  'helpMainVisible',
  'helpAdminVisible',
  'feature:intensives',
] as const;

/** Строковые настройки платформы. По умолчанию — пустая строка. */
export const SYSTEM_SETTING_STRING_KEYS = ['adminContact'] as const;

export type SystemSettingKey =
  | (typeof SYSTEM_SETTING_FEATURE_KEYS)[number]
  | (typeof SYSTEM_SETTING_STRING_KEYS)[number];

const ALL_KEYS: string[] = [...SYSTEM_SETTING_FEATURE_KEYS, ...SYSTEM_SETTING_STRING_KEYS];

/** Глобальные настройки платформы (таблица SystemSetting) с значениями по умолчанию. */
export async function getSystemSettings(): Promise<Record<SystemSettingKey, string>> {
  const rows = await prisma.systemSetting.findMany({ where: { key: { in: ALL_KEYS } } });
  const out = {} as Record<SystemSettingKey, string>;
  for (const k of SYSTEM_SETTING_FEATURE_KEYS) {
    out[k] = rows.find((r) => r.key === k)?.value ?? 'true';
  }
  for (const k of SYSTEM_SETTING_STRING_KEYS) {
    out[k] = rows.find((r) => r.key === k)?.value ?? '';
  }
  return out;
}

export function getBool(settings: Record<string, string>, key: string, defaultTrue = true): boolean {
  const v = settings[key];
  if (v === undefined || v === null) return defaultTrue;
  return v !== 'false';
}
