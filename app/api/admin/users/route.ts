import { NextResponse } from 'next/server';
import type { Prisma } from '@prisma/client';
import prisma from '@/lib/prisma';
import { requireSupportAdmOrAdmin, requireSupportOrAdmin, hashPassword, isForbiddenError } from '@/lib/auth';
import { createActivityLog } from '@/app/api/activity/route';
import { getSafeErrorMessage } from '@/lib/security';

export async function GET() {
  try {
    await requireSupportAdmOrAdmin();

    const users = await prisma.user.findMany({
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        avatarUrl: true,
        role: true,
        restrictedFeatures: true,
        isActive: true,
        isBlocked: true,
        blockedAt: true,
        blockedReason: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
        lastLoginAt: true,
        createdAt: true,
        _count: {
          select: {
            workspaces: true,
            scheduledMessages: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    return NextResponse.json({ users });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    console.error('Get users error:', e);
    return NextResponse.json(
      { error: getSafeErrorMessage(e, 'Failed to fetch users') },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await requireSupportOrAdmin();

    const body = await request.json();
    const {
      email,
      password,
      name,
      username,
      role,
      volunteerExpiresAt,
      volunteerIntensive,
    } = body;

    if (!email || !password) {
      return NextResponse.json(
        { error: 'Email and password are required' },
        { status: 400 }
      );
    }

    if (password.length < 8) {
      return NextResponse.json(
        { error: 'Password must be at least 8 characters long' },
        { status: 400 }
      );
    }

    const allowedRoles = ['USER', 'SUPPORT', 'ADMIN', 'ADM', 'VOL'];
    const roleValue = role && allowedRoles.includes(role) ? role : 'USER';

    const existingUser = await prisma.user.findUnique({
      where: { email: email.trim().toLowerCase() },
    });
    if (existingUser) {
      return NextResponse.json(
        { error: 'User with this email already exists' },
        { status: 409 }
      );
    }

    const hashedPassword = await hashPassword(password);
    const data: Prisma.UserCreateInput = {
      email: email.trim().toLowerCase(),
      password: hashedPassword,
      name: (name || '').trim() || null,
      role: roleValue,
    };
    if (username && String(username).trim()) {
      const existingUsername = await prisma.user.findUnique({
        where: { username: String(username).trim() },
      });
      if (existingUsername) {
        return NextResponse.json(
          { error: 'Username already taken' },
          { status: 409 }
        );
      }
      data.username = String(username).trim();
    }
    if (roleValue === 'VOL') {
      if (volunteerExpiresAt) data.volunteerExpiresAt = new Date(volunteerExpiresAt);
      if (volunteerIntensive != null) data.volunteerIntensive = String(volunteerIntensive).trim() || null;
    }

    const newUser = await prisma.user.create({
      data,
      select: {
        id: true,
        email: true,
        username: true,
        name: true,
        role: true,
        volunteerExpiresAt: true,
        volunteerIntensive: true,
        createdAt: true,
      },
    });

    await createActivityLog(
      currentUser.id,
      'USER_CREATED_BY_ADMIN',
      { targetUserId: newUser.id, email: newUser.email, role: newUser.role },
      'User',
      newUser.id,
      request
    );

    return NextResponse.json({ user: newUser });
  } catch (e) {
    if (isForbiddenError(e)) return NextResponse.json({ error: 'Insufficient permissions' }, { status: 403 });
    console.error('Create user error:', e);
    return NextResponse.json({ error: 'Failed to create user' }, { status: 500 });
  }
}
