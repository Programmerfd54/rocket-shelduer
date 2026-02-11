'use client';

import { useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LogIn, KeyRound } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type Result = {
  username: string;
  found: boolean;
  email?: string;
  addedAt?: string;
  lastLoginAt?: string | null;
  enteredWorkspace?: boolean;
  lastEnteredAt?: string | null;
  message?: string;
};

export function UserAccessTab({ workspaceId }: { workspaceId: string }) {
  const [usernames, setUsernames] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [addedList, setAddedList] = useState<Array<{ username: string; email: string }>>([]);
  const [addedListLoading, setAddedListLoading] = useState(false);
  const [addedListVisible, setAddedListVisible] = useState(false);

  const loadAddedList = async () => {
    if (addedListVisible && addedList.length > 0) {
      setAddedListVisible(false);
      return;
    }
    setAddedListLoading(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/admin/added-usernames`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && Array.isArray(data.list)) {
        setAddedList(data.list);
        setAddedListVisible(true);
      } else {
        toast.error(data.error ?? 'Не удалось загрузить список');
      }
    } catch {
      toast.error('Ошибка загрузки');
    } finally {
      setAddedListLoading(false);
    }
  };

  const handleSubmit = async () => {
    const raw = usernames.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    if (raw.length > 100) {
      toast.error('Максимум 100 пользователей за раз');
      return;
    }
    const useRc = !!(adminUsername.trim() && adminPassword);
    if (!useRc && raw.length === 0) {
      toast.error('Введите хотя бы один логин или укажите креды админа RC для списка всех пользователей');
      return;
    }
    setLoading(true);
    setResults([]);
    try {
      if (useRc) {
        const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access-rc`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adminUsername: adminUsername.trim(),
            adminPassword,
            ...(raw.length > 0 && { usernames: raw }),
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.results)) {
          setResults(data.results);
          toast.success(`Проверено: ${data.results.length} пользователей (Rocket.Chat)`);
        } else {
          toast.error(data.error ?? data.details ?? 'Ошибка запроса');
        }
      } else {
        const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access?usernames=${encodeURIComponent(raw.join(','))}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.results)) {
          setResults(data.results);
          toast.success(`Проверено: ${data.results.length} пользователей`);
        } else {
          toast.error(data.error ?? 'Ошибка запроса');
        }
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
        <h3 className="font-semibold text-foreground">Состояние входа</h3>
        <p className="text-sm text-muted-foreground mt-0.5">
          Введите логины пользователей (по одному на строку или через запятую). Будет показано, входил ли каждый в пространство и когда был последний заход.
        </p>
        <p className="text-xs text-muted-foreground mt-1">
          Без кредов — только пользователи, добавленные через «Добавление пользователей». С кредами администратора RC — все пользователи Rocket.Chat (логины можно не вводить: вернётся полный список).
        </p>
      </div>
      <CardContent className="pt-6">
        <div className="space-y-4">
          <div className="rounded-lg border border-border/60 bg-muted/10 p-3 space-y-2">
            <p className="text-sm font-medium flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-muted-foreground" />
              Креды администратора Rocket.Chat (опционально — для доступа ко всем пользователям RC)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <Label htmlFor="access-admin-username" className="text-xs">Логин админа RC</Label>
                <Input
                  id="access-admin-username"
                  type="text"
                  placeholder="admin"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  className="mt-1 h-9"
                  disabled={loading}
                />
              </div>
              <div>
                <Label htmlFor="access-admin-password" className="text-xs">Пароль админа RC</Label>
                <Input
                  id="access-admin-password"
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
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="user-access-usernames" className="shrink-0">Логины (несколько — по одному на строку; при кредах RC можно оставить пустым для полного списка)</Label>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 text-xs"
              onClick={loadAddedList}
              disabled={addedListLoading}
            >
              {addedListLoading ? <Spinner className="w-3 h-3 mr-1" /> : null}
              {addedListVisible && addedList.length > 0 ? 'Скрыть список' : 'Показать список добавленных в пространство'}
            </Button>
          </div>
          {addedListVisible && addedList.length > 0 && (
            <div className="rounded-lg border border-border/60 bg-muted/20 p-3 text-xs">
              <p className="text-muted-foreground mb-2">Логины, по которым можно проверить состояние входа ({addedList.length}):</p>
              <p className="font-mono text-foreground break-all">{addedList.map((u) => u.username).join(', ')}</p>
            </div>
          )}
          <Textarea
            id="user-access-usernames"
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
            disabled={loading || (!usernames.trim() && !(adminUsername.trim() && adminPassword))}
          >
            {loading ? <Spinner className="w-4 h-4 mr-2" /> : <LogIn className="w-4 h-4 mr-2" />}
            Проверить
          </Button>
        </div>
        {results.length > 0 && (
          <div className="mt-4 rounded-lg border border-border/70 overflow-hidden">
            <div className="max-h-[400px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 sticky top-0">
                  <tr>
                    <th className="text-left p-2 font-medium">Логин</th>
                    <th className="text-left p-2 font-medium">Добавлен</th>
                    <th className="text-left p-2 font-medium">Вход в пространство</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={`${r.username}-${i}`} className="border-t border-border/50">
                      <td className="p-2 font-mono">
                        {r.username}
                        {r.email && <span className="text-muted-foreground font-normal block text-xs">{r.email}</span>}
                      </td>
                      <td className="p-2 text-muted-foreground">
                        {r.found && r.addedAt ? new Date(r.addedAt).toLocaleString('ru-RU') : r.found ? '—' : (r.message ?? '—')}
                      </td>
                      <td className="p-2">
                        {r.found ? (
                          r.enteredWorkspace ? (
                            <span className="text-green-600 dark:text-green-400">
                              Входил · {(r.lastEnteredAt ?? r.lastLoginAt) ? new Date((r.lastEnteredAt ?? r.lastLoginAt)!).toLocaleString('ru-RU') : '—'}
                            </span>
                          ) : (
                            <span className="text-amber-600 dark:text-amber-400">Не входил</span>
                          )
                        ) : (
                          <span className="text-destructive">{r.message}</span>
                        )}
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
