import { NextResponse } from 'next/server';
import { isUnsafeId } from '@/lib/security';
import { requireAuth } from '@/lib/api-auth';
import { requireAction } from '@/lib/permissions';
import { deleteTemplateChannel } from '@/lib/templates/channels';
import { logTemplateAction } from '@/lib/templates/official-service';
import { TemplatesApiError, handleTemplatesRouteError } from '@/lib/templates/http';

/**
 * DELETE /api/template-channels/[id] (Lead_SUP) — удалить неиспользуемый канал из словаря.
 * 409 CHANNEL_IN_USE { usage } — канал используется шаблонами/пунктами планов; 404 CHANNEL_NOT_FOUND.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    requireAction(user, 'templates:channels:manage');
    const { id } = await params;
    if (isUnsafeId(id)) throw new TemplatesApiError(400, 'BAD_REQUEST', 'Некорректный идентификатор');
    const { name } = await deleteTemplateChannel(id.trim());
    await logTemplateAction(user.id, { action: 'template_channel_deleted', entityType: 'template_channel', channelId: id, name });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return handleTemplatesRouteError(e, 'delete template channel');
  }
}
