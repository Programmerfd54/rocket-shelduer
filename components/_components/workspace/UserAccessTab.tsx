'use client';

import { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { ru } from 'date-fns/locale/ru';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { LogIn, KeyRound, Users, Download, Search, HelpCircle } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Запросов к RC меньше, прогресс обновляется чаще, чем по одному пользователю. */
const RC_CHECK_BATCH_SIZE = 8;
/** GET с длинным query — режем список, чтобы не упираться в лимит URL и показывать прогресс. */
const LOCAL_CHECK_BATCH_SIZE = 25;

const MS_DAY = 86400000;

type DataSource = 'rocketchat' | 'scheduler';

type Result = {
  username: string;
  found: boolean;
  email?: string;
  addedAt?: string;
  lastLoginAt?: string | null;
  enteredWorkspace?: boolean;
  lastEnteredAt?: string | null;
  message?: string;
  /** Проставляется на клиенте после ответа API. */
  dataSource?: DataSource;
  /** Порядок строк как в запросе (для сортировки «как в списке»). */
  orderIndex?: number;
};

function getActivityTs(r: Result): number | null {
  const s = r.lastEnteredAt ?? r.lastLoginAt ?? null;
  if (!s) return null;
  const t = new Date(s).getTime();
  return Number.isNaN(t) ? null : t;
}

type Freshness = 'active' | 'recent' | 'aging' | 'stale' | 'none';

function getFreshness(ts: number | null): Freshness {
  if (ts == null) return 'none';
  const days = (Date.now() - ts) / MS_DAY;
  if (days <= 7) return 'active';
  if (days <= 30) return 'recent';
  if (days <= 90) return 'aging';
  return 'stale';
}

const FRESHNESS_LABEL: Record<Exclude<Freshness, 'none'>, string> = {
  active: 'Активен',
  recent: 'Недавно',
  aging: 'Давно',
  stale: 'Очень давно',
};

function freshnessBadgeClass(f: Freshness): string {
  switch (f) {
    case 'active':
      return 'border-emerald-500/50 bg-emerald-500/15 text-emerald-800 dark:text-emerald-200';
    case 'recent':
      return 'border-cyan-500/50 bg-cyan-500/15 text-cyan-900 dark:text-cyan-100';
    case 'aging':
      return 'border-amber-500/50 bg-amber-500/15 text-amber-900 dark:text-amber-100';
    case 'stale':
      return 'border-orange-600/50 bg-orange-500/15 text-orange-900 dark:text-orange-100';
    default:
      return 'border-border bg-muted text-muted-foreground';
  }
}

type FilterPreset =
  | 'all'
  | 'entered'
  | 'not-entered'
  | 'not-found'
  | 'no-activity-date'
  | 'week'
  | 'stale';

type SortMode = 'order' | 'login-asc' | 'activity-desc' | 'activity-asc';

function tagRc(results: Result[], orderOffset: number): Result[] {
  return results.map((r, i) => ({
    ...r,
    dataSource: 'rocketchat' as const,
    orderIndex: orderOffset + i,
  }));
}

function tagScheduler(results: Result[], orderOffset: number): Result[] {
  return results.map((r, i) => ({
    ...r,
    dataSource: 'scheduler' as const,
    orderIndex: orderOffset + i,
  }));
}

export function UserAccessTab({ workspaceId, currentUserRole = 'USER' }: { workspaceId: string; currentUserRole?: string }) {
  const [usernames, setUsernames] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  /** Прогресс пошаговой проверки (null — нет или одна короткая операция без счётчика). */
  const [checkProgress, setCheckProgress] = useState<{ done: number; total: number } | null>(null);
  const [results, setResults] = useState<Result[]>([]);
  const [addedList, setAddedList] = useState<Array<{ username: string; email: string }>>([]);
  const [addedListLoading, setAddedListLoading] = useState(false);
  const [addedListVisible, setAddedListVisible] = useState(false);
  const [filterLogin, setFilterLogin] = useState('');
  const [filterPreset, setFilterPreset] = useState<FilterPreset>('all');
  const [sortMode, setSortMode] = useState<SortMode>('order');

  const hideTimestampForAdm = currentUserRole === 'ADM';

  const dataSourceLabel = useMemo((): DataSource | null => {
    const s = results[0]?.dataSource;
    if (!s) return null;
    return results.every((r) => r.dataSource === s) ? s : null;
  }, [results]);

  const summary = useMemo(() => {
    const total = results.length;
    let found = 0;
    let notFound = 0;
    let entered = 0;
    let foundNotEntered = 0;
    let week = 0;
    let stale = 0;
    let noActivityDate = 0;
    const now = Date.now();
    for (const r of results) {
      if (!r.found) {
        notFound += 1;
        continue;
      }
      found += 1;
      const ts = getActivityTs(r);
      if (r.enteredWorkspace) entered += 1;
      else foundNotEntered += 1;
      if (r.found && ts == null) noActivityDate += 1;
      if (ts != null) {
        if (now - ts <= 7 * MS_DAY) week += 1;
        if (now - ts > 90 * MS_DAY) stale += 1;
      }
    }
    return {
      total,
      found,
      notFound,
      entered,
      foundNotEntered,
      week,
      stale,
      noActivityDate,
    };
  }, [results]);

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
    if (filterPreset === 'entered') list = list.filter((r) => r.found && r.enteredWorkspace);
    if (filterPreset === 'not-entered') list = list.filter((r) => r.found && !r.enteredWorkspace);
    if (filterPreset === 'not-found') list = list.filter((r) => !r.found);
    if (filterPreset === 'no-activity-date') list = list.filter((r) => r.found && getActivityTs(r) == null);
    if (filterPreset === 'week') {
      const now = Date.now();
      list = list.filter((r) => {
        const t = getActivityTs(r);
        return t != null && now - t <= 7 * MS_DAY;
      });
    }
    if (filterPreset === 'stale') {
      const now = Date.now();
      list = list.filter((r) => {
        const t = getActivityTs(r);
        return t != null && now - t > 90 * MS_DAY;
      });
    }

    if (sortMode === 'login-asc') {
      list = [...list].sort((a, b) =>
        (a.username || '').localeCompare(b.username || '', 'ru', { sensitivity: 'base' })
      );
    } else if (sortMode === 'activity-desc') {
      list = [...list].sort((a, b) => {
        const ta = getActivityTs(a);
        const tb = getActivityTs(b);
        if (ta == null && tb == null) return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
        if (ta == null) return 1;
        if (tb == null) return -1;
        return tb - ta;
      });
    } else if (sortMode === 'activity-asc') {
      list = [...list].sort((a, b) => {
        const ta = getActivityTs(a);
        const tb = getActivityTs(b);
        if (ta == null && tb == null) return (a.orderIndex ?? 0) - (b.orderIndex ?? 0);
        if (ta == null) return 1;
        if (tb == null) return -1;
        return ta - tb;
      });
    } else {
      list = [...list].sort((a, b) => (a.orderIndex ?? 0) - (b.orderIndex ?? 0));
    }
    return list;
  }, [results, filterLogin, filterPreset, sortMode]);

  const exportToExcel = () => {
    const exportedAt = new Date().toLocaleString('ru-RU');
    const sourceText =
      dataSourceLabel === 'rocketchat'
        ? 'Rocket.Chat (последний вход на сервере)'
        : dataSourceLabel === 'scheduler'
          ? 'Приложение (список добавленных в пространство)'
          : 'Смешанный / неизвестно';
    const summaryRows = [
      ['Сводка'],
      ['Дата выгрузки', exportedAt],
      ['Источник данных', sourceText],
      ['Всего в выборке', String(summary.total)],
      ['Найдено', String(summary.found)],
      ['Не найдено', String(summary.notFound)],
      ['Был вход (есть дата/активность)', String(summary.entered)],
      ['Не входил (найден, но без входа)', String(summary.foundNotEntered)],
      ['Активность за 7 дней', String(summary.week)],
      ['Без даты активности', String(summary.noActivityDate)],
      ['Давно (>90 дней)', String(summary.stale)],
      [],
      [
        'Логин',
        'Email',
        'Источник',
        'Свежесть',
        'Относительно',
        'Дата и время (точно)',
        'Добавлен в приложение',
        'Статус входа',
      ],
    ];
    const dataRows = filteredResults.map((r) => {
      const ts = getActivityTs(r);
      const fr = getFreshness(ts);
      const frLabel = fr === 'none' ? '—' : FRESHNESS_LABEL[fr];
      const rel =
        ts === null || hideTimestampForAdm
          ? '—'
          : formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru });
      const abs =
        ts === null || hideTimestampForAdm
          ? '—'
          : new Date(ts).toLocaleString('ru-RU');
      const src =
        r.dataSource === 'rocketchat' ? 'Rocket.Chat' : r.dataSource === 'scheduler' ? 'Приложение' : '—';
      const added =
        r.found && r.addedAt ? new Date(r.addedAt).toLocaleString('ru-RU') : r.found ? '—' : (r.message ?? '—');
      const status = !r.found
        ? r.message ?? 'Не найден'
        : r.enteredWorkspace
          ? hideTimestampForAdm
            ? 'Входил'
            : 'Входил'
          : 'Не входил';
      return [
        r.username,
        r.email ?? '',
        src,
        frLabel,
        rel,
        abs,
        added,
        status,
      ];
    });
    const rows = [...summaryRows, ...dataRows];
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
    setCheckProgress(null);
    try {
      if (useRc) {
        if (raw.length === 0) {
          const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access-rc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adminUsername: adminUsername.trim(),
              adminPassword,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(data.results)) {
            setResults(tagRc(data.results as Result[], 0));
            toast.success(`Проверено: ${data.results.length} пользователей (Rocket.Chat)`);
          } else {
            toast.error(data.error ?? data.details ?? 'Ошибка запроса');
          }
        } else if (raw.length > RC_CHECK_BATCH_SIZE) {
          const total = raw.length;
          setCheckProgress({ done: 0, total });
          const merged: Result[] = [];
          for (let i = 0; i < raw.length; i += RC_CHECK_BATCH_SIZE) {
            const chunk = raw.slice(i, i + RC_CHECK_BATCH_SIZE);
            const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access-rc`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                adminUsername: adminUsername.trim(),
                adminPassword,
                usernames: chunk,
              }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok || !Array.isArray(data.results)) {
              toast.error(data.error ?? data.details ?? 'Ошибка запроса');
              setResults(merged);
              return;
            }
            merged.push(...tagRc(data.results as Result[], merged.length));
            const done = merged.length;
            setCheckProgress({ done, total });
            setResults([...merged]);
          }
          toast.success(`Проверено: ${merged.length} пользователей (Rocket.Chat)`);
        } else {
          const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access-rc`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              adminUsername: adminUsername.trim(),
              adminPassword,
              usernames: raw,
            }),
          });
          const data = await res.json().catch(() => ({}));
          if (res.ok && Array.isArray(data.results)) {
            setResults(tagRc(data.results as Result[], 0));
            toast.success(`Проверено: ${data.results.length} пользователей (Rocket.Chat)`);
          } else {
            toast.error(data.error ?? data.details ?? 'Ошибка запроса');
          }
        }
      } else if (raw.length > LOCAL_CHECK_BATCH_SIZE) {
        const total = raw.length;
        setCheckProgress({ done: 0, total });
        const merged: Result[] = [];
        for (let i = 0; i < raw.length; i += LOCAL_CHECK_BATCH_SIZE) {
          const chunk = raw.slice(i, i + LOCAL_CHECK_BATCH_SIZE);
          const res = await fetch(
            `/api/workspace/${workspaceId}/admin/user-access?usernames=${encodeURIComponent(chunk.join(','))}`
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok || !Array.isArray(data.results)) {
            toast.error(data.error ?? 'Ошибка запроса');
            setResults(merged);
            return;
          }
          merged.push(...tagScheduler(data.results as Result[], merged.length));
          setCheckProgress({ done: merged.length, total });
          setResults([...merged]);
        }
        toast.success(`Проверено: ${merged.length} пользователей`);
      } else {
        const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access?usernames=${encodeURIComponent(raw.join(','))}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.results)) {
          setResults(tagScheduler(data.results as Result[], 0));
          toast.success(`Проверено: ${data.results.length} пользователей`);
        } else {
          toast.error(data.error ?? 'Ошибка запроса');
        }
      }
    } catch {
      toast.error('Ошибка запроса');
    } finally {
      setLoading(false);
      setCheckProgress(null);
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
              setFilterPreset('all');
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
        {loading && checkProgress && (
          <div
            className="rounded-xl border border-cyan-400/30 bg-cyan-500/5 px-4 py-3 space-y-2"
            role="status"
            aria-live="polite"
          >
            <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
              <span className="text-foreground font-medium tabular-nums">
                Проверено: {checkProgress.done} из {checkProgress.total}
              </span>
              <span className="text-muted-foreground tabular-nums">
                Осталось: {Math.max(0, checkProgress.total - checkProgress.done)}
              </span>
            </div>
            <Progress
              value={checkProgress.total > 0 ? (checkProgress.done / checkProgress.total) * 100 : 0}
              className="h-2"
            />
          </div>
        )}
        {results.length > 0 && (
          <div className="mt-4 rounded-xl border-2 border-emerald-400/40 bg-emerald-500/5 overflow-hidden space-y-3">
            <div className="p-3 sm:p-4 border-b border-border/50 bg-emerald-500/[0.07] space-y-3">
              <p className="text-sm font-semibold text-foreground">Сводка по выборке</p>
              <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 text-center">
                {[
                  { label: 'Всего', value: summary.total },
                  { label: 'Найдено', value: summary.found },
                  { label: 'Не в списке', value: summary.notFound },
                  { label: 'Был вход', value: summary.entered },
                  { label: 'Не входил', value: summary.foundNotEntered },
                  { label: '≤ 7 дней', value: summary.week },
                  { label: 'Без даты', value: summary.noActivityDate },
                  { label: 'Старше 90 дн.', value: summary.stale },
                ].map((cell) => (
                  <div
                    key={cell.label}
                    className="rounded-lg border border-border/60 bg-background/80 px-2 py-2 shadow-sm"
                  >
                    <div className="text-lg font-bold tabular-nums text-foreground leading-tight">{cell.value}</div>
                    <div className="text-[10px] sm:text-[11px] text-muted-foreground leading-snug mt-0.5">{cell.label}</div>
                  </div>
                ))}
              </div>
              <div className="space-y-1">
                <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted">
                  {summary.total > 0 ? (
                    <>
                      <div
                        className="bg-emerald-500 transition-all"
                        style={{ width: `${(summary.entered / summary.total) * 100}%` }}
                        title="Был вход"
                      />
                      <div
                        className="bg-amber-500/90 transition-all"
                        style={{ width: `${(summary.foundNotEntered / summary.total) * 100}%` }}
                        title="Найден, не входил"
                      />
                      <div
                        className="bg-muted-foreground/45 transition-all"
                        style={{ width: `${(summary.notFound / summary.total) * 100}%` }}
                        title="Не найден"
                      />
                    </>
                  ) : null}
                </div>
                <p className="text-[11px] text-muted-foreground">
                  Полоса: зелёный — был вход, жёлтый — найден без входа, серый — не найден в источнике.
                </p>
              </div>
              {dataSourceLabel && (
                <p className="text-xs text-muted-foreground">
                  Источник дат активности:{' '}
                  <span className="font-medium text-foreground">
                    {dataSourceLabel === 'rocketchat'
                      ? 'Rocket.Chat (поле lastLogin на сервере)'
                      : 'приложение (учёт по списку «добавленных» в пространство)'}
                  </span>
                </p>
              )}
            </div>
            <div className="px-3 pb-0 flex flex-wrap items-center gap-3">
              <div className="relative flex-1 min-w-[140px]">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  placeholder="Фильтр по логину..."
                  value={filterLogin}
                  onChange={(e) => setFilterLogin(e.target.value)}
                  className="pl-8 h-9 text-sm"
                />
              </div>
              <Select value={filterPreset} onValueChange={(v: FilterPreset) => setFilterPreset(v)}>
                <SelectTrigger className="w-[220px] h-9 text-sm">
                  <SelectValue placeholder="Фильтр" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все строки</SelectItem>
                  <SelectItem value="entered">Был вход</SelectItem>
                  <SelectItem value="not-entered">Не входил (найден)</SelectItem>
                  <SelectItem value="not-found">Не найден в источнике</SelectItem>
                  <SelectItem value="no-activity-date">Нет даты активности</SelectItem>
                  <SelectItem value="week">Активность за 7 дней</SelectItem>
                  <SelectItem value="stale">Давно (&gt;90 дней)</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sortMode} onValueChange={(v: SortMode) => setSortMode(v)}>
                <SelectTrigger className="w-[200px] h-9 text-sm">
                  <SelectValue placeholder="Сортировка" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="order">Как в списке</SelectItem>
                  <SelectItem value="login-asc">Логин А→Я</SelectItem>
                  <SelectItem value="activity-desc">Сначала свежие</SelectItem>
                  <SelectItem value="activity-asc">Сначала старые</SelectItem>
                </SelectContent>
              </Select>
              <Button variant="outline" size="sm" className="gap-2 h-9" onClick={exportToExcel}>
                <Download className="w-4 h-4" />
                Экспорт в Excel
              </Button>
              <span className="text-xs text-muted-foreground">
                Показано {filteredResults.length} из {results.length}
              </span>
            </div>
            <div className="max-h-[480px] overflow-x-auto overflow-y-auto px-3 pb-3">
              <table className="w-full text-sm min-w-[720px]">
                <thead className="bg-muted/30 sticky top-0 z-10">
                  <tr>
                    <th className="text-left p-2 font-medium align-bottom">Логин</th>
                    <th className="text-left p-2 font-medium align-bottom w-[100px]">Источник</th>
                    <th className="text-left p-2 font-medium align-bottom min-w-[120px]">
                      <span className="block">Добавлен</span>
                      <span className="text-[10px] font-normal text-muted-foreground">в приложение</span>
                    </th>
                    <th className="text-left p-2 font-medium align-bottom min-w-[220px]">
                      <div className="flex items-start gap-1">
                        <span>
                          <span className="block">Активность</span>
                          <span className="text-[10px] font-normal text-muted-foreground block leading-tight">
                            {dataSourceLabel === 'scheduler'
                              ? 'последний вход (учёт)'
                              : dataSourceLabel === 'rocketchat'
                                ? 'lastLogin в Rocket.Chat'
                                : 'дата входа'}
                          </span>
                        </span>
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <button
                              type="button"
                              className="mt-0.5 text-muted-foreground hover:text-foreground rounded"
                              aria-label="Справка по колонке"
                            >
                              <HelpCircle className="w-3.5 h-3.5" />
                            </button>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[280px] text-xs leading-relaxed">
                            {dataSourceLabel === 'scheduler'
                              ? 'Дата и факт входа берутся из учёта приложения для пользователей, добавленных в пространство через «Добавление пользователей».'
                              : 'Дата последнего входа в Rocket.Chat (поле lastLogin). Это не то же самое, что активность в одном канале, если сервер отдаёт только общий вход.'}
                          </TooltipContent>
                        </Tooltip>
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {filteredResults.map((r, i) => {
                    const ts = getActivityTs(r);
                    const fr = getFreshness(ts);
                    const frKey = fr === 'none' ? null : fr;
                    return (
                      <tr key={`${r.username}-${r.orderIndex ?? i}`} className="border-t border-border/50">
                        <td className="p-2 font-mono align-top">
                          {r.username}
                          {r.email && (
                            <span className="text-muted-foreground font-normal block text-xs">{r.email}</span>
                          )}
                        </td>
                        <td className="p-2 align-top">
                          {r.dataSource === 'rocketchat' ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              RC
                            </Badge>
                          ) : r.dataSource === 'scheduler' ? (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
                              Прилож.
                            </Badge>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                        <td className="p-2 text-muted-foreground align-top text-xs">
                          {r.found && r.addedAt
                            ? new Date(r.addedAt).toLocaleString('ru-RU')
                            : r.found
                              ? '—'
                              : (r.message ?? '—')}
                        </td>
                        <td className="p-2 align-top">
                          {!r.found ? (
                            <span className="text-destructive">{r.message}</span>
                          ) : r.enteredWorkspace && ts != null ? (
                            <div className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                {frKey && (
                                  <span
                                    className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${freshnessBadgeClass(fr)}`}
                                  >
                                    {FRESHNESS_LABEL[frKey]}
                                  </span>
                                )}
                                {!hideTimestampForAdm && (
                                  <span className="text-green-700 dark:text-green-400 text-xs">
                                    {formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru })}
                                  </span>
                                )}
                                {hideTimestampForAdm && (
                                  <span className="text-green-600 dark:text-green-400 text-xs">Входил</span>
                                )}
                              </div>
                              {!hideTimestampForAdm && (
                                <Tooltip>
                                  <TooltipTrigger asChild>
                                    <button
                                      type="button"
                                      className="text-left text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
                                    >
                                      {new Date(ts).toLocaleString('ru-RU')}
                                    </button>
                                  </TooltipTrigger>
                                  <TooltipContent className="max-w-xs text-xs">
                                    Точное время последней активности по данным{' '}
                                    {r.dataSource === 'scheduler' ? 'приложения' : 'Rocket.Chat'}.
                                  </TooltipContent>
                                </Tooltip>
                              )}
                            </div>
                          ) : r.enteredWorkspace && ts == null ? (
                            <span className="text-green-600 dark:text-green-400 text-xs">Входил (дата недоступна)</span>
                          ) : (
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span
                                className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[10px] font-medium ${freshnessBadgeClass('none')}`}
                              >
                                Нет входа
                              </span>
                              <span className="text-amber-600 dark:text-amber-400 text-xs">Не входил</span>
                            </div>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
