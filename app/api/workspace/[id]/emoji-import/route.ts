import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import { RocketChatClient } from '@/lib/rocketchat';
import yaml from 'js-yaml';

const DEFAULT_YAML_URL =
  'https://raw.githubusercontent.com/Programmerfd54/emoji/refs/heads/main/emojis.yaml';

interface YamlEmoji {
  name: string;
  src: string;
}

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

    const workspace = await prisma.workspaceConnection.findFirst({
      where: {
        id: workspaceId,
        userId: user.id,
      },
    });

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
          error:
            'Не удалось войти с указанными учётными данными. Проверьте логин и пароль администратора для этого сервера Rocket.Chat.',
          details: loginError?.message,
        },
        { status: 401 }
      );
    }

    const yamlUrl = (body.yamlUrl as string)?.trim() || DEFAULT_YAML_URL;

    const yamlRes = await fetch(yamlUrl, { signal: AbortSignal.timeout(15000) });
    if (!yamlRes.ok) {
      return NextResponse.json(
        { error: `Не удалось загрузить каталог: ${yamlRes.statusText}` },
        { status: 502 }
      );
    }

    const yamlText = await yamlRes.text();
    const parsed = yaml.load(yamlText) as { emojis?: YamlEmoji[] };
    const emojis: YamlEmoji[] = Array.isArray(parsed?.emojis) ? parsed.emojis : [];

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

            const url = emoji.src;
            const filePart = url.split('/').pop() || '';
            const ext = filePart.split('.').pop() || 'png';
            const extLower = ext.toLowerCase();
            const contentType =
              extLower === 'gif'
                ? 'image/gif'
                : extLower === 'jpeg' || extLower === 'jpg'
                  ? 'image/jpeg'
                  : 'image/png';
            const filename = `${emoji.name}.${extLower}`;

            let imageBuffer: Buffer;
            try {
              const imgRes = await fetch(url, { signal: AbortSignal.timeout(10000) });
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
              const arrayBuffer = await imgRes.arrayBuffer();
              imageBuffer = Buffer.from(arrayBuffer);
            } catch (e: any) {
              errors.push(`${emoji.name}: ${e?.message || 'ошибка загрузки'}`);
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
        } catch (err: any) {
          streamLine(controller, {
            t: 'error',
            error: err?.message || 'Импорт прерван',
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
      { error: error?.message || 'Emoji import failed' },
      { status: 500 }
    );
  }
}
