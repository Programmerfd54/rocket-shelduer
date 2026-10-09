import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { connectionAad, encryptPassword, encryptAuthToken } from '@/lib/encryption';
import { parseRcCredentialFields } from '@/lib/credentials';
import { RocketChatClient } from '@/lib/rocketchat';
import {
  logSecurityEvent,
  getClientIp,
  isSuspiciousInput,
  isUnsafeId,
  SecurityEventType,
  hitRcConnectRateLimit,
  recordRcConnectFailure,
  isRcNetworkErrorMessage,
  RC_CONNECT_RATE_LIMIT_MESSAGE,
  RC_LOGIN_FAILED_MESSAGE,
} from '@/lib/security';
import { sameRcInstanceUrl } from '@/lib/workspace-rc';
import { isSsrfUrl } from '@/lib/ssrf';
import { applySuppressArchivePromptPatch, archiveFieldsFor, getWorkspaceArchiveInfo } from '@/lib/intensives/workspace-schedule';

// GET - получить workspace по ID (владелец или ADM с назначением)
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id } = await params;
    if (isUnsafeId(id)) {
      await logSecurityEvent({
        type: SecurityEventType.PATH_TRAVERSAL_ATTEMPT,
        path: request.url,
        method: 'GET',
        ipAddress: getClientIp(request),
        details: 'Invalid workspace id',
        userId: user.id,
      });
      return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    }

    const workspace = await prisma.workspaceConnection.findUnique({
      where: { id },
      select: {
        id: true,
        userId: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        has2FA: true,
        rcAuthMethod: true,
        userId_RC: true,
        isActive: true,
        lastConnected: true,
        startDate: true,
        endDate: true,
        color: true,
        isArchived: true,
        archivedAt: true,
        archiveDeleteAt: true,
        orgSpaceId: true,
        suppressArchivePrompt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    // archiveSuggested / nextIntensive / upcomingIntensiveCount — то же правило, что в GET /api/workspace
    const archiveFields = async () =>
      archiveFieldsFor(
        await getWorkspaceArchiveInfo([workspace], { includeDrafts: user.role === 'LEAD_SUP' }),
        workspace.id,
        user
      );

    const isOwner = workspace.userId === user.id;
    if (isOwner) {
      const { userId: _u, ...rest } = workspace;
      return NextResponse.json({ workspace: { ...rest, ...(await archiveFields()) } });
    }

    // Любая роль с назначением на это пространство
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId: user.id, workspaceId: id },
    });
    if (assignment) {
      const ownList = await prisma.workspaceConnection.findMany({
        where: { userId: user.id },
        select: { id: true, workspaceUrl: true },
      });
      const ownConnection = ownList.find((c) =>
        sameRcInstanceUrl(c.workspaceUrl, workspace.workspaceUrl)
      );
      // Назначенному не отдаём RC User ID владельца (идентификатор чужой учётки RC)
      const { userId: _u, userId_RC: _rc, ...rest } = workspace;
      return NextResponse.json({
        workspace: {
          ...rest,
          ...(await archiveFields()),
          isAssigned: true,
          hasOwnConnection: !!ownConnection,
        },
      });
    }

    return NextResponse.json(
      { error: 'Workspace not found' },
      { status: 404 }
    );
  } catch {
    return NextResponse.json(
      { error: 'Failed to fetch workspace' },
      { status: 500 }
    );
  }
}

