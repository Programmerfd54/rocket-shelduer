import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { clearAuthCookie, verifyToken, deleteSession } from '@/lib/auth';

export async function POST() {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get('auth-token')?.value;
    if (token) {
      const payload = verifyToken(token);
      if (payload?.sessionId) {
        await deleteSession(payload.sessionId);
      }
    }
    await clearAuthCookie();
    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Logout error:', error);
    return NextResponse.json(
      { error: 'Failed to logout' },
      { status: 500 }
    );
  }
}
