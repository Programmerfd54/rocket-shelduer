import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { workspaceTabForbiddenResponse } from '@/lib/workspace-tab-access';
import { getSafeErrorMessage, isUnsafeId } from '@/lib/security';
import { RocketChatClient } from '@/lib/rocketchat';
import { resolveWorkspaceForEmojiImport } from '@/lib/emoji-import-access';
import { safeFetchPublic, SafeFetchError } from '@/lib/emoji-safe-fetch';
import { parseEmojiCatalog, EMOJI_CATALOG_MAX_BYTES, type CatalogEmoji } from '@/lib/emoji-catalog';
import { classifyEmojiImage, EMOJI_IMAGE_MAX_BYTES } from '@/lib/emoji-image';

const DEFAULT_YAML_URL =
  'https://raw.githubusercontent.com/Programmerfd54/emoji/refs/heads/main/emojis.yaml';

const NOT_AN_IMAGE = 'файл по ссылке не является изображением';

function streamLine(controller: ReadableStreamDefaultController<Uint8Array>, obj: object) {
  controller.enqueue(
    new TextEncoder().encode(JSON.stringify(obj) + '\n')
  );
}

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
      return NextResponse.json(
        { error: 'Workspace not found' },
        { status: 404 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const adminUsername = (body.adminUsername as string)?.trim();
    const adminPassword = typeof body.adminPassword === 'string' ? body.adminPassword : '';

    if (!adminUsername || !adminPassword) {
      return NextResponse.json(
        { error: 'Укажите логин и пароль администратора Rocket.Chat для этого пространства.' },
        { status: 400 }
      );
    }

    const baseUrl = workspace.workspaceUrl.replace(/\/$/, '');
    const rcClient = new RocketChatClient(baseUrl);

    let authToken: string;
    let userId: string;
    try {
      const loginResult = await rcClient.login(adminUsername, adminPassword);
      authToken = loginResult.authToken;
      userId = loginResult.userId;
    } catch (loginError: any) {
      return NextResponse.json(
        {
          code: 'RC_LOGIN_FAILED',
          error:
            'Не удалось войти с указанными учётными данными. Проверьте логин и пароль администратора для этого сервера Rocket.Chat.',
          details: loginError?.message,
        },
        { status: 403 }
      );
    }

    const yamlUrl = (typeof body.yamlUrl === 'string' ? body.yamlUrl.trim() : '') || DEFAULT_YAML_URL;

    // SSRF: URL каталога и ссылки на картинки — пользовательские/сторонние; только публичные http(s)-адреса.
    let emojis: CatalogEmoji[];
    try {
      const yamlRes = await safeFetchPublic(yamlUrl, { maxBytes: EMOJI_CATALOG_MAX_BYTES, timeoutMs: 15000 });
      if (!yamlRes.ok) {
        return NextResponse.json(
          { error: `Не удалось загрузить каталог: HTTP ${yamlRes.status}` },
          { status: 502 }
        );
      }
      emojis = parseEmojiCatalog(new TextDecoder('utf-8', { fatal: false }).decode(yamlRes.body)).emojis;
    } catch (e) {
      const message = e instanceof SafeFetchError ? e.message : 'Не удалось загрузить или разобрать каталог';
      return NextResponse.json({ error: message }, { status: e instanceof SafeFetchError ? 400 : 502 });
    }

    if (emojis.length === 0) {
      return NextResponse.json({
        uploaded: 0,
        skipped: 0,
        total: 0,
        errors: ['YAML содержит пустой список эмодзи или неверный формат.'],
      });
    }

    const existingNames = await rcClient.getExistingEmojiNames(authToken, userId);
    const existingSet = new Set(existingNames);

    const stream = new ReadableStream({
      async start(controller) {
        let uploaded = 0;
        let skipped = 0;
        const errors: string[] = [];
        let processed = 0;

        try {
          streamLine(controller, { t: 'start', total: emojis.length });

          for (const emoji of emojis) {
            if (existingSet.has(emoji.name)) {
              skipped++;
              processed++;
              streamLine(controller, {
                t: 'progress',
                current: processed,
                total: emojis.length,
                uploaded,
                skipped,
                errorsCount: errors.length,
              });
              continue;
            }

            const { contentType } = emoji;
            const filename = `${emoji.name}.${emoji.ext}`;

            let imageBuffer: Buffer;
            try {
              const imgRes = await safeFetchPublic(emoji.src, {
                maxBytes: EMOJI_IMAGE_MAX_BYTES,
                timeoutMs: 10000,
                accept: 'image/*',
              });
              if (!imgRes.ok) {
                errors.push(`${emoji.name}: не удалось загрузить изображение (${imgRes.status})`);
                processed++;
                streamLine(controller, {
                  t: 'progress',
                  current: processed,
                  total: emojis.length,
                  uploaded,
                  skipped,
                  errorsCount: errors.length,
                });
                continue;
              }
              // В Rocket.Chat уходят только картинки (не HTML/JSON и т.п. — защита от эксфильтрации через импорт)
              const kind = classifyEmojiImage(imgRes.body, imgRes.contentType);
              if (kind === 'html' || kind === 'unknown') {
                throw new Error(NOT_AN_IMAGE);
              }
              imageBuffer = Buffer.from(imgRes.body);
            } catch (e: any) {
              const reason =
                e instanceof SafeFetchError || (e instanceof Error && e.message === NOT_AN_IMAGE)
                  ? e.message
                  : getSafeErrorMessage(e, 'ошибка загрузки');
              errors.push(`${emoji.name}: ${reason}`);
              processed++;
              streamLine(controller, {
                t: 'progress',
                current: processed,
                total: emojis.length,
                uploaded,
                skipped,
                errorsCount: errors.length,
              });
              continue;
            }

            const result = await rcClient.createEmoji(
              authToken,
              userId,
              emoji.name,
              imageBuffer,
              filename,
              contentType
            );

            if (result.success) {
              uploaded++;
              existingSet.add(emoji.name);
            } else {
              errors.push(`${emoji.name}: ${result.error || 'ошибка загрузки'}`);
            }
            processed++;
            streamLine(controller, {
              t: 'progress',
              current: processed,
              total: emojis.length,
              uploaded,
              skipped,
              errorsCount: errors.length,
            });
          }

          await prisma.workspaceActionLog.create({
            data: { workspaceId, userId: user.id, action: 'emoji_import' },
          }).catch(() => {});
          streamLine(controller, {
            t: 'done',
            uploaded,
            skipped,
            total: emojis.length,
            errors: errors.length ? errors : undefined,
          });
        } catch (err: unknown) {
          console.error('Emoji import stream failed:', err);
          streamLine(controller, {
            t: 'error',
            error: getSafeErrorMessage(err, 'Импорт прерван'),
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
  } catch (error: any) {
    console.error('Emoji import error:', error);
    return NextResponse.json(
      { error: getSafeErrorMessage(error, 'Emoji import failed') },
      { status: 500 }
    );
  }
}
