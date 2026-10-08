'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { PasswordInput } from '@/components/ui/password-input';
import { Skeleton } from '@/components/ui/skeleton';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { AuthShell } from '@/components/common/AuthShell';
import { PasswordStrength } from '@/components/common/PasswordStrength';
import { validateNewPassword, validatePasswordConfirm } from '@/lib/validate-password';
import { clearWorkspaceEmojisCache } from '@/lib/useWorkspaceEmojis';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [needChange, setNeedChange] = useState(false);
  const [loggingOut, setLoggingOut] = useState(false);
  const [form, setForm] = useState({ newPassword: '', confirmPassword: '' });
  const [touched, setTouched] = useState({ newPassword: false, confirmPassword: false });
  const [formError, setFormError] = useState<string | null>(null);

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

  const newPasswordError = validateNewPassword(form.newPassword);
  const confirmError = validatePasswordConfirm(form.newPassword, form.confirmPassword);
  const valid = !newPasswordError && !confirmError;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setTouched({ newPassword: true, confirmPassword: true });
    if (!valid) return;
    setFormError(null);
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
        toast.success(data.message ?? 'Пароль установлен', { description: 'Теперь можно продолжить работу.' });
        router.replace('/dashboard');
      } else {
        const message = data.error ?? 'Не удалось установить пароль';
        setFormError(message);
        toast.error('Не удалось установить пароль', { description: message });
      }
    } catch {
      setFormError('Не удалось связаться с сервером. Проверьте соединение и попробуйте снова.');
      toast.error('Ошибка запроса', { description: 'Проверьте соединение и попробуйте снова.' });
    } finally {
      setSaving(false);
    }
  };

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

  if (!loading && !needChange) {
    return null;
  }

  // Перекрывает сайдбар: пока пароль не задан, ничего другого делать нельзя
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <AuthShell
        title="Задайте новый пароль"
        description="Ваш пароль был сброшен администратором. Придумайте новый — он нужен для входа в систему."
        footer={
          <button
            type="button"
            onClick={handleLogout}
            disabled={loggingOut}
            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline disabled:opacity-50"
          >
            Выйти из аккаунта
          </button>
        }
      >
        {loading ? (
          <div className="space-y-4" aria-busy="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4" noValidate>
            {formError && (
              <Alert variant="destructive">
                <AlertDescription>{formError}</AlertDescription>
              </Alert>
            )}

            <Field
              label="Новый пароль"
              htmlFor="newPassword"
              hint="Минимум 8 символов: заглавные и строчные буквы, цифры, спецсимволы."
              error={touched.newPassword && form.newPassword ? newPasswordError : undefined}
            >
              <PasswordInput
                id="newPassword"
                autoComplete="new-password"
                autoFocus
                value={form.newPassword}
                onChange={(e) => setForm((f) => ({ ...f, newPassword: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, newPassword: true }))}
                aria-invalid={!!(touched.newPassword && form.newPassword && newPasswordError)}
                disabled={saving}
              />
              <PasswordStrength password={form.newPassword} className="pt-1" />
            </Field>

            <Field
              label="Повторите пароль"
              htmlFor="confirmPassword"
              error={touched.confirmPassword && form.confirmPassword ? confirmError : undefined}
            >
              <PasswordInput
                id="confirmPassword"
                autoComplete="new-password"
                value={form.confirmPassword}
                onChange={(e) => setForm((f) => ({ ...f, confirmPassword: e.target.value }))}
                onBlur={() => setTouched((t) => ({ ...t, confirmPassword: true }))}
                aria-invalid={!!(touched.confirmPassword && form.confirmPassword && confirmError)}
                disabled={saving}
              />
            </Field>

            <Button type="submit" className="w-full" disabled={saving || !valid}>
              {saving && <Loader2 className="animate-spin" aria-hidden />}
              {saving ? 'Сохраняем…' : 'Установить пароль'}
            </Button>
          </form>
        )}
      </AuthShell>
    </div>
  );
}
