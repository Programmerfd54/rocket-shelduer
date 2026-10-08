'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Loader2, LogOut } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { AuthShell } from '@/components/common/AuthShell';
import { CopyButton } from '@/components/common/CopyButton';
import { clearWorkspaceEmojisCache } from '@/lib/useWorkspaceEmojis';

type BlockedUser = {
  email?: string;
  blockedReason?: string;
  volunteerExpiresAt?: string;
  adminContact?: string | null;
};

export default function BlockedPage() {
  const router = useRouter();
  const [user, setUser] = useState<BlockedUser | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        setUser(data.user);
        setLoaded(true);
      })
      .catch(() => router.push('/login'));
  }, [router]);

  const handleLogout = async () => {
    setLoggingOut(true);
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
      clearWorkspaceEmojisCache();
      router.push('/login');
    } catch {
      toast.error('Не удалось выйти', { description: 'Проверьте соединение и попробуйте снова.' });
      setLoggingOut(false);
    }
  };

  const isExpired = !!user?.volunteerExpiresAt && new Date(user.volunteerExpiresAt) < new Date();

  const message = isExpired
    ? 'Срок действия вашей учётной записи истёк. Обратитесь к администратору, чтобы продлить доступ.'
    : user?.blockedReason
      ? user.blockedReason
      : 'Ваша учётная запись заблокирована. Обратитесь к администратору.';

  return (
    <AuthShell
      title="Доступ ограничен"
      description={
        loaded ? (
          <span className="flex flex-wrap items-center gap-2">
            <Badge variant={isExpired ? 'warning' : 'danger'}>{isExpired ? 'Срок доступа истёк' : 'Учётная запись заблокирована'}</Badge>
            {user?.email && <span className="font-mono text-xs">{user.email}</span>}
          </span>
        ) : undefined
      }
    >
      <div className="space-y-4">
        {!loaded ? (
          <div className="space-y-2" aria-busy="true">
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        ) : (
          <>
            <p className="text-sm text-foreground text-pretty">{message}</p>

            {isExpired && user?.volunteerExpiresAt && (
              <p className="text-xs text-muted-foreground">
                Доступ закончился {new Date(user.volunteerExpiresAt).toLocaleDateString('ru-RU')}.
              </p>
            )}

            {user?.adminContact && (
              <div className="flex items-center justify-between gap-2 rounded-md border bg-muted/40 px-3 py-2">
                <div className="min-w-0">
                  <p className="text-xs text-muted-foreground">Контакт администратора</p>
                  <p className="truncate text-sm font-medium">{user.adminContact}</p>
                </div>
                <CopyButton
                  text={user.adminContact}
                  successMessage="Контакт скопирован"
                  aria-label="Скопировать контакт"
                />
              </div>
            )}
          </>
        )}

        <Button onClick={handleLogout} variant="outline" className="w-full" disabled={loggingOut}>
          {loggingOut ? <Loader2 className="animate-spin" aria-hidden /> : <LogOut aria-hidden />}
          Выйти из аккаунта
        </Button>
      </div>
    </AuthShell>
  );
}
