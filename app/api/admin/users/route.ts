import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth, hashPassword } from '@/lib/auth';
import { createActivityLog } from '@/app/api/activity/route';

export async function GET() {
  try {
    const user = await requireAuth();

    if (user.role !== 'SUPPORT' && user.role !== 'ADM' && user.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

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
  } catch (error) {
    console.error('Get users error:', error);
    const message = error instanceof Error ? error.message : 'Failed to fetch users';
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}

export async function POST(request: Request) {
  try {
    const currentUser = await requireAuth();
    if (currentUser.role !== 'SUPPORT' && currentUser.role !== 'ADMIN') {
      return NextResponse.json(
        { error: 'Insufficient permissions' },
        { status: 403 }
      );
    }

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
    const data: Record<string, unknown> = {
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
      data: data as any,
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
  } catch (error) {
    console.error('Create user error:', error);
    return NextResponse.json(
      { error: 'Failed to create user' },
      { status: 500 }
    );
  }
}
