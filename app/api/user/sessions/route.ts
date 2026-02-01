import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { getCurrentUser, deleteSession, deleteAllSessionsExcept } from '@/lib/auth';

/** Список активных сессий текущего пользователя */
export async function GET() {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    const sessions = await prisma.session.findMany({
      where: { userId: user.id },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        userAgent: true,
        createdAt: true,
        expiresAt: true,
      },
    });

    const now = new Date();
    const list = sessions
      .filter((s) => new Date(s.expiresAt) > now)
      .map((s) => ({
        id: s.id,
        userAgent: s.userAgent,
        createdAt: s.createdAt,
        expiresAt: s.expiresAt,
        isCurrent: user.sessionId === s.id,
      }));

    return NextResponse.json({
      sessions: list,
      currentSessionId: user.sessionId,
    });
  } catch (error) {
    console.error('Get sessions error:', error);
    return NextResponse.json(
      { error: 'Failed to load sessions' },
      { status: 500 }
    );
  }
}

/** Завершить сессию или все сессии кроме текущей. Body: { sessionId?: string } — если передан, удалить эту сессию; иначе удалить все кроме текущей. */
export async function DELETE(request: Request) {
  try {
    const user = await getCurrentUser();
    if (!user) {
      return NextResponse.json({ error: 'Not authenticated' }, { status: 401 });
    }

    let body: { sessionId?: string } = {};
    try {
      body = await request.json();
    } catch {
      // no body
    }

    if (body.sessionId) {
      // Удалить одну сессию (должна принадлежать пользователю)
      const session = await prisma.session.findFirst({
        where: { id: body.sessionId, userId: user.id },
      });
      if (!session) {
        return NextResponse.json(
          { error: 'Session not found or access denied' },
          { status: 404 }
        );
      }
      await deleteSession(body.sessionId);
      return NextResponse.json({ success: true, deleted: 1 });
    }

    // Удалить все сессии кроме текущей
    const deleted = await deleteAllSessionsExcept(user.id, user.sessionId);
    return NextResponse.json({ success: true, deleted });
  } catch (error) {
    console.error('Delete sessions error:', error);
    return NextResponse.json(
      { error: 'Failed to delete sessions' },
      { status: 500 }
    );
  }
}