// PATCH - обновить workspace
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role === 'MEMBER' && user.volunteerExpiresAt != null) {
      return NextResponse.json(
        { error: 'Волонтёр не может изменять настройки пространства.' },
        { status: 403 }
      );
    }
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const body = await request.json();

    // «Не предлагать архивировать» — только Lead_SUP (своё или назначенное пространство); остальные поля — владелец
    const archivePrompt = await applySuppressArchivePromptPatch(user, id, body);
    if (archivePrompt.response) return archivePrompt.response;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const {
      workspaceName,
      workspaceUrl,
      username,
      password,
      has2FA,
      startDate,
      endDate,
      color,
      totpCode,
    } = body;
    const personalToken =
      typeof body.personalToken === 'string' ? body.personalToken.trim() : '';
    const rcUserIdPatch =
      typeof body.rcUserId === 'string' ? body.rcUserId.trim() : '';

    if (
      (workspaceUrl && isSuspiciousInput(workspaceUrl)) ||
      (username && isSuspiciousInput(username)) ||
      (personalToken && isSuspiciousInput(personalToken)) ||
      (rcUserIdPatch && isSuspiciousInput(rcUserIdPatch))
    ) {
      const ip = getClientIp(request);
      const userAgent = request.headers.get('user-agent') ?? undefined;
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: `/api/workspace/${id}`,
        method: 'PATCH',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы при обновлении пространства',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }

    // Типы и длины полей (иначе Prisma падает 500 или в БД попадает мусор)
    const isOptStr = (v: unknown, max: number) => v === undefined || (typeof v === 'string' && v.length <= max);
    const isOptDate = (v: unknown) =>
      v === undefined || v === null || v === '' || (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()));
    if (
      !isOptStr(workspaceName, 200) ||
      !isOptStr(workspaceUrl, 500) ||
      !isOptStr(username, 256) ||
      !isOptStr(password, 4096) ||
      !isOptStr(totpCode, 128) ||
      (color !== undefined && color !== null && !(typeof color === 'string' && color.length <= 32)) ||
      (has2FA !== undefined && typeof has2FA !== 'boolean') ||
      !isOptDate(startDate) ||
      !isOptDate(endDate) ||
      (typeof workspaceName === 'string' && !workspaceName.trim()) ||
      (typeof username === 'string' && !username.trim())
    ) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    // Формат кредов RC (zod)
    const creds = parseRcCredentialFields({
      username,
      password: password || undefined,
      totpCode,
      personalToken,
      rcUserId: rcUserIdPatch,
    });
    if (!creds) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    // SSRF: новый адрес сервера проверяется так же, как при создании пространства
    // (раньше PATCH позволял сменить URL на внутренний адрес, и все запросы RC уходили туда).
    const urlChanged =
      typeof workspaceUrl === 'string' &&
      workspaceUrl.trim().replace(/\/+$/, '') !== (workspace.workspaceUrl || '').trim().replace(/\/+$/, '');
    if (urlChanged) {
      if (!/^https?:\/\/.+/.test(workspaceUrl.trim()) || isSsrfUrl(workspaceUrl.trim())) {
        return NextResponse.json(
          { error: 'Invalid workspace URL: internal or private addresses are not allowed' },
          { status: 400 }
        );
      }
    }

    // Подготовка данных для обновления
    const updateData: Record<string, unknown> = {
      workspaceName: typeof workspaceName === 'string' ? workspaceName.trim() : undefined,
      workspaceUrl: typeof workspaceUrl === 'string' ? workspaceUrl.trim().replace(/\/+$/, '') : undefined,
      username: typeof username === 'string' ? username.trim() : undefined,
      has2FA,
      color,
      updatedAt: new Date(),
      ...archivePrompt.data,
    };

    if (personalToken && password) {
      return NextResponse.json(
        {
          error: 'Укажите либо новый пароль (вход по LDAP), либо новый личный токен — не оба сразу.',
        },
        { status: 400 }
      );
    }

    // Сменили адрес сервера или логин без нового пароля — сохранённый пароль больше не отправляем никуда:
    // иначе автоматический повторный вход отправил бы его на новый адрес (например, после угона сессии).
    const usernameChanged =
      typeof username === 'string' && username.trim() !== (workspace.username || '').trim();
    if ((urlChanged || usernameChanged) && !password) {
      updateData.encryptedPassword = '';
    }

    // Креды проверяются в Rocket.Chat — лимит попыток (защита от перебора паролей через приложение)
    if (personalToken || password) {
      if (await hitRcConnectRateLimit(user.id, getClientIp(request))) {
        return NextResponse.json({ error: RC_CONNECT_RATE_LIMIT_MESSAGE }, { status: 429 });
      }
    }
    // Шифрование v2 с привязкой к владельцу подключения
    const credAad = connectionAad(workspace.userId);
    const rcAuthFailed = async (err: unknown, reason: string) => {
      const msg = err instanceof Error ? err.message : '';
      if (isRcNetworkErrorMessage(msg)) {
        return NextResponse.json(
          { error: 'Сервер Rocket.Chat недоступен. Проверьте адрес сервера и подключение, затем повторите попытку.' },
          { status: 503 }
        );
      }
      await recordRcConnectFailure({ userId: user.id, request, path: `/api/workspace/${id}`, method: 'PATCH', reason });
      return NextResponse.json({ error: RC_LOGIN_FAILED_MESSAGE }, { status: 400 });
    };

    if (personalToken) {
      const rcUser = (rcUserIdPatch || workspace.userId_RC || '').trim();
      if (!rcUser) {
        return NextResponse.json(
          { error: 'Укажите User ID Rocket.Chat (из профиля) для проверки токена.' },
          { status: 400 }
        );
      }
      const rcUrl = (workspaceUrl ?? workspace.workspaceUrl ?? '').trim();
      if (!rcUrl) {
        return NextResponse.json({ error: 'Укажите URL сервера Rocket.Chat.' }, { status: 400 });
      }
      try {
        await RocketChatClient.validatePersonalAccessToken(rcUrl, personalToken, rcUser);
        updateData.authToken = encryptAuthToken(personalToken, credAad);
        updateData.userId_RC = rcUser;
        // Вход по токену: сохранённый пароль больше не нужен — удаляем
        updateData.encryptedPassword = '';
        updateData.rcAuthMethod = 'personal_token';
        updateData.has2FA = false;
        updateData.isActive = true;
        updateData.lastConnected = new Date();
      } catch (e) {
        return rcAuthFailed(e, 'Rocket.Chat token check failed');
      }
    }

    // Смена пароля: сразу входим в Rocket.Chat и сохраняем токен (иначе каналы/API RC остаются без сессии)
    if (password) {
      const rcUrl = (workspaceUrl ?? workspace.workspaceUrl ?? '').trim();
      const rcUser = (username ?? workspace.username ?? '').trim();
      if (!rcUrl || !rcUser) {
        return NextResponse.json(
          { error: 'Укажите адрес сервера и логин Rocket.Chat вместе с паролем.' },
          { status: 400 }
        );
      }
      const rcClient = new RocketChatClient(rcUrl);
      try {
        const totp = creds.totpCode ? creds.totpCode : undefined;
        const loginResult = await rcClient.login(rcUser, password, totp);
        // Пароль хранится только зашифрованным — для автоматического обновления сессии RC
        updateData.encryptedPassword = encryptPassword(password, credAad);
        updateData.authToken = encryptAuthToken(loginResult.authToken, credAad);
        // Вход потребовал код 2FA → автоматический повторный вход для этого подключения не выполняется
        if (totp) updateData.has2FA = true;
        updateData.userId_RC = loginResult.userId;
        updateData.rcAuthMethod = 'password';
        updateData.isActive = true;
        updateData.lastConnected = new Date();
      } catch (loginErr: unknown) {
        const e = loginErr as Error & { code?: string };
        if (e?.message === 'TOTP_REQUIRED' || e?.code === 'totp-required') {
          return NextResponse.json(
            {
              requiresTotp: true,
              error:
                'Требуется код двухфакторной аутентификации из приложения-аутентификатора.',
            },
            { status: 400 }
          );
        }
        return rcAuthFailed(loginErr, 'Rocket.Chat login failed');
      }
    }

    // Обновляем даты если переданы
    if (startDate !== undefined) {
      updateData.startDate = startDate ? new Date(startDate) : null;
    }
    if (endDate !== undefined) {
      updateData.endDate = endDate ? new Date(endDate) : null;
    }

    const updatedWorkspace = await prisma.workspaceConnection.update({
      where: { id },
      data: updateData,
      select: {
        id: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        has2FA: true,
        rcAuthMethod: true,
        userId_RC: true,
        isActive: true,
        lastConnected: true,
        startDate: true,
        endDate: true,
        color: true,
        isArchived: true,
        suppressArchivePrompt: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    // Логируем действие
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_UPDATED',
        entityType: 'workspace',
        entityId: id,
        details: JSON.stringify({ workspaceName }),
      },
    });

    return NextResponse.json({
      success: true,
      workspace: updatedWorkspace,
    });
  } catch (error) {
    console.error('Update workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to update workspace' },
      { status: 500 }
    );
  }
}

