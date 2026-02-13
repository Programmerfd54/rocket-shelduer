import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';
import crypto from 'crypto';

const TOKEN_BYTES = 32;
const EXPIRES_HOURS = 1;

/** POST — сгенерировать ссылку-приглашение на регистрацию. SUPPORT не может выдавать ADMIN. Body: { role, email? } */
export async function POST(request: Request) {
  try {
    const user = await requireAuth();
    if (user.role !== 'SUPPORT' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Недостаточно прав' },
        { status: 403 }
      );
    }

    const body = await request.json();
    const role = body?.role ?? 'USER';
    const email = typeof body?.email === 'string' ? body.email.trim() || null : null;

    const allowedRoles = ['USER', 'ADM', 'VOL', 'SUPPORT', 'ADMIN'];
    if (!allowedRoles.includes(role)) {
      return NextResponse.json(
        { error: 'Недопустимая роль' },
        { status: 400 }
      );
    }
    if (user.role === 'SUPPORT' && role === 'ADMIN') {
      return NextResponse.json(
        { error: 'SUPPORT не может создавать приглашения с ролью ADMIN' },
        { status: 400 }
      );
    }

    const token = crypto.randomBytes(TOKEN_BYTES).toString('base64url');
    const expiresAt = new Date(Date.now() + EXPIRES_HOURS * 60 * 60 * 1000);

    await prisma.inviteToken.create({
      data: {
        token,
        createdById: user.id,
        role: role as 'USER' | 'ADM' | 'VOL' | 'SUPPORT' | 'ADMIN',
        email,
        expiresAt,
      },
    });

    const origin =
      process.env.APP_URL ||
      process.env.NEXT_PUBLIC_APP_URL ||
      process.env.NEXTAUTH_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : null) ||
      'http://localhost:3000';
    const link = `${origin.replace(/\/+$/, '')}/register/invite/${token}`;

    return NextResponse.json({
      success: true,
      link,
      token,
      expiresAt: expiresAt.toISOString(),
      role,
      email,
    });
  } catch (error) {
    console.error('Create invite error:', error);
    return NextResponse.json(
      { error: 'Ошибка создания приглашения' },
      { status: 500 }
    );
  }
}
