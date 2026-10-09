import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { sameRcInstanceUrl } from '@/lib/workspace-rc';
import { isUserEffectivelyBlocked } from '@/lib/auth';
import { requireAuth } from '@/lib/api-auth';
import { connectionAad, encryptPassword, encryptAuthToken } from '@/lib/encryption';
import { parseRcCredentialFields } from '@/lib/credentials';
import { RocketChatClient } from '@/lib/rocketchat';
import {
  logSecurityEvent,
  getClientIp,
  getSafeErrorMessage,
  isSuspiciousInput,
  SecurityEventType,
  hitRcConnectRateLimit,
  recordRcConnectFailure,
  isRcNetworkErrorMessage,
  RC_CONNECT_RATE_LIMIT_MESSAGE,
  RC_LOGIN_FAILED_MESSAGE,
} from '@/lib/security';
import { getEffectiveOfficialTemplates } from '@/lib/templates/official-templates';
import { archiveFieldsFor, getWorkspaceArchiveInfo } from '@/lib/intensives/workspace-schedule';

export async function GET(request: Request) {
  try {
    const user = await requireAuth();
    const { searchParams } = new URL(request.url);
    const archived = searchParams.get('archived') === 'true';
    // Локальная дата «сегодня» от клиента (YYYY-MM-DD), чтобы день интенсива совпадал с календарём у пользователя
    const todayParam = searchParams.get('today');
    const clientToday =
      typeof todayParam === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(todayParam)
        ? new Date(todayParam + 'T12:00:00.000Z')
        : null;

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
      orgSpaceId: string | null;
      suppressArchivePrompt: boolean;
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
        rcAuthMethod: true,
        userId_RC: true,
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
        orgSpaceId: true,
        suppressArchivePrompt: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    // Все роли: свои пространства + назначенные (WorkspaceAdminAssignment). При том же инстансе RC показываем только назначенное (A), своё (B) скрываем — нет дубля, всегда многопользовательское и без повторного ввода кредов.
    {
      try {
        const assignments = await prisma.workspaceAdminAssignment.findMany({
          where: { userId: user.id },
          select: { workspaceId: true },
        });
        const assignedIds = [...new Set(assignments.map((a) => a.workspaceId))];
        if (assignedIds.length > 0) {
          const assignedWorkspacesRaw = await prisma.workspaceConnection.findMany({
            where: { id: { in: assignedIds }, isArchived: archived },
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
              orgSpaceId: true,
              suppressArchivePrompt: true,
            },
          });
          // Свои подключения к тому же инстансу RC, что и назначенное, не показываем (как и при точном совпадении URL)
          const ownFiltered = ownWorkspaces.filter(
            (w) =>
              !assignedWorkspacesRaw.some((a) => sameRcInstanceUrl(w.workspaceUrl, a.workspaceUrl))
          );
          workspaces = [
            ...ownFiltered.map((w) => ({ ...w, isAssigned: false as const })),
            ...assignedWorkspacesRaw.map((w) => ({ ...w, isAssigned: true as const })),
          ];
          workspaces.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
        } else {
          workspaces = ownWorkspaces.map((w) => ({ ...w, isAssigned: false }));
        }
      } catch (_) {
        workspaces = ownWorkspaces.map((w) => ({ ...w, isAssigned: false }));
      }
    }

    const workspaceIds = workspaces.map((w) => w.id);
    if (workspaceIds.length === 0) {
      return NextResponse.json({ workspaces, groups: [] });
    }

    const normalizeUrlForMulti = (u: string) => (u || '').trim().replace(/\/+$/, '').toLowerCase();

    // Многопользовательское по URL: если к этому URL привязано любое пространство с назначениями — все подключения к этому URL считаем многопользовательскими. Учитываем регистр URL (VOL/ADM могут подключиться с другим регистром).
    const urlVariants = workspaces.flatMap((w) => {
      const u = (w.workspaceUrl || '').trim();
      const noTrail = u.replace(/\/+$/, '');
      return [u, noTrail, u.toLowerCase(), noTrail.toLowerCase()].filter(Boolean);
    });
    const allConnectionsWithSameUrl = await prisma.workspaceConnection.findMany({
      where: {
        workspaceUrl: { in: [...new Set(urlVariants)] },
      },
      select: { id: true, workspaceUrl: true },
    });
    const workspaceIdsByUrl = new Map<string, string[]>();
    for (const c of allConnectionsWithSameUrl) {
      const key = normalizeUrlForMulti(c.workspaceUrl);
      if (!workspaceIdsByUrl.has(key)) workspaceIdsByUrl.set(key, []);
      workspaceIdsByUrl.get(key)!.push(c.id);
    }
    const allIdsForMultiUser = [...new Set(Array.from(workspaceIdsByUrl.values()).flat())];
    const multiUserCounts = await prisma.workspaceAdminAssignment.groupBy({
      by: ['workspaceId'],
      where: { workspaceId: { in: allIdsForMultiUser } },
      _count: { id: true },
    });
    const multiUserWorkspaceIdsSet = new Set(multiUserCounts.map((m) => m.workspaceId));
    const multiUserByUrl = new Set<string>();
    for (const [url, ids] of workspaceIdsByUrl) {
      if (ids.some((id) => multiUserWorkspaceIdsSet.has(id))) multiUserByUrl.add(url);
    }
    // На какие workspace id назначен текущий пользователь (для проверки «многопользовательское» по факту назначения, а не по сравнению URL)
    const currentUserAssignedWorkspaceIds = await prisma.workspaceAdminAssignment
      .findMany({ where: { userId: user.id }, select: { workspaceId: true } })
      .then((rows) => new Set(rows.map((r) => r.workspaceId)));

    // Для SUP: собираем все connection id с тем же workspaceUrl, чтобы показывать последние действия любого SUP
    let actionLogWorkspaceIds = workspaceIds;
    let connectionIdToNormalizedUrl: Record<string, string> = {};
    let userWorkspaceIdsByNormalizedUrl: Record<string, string[]> = {};
    if (user.role === 'SUP') {
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
      user.role === 'SUP' && actionLogWorkspaceIds.length > 0
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
    if (user.role === 'SUP' && Object.keys(connectionIdToNormalizedUrl).length > 0 && Object.keys(userWorkspaceIdsByNormalizedUrl).length > 0) {
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

    // День интенсива и «нужно ли отправить сегодня» по шаблонам (свои шаблоны пользователя + роль)
    const now = clientToday ?? new Date();
    const userTemplateDays = await prisma.userTemplate
      .findMany({ where: { userId: user.id }, select: { intensiveDay: true } })
      .then((rows) => new Set(rows.map((r) => r.intensiveDay).filter((d): d is number => d != null)));

    // Для «следующего анонса»: пользовательские шаблоны по дням и каналам
    const userTemplatesByDay = await prisma.userTemplate.findMany({
      where: { userId: user.id },
      select: { intensiveDay: true, channel: true },
    }).then((rows) => {
      const map = new Map<number, Set<string>>();
      for (const r of rows) {
        if (r.intensiveDay == null) continue;
        if (!map.has(r.intensiveDay)) map.set(r.intensiveDay, new Set());
        map.get(r.intensiveDay)!.add(r.channel);
      }
      return map;
    });

    // Подсказка «архивировать» и ближайший интенсив графика — одним запросом на все пространства
    const archiveInfo = await getWorkspaceArchiveInfo(workspaces, { includeDrafts: user.role === 'LEAD_SUP' });

    // Официальные шаблоны для «следующего анонса» (эффективные: с изменениями и созданными Lead_SUP, без удалённых)
    const officialTemplates =
      user.role === 'ADM' || user.role === 'SUP'
        ? await getEffectiveOfficialTemplates({ scope: user.role === 'ADM' ? 'ADM' : undefined })
        : [];

    const workspacesWithStats = workspaces.map((w) => {
      let todayIntensiveDay: number | null = null;
      let totalIntensiveDays: number | null = null;
      if (w.startDate && w.endDate) {
        const start = new Date(w.startDate);
        const end = new Date(w.endDate);
        const totalDays = Math.max(1, Math.ceil((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24)));
        totalIntensiveDays = totalDays;
        if (now >= start && now <= end) {
          // День по календарю: разница дат (при clientToday — календарный день у пользователя)
          const startDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
          const todayDay = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
          const diffDays = Math.floor((todayDay.getTime() - startDay.getTime()) / 86400000);
          todayIntensiveDay = Math.min(totalDays, Math.max(1, diffDays + 1));
        }
      }
      const messageDueToday =
        todayIntensiveDay != null &&
        (userTemplateDays.has(todayIntensiveDay) || ['ADM', 'SUP'].includes(user.role));

      // Следующий анонс: ближайший день (>= сегодня) с шаблоном и каналы для него
      let nextAnnouncementDay: number | undefined;
      let nextAnnouncementChannels: string[] | undefined;
      if (todayIntensiveDay != null && totalIntensiveDays != null) {
        const officialByDay = new Map<number, Set<string>>();
        const addOfficial = (t: { intensiveDay: number; channel: string }) => {
          if (!officialByDay.has(t.intensiveDay)) officialByDay.set(t.intensiveDay, new Set());
          officialByDay.get(t.intensiveDay)!.add(t.channel);
        };
        officialTemplates.forEach(addOfficial);
        let nextDay: number | null = null;
        for (let d = todayIntensiveDay; d <= totalIntensiveDays; d++) {
          const userCh = userTemplatesByDay.get(d);
          const offCh = officialByDay.get(d);
          if ((userCh && userCh.size > 0) || (offCh && offCh.size > 0)) {
            nextDay = d;
            break;
          }
        }
        if (nextDay != null) {
          nextAnnouncementDay = nextDay;
          const chSet = new Set<string>();
          userTemplatesByDay.get(nextDay)?.forEach((c) => chSet.add(c));
          officialByDay.get(nextDay)?.forEach((c) => chSet.add(c));
          nextAnnouncementChannels = [...chSet];
        }
      }
      const urlKey = normalizeUrlForMulti(w.workspaceUrl);
      const urlIsMulti = multiUserByUrl.has(urlKey);
      // Многопользовательское: если у этого workspace есть назначения ИЛИ пользователь назначен на любое пространство с тем же URL (надёжная проверка по id, не по строке URL)
      const sameUrlIds = workspaceIdsByUrl.get(urlKey) || [];
      const userIsInMulti =
        multiUserWorkspaceIdsSet.has(w.id) || sameUrlIds.some((id) => currentUserAssignedWorkspaceIds.has(id));
      return {
        ...w,
        isMultiUser: urlIsMulti && userIsInMulti,
        ...archiveFieldsFor(archiveInfo, w.id, user),
        messageCountTotal: totalByWs[w.id] ?? 0,
        messageCountPending: pendingByWs[w.id] ?? 0,
        todayIntensiveDay: todayIntensiveDay ?? undefined,
        totalIntensiveDays: totalIntensiveDays ?? undefined,
        messageDueToday: w.startDate && w.endDate ? messageDueToday : undefined,
        nextAnnouncementDay: nextAnnouncementDay ?? undefined,
        nextAnnouncementChannels: nextAnnouncementChannels ?? undefined,
        ...(user.role === 'SUP'
          ? {
              lastEmojiImport: lastEmojiByWs[w.id] ?? null,
              lastUsersAdd: lastUsersAddByWs[w.id] ?? null,
            }
          : {}),
      };
    });

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
    // Волонтёр (MEMBER с периодом) не может создавать пространство — только получать по назначению
    if (user.role === 'MEMBER' && user.volunteerExpiresAt != null) {
      return NextResponse.json(
        { error: 'Волонтёр не может создавать пространство. Добавить вас в пространство может только администратор (SUP / Lead_SUP).' },
        { status: 403 }
      );
    }
    const body = await request.json();
    const authMethodRaw = body?.authMethod;
    const authMethod =
      authMethodRaw === 'personal_token' || authMethodRaw === 'token' ? 'personal_token' : 'password';
    const {
      workspaceName,
      workspaceUrl,
      username,
      password,
      has2FA,
      startDate,
      endDate,
      totpCode,
    } = body;
    const personalToken =
      typeof body.personalToken === 'string' ? body.personalToken.trim() : '';
    const rcUserIdFromBody =
      typeof body.rcUserId === 'string' ? body.rcUserId.trim() : '';

    if (!workspaceName || !workspaceUrl || !username) {
      return NextResponse.json(
        { error: 'Укажите название пространства, URL и логин Rocket.Chat.' },
        { status: 400 }
      );
    }
    const isDateOrEmpty = (v: unknown) =>
      v === undefined || v === null || v === '' || (typeof v === 'string' && !Number.isNaN(new Date(v).getTime()));
    if (
      typeof workspaceName !== 'string' || workspaceName.length > 200 ||
      typeof workspaceUrl !== 'string' || workspaceUrl.length > 500 ||
      typeof username !== 'string' || username.length > 256 ||
      (password !== undefined && password !== null && (typeof password !== 'string' || password.length > 4096)) ||
      (totpCode !== undefined && totpCode !== null && typeof totpCode !== 'string') ||
      personalToken.length > 4096 || rcUserIdFromBody.length > 256 ||
      !isDateOrEmpty(startDate) || !isDateOrEmpty(endDate)
    ) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    // Формат кредов RC (zod): логин/пароль без управляющих символов, токен — печатный ASCII, User ID — id RC
    const creds = parseRcCredentialFields({
      username,
      password: authMethod === 'password' ? password : undefined,
      totpCode,
      personalToken,
      rcUserId: rcUserIdFromBody,
    });
    if (!creds) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }

    if (authMethod === 'password') {
      if (!password) {
        return NextResponse.json({ error: 'Укажите пароль.' }, { status: 400 });
      }
    } else {
      if (!personalToken || !rcUserIdFromBody) {
        return NextResponse.json(
          { error: 'Укажите личный токен доступа и User ID из профиля Rocket.Chat.' },
          { status: 400 }
        );
      }
    }

    if (
      isSuspiciousInput(workspaceUrl) ||
      isSuspiciousInput(username) ||
      (authMethod === 'personal_token' &&
        (isSuspiciousInput(personalToken) || isSuspiciousInput(rcUserIdFromBody)))
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

    try {
      const { assertSafeWorkspaceUrl } = await import('@/lib/ssrf');
      assertSafeWorkspaceUrl(workspaceUrl);
    } catch (e) {
      return NextResponse.json(
        { error: e instanceof Error ? e.message : 'Invalid workspace URL' },
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

    // Запрет: другой пользователь уже подключил это пространство с теми же учётными данными
    if (authMethod === 'password') {
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
    } else {
      const sameTokenAccountByOther = await prisma.workspaceConnection.findFirst({
        where: {
          userId: { not: user.id },
          OR: [
            { workspaceUrl: normalizedUrl },
            { workspaceUrl: normalizedUrl + '/' },
          ],
          userId_RC: rcUserIdFromBody,
          rcAuthMethod: 'personal_token',
        },
      });
      if (sameTokenAccountByOther) {
        return NextResponse.json(
          {
            error:
              'Этот User ID Rocket.Chat уже подключён к этому серверу другим пользователем системы.',
          },
          { status: 403 }
        );
      }
    }

    const STAFF_HOST = 'rocketchat-staff.21-school.ru';
    const isStaffHost = normalizedUrl.toLowerCase().includes(STAFF_HOST);

    let encryptedPassword: string;
    let encryptedToken: string;
    let rcUserId: string;
    let has2FAEffective: boolean;
    // Креды шифруются v2 (AES-256-GCM, свой подключ на назначение) с привязкой к владельцу подключения
    const credAad = connectionAad(user.id);

    // Лимит попыток: приложение не должно быть прокси для перебора паролей Rocket.Chat
    if (await hitRcConnectRateLimit(user.id, getClientIp(request))) {
      return NextResponse.json({ error: RC_CONNECT_RATE_LIMIT_MESSAGE }, { status: 429 });
    }
    const rcAuthFailed = async (err: unknown) => {
      const msg = err instanceof Error ? err.message : '';
      if (isRcNetworkErrorMessage(msg)) {
        return NextResponse.json(
          { error: 'Сервер Rocket.Chat недоступен. Проверьте адрес сервера и подключение, затем повторите попытку.' },
          { status: 503 }
        );
      }
      await recordRcConnectFailure({
        userId: user.id,
        request,
        path: '/api/workspace',
        method: 'POST',
        reason: authMethod === 'personal_token' ? 'Rocket.Chat token check failed' : 'Rocket.Chat login failed',
      });
      // Одинаковый ответ для неверного пароля и несуществующей учётки (не раскрываем, есть ли аккаунт)
      return NextResponse.json({ error: RC_LOGIN_FAILED_MESSAGE }, { status: 400 });
    };

    if (authMethod === 'personal_token') {
      try {
        await RocketChatClient.validatePersonalAccessToken(
          normalizedUrl,
          personalToken,
          rcUserIdFromBody,
        );
      } catch (tokenErr: unknown) {
        return rcAuthFailed(tokenErr);
      }
      // Пароль не нужен и не хранится: вход по личному токену
      encryptedPassword = '';
      encryptedToken = encryptAuthToken(personalToken, credAad);
      rcUserId = rcUserIdFromBody;
      has2FAEffective = false;
    } else {
      const rcClient = new RocketChatClient(normalizedUrl);
      const totp = creds.totpCode ? creds.totpCode : undefined;
      try {
        const loginResult = await rcClient.login(String(username).trim(), password, totp);
        // Пароль хранится только зашифрованным — для автоматического обновления сессии RC (lib/rc-session-refresh)
        encryptedPassword = encryptPassword(password, credAad);
        encryptedToken = encryptAuthToken(loginResult.authToken, credAad);
        rcUserId = loginResult.userId;
        // Вход потребовал код 2FA → у учётки 2FA: автоматический повторный вход для неё не выполняется
        has2FAEffective = Boolean(has2FA) || isStaffHost || Boolean(totp);
      } catch (loginErr: unknown) {
        const e = loginErr as Error & { code?: string };
        if (e?.message === 'TOTP_REQUIRED' || e?.code === 'totp-required') {
          return NextResponse.json(
            {
              requiresTotp: true,
              error: 'Требуется код двухфакторной аутентификации из приложения-аутентификатора.',
            },
            { status: 400 }
          );
        }
        return rcAuthFailed(loginErr);
      }
    }

    const workspace = await prisma.workspaceConnection.create({
      data: {
        userId: user.id,
        workspaceName,
        workspaceUrl: normalizedUrl,
        username: String(username).trim(),
        encryptedPassword,
        rcAuthMethod: authMethod,
        has2FA: has2FAEffective,
        authToken: encryptedToken,
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
        rcAuthMethod: true,
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
    const errMsg = error instanceof Error ? error.message : String(error);
    console.error('[POST /api/workspace] Error:', errMsg);
    await logSecurityEvent({
      type: SecurityEventType.WORKSPACE_AUTH_FAILED,
      path: '/api/workspace',
      method: 'POST',
      ipAddress: ip,
      userAgent,
      details: errMsg.slice(0, 500),
      blocked: true,
    });
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Failed to connect workspace') },
      { status: 500 }
    );
  }
}