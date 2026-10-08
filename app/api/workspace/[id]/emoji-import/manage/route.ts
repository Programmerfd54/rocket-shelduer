import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { workspaceTabForbiddenResponse } from '@/lib/workspace-tab-access';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import {
  loginRcEmojiAdmin,
  resolveWorkspaceForEmojiImport,
} from '@/lib/emoji-import-access';

function streamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  controller.enqueue(new TextEncoder().encode(JSON.stringify(obj) + '\n'));
}

/** POST — список или удаление кастомных эмодзи в Rocket.Chat (нужны учётные данные admin RC). */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    if (isUnsafeId(workspaceId)) return NextResponse.json({ error: 'Bad request' }, { status: 400 });
    const tabDenied = await workspaceTabForbiddenResponse(user, 'emojiImport');
    if (tabDenied) return tabDenied;

    const workspace = await resolveWorkspaceForEmojiImport(user.id, workspaceId);
    if (!workspace) {
      return NextResponse.json({ error: 'Workspace not found' }, { status: 404 });
    }

    const body = await request.json().catch(() => ({}));
    const action = body.action === 'delete' ? 'delete' : 'list';
    const adminUsername = (body.adminUsername as string)?.trim();
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';

    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль администратора Rocket.Chat для этого пространства.' },
        { status: 400 }
      );
    }

    const login = await loginRcEmojiAdmin(workspace.workspaceUrl, adminUsername, adminPassword);
    if (!login.ok) {
      return NextResponse.json(
        { code: login.code, error: login.error, details: login.details },
        { status: 403 }
      );
    }

    const { rc, authToken, userId: rcUserId } = login;

    if (action === 'list') {
      const emojis = await rc.fetchCustomEmojis(authToken, rcUserId);
      return NextResponse.json({
        total: emojis.length,
        emojis: emojis.map((e) => ({
          _id: e._id,
          name: e.name,
          aliases: e.aliases || [],
          extension: e.extension || 'png',
        })),
      });
    }

    const deleteAll = body.deleteAll === true;
    const emojiIds = Array.isArray(body.emojiIds)
      ? body.emojiIds.filter((id: unknown) => typeof id === 'string' && id.trim()).map((id: string) => id.trim())
      : [];

    let idsToDelete = emojiIds;
    if (deleteAll) {
      const emojis = await rc.fetchCustomEmojis(authToken, rcUserId);
      idsToDelete = emojis.map((e) => e._id).filter(Boolean);
    }

    if (idsToDelete.length === 0) {
      return NextResponse.json({ error: 'Не выбраны эмодзи для удаления' }, { status: 400 });
    }

    const stream = new ReadableStream({
      async start(controller) {
        let deleted = 0;
        const errors: string[] = [];

        try {
          streamLine(controller, { t: 'start', total: idsToDelete.length });

          for (let i = 0; i < idsToDelete.length; i++) {
            const emojiId = idsToDelete[i];
            const result = await rc.deleteEmoji(authToken, rcUserId, emojiId);
            if (result.success) {
              deleted++;
            } else {
              errors.push(`${emojiId}: ${result.error || 'ошибка'}`);
            }
            streamLine(controller, {
              t: 'progress',
              current: i + 1,
              total: idsToDelete.length,
              deleted,
              errorsCount: errors.length,
            });
          }

          await prisma.workspaceActionLog.create({
            data: {
              workspaceId,
              userId: user.id,
              action: 'emoji_delete',
              details: JSON.stringify({ deleted, total: idsToDelete.length, deleteAll }),
            },
          }).catch(() => {});

          streamLine(controller, {
            t: 'done',
            deleted,
            total: idsToDelete.length,
            errors: errors.length ? errors : undefined,
          });
        } catch (err: unknown) {
          console.error('Emoji manage stream failed:', err);
          streamLine(controller, {
            t: 'error',
            error: getSafeErrorMessage(err, 'Удаление прервано'),
          });
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
  } catch (error) {
    console.error('Emoji manage error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Ошибка управления эмодзи') },
      { status: 500 }
    );
  }
}
