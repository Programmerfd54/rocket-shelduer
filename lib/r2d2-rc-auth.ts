import prisma from '@/lib/prisma';
import { RocketChatClient } from '@/lib/rocketchat';
import { getEffectiveConnectionForRc } from '@/lib/workspace-rc';

export type RcAuthResult =
  | { ok: true; rc: RocketChatClient; authToken: string; rcUserId: string; workspaceUrl: string }
  | { ok: false; status: number; error: string; requiresTotp?: boolean };

/**
 * Как во вкладках «Сброс учётки» / «Состояние входа»: приоритет у кредов админа RC,
 * иначе — токен из getEffectiveConnectionForRc.
 */
export async function resolveR2RcAuth(
  workspaceId: string,
  appUserId: string,
  body: { adminUsername?: string; adminPassword?: string; totpCode?: string }
): Promise<RcAuthResult> {
  const workspace = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { workspaceUrl: true },
  });
  if (!workspace?.workspaceUrl) {
    return { ok: false, status: 404, error: 'Пространство не найдено' };
  }
  const baseUrl = workspace.workspaceUrl.replace(/\/$/, '');
  const rc = new RocketChatClient(baseUrl);

  const admin = (body.adminUsername ?? '').trim();
  const pass = typeof body.adminPassword === 'string' ? body.adminPassword : '';

  if (admin && pass) {
    try {
      const loginResult = await rc.login(admin, pass, body.totpCode?.trim());
      return {
        ok: true,
        rc,
        authToken: loginResult.authToken,
        rcUserId: loginResult.userId,
        workspaceUrl: baseUrl,
      };
    } catch (e: unknown) {
      const err = e as Error & { code?: string };
      if (err.message === 'TOTP_REQUIRED' || err.code === 'totp-required') {
        return {
          ok: false,
          status: 400,
          error: 'Введите код 2FA из приложения-аутентификатора.',
          requiresTotp: true,
        };
      }
      const raw = err.message ?? '';
      const inner = raw.replace(/^Failed to login to Rocket\.Chat:\s*/i, '').trim();
      const detail =
        inner && inner !== raw && inner.length < 400
          ? inner
          : 'Проверьте логин и пароль администратора или переключитесь на вход по подключению пространства.';
      return {
        ok: false,
        status: 401,
        error: `Не удалось войти в Rocket.Chat: ${detail}`,
      };
    }
  }

  const conn = await getEffectiveConnectionForRc(appUserId, workspaceId);
  if (!conn) {
    return {
      ok: false,
      status: 403,
      error:
        'Укажите логин и пароль администратора Rocket.Chat (как во вкладке «Состояние входа») или подключите пространство к своей учётной записи RC.',
    };
  }

  return {
    ok: true,
    rc,
    authToken: conn.authToken,
    rcUserId: conn.userId_RC,
    workspaceUrl: conn.workspaceUrl.replace(/\/$/, ''),
  };
}
