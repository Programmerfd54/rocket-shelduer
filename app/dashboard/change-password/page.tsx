'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Lock, Loader2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [needChange, setNeedChange] = useState(false);
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });

  useEffect(() => {
    let cancelled = false;
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((data) => {
        if (cancelled) return;
        if (!data?.user) {
          router.replace('/login');
          return;
        }
        setNeedChange(!!data.user.requirePasswordChange);
        if (!data.user.requirePasswordChange) {
          router.replace('/dashboard');
        }
      })
      .catch(() => {
        if (!cancelled) router.replace('/login');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (form.newPassword.length < 8) {
      toast.error('Пароль должен содержать минимум 8 символов');
      return;
    }
    if (form.newPassword !== form.confirmPassword) {
      toast.error('Пароли не совпадают');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch('/api/user/set-initial-password', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          newPassword: form.newPassword,
          confirmPassword: form.confirmPassword,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok) {
        toast.success(data.message ?? 'Пароль установлен');
        router.replace('/dashboard');
      } else {
        toast.error(data.error ?? 'Не удалось установить пароль');
      }
    } catch {
      toast.error('Ошибка запроса');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!needChange) {
    return null;
  }

  return (
    <div className="max-w-md mx-auto py-8 px-4">
      <Card className="rounded-2xl border border-border/80 bg-card shadow-sm">
        <CardHeader className="pb-4">
          <CardTitle className="flex items-center gap-2">
            <Lock className="w-5 h-5 text-primary" />
            Требуется смена пароля
          </CardTitle>
          <CardDescription>
            Ваш пароль был сброшен. Установите новый пароль для продолжения работы. Используйте не менее 8 символов, буквы разного регистра, цифры и спецсимволы.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="newPassword">Новый пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="newPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.newPassword}
                  onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                  placeholder="••••••••"
                  className="h-11 pl-10"
                  disabled={saving}
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword">Подтвердите пароль</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  id="confirmPassword"
                  type="password"
                  autoComplete="new-password"
                  value={form.confirmPassword}
                  onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                  placeholder="••••••••"
                  className="h-11 pl-10"
                  disabled={saving}
                />
                {form.confirmPassword && form.newPassword === form.confirmPassword && (
                  <CheckCircle2 className="absolute right-3 top-3 h-5 w-5 text-green-500" />
                )}
              </div>
            </div>
            <Button
              type="submit"
              className="w-full h-11 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800"
              disabled={saving || !form.newPassword || !form.confirmPassword}
            >
              {saving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Сохранение...
                </>
              ) : (
                <>
                  <Lock className="mr-2 h-4 w-4" />
                  Установить пароль
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
