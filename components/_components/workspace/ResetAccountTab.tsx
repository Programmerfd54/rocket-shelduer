'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { RotateCcw, KeyRound } from 'lucide-react';
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
    <Card className="rounded-2xl border border-border/80 bg-card shadow-[0_1px_3px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-6 py-4 bg-gradient-to-b from-muted/20 to-transparent border-b border-border/60">
        <h3 className="font-semibold text-foreground">Сброс учётки</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Введите логины (по одному на строку или через запятую). Пароль будет сброшен на значение, равное логину. При первом входе пользователю будет предложено задать новый пароль.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Без кредов RC — сброс только в приложении (кто уже входил в планировщик). С кредами администратора Rocket.Chat — сброс и в приложении, и в RC (можно сбрасывать и тех, кто только в RC).
        </p>
      </div>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              Креды администратора Rocket.Chat (опционально — для сброса пароля и в RC)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="reset-admin-username" className="text-xs">Логин админа RC</Label>
                <Input
                  id="reset-admin-username"
                  type="text"
                  placeholder="admin"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="mt-1 h-9"
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
                  className="mt-1 h-9"
                  disabled={loading}
                />
              </div>
            </div>
          </div>
          <Label htmlFor="reset-account-usernames">Логины (несколько — по одному на строку)</Label>
          <Textarea
            id="reset-account-usernames"
            placeholder={'wrightag\nivanov\npetrov'}
            value={usernames}
            onChange={(e) => {
              setUsernames(e.target.value);
              setResults([]);
            }}
            className="min-h-[120px] font-mono text-sm resize-y"
            disabled={loading}
          />
          <Button
            onClick={handleSubmit}
            disabled={loading || !usernames.trim()}
          >
            {loading ? <Spinner className="w-4 h-4 mr-2" /> : <RotateCcw className="w-4 h-4 mr-2" />}
            Сбросить пароли
          </Button>
        </div>
        {results.length > 0 && (
          <div className="mt-4 rounded-lg border border-border/70 overflow-hidden">
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
