'use client';

import { useState, useMemo } from 'react';
import { formatDistanceToNow } from 'date-fns/formatDistanceToNow';
import { ru } from 'date-fns/locale/ru';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Section } from '@/components/common/Section';
import { EmptyState } from '@/components/common/EmptyState';
import { LogIn, Download, Search, HelpCircle, UserX } from 'lucide-react';
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

function freshnessVariant(f: Freshness): 'success' | 'info' | 'warning' | 'danger' | 'muted' {
  switch (f) {
    case 'active':
      return 'success';
    case 'recent':
      return 'info';
    case 'aging':
      return 'warning';
    case 'stale':
      return 'danger';
    default:
      return 'muted';
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

export function UserAccessTab({ workspaceId, currentUserRole = 'MEMBER' }: { workspaceId: string; currentUserRole?: string }) {
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
  /** Проверка завершилась успешно (нужно, чтобы отличить «ещё не проверяли» от «никого не нашли»). */
  const [checked, setChecked] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const hideTimestampForAdm = currentUserRole === 'ADM';

  const parsedLogins = useMemo(() => usernames.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean), [usernames]);
  const hasAdminUser = adminUsername.trim().length > 0;
  const hasAdminPass = adminPassword.length > 0;
  const credsPartial = hasAdminUser !== hasAdminPass;
  const credsError = credsPartial
    ? hasAdminUser
      ? 'Укажите и пароль администратора'
      : 'Укажите и логин администратора'
    : undefined;
  const usernamesError = parsedLogins.length > 100 ? `Максимум 100 пользователей за раз — сейчас ${parsedLogins.length}` : undefined;
  const planText =
    parsedLogins.length === 0
      ? hasAdminUser && hasAdminPass
        ? 'Список пуст — будут проверены все пользователи Rocket.Chat (по кредам администратора).'
        : 'Список пуст — будут проверены все пользователи Rocket.Chat (через ваше подключение к пространству).'
      : hasAdminUser && hasAdminPass
        ? `Будет проверено логинов: ${parsedLogins.length} — по данным Rocket.Chat (креды администратора).`
        : `Будет проверено логинов: ${parsedLogins.length} — по учёту приложения (только добавленные через «Добавление пользователей»).`;

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
    setSubmitted(true);
    const raw = parsedLogins;
    if (raw.length > 100) {
      toast.error('Максимум 100 пользователей за раз');
      return;
    }
    if (credsPartial) {
      toast.error(credsError ?? 'Укажите логин и пароль администратора RC целиком');
      return;
    }
    const useRc = !!(adminUsername.trim() && adminPassword) || raw.length === 0;
    setLoading(true);
    setResults([]);
    setChecked(false);
    setCheckProgress(null);
    const toastId = toast.loading('Проверяем пользователей…');
    const done = (count: number, rc: boolean) => {
      setChecked(true);
      toast.success(`Проверено: ${count} пользователей${rc ? ' (Rocket.Chat)' : ''}`, { id: toastId });
    };
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
            done(data.results.length, true);
          } else {
            toast.error(data.error ?? data.details ?? 'Не удалось получить список. Проверьте данные и повторите.', { id: toastId });
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
              toast.error(`${data.error ?? data.details ?? 'Ошибка запроса'}. Проверено ${merged.length} из ${total} — повторите для остальных.`, { id: toastId });
              setResults(merged);
              return;
            }
            merged.push(...tagRc(data.results as Result[], merged.length));
            const doneCount = merged.length;
            setCheckProgress({ done: doneCount, total });
            setResults([...merged]);
            toast.loading(`Проверяем пользователей: ${doneCount} из ${total}`, { id: toastId });
          }
          done(merged.length, true);
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
            done(data.results.length, true);
          } else {
            toast.error(data.error ?? data.details ?? 'Ошибка запроса. Проверьте данные и повторите.', { id: toastId });
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
            toast.error(`${data.error ?? 'Ошибка запроса'}. Проверено ${merged.length} из ${total} — повторите для остальных.`, { id: toastId });
            setResults(merged);
            return;
          }
          merged.push(...tagScheduler(data.results as Result[], merged.length));
          setCheckProgress({ done: merged.length, total });
          setResults([...merged]);
          toast.loading(`Проверяем пользователей: ${merged.length} из ${total}`, { id: toastId });
        }
        done(merged.length, false);
      } else {
        const res = await fetch(`/api/workspace/${workspaceId}/admin/user-access?usernames=${encodeURIComponent(raw.join(','))}`);
        const data = await res.json().catch(() => ({}));
        if (res.ok && Array.isArray(data.results)) {
          setResults(tagScheduler(data.results as Result[], 0));
          done(data.results.length, false);
        } else {
          toast.error(data.error ?? 'Ошибка запроса. Повторите попытку.', { id: toastId });
        }
      }
    } catch {
      toast.error('Нет связи с сервером. Повторите попытку.', { id: toastId });
    } finally {
      setLoading(false);
      setCheckProgress(null);
    }
  };

  return (
    <div className="space-y-6">
      <Section
        title="Состояние входа"
        description="Показывает, входил ли пользователь в пространство и когда был последний заход."
      >
        <div className="space-y-5">
          <div className="space-y-3">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Доступ к Rocket.Chat</p>
              <p className="text-xs text-muted-foreground">
                Необязательно. Если вы подключены к пространству — креды не нужны. С кредами администратора доступны все пользователи Rocket.Chat; без кредов и без подключения — только добавленные через «Добавление пользователей».
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Логин админа RC" htmlFor="access-admin-username">
                <Input
                  id="access-admin-username"
                  type="text"
                  placeholder="admin"
                  autoComplete="off"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  aria-invalid={submitted && credsPartial && !hasAdminUser}
                  disabled={loading}
                />
              </Field>
              <Field label="Пароль админа RC" htmlFor="access-admin-password">
                <Input
                  id="access-admin-password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  aria-invalid={submitted && credsPartial && !hasAdminPass}
                  disabled={loading}
                />
              </Field>
            </div>
            {(submitted || (hasAdminUser && hasAdminPass)) && credsError && (
              <p role="alert" className="text-xs text-destructive">{credsError}</p>
            )}
          </div>

          <div className="space-y-3 border-t pt-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="text-sm font-medium">Кого проверяем</span>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={loadAddedList}
                disabled={addedListLoading}
              >
                {addedListLoading ? <Spinner /> : null}
                {addedListVisible && addedList.length > 0 ? 'Скрыть список' : 'Показать список добавленных'}
              </Button>
            </div>
            {addedListVisible && addedList.length > 0 && (
              <div className="rounded-md border bg-muted/30 p-3 text-xs">
                <p className="mb-1.5 text-muted-foreground">Добавленные логины ({addedList.length}):</p>
                <p className="break-all font-mono text-foreground">{addedList.map((u) => u.username).join(', ')}</p>
              </div>
            )}
            <Field
              label="Логины"
              htmlFor="user-access-usernames"
              error={usernamesError}
              hint="По одному на строку или через запятую, до 100. При кредах RC поле можно оставить пустым — проверим всех."
            >
              <Textarea
                id="user-access-usernames"
                placeholder={'wrightag\nivanov\npetrov'}
                value={usernames}
                onChange={(e) => {
                  setUsernames(e.target.value);
                  setResults([]);
                  setChecked(false);
                  setFilterPreset('all');
                }}
                aria-invalid={!!usernamesError}
                className="min-h-[120px] resize-y font-mono text-sm"
                disabled={loading}
              />
            </Field>
          </div>

          <div className="flex flex-col gap-3 border-t pt-4 sm:flex-row sm:items-center">
            <Button onClick={handleSubmit} disabled={loading || !!usernamesError || credsPartial}>
              {loading ? <Spinner /> : <LogIn />}
              {loading ? 'Проверяем…' : 'Проверить'}
            </Button>
            <p className="text-xs text-muted-foreground">{planText}</p>
          </div>

          {loading && checkProgress && (
            <div className="space-y-2 rounded-md border bg-muted/30 px-3 py-2.5" role="status" aria-live="polite">
              <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="font-medium tabular-nums text-foreground">
                  Проверено: {checkProgress.done} из {checkProgress.total}
                </span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  Осталось: {Math.max(0, checkProgress.total - checkProgress.done)}
                </span>
              </div>
              <Progress
                value={checkProgress.total > 0 ? (checkProgress.done / checkProgress.total) * 100 : 0}
                aria-label="Прогресс проверки"
                className="h-1.5"
              />
            </div>
          )}
        </div>
      </Section>

      {checked && !loading && results.length === 0 && (
        <EmptyState
          icon={<UserX />}
          title="Пользователей не найдено"
          description="Источник вернул пустой список. Проверьте логины и доступ к Rocket.Chat."
        />
      )}

      {results.length > 0 && (
        <Section
          title="Результат"
          bare
          actions={
            <Button variant="outline" size="sm" onClick={exportToExcel}>
              <Download />
              Экспорт в Excel
            </Button>
          }
        >
          <div className="space-y-4 rounded-lg border bg-card p-4">
            <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4 lg:grid-cols-8">
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
                <div key={cell.label}>
                  <dd className="text-lg font-semibold leading-tight tabular-nums text-foreground">{cell.value}</dd>
                  <dt className="text-xs text-muted-foreground">{cell.label}</dt>
                </div>
              ))}
            </dl>
            <div className="space-y-1">
              <div className="flex h-2 w-full overflow-hidden rounded-sm bg-muted">
                {summary.total > 0 ? (
                  <>
                    <div
                      className="bg-emerald-500 transition-all"
                      style={{ width: `${(summary.entered / summary.total) * 100}%` }}
                      title="Был вход"
                    />
                    <div
                      className="bg-amber-500 transition-all"
                      style={{ width: `${(summary.foundNotEntered / summary.total) * 100}%` }}
                      title="Найден, не входил"
                    />
                    <div
                      className="bg-muted-foreground/40 transition-all"
                      style={{ width: `${(summary.notFound / summary.total) * 100}%` }}
                      title="Не найден"
                    />
                  </>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground">
                Зелёный — был вход, жёлтый — найден без входа, серый — не найден в источнике.
                {dataSourceLabel && (
                  <>
                    {' '}Источник дат:{' '}
                    <span className="font-medium text-foreground">
                      {dataSourceLabel === 'rocketchat'
                        ? 'Rocket.Chat (lastLogin на сервере)'
                        : 'приложение (учёт добавленных в пространство)'}
                    </span>
                  </>
                )}
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[140px] flex-1 sm:max-w-xs">
              <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input
                placeholder="Фильтр по логину…"
                aria-label="Фильтр по логину"
                value={filterLogin}
                onChange={(e) => setFilterLogin(e.target.value)}
                className="pl-8"
              />
            </div>
            <Select value={filterPreset} onValueChange={(v: FilterPreset) => setFilterPreset(v)}>
              <SelectTrigger className="w-full sm:w-[220px]" aria-label="Фильтр по состоянию">
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
              <SelectTrigger className="w-full sm:w-[200px]" aria-label="Сортировка">
                <SelectValue placeholder="Сортировка" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="order">Как в списке</SelectItem>
                <SelectItem value="login-asc">Логин А→Я</SelectItem>
                <SelectItem value="activity-desc">Сначала свежие</SelectItem>
                <SelectItem value="activity-asc">Сначала старые</SelectItem>
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground sm:ml-auto">
              Показано {filteredResults.length} из {results.length}
            </span>
          </div>

          <div className="max-h-[480px] overflow-auto rounded-lg border bg-card">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10 bg-muted">
                <tr>
                  <th className="p-2 px-3 text-left align-bottom text-xs font-medium text-muted-foreground">Логин</th>
                  <th className="w-[100px] p-2 px-3 text-left align-bottom text-xs font-medium text-muted-foreground">Источник</th>
                  <th className="min-w-[120px] p-2 px-3 text-left align-bottom text-xs font-medium text-muted-foreground">
                    Добавлен в приложение
                  </th>
                  <th className="min-w-[220px] p-2 px-3 text-left align-bottom text-xs font-medium text-muted-foreground">
                    <div className="flex items-center gap-1">
                      <span>
                        Активность
                        <span className="ml-1 font-normal">
                          ({dataSourceLabel === 'scheduler'
                            ? 'последний вход (учёт)'
                            : dataSourceLabel === 'rocketchat'
                              ? 'lastLogin в RC'
                              : 'дата входа'})
                        </span>
                      </span>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <button
                            type="button"
                            className="rounded text-muted-foreground hover:text-foreground"
                            aria-label="Справка по колонке"
                          >
                            <HelpCircle className="size-3.5" />
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
                {filteredResults.length === 0 && (
                  <tr>
                    <td colSpan={4} className="p-6 text-center text-sm text-muted-foreground">
                      Ничего не найдено по текущему фильтру.{' '}
                      <button
                        type="button"
                        className="text-primary underline-offset-2 hover:underline"
                        onClick={() => {
                          setFilterLogin('');
                          setFilterPreset('all');
                        }}
                      >
                        Сбросить фильтры
                      </button>
                    </td>
                  </tr>
                )}
                {filteredResults.map((r, i) => {
                  const ts = getActivityTs(r);
                  const fr = getFreshness(ts);
                  const frKey = fr === 'none' ? null : fr;
                  return (
                    <tr key={`${r.username}-${r.orderIndex ?? i}`} className="border-t hover:bg-muted/40">
                      <td className="p-2 px-3 align-top font-mono">
                        {r.username}
                        {r.email && (
                          <span className="block text-xs font-normal text-muted-foreground">{r.email}</span>
                        )}
                      </td>
                      <td className="p-2 px-3 align-top">
                        {r.dataSource === 'rocketchat' ? (
                          <Badge variant="muted">RC</Badge>
                        ) : r.dataSource === 'scheduler' ? (
                          <Badge variant="muted">Прилож.</Badge>
                        ) : (
                          <span className="text-muted-foreground">—</span>
                        )}
                      </td>
                      <td className="p-2 px-3 align-top text-xs text-muted-foreground">
                        {r.found && r.addedAt
                          ? new Date(r.addedAt).toLocaleString('ru-RU')
                          : r.found
                            ? '—'
                            : (r.message ?? '—')}
                      </td>
                      <td className="p-2 px-3 align-top">
                        {!r.found ? (
                          <span className="text-destructive">{r.message ?? 'Не найден'}</span>
                        ) : r.enteredWorkspace && ts != null ? (
                          <div className="space-y-1">
                            <div className="flex flex-wrap items-center gap-1.5">
                              {frKey && (
                                <Badge variant={freshnessVariant(fr)}>{FRESHNESS_LABEL[frKey]}</Badge>
                              )}
                              {!hideTimestampForAdm && (
                                <span className="text-xs text-foreground">
                                  {formatDistanceToNow(new Date(ts), { addSuffix: true, locale: ru })}
                                </span>
                              )}
                              {hideTimestampForAdm && (
                                <span className="text-xs text-foreground">Входил</span>
                              )}
                            </div>
                            {!hideTimestampForAdm && (
                              <Tooltip>
                                <TooltipTrigger asChild>
                                  <button
                                    type="button"
                                    className="text-left text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
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
                          <span className="text-xs text-foreground">Входил (дата недоступна)</span>
                        ) : (
                          <Badge variant="warning">Не входил</Badge>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}
    </div>
  );
}
