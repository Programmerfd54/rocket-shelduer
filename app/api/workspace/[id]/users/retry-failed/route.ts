import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';

const EMAIL_DOMAIN = '@student.21-school.ru';

function streamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\n'));
}

function isAlreadyExistsError(err: string | undefined): boolean {
  if (!err) return false;
  const lower = err.toLowerCase();
  return lower.includes('already exists') || lower.includes('username is already');
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
    const channelId = typeof body.channelId === 'string' ? body.channelId : undefined;
    const channelType = body.channelType === 'p' ? 'p' : (body.channelType === 'c' ? 'c' : undefined);
    const roleId = typeof body.roleId === 'string' ? body.roleId : undefined;

    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль администратора Rocket.Chat.' },
        { status: 400 }
      );
    }

    const failedList = await prisma.workspaceAddedUser.findMany({
      where: { workspaceId, status: 'ERROR' },
      orderBy: { addedAt: 'asc' },
    });
    if (failedList.length === 0) {
      return NextResponse.json({ results: [], message: 'Нет пользователей с ошибкой для повтора.' });
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
          error: 'Не удалось войти с указанными учётными данными.',
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
          streamLine(controller, { t: 'start', total: failedList.length });

          for (let i = 0; i < failedList.length; i++) {
            const rec = failedList[i];
            const login = rec.username;
            const email = rec.email;
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
              await prisma.workspaceAddedUser.update({
                where: { id: rec.id },
                data: { status: 'ADDED', rcUserId: created.userId, errorMessage: null },
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
              if (isAlreadyExistsError(errMsg)) {
                await prisma.workspaceAddedUser.update({
                  where: { id: rec.id },
                  data: { status: 'ALREADY_EXISTS', errorMessage: errMsg },
                });
                skippedCount++;
                results.push({ login, status: 'ALREADY_EXISTS', error: errMsg });
              } else {
                await prisma.workspaceAddedUser.update({
                  where: { id: rec.id },
                  data: { errorMessage: errMsg },
                });
                errorsCount++;
                results.push({ login, status: 'ERROR', error: errMsg });
              }
            }

            const current = i + 1;
            streamLine(controller, {
              t: 'progress',
              current,
              total: failedList.length,
              added,
              errors: errorsCount,
              skipped: skippedCount,
            });
            streamLine(controller, {
              t: 'result',
              login,
              status: results[results.length - 1].status,
              error: results[results.length - 1].error,
              rcUserId: results[results.length - 1].rcUserId,
            });
          }

          streamLine(controller, {
            t: 'done',
            total: failedList.length,
            added,
            errors: errorsCount,
            skipped: skippedCount,
            results,
          });
        } catch (err: any) {
          streamLine(controller, { t: 'error', error: err?.message || 'Повтор прерван' });
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
    console.error('Retry failed users error:', error);
    return NextResponse.json(
      { error: error?.message || 'Retry failed' },
      { status: 500 }
    );
  }
}
