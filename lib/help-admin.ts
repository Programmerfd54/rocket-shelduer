import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { isForbiddenError } from '@/lib/auth';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';

/**
 * Хелперы админки справки. Приложение редактирует только глобальный контент справки:
 * строки, не прошедшие фильтр GLOBAL_SCOPE (легаси), считаются несуществующими (404).
 */

export function helpAdminErrorResponse(e: unknown, logLabel: string): NextResponse {
  if (e instanceof Error) {
    if (e.message === 'NotFound') {
      return NextResponse.json({ error: 'Not found' }, { status: 404 });
    }
    if (e.message === 'Unauthorized') {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    if (isForbiddenError(e)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
  }
  console.error(logLabel, e);
  return NextResponse.json({ error: 'Failed' }, { status: 500 });
}

export async function assertGlobalHelpMainSection(sectionId: string): Promise<void> {
  const s = await prisma.helpMainSection.findFirst({
    where: { id: sectionId, ...GLOBAL_SCOPE },
    select: { id: true },
  });
  if (!s) throw new Error('NotFound');
}

export async function assertGlobalHelpCatalog(catalogId: string): Promise<void> {
  const c = await prisma.helpCatalog.findFirst({
    where: { id: catalogId, ...GLOBAL_SCOPE },
    select: { id: true },
  });
  if (!c) throw new Error('NotFound');
}

export async function assertGlobalHelpInstruction(instructionId: string): Promise<void> {
  const i = await prisma.helpInstruction.findFirst({
    where: { id: instructionId, catalog: { ...GLOBAL_SCOPE } },
    select: { id: true },
  });
  if (!i) throw new Error('NotFound');
}

/** FAQ без каталога — глобальный; FAQ в каталоге — только если каталог глобальный. */
export async function assertGlobalHelpFaq(faqId: string): Promise<void> {
  const f = await prisma.helpFAQ.findFirst({
    where: {
      id: faqId,
      OR: [{ catalogId: null }, { catalog: { ...GLOBAL_SCOPE } }],
    },
    select: { id: true },
  });
  if (!f) throw new Error('NotFound');
}
