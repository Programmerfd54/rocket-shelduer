import { redirect } from 'next/navigation';
import { getCurrentUser } from '@/lib/auth';

export const dynamic = 'force-dynamic';

export default async function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();

  // Если пользователь уже залогинен, редирект на dashboard
  if (user) {
    redirect('/dashboard');
  }

  return <>{children}</>;
}
