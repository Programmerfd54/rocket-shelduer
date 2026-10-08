'use client';

import { useState } from 'react';
import { useRouter, useParams } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { PasswordInput } from '@/components/ui/password-input';
import { Field } from '@/components/ui/field';
import { AuthShell } from '@/components/common/AuthShell';
import { PasswordStrength } from '@/components/common/PasswordStrength';
import { toast } from 'sonner';
import { Loader2, ArrowLeft } from 'lucide-react';
import { checkPasswordStrength } from '@/lib/utils';

export default function ResetPasswordPage() {
  const router = useRouter();
  const params = useParams();
  const token = (params?.token ?? '') as string;
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const strength = checkPasswordStrength(password);
  const passwordError =
    submitted && !strength.valid
      ? strength.message
      : submitted && strength.strength === 'weak'
        ? 'Слишком простой пароль: добавьте заглавные буквы, цифры или символы'
        : undefined;
  const confirmError = submitted && confirm !== password ? 'Пароли не совпадают' : undefined;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitted(true);
    if (!strength.valid || strength.strength === 'weak' || confirm !== password) return;
    setLoading(true);
    try {
      const res = await fetch('/api/auth/reset-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token, newPassword: password }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка сброса пароля');
      toast.success('Пароль изменён', { description: data.message || 'Теперь можно войти с новым паролем' });
      router.replace('/login');
    } catch (err: unknown) {
      toast.error('Не удалось сменить пароль', { description: err instanceof Error ? err.message : 'Попробуйте ещё раз' });
    } finally {
      setLoading(false);
    }
  };

  if (!token) {
    return (
      <AuthShell title="Ссылка не работает" description="Ссылка для сброса пароля неверна или устарела. Попросите администратора прислать новую.">
        <Button asChild className="w-full">
          <Link href="/login">Перейти ко входу</Link>
        </Button>
      </AuthShell>
    );
  }

  return (
    <AuthShell title="Новый пароль" description="Придумайте пароль не короче 8 символов.">
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <Field label="Новый пароль" htmlFor="password" error={passwordError}>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            autoFocus
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            aria-invalid={!!passwordError}
            placeholder="••••••••"
            disabled={loading}
          />
          <PasswordStrength password={password} className="pt-1" />
        </Field>
        <Field label="Повторите пароль" htmlFor="confirm" error={confirmError}>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            aria-invalid={!!confirmError}
            placeholder="••••••••"
            disabled={loading}
          />
        </Field>
        <div className="flex gap-2 pt-1">
          <Button type="submit" className="flex-1" disabled={loading}>
            {loading && <Loader2 className="animate-spin" aria-hidden />}
            {loading ? 'Сохраняем…' : 'Сохранить пароль'}
          </Button>
          <Button type="button" variant="outline" asChild>
            <Link href="/login">
              <ArrowLeft aria-hidden />
              К входу
            </Link>
          </Button>
        </div>
      </form>
    </AuthShell>
  );
}