// DELETE - удалить workspace
export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    if (user.role === 'MEMBER' && user.volunteerExpiresAt != null) {
      return NextResponse.json(
        { error: 'Волонтёр не может удалять пространство.' },
        { status: 403 }
      );
    }
    const { id } = await params;
    if (isUnsafeId(id)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id,
        userId: user.id,
      },
    });

    if (!workspace) {
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    // Удалять можно только заархивированное пространство (досрочное удаление из архива)
    if (!workspace.isArchived) {
      return NextResponse.json(
        { error: 'Сначала заархивируйте пространство. Удаление возможно только из раздела «Архив».' },
        { status: 400 }
      );
    }

    // Удаляем workspace (каскадно удалятся все связанные сообщения)
    await prisma.workspaceConnection.delete({
      where: { id },
    });

    // Логируем
    await prisma.activityLog.create({
      data: {
        userId: user.id,
        action: 'WORKSPACE_DELETED',
        entityType: 'workspace',
        entityId: id,
        details: JSON.stringify({
          workspaceName: workspace.workspaceName,
        }),
      },
    });

    return NextResponse.json({
      success: true,
      message: 'Workspace deleted successfully',
    });
  } catch (error) {
    console.error('Delete workspace error:', error);
    return NextResponse.json(
      { error: 'Failed to delete workspace' },
      { status: 500 }
    );
  }
}