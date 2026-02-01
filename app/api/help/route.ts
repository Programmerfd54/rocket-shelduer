import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';

/** Контент справки: основные моменты + каталоги «От Администратора». Только видимые разделы; ADMIN видит всё. */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const rows = await prisma.systemSetting.findMany({
      where: { key: { in: ['helpMainVisible', 'helpAdminVisible'] } },
    });
    const get = (k: string) => rows.find((r) => r.key === k)?.value ?? 'true';
    const helpMainVisible = get('helpMainVisible') !== 'false';
    const helpAdminVisible = get('helpAdminVisible') !== 'false';
    const isAdmin = user.role === 'ADMIN';

    let mainContent: string | null = null;
    let mainSections: Array<{ id: string; title: string; order: number; content: string }> = [];
    if (helpMainVisible || isAdmin) {
      const main = await prisma.helpMainContent.findFirst({ orderBy: { updatedAt: 'desc' } });
      mainContent = main?.content ?? '';
      const sections = await prisma.helpMainSection.findMany({
        orderBy: { order: 'asc' },
      });
      mainSections = sections.map((s) => ({ id: s.id, title: s.title, order: s.order, content: s.content }));
    }

    const userRole = user.role ?? '';
    const visibleForRole = (roles: string[]) =>
      roles.length === 0 || roles.includes(userRole);

    let catalogs: Array<{
      id: string;
      title: string;
      order: number;
      instructions: Array<{ id: string; title: string; content: string; order: number }>;
      faqs: Array<{ id: string; question: string; answer: string; order: number }>;
    }> = [];
    if (helpAdminVisible || isAdmin) {
      const cats = await prisma.helpCatalog.findMany({
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

    const globalFaqsRaw = (helpAdminVisible || isAdmin)
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
