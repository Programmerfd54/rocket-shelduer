import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';

const EMAIL_DOMAIN = '@student.21-school.ru';
const MAX_USERS = 100;

function streamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\n'));
}

function isAlreadyExistsError(err: string | undefined): boolean {
  if (!err) return false;
  const lower = err.toLowerCase();
  return lower.includes('already exists') || lower.includes('already exists') || lower.includes('username is already');
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    let user;
    try {
      user = await requireAuth();
    } catch (authError: any) {
      if (authError?.message === 'Unauthorized') {
        return NextResponse.json({ error: 'Требуется авторизация' }, { status: 401 });
      }
      throw authError;
    }
    const { id: workspaceId } = await params;

    const workspace = await prisma.workspaceConnection.findFirst({
      where: { id: workspaceId, userId: user.id },
    });
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const adminUsername = (body.adminUsername as string)?.trim();
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';
    const loginsRaw = body.logins;
    let logins: string[] = Array.isArray(loginsRaw)
      ? loginsRaw.map((l: unknown) => (typeof l === 'string' ? l.trim().replace(/^@/, '') : '')).filter(Boolean)
      : typeof loginsRaw === 'string'
        ? loginsRaw.split(/[\n,;]+/).map((s) => s.trim().replace(/^@/, '')).filter(Boolean)
        : [];
    const channelId = typeof body.channelId === 'string' ? body.channelId : undefined;
    const channelType = body.channelType === 'p' ? 'p' : (body.channelType === 'c' ? 'c' : undefined);
    const roleId = typeof body.roleId === 'string' ? body.roleId : undefined;
    const ifUserExists = body.ifUserExists === 'reset_password' ? 'reset_password' : 'skip';

    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль администратора Rocket.Chat.' },
        { status: 400 }
      );
    }
    if (logins.length === 0) {
      return NextResponse.json(
        { error: 'Введите хотя бы один логин (по одному на строку).' },
        { status: 400 }
      );
    }
    if (logins.length > MAX_USERS) {
      return NextResponse.json(
        { error: `Максимум ${MAX_USERS} пользователей за один запрос. Сейчас: ${logins.length}.` },
        { status: 400 }
      );
    }

    const baseUrl = workspace.workspaceUrl.replace(/\/$/, '');
    const rcClient = new RocketChatClient(baseUrl);

    let authToken: string;
    let rcUserId: string;
    try {
      const loginResult = await rcClient.login(adminUsername, adminPassword);
      authToken = loginResult.authToken;
      rcUserId = loginResult.userId;
    } catch (loginError: any) {
      return NextResponse.json(
        {
          error: 'Не удалось войти с указанными учётными данными. Проверьте логин и пароль администратора.',
          details: loginError?.message,
        },
        { status: 401 }
      );
    }

    const stream = new ReadableStream({
      async start(controller) {
        let added = 0;
        let errorsCount = 0;
        let skippedCount = 0;
        const results: { login: string; status: string; rcUserId?: string; error?: string }[] = [];

        try {
          streamLine(controller, { t: 'start', total: logins.length });

          for (let i = 0; i < logins.length; i++) {
            const login = logins[i];
            const email = `${login}${EMAIL_DOMAIN}`;
            const name = login;
            const password = login;
            const requirePasswordChange = true;
            const verified = true;

            const created = await rcClient.createUser(authToken, rcUserId, {
              email,
              name,
              username: login,
              password,
              requirePasswordChange,
              verified,
            });

            if (created.success && created.userId) {
              await prisma.workspaceAddedUser.create({
                data: {
                  workspaceId,
                  rcUserId: created.userId,
                  username: login,
                  email,
                  status: 'ADDED',
                },
              });
              added++;

              if (channelId && (channelType === 'c' || channelType === 'p')) {
                await rcClient.inviteUserToRoom(authToken, rcUserId, channelId, channelType, created.userId);
              }
              if (roleId) {
                await rcClient.addUserToRole(authToken, rcUserId, roleId, login);
              }

              results.push({ login, status: 'ADDED', rcUserId: created.userId });
            } else {
              const errMsg = created.error ?? 'Unknown error';
              if (isAlreadyExistsError(errMsg) && ifUserExists === 'skip') {
                await prisma.workspaceAddedUser.create({
                  data: {
                    workspaceId,
                    username: login,
                    email,
                    status: 'ALREADY_EXISTS',
                    errorMessage: errMsg,
                  },
                });
                skippedCount++;
                results.push({ login, status: 'ALREADY_EXISTS', error: errMsg });
              } else {
                await prisma.workspaceAddedUser.create({
                  data: {
                    workspaceId,
                    username: login,
                    email,
                    status: 'ERROR',
                    errorMessage: errMsg,
                  },
                });
                errorsCount++;
                results.push({ login, status: 'ERROR', error: errMsg });
              }
            }

            const current = i + 1;
            streamLine(controller, {
              t: 'progress',
              current,
              total: logins.length,
              added,
              errors: errorsCount,
              skipped: skippedCount,
            });
            streamLine(controller, { t: 'result', login, status: results[results.length - 1].status, error: results[results.length - 1].error, rcUserId: results[results.length - 1].rcUserId });
          }

          await prisma.workspaceActionLog.create({
            data: { workspaceId, userId: user.id, action: 'users_add' },
          }).catch(() => {});
          streamLine(controller, {
            t: 'done',
            total: logins.length,
            added,
            errors: errorsCount,
            skipped: skippedCount,
            results,
          });
        } catch (err: any) {
          streamLine(controller, { t: 'error', error: err?.message || 'Добавление прервано' });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        'Content-Type': 'application/x-ndjson',
        'Cache-Control': 'no-store',
      },
    });
  } catch (error: any) {
    console.error('Add users error:', error);
    if (error?.code === 'P2021' || (error?.message && error.message.includes('does not exist'))) {
      return NextResponse.json(
        {
          error: 'Таблица добавленных пользователей не найдена. Выполните миграцию: npx prisma migrate dev',
          code: 'MIGRATION_NEEDED',
        },
        { status: 503 }
      );
    }
    return NextResponse.json(
      { error: error?.message || 'Failed to add users' },
      { status: 500 }
    );
  }
}
