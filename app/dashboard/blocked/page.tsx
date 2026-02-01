'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, LogOut } from 'lucide-react';

export default function BlockedPage() {
  const router = useRouter();
  const [user, setUser] = useState<{ email?: string; blockedReason?: string; volunteerExpiresAt?: string; adminContact?: string | null } | null>(null);

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => setUser(data.user))
      .catch(() => router.push('/login'));
  }, [router]);

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' });
    router.push('/login');
  };

  const isExpired = user?.volunteerExpiresAt && new Date(user.volunteerExpiresAt) < new Date();

  return (
    <div className="flex min-h-screen items-center justify-center p-4 bg-muted/30">
      <Card className="max-w-md w-full border-amber-200 dark:border-amber-800">
        <CardContent className="pt-6 pb-6">
          <div className="flex flex-col items-center text-center space-y-4">
            <div className="w-14 h-14 rounded-full bg-amber-100 dark:bg-amber-900/40 flex items-center justify-center">
              <AlertTriangle className="w-8 h-8 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <h1 className="text-xl font-semibold text-foreground">
                Доступ ограничен
              </h1>
              <p className="text-sm text-muted-foreground mt-2">
                {isExpired
                  ? 'Срок действия вашей учётной записи истёк. Обратитесь к администратору для продления доступа.'
                  : user?.blockedReason
                    ? user.blockedReason
                    : 'Ваша учётная запись заблокирована. Обратитесь к администратору.'}
              </p>
              {user?.volunteerExpiresAt && isExpired && (
                <p className="text-xs text-muted-foreground mt-2">
                  Дата окончания доступа: {new Date(user.volunteerExpiresAt).toLocaleDateString('ru-RU')}
                </p>
              )}
              {user?.adminContact && (
                <p className="text-sm text-foreground mt-3 pt-3 border-t border-border/60">
                  Контакт администратора: <span className="font-medium">{user.adminContact}</span>
                </p>
              )}
            </div>
            <Button onClick={handleLogout} variant="outline" className="gap-2">
              <LogOut className="w-4 h-4" />
              Выйти
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
