import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/auth';

export async function GET() {
  try {
    const user = await requireAuth();

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const [
      workspaces,
      activeWorkspaces,
      archivedWorkspaces,
      messages,
      pendingMessages,
      sentMessages,
      failedMessages,
      todayMessages
    ] = await Promise.all([
      prisma.workspaceConnection.count({ 
        where: { userId: user.id } 
      }),
      prisma.workspaceConnection.count({ 
        where: { 
          userId: user.id, 
          isActive: true 
        } 
      }),
      prisma.workspaceConnection.count({ 
        where: { 
          userId: user.id, 
          isActive: false 
        } 
      }),
      prisma.scheduledMessage.count({ 
        where: { userId: user.id } 
      }),
      prisma.scheduledMessage.count({ 
        where: { 
          userId: user.id, 
          status: 'PENDING' 
        } 
      }),
      prisma.scheduledMessage.count({ 
        where: { 
          userId: user.id, 
          status: 'SENT' 
        } 
      }),
      prisma.scheduledMessage.count({ 
        where: { 
          userId: user.id, 
          status: 'FAILED' 
        } 
      }),
      prisma.scheduledMessage.count({
        where: {
          userId: user.id,
          scheduledFor: { gte: today },
          status: 'PENDING'
        }
      })
    ]);

    return NextResponse.json({
      workspaces,
      activeWorkspaces,
      archivedWorkspaces,
      totalMessages: messages,
      pendingMessages,
      sentMessages,
      failedMessages,
      todayMessages
    });
  } catch (error) {
    console.error('Get dashboard stats error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch stats' },
      { status: 500 }
    );
  }
}