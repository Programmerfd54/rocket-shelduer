/**
 * Серверное применение ограничений вкладок пространства (SystemSetting: workspaceTab*).
 *
 * Правила зеркалят то, что скрывает UI страницы пространства (app/dashboard/workspaces/[id]/page.tsx):
 *  - вкладка «Настройка пространства» (SpaceSettingsTab: space-settings, R2D2, импорт эмодзи и блок
 *    «Добавление пользователей») видна, если флаг emojiImport = true;
 *  - блок «Добавление пользователей» (users/*) дополнительно требует usersAdd = true и не показывается
 *    для пространств интенсива (isStudentIntensiveWorkspaceUrl).
 * Значения флагов — те же, что отдаёт GET /api/workspace-tab-restrictions (он использует эту же функцию).
 * Без записей в SystemSetting (по умолчанию 'true') поведение не меняется.
 */
import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isUnsafeId } from '@/lib/security';
import { getBool, getSystemSettings } from '@/lib/system-settings';
import { isStudentIntensiveWorkspaceUrl } from '@/lib/workspace-url-flags';

export type WorkspaceTabFlags = { templates: boolean; emojiImport: boolean; usersAdd: boolean };

/** Возможности, которые закрываются ограничениями вкладок. */
export type WorkspaceTabFeature = 'spaceSettings' | 'emojiImport' | 'r2d2' | 'usersAdd';

/** Флаги вкладок по роли и глобальным настройкам (чистая функция — удобно тестировать). */
export function computeWorkspaceTabFlags(role: string, settings: Record<string, string>): WorkspaceTabFlags {
  const get = (key: string) => getBool(settings, key);
  switch (role) {
    case 'LEAD_SUP':
      return { templates: true, emojiImport: true, usersAdd: true };
    case 'MEMBER':
      return { templates: true, emojiImport: false, usersAdd: false };
    case 'SUP':
      return {
        templates: get('workspaceTabTemplatesSup'),
        emojiImport: get('workspaceTabEmojiImportSup'),
        usersAdd: get('workspaceTabUsersAddSup'),
      };
    case 'ADM':
      // ADM не видит вкладку «Настройка пространства» (исторически; настройка workspaceTabEmojiImportAdm в UI не используется)
      return { templates: get('workspaceTabTemplatesAdm'), emojiImport: false, usersAdd: false };
    default:
      return { templates: false, emojiImport: false, usersAdd: false };
  }
}

/** Флаги вкладок для пользователя (читает SystemSetting только для SUP/ADM). */
export async function getWorkspaceTabFlags(role: string): Promise<WorkspaceTabFlags> {
  if (role !== 'SUP' && role !== 'ADM') return computeWorkspaceTabFlags(role, {});
  return computeWorkspaceTabFlags(role, await getSystemSettings());
}

/** Разрешена ли возможность при данных флагах (и адресе пространства — для usersAdd). */
export function isWorkspaceTabFeatureAllowed(
  flags: WorkspaceTabFlags,
  feature: WorkspaceTabFeature,
  workspaceUrl?: string | null
): boolean {
  if (!flags.emojiImport) return false;
  if (feature === 'usersAdd') {
    if (!flags.usersAdd) return false;
    if (workspaceUrl && isStudentIntensiveWorkspaceUrl(workspaceUrl)) return false;
  }
  return true;
}

const FEATURE_ERRORS: Record<WorkspaceTabFeature, string> = {
  spaceSettings: 'Настройка пространства недоступна для вашей роли (ограничение платформы).',
  emojiImport: 'Импорт эмодзи недоступен для вашей роли (ограничение платформы).',
  r2d2: 'R2D2 недоступен для вашей роли (ограничение платформы).',
  usersAdd: 'Добавление пользователей недоступно для вашей роли (ограничение платформы).',
};

/**
 * Проверка ограничения вкладки на сервере. Возвращает null, если доступ есть, иначе ответ 403.
 * Вызывать после проверки доступа к самому пространству (владелец/назначенный).
 */
export async function workspaceTabForbiddenResponse(
  user: { role: string },
  feature: WorkspaceTabFeature,
  workspaceUrl?: string | null
): Promise<NextResponse | null> {
  const flags = await getWorkspaceTabFlags(user.role);
  if (isWorkspaceTabFeatureAllowed(flags, feature, workspaceUrl)) return null;
  return NextResponse.json({ error: FEATURE_ERRORS[feature], code: 'TAB_RESTRICTED' }, { status: 403 });
}

type WorkspaceMin = { id: string; userId: string; workspaceUrl: string };

/**
 * Полная серверная проверка для API вкладки: корректный id, пространство существует,
 * пользователь — владелец или назначенный, и ограничение вкладки платформы разрешает действие.
 */
export async function requireWorkspaceTabAccess(
  user: { id: string; role: string },
  workspaceId: string,
  feature: WorkspaceTabFeature
): Promise<{ ok: true; workspace: WorkspaceMin } | { ok: false; response: NextResponse }> {
  if (isUnsafeId(workspaceId)) {
    return { ok: false, response: NextResponse.json({ error: 'Bad request' }, { status: 400 }) };
  }
  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true, workspaceUrl: true },
  });
  const notFound = () => ({
    ok: false as const,
    response: NextResponse.json({ error: 'Пространство не найдено' }, { status: 404 }),
  });
  if (!workspace) return notFound();
  if (workspace.userId !== user.id) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId: user.id, workspaceId },
      select: { id: true },
    });
    if (!assignment) return notFound();
  }
  const denied = await workspaceTabForbiddenResponse(user, feature, workspace.workspaceUrl);
  if (denied) return { ok: false, response: denied };
  return { ok: true, workspace };
}
