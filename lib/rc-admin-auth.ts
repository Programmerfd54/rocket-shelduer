import { NextResponse } from 'next/server';
import type { RocketChatClient } from '@/lib/rocketchat';
import { RocketChatApiError } from '@/lib/rc-api-error';
import type { RcAdminCredentials } from '@/lib/rc-admin-credentials';
import { isRcNetworkFailure, rcUnreachableResponse } from '@/lib/rc-network';

export function authenticateRcAdmin(client: RocketChatClient, credentials: RcAdminCredentials) {
  if (credentials.adminAuthMethod === 'personal_token') {
    return client.authenticatePersonalAccessToken(credentials.adminPersonalToken, credentials.adminUserId);
  }
  return client.login(credentials.adminUsername, credentials.adminPassword, credentials.adminTotpCode || undefined);
}

export function rcAdminErrorResponse(error: unknown, workspaceUrl: string, phase: 'login' | 'catalogue' = 'catalogue') {
  if (isRcNetworkFailure(error)) return rcUnreachableResponse(workspaceUrl, error);
  const api = error instanceof RocketChatApiError ? error : undefined;
  const code = error && typeof error === 'object' && 'code' in error ? String(error.code) : '';
  if (code.includes('totp-required') || (error instanceof Error && error.message === 'TOTP_REQUIRED')) {
    return NextResponse.json({ code: 'RC_TOTP_REQUIRED', requiresTotp: true,
      error: 'Rocket.Chat требует дополнительное подтверждение входа.',
      details: 'Введите код 2FA для входа по паролю. Для токена используйте настройки доступа, разрешённые администратором пространства.',
    }, { status: 400 });
  }
  if (api?.status === 429) {
    return NextResponse.json({ code: 'RC_RATE_LIMITED', error: 'Rocket.Chat временно ограничил число запросов. Повторите позже.' }, { status: 429 });
  }
  if ((api && api.status >= 500) || (error instanceof Error && error.message.includes('Invalid login response'))) {
    return NextResponse.json({ code: 'RC_UPSTREAM_ERROR', error: 'Rocket.Chat вернул ошибку или некорректный ответ.',
      details: 'Проверьте URL пространства и доступность сервера Rocket.Chat.',
    }, { status: 502 });
  }
  if (phase === 'login' && (!api || api.status === 401 || api.status === 403)) {
    return NextResponse.json({ code: 'RC_LOGIN_FAILED',
      error: 'Rocket.Chat отклонил вход для этого пространства.',
      details: 'Проверьте учётные данные именно этого Rocket.Chat. При корпоративном входе (SSO) используйте личный токен и User ID администратора.',
    }, { status: 403 });
  }
  if (api?.status === 401) {
    return NextResponse.json({ code: 'RC_UNAUTHORIZED', error: 'Rocket.Chat отклонил токен. Проверьте токен и User ID или войдите заново.' }, { status: 403 });
  }
  if (api?.status === 403) {
    return NextResponse.json({ code: 'RC_FORBIDDEN', error: 'Недостаточно прав в Rocket.Chat для загрузки списка.',
      details: 'Используйте учётную запись с правами просмотра каналов и ролей в этом пространстве.',
    }, { status: 403 });
  }
  return NextResponse.json({ code: 'RC_REQUEST_FAILED', error: 'Не удалось получить данные от Rocket.Chat.',
    details: 'Проверьте права учётной записи, URL пространства и доступность сервера.',
  }, { status: 502 });
}
