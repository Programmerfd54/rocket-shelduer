import { NextResponse } from 'next/server';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { connectionAad, encryptPassword, encryptAuthToken } from '@/lib/encryption';
import { RocketChatClient } from '@/lib/rocketchat';
import {
  logSecurityEvent,
  getClientIp,
  isSuspiciousInput,
  SecurityEventType,
  hitRcConnectRateLimit,
  recordRcConnectFailure,
  isRcNetworkErrorMessage,
  RC_CONNECT_RATE_LIMIT_MESSAGE,
  RC_LOGIN_FAILED_MESSAGE,
} from '@/lib/security';
import { parseRcCredentialFields } from '@/lib/credentials';
import { safeErrorForLog } from '@/lib/sensitive-data';

/**
 * POST — подтвердить назначение: войти в Rocket.Chat (логин/пароль или личный токен)
 * и создать своё подключение к пространству. Доступно только назначенным (ADM/VOL).
 * Body: { username, password } | { authMethod: 'personal_token', username, personalToken, rcUserId }
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (isUnsafeId(workspaceId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId: user.id, workspaceId },
    });
    if (!assignment) {
      return NextResponse.json(
        { error: 'Вы не назначены на это пространство.' },
        { status: 403 }
      );
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id: workspaceId },
    });
    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const body = await request.json();
    const authMethod =
      body?.authMethod === 'personal_token' || body?.authMethod === 'token'
        ? 'personal_token'
        : 'password';
    const username = body?.username?.trim?.();
    const password = body?.password;
    const personalToken =
      typeof body.personalToken === 'string' ? body.personalToken.trim() : '';
    const rcUserIdBody =
      typeof body.rcUserId === 'string' ? body.rcUserId.trim() : '';

    if (authMethod === 'password') {
      if (!username || typeof password !== 'string') {
        return NextResponse.json(
          { error: 'Укажите логин и пароль Rocket.Chat (LDAP).' },
          { status: 400 }
        );
      }
    } else {
      if (!username || !personalToken || !rcUserIdBody) {
        return NextResponse.json(
          {
            error:
              'Укажите логин (для отображения), личный токен доступа и User ID из Rocket.Chat.',
          },
          { status: 400 }
        );
      }
    }

    // Формат кредов RC (zod)
    if (
      !parseRcCredentialFields({
        username: typeof username === 'string' ? username : undefined,
        password: authMethod === 'password' ? password : undefined,
        personalToken,
        rcUserId: rcUserIdBody,
      })
    ) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    if (
      (username && isSuspiciousInput(username)) ||
      (personalToken && isSuspiciousInput(personalToken)) ||
      (rcUserIdBody && isSuspiciousInput(rcUserIdBody))
    ) {
      const ip = getClientIp(request);
      const userAgent = request.headers.get('user-agent') ?? undefined;
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: `/api/workspace/${workspaceId}/confirm-assignment`,
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы при подтверждении назначения пространства',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }

    // VOL может иметь только одно активное пространство
    if (user.role === 'MEMBER' && user.volunteerExpiresAt != null) {
      const count = await prisma.workspaceConnection.count({
        where: { userId: user.id, isArchived: false },
      });
      if (count >= 1) {
        return NextResponse.json(
          { error: 'Волонтёр может подключить только одно пространство.' },
          { status: 400 }
        );
      }
    }

    const normalizeWorkspaceUrl = (u: string) => (u || '').trim().replace(/\/+$/, '') || u;
    const normalizedUrl = normalizeWorkspaceUrl(workspace.workspaceUrl);

    const existing = await prisma.workspaceConnection.findFirst({
      where: {
        userId: user.id,
        OR: [
          { workspaceUrl: normalizedUrl },
          { workspaceUrl: normalizedUrl + '/' },
        ],
      },
    });
    if (existing) {
      return NextResponse.json(
        { error: 'У вас уже есть подключение к этому пространству.' },
        { status: 400 }
      );
    }

    // Лимит попыток проверки кредов RC (защита от перебора паролей через приложение)
    if (await hitRcConnectRateLimit(user.id, getClientIp(request))) {
      return NextResponse.json({ error: RC_CONNECT_RATE_LIMIT_MESSAGE }, { status: 429 });
    }

    const rcClient = new RocketChatClient(normalizedUrl);
    let encryptedPassword: string;
    let encryptedToken: string;
    let rcUserId: string;
    // Новое подключение принадлежит текущему пользователю — привязка шифртекста к нему
    const credAad = connectionAad(user.id);

    try {
      if (authMethod === 'personal_token') {
        await RocketChatClient.validatePersonalAccessToken(
          normalizedUrl,
          personalToken,
          rcUserIdBody,
        );
        encryptedPassword = '';
        encryptedToken = encryptAuthToken(personalToken, credAad);
        rcUserId = rcUserIdBody;
      } else {
        const login = await rcClient.login(username.trim(), password);
        // Пароль хранится только зашифрованным — для автоматического обновления сессии RC
        encryptedPassword = encryptPassword(password, credAad);
        encryptedToken = encryptAuthToken(login.authToken, credAad);
        rcUserId = login.userId;
      }
    } catch (authErr: unknown) {
      const msg = authErr instanceof Error ? authErr.message : '';
      const code = (authErr as { code?: string })?.code;
      if (msg === 'TOTP_REQUIRED' || code === 'totp-required') {
        return NextResponse.json(
          {
            error:
              'Для этой учётной записи Rocket.Chat включена 2FA. Подключитесь через личный токен доступа.',
          },
          { status: 400 }
        );
      }
      if (isRcNetworkErrorMessage(msg)) throw authErr;
      await recordRcConnectFailure({
        userId: user.id,
        request,
        path: `/api/workspace/${workspaceId}/confirm-assignment`,
        method: 'POST',
        reason: authMethod === 'personal_token' ? 'Rocket.Chat token check failed' : 'Rocket.Chat login failed',
      });
      return NextResponse.json({ error: RC_LOGIN_FAILED_MESSAGE }, { status: 400 });
    }

    const newConnection = await prisma.workspaceConnection.create({
      data: {
        userId: user.id,
        workspaceName: workspace.workspaceName,
        workspaceUrl: normalizedUrl,
        username: username.trim(),
        encryptedPassword,
        rcAuthMethod: authMethod,
        has2FA: false,
        authToken: encryptedToken,
        userId_RC: rcUserId,
        isActive: true,
        lastConnected: new Date(),
        startDate: workspace.startDate,
        endDate: workspace.endDate,
        color: workspace.color,
      },
      select: { id: true },
    });

    return NextResponse.json({
      success: true,
      workspaceId: newConnection.id,
    });
  } catch (error) {
    console.error('Confirm assignment error:', safeErrorForLog(error));
    const rawMessage = error instanceof Error ? error.message : 'Ошибка подключения к Rocket.Chat';
    const isNetworkError =
      /fetch failed|timeout|ECONNREFUSED|ECONNRESET|UND_ERR_CONNECT_TIMEOUT|ENOTFOUND|ETIMEDOUT/i.test(rawMessage);
    const status = isNetworkError ? 503 : 500;
    const message = isNetworkError
      ? 'Сервер Rocket.Chat недоступен. Проверьте подключение к интернету и доступность сервера, затем повторите попытку.'
      : getSafeErrorMessage(error, 'Ошибка подключения к Rocket.Chat');
    return NextResponse.json(
      { error: message },
      { status }
    );
  }
}
