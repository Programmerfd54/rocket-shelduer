import { NextResponse } from 'next/server';
import { requireAuth } from '@/lib/api-auth';
import { canPerformAction, requireAction } from '@/lib/permissions';
import { createTemplateChannel, listTemplateChannels } from '@/lib/templates/channels';
import { logTemplateAction } from '@/lib/templates/official-service';
import { handleTemplatesRouteError, parseOrThrow, readJson } from '@/lib/templates/http';
import { createChannelSchema } from '@/lib/templates/schemas';

/**
 * GET /api/template-channels — словарь каналов для селекторов (все роли с доступом к шаблонам).
 * → { channels: TemplateChannelDto[], canManage }
 */
export async function GET() {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:channels:view');
    const channels = await listTemplateChannels();
    return NextResponse.json({ channels, canManage: canPerformAction(user, 'templates:channels:manage') });
  } catch (e) {
    return handleTemplatesRouteError(e, 'list template channels');
  }
}

/**
 * POST /api/template-channels (Lead_SUP) — { name, label? } → 201 { channel, created: true } | 200 { channel, created: false }.
 * Имя нормализуется (без '#', пробелы → '_', нижний регистр). Существующее имя возвращается (идемпотентно).
 */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:channels:manage');
    const input = parseOrThrow(createChannelSchema, await readJson(request));
    const result = await createTemplateChannel(input, user.id);
    if (result.created) {
      await logTemplateAction(user.id, {
        action: 'template_channel_created',
        entityType: 'template_channel',
        channelId: result.channel.id,
        name: result.channel.name,
      });
    }
    return NextResponse.json(result, { status: result.created ? 201 : 200 });
  } catch (e) {
    return handleTemplatesRouteError(e, 'create template channel');
  }
}
