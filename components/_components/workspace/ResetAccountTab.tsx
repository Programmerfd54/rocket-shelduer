'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Field } from '@/components/ui/field';
import { Section } from '@/components/common/Section';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { RotateCcw } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';

type Result = { username: string; success: boolean; message: string };

const MAX_USERS = 100;

export function ResetAccountTab({ workspaceId }: { workspaceId: string }) {
  const [usernames, setUsernames] = useState('');
  const [adminUsername, setAdminUsername] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<Result[]>([]);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [touched, setTouched] = useState(false);

  // Уникальные логины без учёта регистра; дубликаты считаем отдельно, чтобы показать подсказку.
  const parsed = useMemo(() => {
    const all = usernames.split(/[\n,;]+/).map((s) => s.trim()).filter(Boolean);
    return { list: all, unique: new Set(all.map((s) => s.toLowerCase())).size };
  }, [usernames]);
  const raw = parsed.list;
  const duplicates = raw.length - parsed.unique;

  const hasAdminUser = adminUsername.trim().length > 0;
  const hasAdminPass = adminPassword.length > 0;
  const withRc = hasAdminUser && hasAdminPass;
  const rcPartial = hasAdminUser !== hasAdminPass;

  const usernamesError = !touched
    ? undefined
    : raw.length === 0
      ? 'Введите хотя бы один логин'
      : raw.length > MAX_USERS
        ? `Максимум ${MAX_USERS} пользователей за раз — сейчас ${raw.length}`
        : undefined;
  const rcError = rcPartial
    ? hasAdminUser
      ? 'Укажите и пароль администратора — иначе сброс в Rocket.Chat не выполнится'
      : 'Укажите и логин администратора — иначе сброс в Rocket.Chat не выполнится'
    : undefined;
  const canSubmit = raw.length > 0 && raw.length <= MAX_USERS && !rcPartial && !loading;

  const requestConfirm = () => {
    setTouched(true);
    if (!canSubmit) {
      toast.error(rcError ?? usernamesError ?? 'Проверьте поля формы');
      return;
    }
    setConfirmOpen(true);
  };

  const handleSubmit = async () => {
    setLoading(true);
    setResults([]);
    const body: { usernames: string[]; adminUsername?: string; adminPassword?: string } = { usernames: raw };
    if (adminUsername.trim() && adminPassword) {
      body.adminUsername = adminUsername.trim();
      body.adminPassword = adminPassword;
    }
    const toastId = toast.loading(`Сбрасываем пароли: ${raw.length}…`);
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
        toast.success(data.message ?? `Обработано: ${ok} из ${data.results.length}`, { id: toastId });
        setUsernames('');
        setTouched(false);
      } else {
        toast.error(data.error ?? 'Не удалось сбросить пароли. Проверьте данные и повторите.', { id: toastId });
        if (data.results) setResults(data.results);
      }
    } catch {
      toast.error('Нет связи с сервером. Проверьте подключение и повторите.', { id: toastId });
    } finally {
      setLoading(false);
      setConfirmOpen(false);
    }
  };

  const okCount = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success);

  return (
    <div className="space-y-6">
      <Section
        title="Сброс пароля"
        description="Пароль пользователя станет равен его логину. При первом входе система предложит задать новый."
      >
        <div className="space-y-5">
          <Field
            label="Логины пользователей"
            htmlFor="reset-account-usernames"
            required
            error={usernamesError}
            hint="По одному на строку или через запятую, до 100 за раз."
          >
            <Textarea
              id="reset-account-usernames"
              placeholder={'wrightag\nivanov\npetrov'}
              value={usernames}
              onChange={(e) => {
                setUsernames(e.target.value);
                setResults([]);
              }}
              onBlur={() => setTouched(true)}
              aria-invalid={!!usernamesError}
              className="min-h-[120px] resize-y font-mono text-sm"
              disabled={loading}
            />
            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span>Логинов: <span className={cn('font-medium text-foreground', raw.length > MAX_USERS && 'text-destructive')}>{raw.length}</span> из {MAX_USERS}</span>
              {duplicates > 0 && <Badge variant="warning">Повторов: {duplicates}</Badge>}
            </div>
          </Field>

          <div className="space-y-3 border-t pt-4">
            <div className="space-y-0.5">
              <p className="text-sm font-medium">Сбросить также в Rocket.Chat</p>
              <p className="text-xs text-muted-foreground">
                Необязательно. Без учётных данных администратора пароль меняется только в приложении; с ними — и в приложении, и в Rocket.Chat.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Логин администратора RC" htmlFor="reset-admin-username">
                <Input
                  id="reset-admin-username"
                  type="text"
                  placeholder="admin"
                  autoComplete="off"
                  value={adminUsername}
                  onChange={(e) => setAdminUsername(e.target.value)}
                  aria-invalid={rcPartial && !hasAdminUser}
                  disabled={loading}
                />
              </Field>
              <Field label="Пароль администратора RC" htmlFor="reset-admin-password">
                <Input
                  id="reset-admin-password"
                  type="password"
                  placeholder="••••••••"
                  autoComplete="new-password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  aria-invalid={rcPartial && !hasAdminPass}
                  disabled={loading}
                />
              </Field>
            </div>
            {rcError && <p role="alert" className="text-xs text-destructive">{rcError}</p>}
          </div>

          <div className="flex flex-wrap items-center gap-3 border-t pt-4">
            <Button onClick={requestConfirm} disabled={loading || !usernames.trim() || rcPartial}>
              {loading ? <Spinner /> : <RotateCcw />}
              {loading ? 'Сбрасываем…' : `Сбросить пароли${raw.length ? ` (${raw.length})` : ''}`}
            </Button>
            <span className="text-xs text-muted-foreground">Перед выполнением покажем, что именно изменится.</span>
          </div>
        </div>
      </Section>

      {results.length > 0 && (
        <Section
          title="Результат"
          description={`Успешно: ${okCount} из ${results.length}${failed.length ? `, с ошибкой: ${failed.length}` : ''}`}
          actions={failed.length > 0 ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setUsernames(failed.map((r) => r.username).join('\n'));
                setResults([]);
                setTouched(false);
              }}
            >
              Вернуть неудавшиеся в список
            </Button>
          ) : undefined}
          bare
        >
          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="max-h-[320px] overflow-y-auto">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-muted">
                  <tr>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Логин</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Результат</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r, i) => (
                    <tr key={`${r.username}-${i}`} className="border-t hover:bg-muted/40">
                      <td className="px-3 py-2 font-mono">{r.username}</td>
                      <td className="px-3 py-2">
                        {r.success ? (
                          <Badge variant="success">Пароль сброшен</Badge>
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
        </Section>
      )}

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        destructive
        loading={loading}
        title={`Сбросить пароли: ${raw.length}`}
        confirmLabel="Сбросить пароли"
        onConfirm={handleSubmit}
        description={
          <div className="space-y-2">
            <p>
              Пароль каждого из выбранных пользователей станет равен его логину. Текущий пароль перестанет работать,
              это действие нельзя отменить.
            </p>
            <p>
              {withRc
                ? 'Пароль будет изменён в приложении и в Rocket.Chat.'
                : 'Пароль будет изменён только в приложении — в Rocket.Chat он останется прежним.'}
            </p>
          </div>
        }
      >
        <div className="max-h-40 overflow-y-auto rounded-md border bg-muted/40 p-2 font-mono text-xs">
          {raw.slice(0, 50).join(', ')}
          {raw.length > 50 && <span className="text-muted-foreground"> … и ещё {raw.length - 50}</span>}
        </div>
      </ConfirmDialog>
    </div>
  );
}
