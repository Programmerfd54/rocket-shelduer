import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/api-auth';
import { getSystemSettings, getBool } from '@/lib/system-settings';
import { GLOBAL_SCOPE } from '@/lib/legacy-scope';

/** Контент справки: основные моменты + каталоги «От Администратора». Видимость — глобальные настройки платформы. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const settings = await getSystemSettings();
    const helpMainVisible = getBool(settings, 'helpMainVisible');
    const helpAdminVisible = getBool(settings, 'helpAdminVisible');
    const isAdmin = user.role === 'LEAD_SUP';

    let mainContent: string | null = null;
    let mainSections: Array<{ id: string; title: string; order: number; content: string }> = [];
    if (helpMainVisible || isAdmin) {
      const main = await prisma.helpMainContent.findFirst({
        where: { ...GLOBAL_SCOPE },
        orderBy: { updatedAt: 'desc' },
      });
      mainContent = main?.content ?? '';
      const sections = await prisma.helpMainSection.findMany({
        where: { ...GLOBAL_SCOPE },
        orderBy: { order: 'asc' },
      });
      mainSections = sections.map((s) => ({ id: s.id, title: s.title, order: s.order, content: s.content }));
    }

    const userRole = user.role ?? '';
    // Старые записи могут хранить роль волонтёра как 'VOL' — для MEMBER считаем её совпадением.
    const visibleForRole = (roles: string[]) =>
      roles.length === 0 ||
      roles.includes(userRole) ||
      (userRole === 'MEMBER' && roles.includes('VOL'));

    let catalogs: Array<{
      id: string;
      title: string;
      order: number;
      instructions: Array<{ id: string; title: string; content: string; order: number }>;
      faqs: Array<{ id: string; question: string; answer: string; order: number }>;
    }> = [];
    if (helpAdminVisible || isAdmin) {
      const cats = await prisma.helpCatalog.findMany({
        where: { ...GLOBAL_SCOPE },
        orderBy: { order: 'asc' },
        include: {
          instructions: { orderBy: { order: 'asc' } },
          faqs: { orderBy: { order: 'asc' } },
        },
      });
      catalogs = cats
        .filter((c) => visibleForRole(c.roles))
        .map((c) => ({
          id: c.id,
          title: c.title,
          order: c.order,
          instructions: c.instructions
            .filter((i) => visibleForRole(i.roles))
            .map((i) => ({ id: i.id, title: i.title, content: i.content, order: i.order })),
          faqs: c.faqs
            .filter((f) => visibleForRole(f.roles))
            .map((f) => ({ id: f.id, question: f.question, answer: f.answer, order: f.order })),
        }));
    }

    const globalFaqsRaw =
      helpAdminVisible || isAdmin
        ? await prisma.helpFAQ.findMany({
            where: { catalogId: null },
            orderBy: { order: 'asc' },
          })
        : [];
    const globalFaqs = globalFaqsRaw
      .filter((f) => visibleForRole(f.roles))
      .map((f) =>
        isAdmin
          ? { id: f.id, question: f.question, answer: f.answer, order: f.order, roles: f.roles }
          : { id: f.id, question: f.question, answer: f.answer, order: f.order }
      );

    return NextResponse.json({
      helpMainVisible: helpMainVisible || isAdmin,
      helpAdminVisible: helpAdminVisible || isAdmin,
      mainContent,
      mainSections,
      catalogs,
      globalFaqs,
      isAdmin,
    });
  } catch (e) {
    console.error('Help content error:', e);
    return NextResponse.json({ error: 'Failed to load help' }, { status: 500 });
  }
}
