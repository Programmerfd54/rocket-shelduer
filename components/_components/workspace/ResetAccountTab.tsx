'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RotateCcw, KeyRound, Users } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type Result = { username: string; success: boolean; message: string };

export function ResetAccountTab({ workspaceId }: { workspaceId: string }) {
  const [usernames, setUsernames] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);

  const handleSubmit = async () => {
    const raw = usernames.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (raw.length === 0) {
      toast.error('Введите хотя бы один логин');
      return;
    }
    if (raw.length > 100) {
      toast.error('Максимум 100 пользователей за раз');
      return;
    }
    setLoading(true);
    setResults([]);
    const body: { usernames: string[]; adminUsername?: string; adminPassword?: string } = { usernames: raw };
    if (adminUsername.trim() && adminPassword) {
      body.adminUsername = adminUsername.trim();
      body.adminPassword = adminPassword;
    }
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/admin/reset-user-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.results)) {
        setResults(data.results);
        const ok = data.results.filter((r: Result) => r.success).length;
        toast.success(data.message ?? `Обработано: ${ok} из ${data.results.length}`);
        setUsernames('');
      } else {
        toast.error(data.error ?? 'Не удалось сбросить пароли');
        if (data.results) setResults(data.results);
      }
    } catch {
      toast.error('Ошибка запроса');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="rounded-2xl border-2 border-border/80 bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-4 py-3 border-b-2 border-border/70 bg-gradient-to-b from-orange-500/8 to-transparent">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-orange-500/15 text-orange-600 dark:text-orange-400">
            <RotateCcw className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Сброс учётки</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Введите логины (по одному на строку или через запятую). Пароль будет сброшен на значение, равное логину. При первом входе пользователю будет предложено задать новый пароль.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Без кредов RC — сброс только в приложении. С кредами администратора Rocket.Chat — сброс и в приложении, и в RC.
            </p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 space-y-4">
        <div className="rounded-xl border-2 border-amber-400/40 bg-amber-500/5 p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/20 text-amber-600 dark:text-amber-400">
              <KeyRound className="w-4 h-4" />
            </span>
            Креды администратора Rocket.Chat (опционально — для сброса пароля и в RC)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="reset-admin-username" className="text-xs">Логин админа RC</Label>
              <Input
                id="reset-admin-username"
                type="text"
                placeholder="admin"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="mt-1.5 h-9 border-2 border-amber-300/30 focus:border-amber-400/50 rounded-lg bg-background"
                disabled={loading}
              />
            </div>
            <div>
              <Label htmlFor="reset-admin-password" className="text-xs">Пароль админа RC</Label>
              <Input
                id="reset-admin-password"
                type="password"
                placeholder="••••••••"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                className="mt-1.5 h-9 border-2 border-amber-300/30 focus:border-amber-400/50 rounded-lg bg-background"
                disabled={loading}
              />
            </div>
          </div>
        </div>
        <div className="rounded-xl border-2 border-blue-400/40 bg-blue-500/5 p-4 space-y-2">
          <Label htmlFor="reset-account-usernames" className="flex items-center gap-2 text-sm font-medium">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400">
              <Users className="w-4 h-4" />
            </span>
            Логины (несколько — по одному на строку)
          </Label>
          <Textarea
            id="reset-account-usernames"
            placeholder={'wrightag\nivanov\npetrov'}
            value={usernames}
            onChange={(e) => {
              setUsernames(e.target.value);
              setResults([]);
            }}
            className="min-h-[120px] font-mono text-sm resize-y border-2 border-blue-300/30 focus:border-blue-400/50 rounded-lg bg-background"
            disabled={loading}
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={loading || !usernames.trim()}
          className="gap-2 rounded-lg border-2 border-orange-400/50 bg-orange-500 hover:bg-orange-600 text-white shadow-sm"
        >
          {loading ? <Spinner className="w-4 h-4" /> : <RotateCcw className="w-4 h-4" />}
          Сбросить пароли
        </Button>
        {results.length > 0 && (
          <div className="mt-4 rounded-xl border-2 border-emerald-400/40 bg-emerald-500/5 overflow-hidden">
            <div className="max-h-[280px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Логин</th>
                    <th className="text-left p-2 font-medium">Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={`${r.username}-${i}`} className="border-t border-border/50">
                      <td className="p-2 font-mono">{r.username}</td>
                      <td className={cn('p-2', r.success ? 'text-green-600 dark:text-green-400' : 'text-destructive')}>
                        {r.success ? 'Пароль сброшен' : r.message}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
