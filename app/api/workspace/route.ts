import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, isUserEffectivelyBlocked } from '@/lib/auth';
import { encryptPassword } from '@/lib/encryption';
import { RocketChatClient } from '@/lib/rocketchat';
import { logSecurityEvent, getClientIp, isSuspiciousInput, SecurityEventType } from '@/lib/security';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const archived = searchParams.get('archived') === 'true';

    // Заблокированный пользователь не может видеть архив — только активные пространства
    if (archived && isUserEffectivelyBlocked(user)) {
      return NextResponse.json({ workspaces: [] });
    }

    // ADM: свои пространства + назначенные SUP/ADMIN
    let workspaces: Array<{
      id: string;
      workspaceName: string;
      workspaceUrl: string;
      username: string;
      has2FA: boolean;
      isActive: boolean;
      lastConnected: Date | null;
      createdAt: Date;
      startDate: Date | null;
      endDate: Date | null;
      isArchived: boolean;
      archivedAt: Date | null;
      archiveDeleteAt: Date | null;
      color: string | null;
      isAssigned?: boolean;
      isMultiUser?: boolean;
    }> = [];

    const ownWorkspaces = await prisma.workspaceConnection.findMany({
      where: { userId: user.id, isArchived: archived },
      select: {
        id: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        has2FA: true,
        isActive: true,
        lastConnected: true,
        createdAt: true,
        startDate: true,
        endDate: true,
        isArchived: true,
        archivedAt: true,
        archiveDeleteAt: true,
        color: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // ADM и VOL: свои пространства + назначенные SUP/ADMIN
    if (user.role === 'ADM' || user.role === 'VOL' || user.role === 'ADMIN' || user.role === 'SUPPORT') {
      try {
        const assignments = await prisma.workspaceAdminAssignment.findMany({
          where: { userId: user.id },
          select: { workspaceId: true },
        });
        const assignedIds = [...new Set(assignments.map((a) => a.workspaceId))];
        const ownIds = new Set(ownWorkspaces.map((w) => w.id));
        const normalizeUrl = (u: string) => (u || '').trim().replace(/\/+$/, '') || u;
        const ownNormalizedUrls = new Set(ownWorkspaces.map((w) => normalizeUrl(w.workspaceUrl)));
        const assignedOnlyIds = assignedIds.filter((id) => !ownIds.has(id));
        if (assignedOnlyIds.length > 0) {
          const assignedWorkspacesRaw = await prisma.workspaceConnection.findMany({
            where: { id: { in: assignedOnlyIds }, isArchived: archived },
            select: {
              id: true,
              workspaceName: true,
              workspaceUrl: true,
              username: true,
              has2FA: true,
              isActive: true,
              lastConnected: true,
              createdAt: true,
              startDate: true,
              endDate: true,
              isArchived: true,
              archivedAt: true,
              archiveDeleteAt: true,
              color: true,
            },
          });
          // Не показывать назначенное пространство, если у пользователя уже есть своё подключение к тому же URL (избегаем дублей)
          const assignedWorkspaces = assignedWorkspacesRaw.filter(
            (w) => !ownNormalizedUrls.has(normalizeUrl(w.workspaceUrl))
          );
          workspaces = [
            ...ownWorkspaces.map((w) => ({ ...w, isAssigned: false as const })),
            ...assignedWorkspaces.map((w) => ({ ...w, isAssigned: true as const })),
          ];
          workspaces.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else {
          workspaces = ownWorkspaces.map((w) => ({ ...w, isAssigned: false }));
        }
      } catch (_) {
        workspaces = ownWorkspaces.map((w) => ({ ...w, isAssigned: false }));
      }
    } else {
      workspaces = ownWorkspaces.map((w) => ({ ...w }));
    }

    const workspaceIds = workspaces.map((w) => w.id);
    if (workspaceIds.length === 0) {
      return NextResponse.json({ workspaces, groups: [] });
    }

    // Какие пространства многопользовательские (есть хотя бы одно назначение)
    const multiUserCounts = await prisma.workspaceAdminAssignment.groupBy({
      by: ['workspaceId'],
      where: { workspaceId: { in: workspaceIds } },
      _count: { id: true },
    });
    const multiUserWorkspaceIds = new Set(multiUserCounts.map((m) => m.workspaceId));

    // Для SUP: собираем все connection id с тем же workspaceUrl, чтобы показывать последние действия любого SUP
    let actionLogWorkspaceIds = workspaceIds;
    let connectionIdToNormalizedUrl: Record<string, string> = {};
    let userWorkspaceIdsByNormalizedUrl: Record<string, string[]> = {};
    if (user.role === 'SUPPORT') {
      const normalizeUrl = (url: string) => url.replace(/\/$/, '').toLowerCase();
      for (const w of workspaces) {
        const key = normalizeUrl(w.workspaceUrl);
        if (!userWorkspaceIdsByNormalizedUrl[key]) userWorkspaceIdsByNormalizedUrl[key] = [];
        userWorkspaceIdsByNormalizedUrl[key].push(w.id);
      }
      const allUrlVariants = [...new Set(workspaces.flatMap((w) => {
        const base = normalizeUrl(w.workspaceUrl);
        return [base, base + '/', w.workspaceUrl, w.workspaceUrl.replace(/\/$/, '')];
      }))].filter(Boolean);
      const peerConnections = await prisma.workspaceConnection.findMany({
        where: { workspaceUrl: { in: allUrlVariants } },
        select: { id: true, workspaceUrl: true },
      });
      for (const c of peerConnections) {
        connectionIdToNormalizedUrl[c.id] = normalizeUrl(c.workspaceUrl);
      }
      actionLogWorkspaceIds = peerConnections.map((c) => c.id);
    }

    const [totalCounts, pendingCounts, actionLogsRaw] = await Promise.all([
      prisma.scheduledMessage.groupBy({
        by: ['workspaceId'],
        _count: { id: true },
        where: { workspaceId: { in: workspaceIds } },
      }),
      prisma.scheduledMessage.groupBy({
        by: ['workspaceId'],
        _count: { id: true },
        where: { workspaceId: { in: workspaceIds }, status: 'PENDING' },
      }),
      user.role === 'SUPPORT' && actionLogWorkspaceIds.length > 0
        ? prisma.workspaceActionLog.findMany({
            where: { workspaceId: { in: actionLogWorkspaceIds } },
            orderBy: { createdAt: 'desc' },
            include: { user: { select: { name: true, email: true } } },
          })
        : Promise.resolve([]),
    ]);

    const totalByWs = Object.fromEntries(totalCounts.map((c) => [c.workspaceId, c._count.id]));
    const pendingByWs = Object.fromEntries(pendingCounts.map((c) => [c.workspaceId, c._count.id]));
    const lastEmojiByWs: Record<string, { userName: string | null; userEmail: string; at: string }> = {};
    const lastUsersAddByWs: Record<string, { userName: string | null; userEmail: string; at: string }> = {};
    if (user.role === 'SUPPORT' && Object.keys(connectionIdToNormalizedUrl).length > 0 && Object.keys(userWorkspaceIdsByNormalizedUrl).length > 0) {
      for (const log of actionLogsRaw) {
        const entry = { userName: log.user.name, userEmail: log.user.email, at: log.createdAt.toISOString() };
        const url = connectionIdToNormalizedUrl[log.workspaceId];
        const userWsIds = url ? userWorkspaceIdsByNormalizedUrl[url] : [log.workspaceId];
        for (const wid of userWsIds || []) {
          if (log.action === 'emoji_import' && !lastEmojiByWs[wid]) lastEmojiByWs[wid] = entry;
          if (log.action === 'users_add' && !lastUsersAddByWs[wid]) lastUsersAddByWs[wid] = entry;
        }
      }
    } else {
      for (const log of actionLogsRaw) {
        const entry = { userName: log.user.name, userEmail: log.user.email, at: log.createdAt.toISOString() };
        if (log.action === 'emoji_import' && !lastEmojiByWs[log.workspaceId]) lastEmojiByWs[log.workspaceId] = entry;
        if (log.action === 'users_add' && !lastUsersAddByWs[log.workspaceId]) lastUsersAddByWs[log.workspaceId] = entry;
      }
    }

    const workspacesWithStats = workspaces.map((w) => ({
      ...w,
      isMultiUser: multiUserWorkspaceIds.has(w.id),
      messageCountTotal: totalByWs[w.id] ?? 0,
      messageCountPending: pendingByWs[w.id] ?? 0,
      ...(user.role === 'SUPPORT'
        ? {
            lastEmojiImport: lastEmojiByWs[w.id] ?? null,
            lastUsersAdd: lastUsersAddByWs[w.id] ?? null,
          }
        : {}),
    }));

    const groups = await prisma.workspaceGroup.findMany({
      where: { userId: user.id },
      include: {
        workspaces: {
          orderBy: { order: 'asc' },
          select: { workspaceId: true },
        },
      },
      orderBy: { order: 'asc' },
    });

    return NextResponse.json({ workspaces: workspacesWithStats, groups });
  } catch (error) {
    console.error('Get workspaces error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch workspaces' },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    // Волонтёр не может создавать пространство — только получать по назначению от администраторов
    if (user.role === 'VOL') {
      return NextResponse.json(
        { error: 'Волонтёр не может создавать пространство. Добавить вас в пространство может только администратор (SUP/ADMIN).' },
        { status: 403 }
      );
    }
    const body = await request.json();
    const { workspaceName, workspaceUrl, username, password, has2FA, startDate, endDate } = body;

    if (!workspaceName || !workspaceUrl || !username || !password) {
      return NextResponse.json(
        { error: 'All fields are required' },
        { status: 400 }
      );
    }

    if (
      isSuspiciousInput(workspaceUrl) ||
      isSuspiciousInput(username) ||
      isSuspiciousInput(password)
    ) {
      const ip = getClientIp(request);
      const userAgent = request.headers.get('user-agent') ?? undefined;
      await logSecurityEvent({
        type: SecurityEventType.SUSPICIOUS_INPUT,
        path: '/api/workspace',
        method: 'POST',
        ipAddress: ip,
        userAgent,
        details: 'Подозрительные символы при добавлении пространства',
        blocked: true,
        userId: user.id,
      });
      return NextResponse.json(
        { error: 'Invalid input' },
        { status: 400 }
      );
    }

    const urlPattern = /^https?:\/\/.+/;
    if (!urlPattern.test(workspaceUrl)) {
      return NextResponse.json(
        { error: 'Invalid workspace URL format' },
        { status: 400 }
      );
    }

    // Нормализация URL: без завершающего слэша, чтобы url.com и url.com/ не создавали дубли
    const normalizeWorkspaceUrl = (u: string) => (u || '').trim().replace(/\/+$/, '') || u;
    const normalizedUrl = normalizeWorkspaceUrl(workspaceUrl);

    // Заблокированный пользователь может иметь только одно пространство; восстановление из архива недоступно
    if (isUserEffectivelyBlocked(user)) {
      const count = await prisma.workspaceConnection.count({
        where: { userId: user.id, isArchived: false },
      });
      if (count >= 1) {
        return NextResponse.json(
          { error: 'Заблокированный пользователь может подключить только одно пространство.' },
          { status: 400 }
        );
      }
    }

    const existingWorkspace = await prisma.workspaceConnection.findFirst({
      where: {
        userId: user.id,
        OR: [
          { workspaceUrl: normalizedUrl },
          { workspaceUrl: normalizedUrl + '/' },
        ],
      },
    });

    if (existingWorkspace) {
      return NextResponse.json(
        { error: 'Такое пространство уже добавлено. Адрес с слэшем в конце и без считаются одним и тем же.' },
        { status: 409 }
      );
    }

    // Запрет: другой пользователь уже подключил это пространство с такими же учётными данными (тестовый пользователь)
    const sameCredentialsByOther = await prisma.workspaceConnection.findFirst({
      where: {
        userId: { not: user.id },
        OR: [
          { workspaceUrl: normalizedUrl },
          { workspaceUrl: normalizedUrl + '/' },
        ],
        username: username.trim(),
      },
    });

    if (sameCredentialsByOther) {
      return NextResponse.json(
        {
          error:
            'Подключение с такими учётными данными уже используется другим пользователем. Подключайтесь со своими учётными данными: логин — ваш логин в системе (как в планировщике), пароль — пароль от LDAP.',
        },
        { status: 403 }
      );
    }

    const rcClient = new RocketChatClient(normalizedUrl);
    const { authToken, userId: rcUserId } = await rcClient.login(username, password);

    const encryptedPassword = encryptPassword(password);

    const workspace = await prisma.workspaceConnection.create({
      data: {
        userId: user.id,
        workspaceName,
        workspaceUrl: normalizedUrl,
        username,
        encryptedPassword,
        has2FA: has2FA || false,
        authToken,
        userId_RC: rcUserId,
        isActive: true,
        lastConnected: new Date(),
        startDate: startDate ? new Date(startDate) : null,
        endDate: endDate ? new Date(endDate) : null,
      },
      select: {
        id: true,
        workspaceName: true,
        workspaceUrl: true,
        username: true,
        has2FA: true,
        isActive: true,
        lastConnected: true,
        createdAt: true,
        startDate: true,
        endDate: true,
        color: true,
        isArchived: true,
      },
    });

    return NextResponse.json({
      success: true,
      workspace,
    });
  } catch (error) {
    const ip = getClientIp(request);
    const userAgent = request.headers.get('user-agent') ?? undefined;
    await logSecurityEvent({
      type: SecurityEventType.WORKSPACE_AUTH_FAILED,
      path: '/api/workspace',
      method: 'POST',
      ipAddress: ip,
      userAgent,
      details: 'Ошибка подключения к пространству (неверные данные или недоступный сервер)',
      blocked: true,
    });
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Failed to connect workspace',
      },
      { status: 500 }
    );
  }
}