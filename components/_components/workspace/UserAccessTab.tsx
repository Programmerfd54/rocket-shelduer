'use client';

import { useState, useMemo } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { LogIn, KeyRound, Users, Download, Search } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

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

export function UserAccessTab({ workspaceId, currentUserRole = 'USER' }: { workspaceId: string; currentUserRole?: string }) {
  const [usernames, setUsernames] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [addedList, setAddedList] = useState<Array<{ username: string; email: string }>>([]);
  const [addedListLoading, setAddedListLoading] = useState(false);
  const [addedListVisible, setAddedListVisible] = useState(false);
  const [filterLogin, setFilterLogin] = useState('');
  const [filterEntry, setFilterEntry] = useState<'all' | 'entered' | 'not-entered'>('all');

  const hideTimestampForAdm = currentUserRole === 'ADM';

  const filteredResults = useMemo(() => {
    let list = results;
    if (filterLogin.trim()) {
      const q = filterLogin.trim().toLowerCase();
      list = list.filter(
        (r) =>
          (r.username || '').toLowerCase().includes(q) ||
          (r.email || '').toLowerCase().includes(q)
      );
    }
    if (filterEntry === 'entered') list = list.filter((r) => r.found && r.enteredWorkspace);
    if (filterEntry === 'not-entered') list = list.filter((r) => r.found && !r.enteredWorkspace);
    return list;
  }, [results, filterLogin, filterEntry]);

  const exportToExcel = () => {
    const rows = [
      ['Логин', 'Email', 'Добавлен', 'Вход в пространство'],
      ...filteredResults.map((r) => [
        r.username,
        r.email ?? '',
        r.found && r.addedAt ? new Date(r.addedAt).toLocaleString('ru-RU') : r.found ? '—' : (r.message ?? '—'),
        r.found
          ? r.enteredWorkspace
            ? hideTimestampForAdm ? 'Входил' : `Входил · ${(r.lastEnteredAt ?? r.lastLoginAt) ? new Date((r.lastEnteredAt ?? r.lastLoginAt)!).toLocaleString('ru-RU') : '—'}`
            : 'Не входил'
          : r.message ?? '—',
      ]),
    ];
    const csv = rows.map((row) => row.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(';')).join('\n');
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `состояние-входа-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Файл сохранён');
  };

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
    const useRc = !!(adminUsername.trim() && adminPassword) || raw.length === 0;
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
    <Card className="rounded-2xl border-2 border-border/80 bg-card shadow-[0_2px_12px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className="px-4 py-3 border-b-2 border-border/70 bg-gradient-to-b from-cyan-500/8 to-transparent">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-500/15 text-cyan-600 dark:text-cyan-400">
            <LogIn className="h-5 w-5" />
          </div>
          <div>
            <h3 className="font-semibold text-foreground">Состояние входа</h3>
            <p className="text-sm text-muted-foreground mt-0.5">
              Введите логины пользователей (по одному на строку или через запятую). Будет показано, входил ли каждый в пространство и когда был последний заход.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Если вы подключены к пространству — можно без кредов (используется ваше подключение). С кредами RC — все пользователи Rocket.Chat. Без кредов и без подключения — только пользователи, добавленные через «Добавление пользователей».
            </p>
          </div>
        </div>
      </div>
      <CardContent className="pt-4 space-y-4">
        <div className="rounded-xl border-2 border-violet-400/40 bg-violet-500/5 p-4 space-y-3">
          <p className="text-sm font-medium flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-500/20 text-violet-600 dark:text-violet-400">
              <KeyRound className="w-4 h-4" />
            </span>
            Креды администратора Rocket.Chat (опционально — для доступа ко всем пользователям RC)
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="access-admin-username" className="text-xs">Логин админа RC</Label>
              <Input
                id="access-admin-username"
                type="text"
                placeholder="admin"
                value={adminUsername}
                onChange={(e) => setAdminUsername(e.target.value)}
                className="mt-1.5 h-9 border-2 border-violet-300/30 focus:border-violet-400/50 rounded-lg bg-background"
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
                className="mt-1.5 h-9 border-2 border-violet-300/30 focus:border-violet-400/50 rounded-lg bg-background"
                disabled={loading}
              />
            </div>
          </div>
        </div>
        <div className="rounded-xl border-2 border-blue-400/40 bg-blue-500/5 p-4 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <Label htmlFor="user-access-usernames" className="flex items-center gap-2 text-sm font-medium shrink-0">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-500/20 text-blue-600 dark:text-blue-400">
                <Users className="w-4 h-4" />
              </span>
              Логины (несколько — по одному на строку; при кредах RC можно оставить пустым)
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-8 text-xs border-2 border-blue-300/40 rounded-lg"
              onClick={loadAddedList}
              disabled={addedListLoading}
            >
              {addedListLoading ? <Spinner className="w-3 h-3 mr-1" /> : null}
              {addedListVisible && addedList.length > 0 ? 'Скрыть список' : 'Показать список добавленных'}
            </Button>
          </div>
          {addedListVisible && addedList.length > 0 && (
            <div className="rounded-lg border-2 border-blue-300/30 bg-blue-500/10 p-3 text-xs">
              <p className="text-muted-foreground mb-2">Логины для проверки ({addedList.length}):</p>
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
            className="min-h-[120px] font-mono text-sm resize-y border-2 border-blue-300/30 focus:border-blue-400/50 rounded-lg bg-background"
            disabled={loading}
          />
        </div>
        <Button
          onClick={handleSubmit}
          disabled={loading}
          className="gap-2 rounded-lg border-2 border-cyan-400/50 bg-cyan-500 hover:bg-cyan-600 text-white shadow-sm"
        >
          {loading ? <Spinner className="w-4 h-4" /> : <LogIn className="w-4 h-4" />}
          Проверить
        </Button>
        {results.length > 0 && (
          <div className="mt-4 rounded-xl border-2 border-emerald-400/40 bg-emerald-500/5 overflow-hidden">
            <div className="p-3 border-b border-border/50 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[140px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Фильтр по логину..."
                  value={filterLogin}
                  onChange={(e) => setFilterLogin(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={filterEntry} onValueChange={(v: 'all' | 'entered' | 'not-entered') => setFilterEntry(v)}>
                <SelectTrigger className="w-[180px] h-9 text-sm">
                  <SelectValue placeholder="Вход в пространство" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="entered">Входил</SelectItem>
                  <SelectItem value="not-entered">Не входил</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-2 h-9" onClick={exportToExcel}>
                <Download className="w-4 h-4" />
                Экспорт в Excel
              </Button>
              <span className="text-xs text-muted-foreground">
                {filteredResults.length} из {results.length}
              </span>
            </div>
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
                  {filteredResults.map((r, i) => (
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
                              {hideTimestampForAdm ? 'Входил' : `Входил · ${(r.lastEnteredAt ?? r.lastLoginAt) ? new Date((r.lastEnteredAt ?? r.lastLoginAt)!).toLocaleString('ru-RU') : '—'}`}
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
