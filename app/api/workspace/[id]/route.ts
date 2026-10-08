import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { encryptPassword, encryptAuthToken } from '@/lib/encryption';
import { RocketChatClient } from '@/lib/rocketchat';
import { logSecurityEvent, getClientIp, isSuspiciousInput, isUnsafeId, SecurityEventType } from '@/lib/security';
import { sameRcInstanceUrl } from '@/lib/workspace-rc';
import { isSsrfUrl } from '@/lib/ssrf';

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

    const isOwner = workspace.userId === user.id;
    if (isOwner) {
      const { userId: _u, ...rest } = workspace;
      return NextResponse.json({ workspace: rest });
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
      const { userId: _u, ...rest } = workspace;
      return NextResponse.json({
        workspace: {
          ...rest,
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
      (password && isSuspiciousInput(password)) ||
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
    };

    if (personalToken && password) {
      return NextResponse.json(
        {
          error: 'Укажите либо новый пароль (вход по LDAP), либо новый личный токен — не оба сразу.',
        },
        { status: 400 }
      );
    }

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
        updateData.authToken = encryptAuthToken(personalToken);
        updateData.userId_RC = rcUser;
        updateData.encryptedPassword = encryptPassword('');
        updateData.rcAuthMethod = 'personal_token';
        updateData.has2FA = false;
        updateData.isActive = true;
        updateData.lastConnected = new Date();
      } catch (e) {
        return NextResponse.json(
          { error: e instanceof Error ? e.message : 'Не удалось проверить токен' },
          { status: 400 }
        );
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
        const totp =
          typeof totpCode === 'string' && totpCode.trim() ? totpCode.trim() : undefined;
        const loginResult = await rcClient.login(rcUser, password, totp);
        updateData.encryptedPassword = encryptPassword(password);
        updateData.authToken = encryptAuthToken(loginResult.authToken);
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
        return NextResponse.json(
          {
            error:
              'Не удалось войти в Rocket.Chat с указанным паролем. Проверьте адрес сервера, логин и пароль.',
          },
          { status: 400 }
        );
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