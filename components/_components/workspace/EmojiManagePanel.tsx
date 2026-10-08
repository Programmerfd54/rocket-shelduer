'use client';

import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Section } from '@/components/common/Section';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { AlertCircle, ListChecks, RefreshCw, Search, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

type RcEmoji = {
  _id: string;
  name: string;
  aliases: string[];
  extension: string;
};

type EmojiManagePanelProps = {
  workspaceId: string;
  adminUsername: string;
  adminPassword: string;
  disabled?: boolean;
};

export function EmojiManagePanel({
  workspaceId,
  adminUsername,
  adminPassword,
  disabled = false,
}: EmojiManagePanelProps) {
  const [emojis, setEmojis] = useState<RcEmoji[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [loading, setLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteProgress, setDeleteProgress] = useState<{
    current: number;
    total: number;
    deleted: number;
    errorsCount: number;
  } | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');
  const [confirmDelete, setConfirmDelete] = useState<'selected' | 'all' | null>(null);
  const [confirmText, setConfirmText] = useState('');
  const [loadError, setLoadError] = useState<string | null>(null);

  const credsMissing = !adminUsername.trim() || !adminPassword;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return emojis;
    return emojis.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.aliases.some((a) => a.toLowerCase().includes(q))
    );
  }, [emojis, search]);

  const allFilteredSelected =
    filtered.length > 0 && filtered.every((e) => selectedIds.has(e._id));

  const loadEmojis = async (silent = false) => {
    const username = adminUsername.trim();
    const password = adminPassword;
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора Rocket.Chat');
      return;
    }
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/emoji-import/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'list',
          adminUsername: username,
          adminPassword: password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Ошибка загрузки списка');
      setEmojis(data.emojis ?? []);
      setLoaded(true);
      setSelectedIds(new Set());
      if (!silent) {
        toast.success(`В пространстве ${data.total ?? 0} кастомных эмодзи`);
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Не удалось загрузить список';
      setLoadError(message);
      toast.error(message);
    } finally {
      setLoading(false);
    }
  };

  const toggleOne = (id: string, checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const toggleAllFiltered = (checked: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const e of filtered) {
        if (checked) next.add(e._id);
        else next.delete(e._id);
      }
      return next;
    });
  };

  const runDelete = async (mode: 'selected' | 'all') => {
    setConfirmDelete(null);
    setConfirmText('');
    const username = adminUsername.trim();
    const password = adminPassword;
    if (!username || !password) {
      toast.error('Введите логин и пароль администратора Rocket.Chat в блоке импорта выше');
      return;
    }

    setDeleting(true);
    setDeleteProgress(null);
    const toastId = toast.loading('Удаляем эмодзи…');
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/emoji-import/manage`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'delete',
          adminUsername: username,
          adminPassword: password,
          deleteAll: mode === 'all',
          emojiIds: mode === 'selected' ? Array.from(selectedIds) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || 'Ошибка удаления');
      }

      const reader = res.body?.getReader();
      if (!reader) throw new Error('Нет потока ответа');

      const decoder = new TextDecoder();
      let buffer = '';
      let deleted = 0;
      let errors: string[] | undefined;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) {
          if (!line.trim()) continue;
          const msg = JSON.parse(line) as {
            t: string;
            total?: number;
            current?: number;
            deleted?: number;
            errorsCount?: number;
            errors?: string[];
            error?: string;
          };
          if (msg.t === 'start') {
            setDeleteProgress({
              current: 0,
              total: msg.total || 0,
              deleted: 0,
              errorsCount: 0,
            });
          } else if (msg.t === 'progress') {
            setDeleteProgress({
              current: msg.current || 0,
              total: msg.total || 0,
              deleted: msg.deleted || 0,
              errorsCount: msg.errorsCount || 0,
            });
            toast.loading(`Удаляем эмодзи: ${msg.current || 0} из ${msg.total || 0}`, { id: toastId });
          } else if (msg.t === 'done') {
            deleted = msg.deleted || 0;
            errors = msg.errors;
          } else if (msg.t === 'error') {
            throw new Error(msg.error || 'Удаление прервано');
          }
        }
      }

      await loadEmojis(true);
      if (errors?.length) {
        toast.warning(`Удалено ${deleted}, с ошибками: ${errors.length}`, { id: toastId, duration: 10_000 });
      } else {
        toast.success(`Удалено эмодзи: ${deleted}`, { id: toastId });
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Не удалось удалить эмодзи. Обновите список и повторите.', { id: toastId });
    } finally {
      setDeleting(false);
      setDeleteProgress(null);
    }
  };

  const deleteCount = confirmDelete === 'all' ? emojis.length : selectedIds.size;
  const needsTypedConfirm = confirmDelete === 'all';

  return (
    <>
      <Section
        title="Управление кастомными эмодзи"
        description="Список эмодзи в Rocket.Chat и удаление выбранных или всех сразу. Используются те же учётные данные администратора, что и для импорта."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => loadEmojis()}
            disabled={disabled || loading || deleting || credsMissing}
          >
            {loading ? <Spinner /> : <RefreshCw />}
            {loaded ? 'Обновить список' : 'Загрузить список'}
          </Button>
        }
      >
        <div className="space-y-4">
          {credsMissing && (
            <p className="text-xs text-muted-foreground">
              Чтобы загрузить список, введите логин и пароль администратора Rocket.Chat в блоке импорта выше.
            </p>
          )}

          {loaded && (
            <p className="text-sm tabular-nums text-muted-foreground">
              Всего: <span className="font-medium text-foreground">{emojis.length}</span>
              {selectedIds.size > 0 && (
                <>
                  {' '}· выбрано: <span className="font-medium text-foreground">{selectedIds.size}</span>
                </>
              )}
            </p>
          )}

          {deleting && deleteProgress && (
            <div className="space-y-2 rounded-md border bg-muted/30 p-3" role="status" aria-live="polite">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium">Удаление эмодзи…</span>
                <span className="text-xs tabular-nums text-muted-foreground">
                  {deleteProgress.current} / {deleteProgress.total} · удалено {deleteProgress.deleted}
                  {deleteProgress.errorsCount > 0 && ` · ошибок ${deleteProgress.errorsCount}`}
                </span>
              </div>
              <Progress
                value={deleteProgress.total ? (100 * deleteProgress.current) / deleteProgress.total : 0}
                aria-label="Прогресс удаления эмодзи"
                className="h-1.5"
              />
            </div>
          )}

          {loading && !loaded && (
            <div className="space-y-2" role="status" aria-busy="true" aria-label="Загрузка списка эмодзи">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-8 w-full" />
              ))}
            </div>
          )}

          {loadError && !loading && (
            <EmptyState
              icon={<AlertCircle />}
              title="Не удалось загрузить список"
              description={loadError}
              action={{ label: 'Повторить', onClick: () => loadEmojis() }}
            />
          )}

          {loaded && emojis.length > 0 && (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <div className="relative min-w-[200px] max-w-sm flex-1">
                  <Search className="absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <Input
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Поиск по имени или алиасу…"
                    aria-label="Поиск эмодзи"
                    disabled={deleting}
                    className="pl-9"
                  />
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deleting || selectedIds.size === 0}
                    onClick={() => setConfirmDelete('selected')}
                  >
                    <Trash2 />
                    Удалить выбранные ({selectedIds.size})
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={deleting}
                    className="text-destructive hover:text-destructive"
                    onClick={() => setConfirmDelete('all')}
                  >
                    <Trash2 />
                    Удалить все ({emojis.length})
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-lg border">
                <div className="max-h-72 overflow-y-auto">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 border-b bg-muted">
                      <tr>
                        <th className="w-10 px-3 py-2 text-left">
                          <Checkbox
                            checked={allFilteredSelected}
                            onCheckedChange={(v) => toggleAllFiltered(v === true)}
                            disabled={deleting || filtered.length === 0}
                            aria-label="Выбрать все найденные"
                          />
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-medium text-muted-foreground">Имя</th>
                        <th className="hidden px-3 py-2 text-left text-xs font-medium text-muted-foreground sm:table-cell">
                          Алиасы
                        </th>
                        <th className="w-16 px-3 py-2 text-left text-xs font-medium text-muted-foreground">Формат</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filtered.map((emoji) => (
                        <tr
                          key={emoji._id}
                          className="border-b last:border-0 hover:bg-muted/40"
                        >
                          <td className="px-3 py-2">
                            <Checkbox
                              checked={selectedIds.has(emoji._id)}
                              onCheckedChange={(v) => toggleOne(emoji._id, v === true)}
                              disabled={deleting}
                              aria-label={`Выбрать ${emoji.name}`}
                            />
                          </td>
                          <td className="px-3 py-2 font-mono text-xs">:{emoji.name}:</td>
                          <td className="hidden px-3 py-2 text-xs text-muted-foreground sm:table-cell">
                            {emoji.aliases.length ? emoji.aliases.join(', ') : '—'}
                          </td>
                          <td className="px-3 py-2 text-xs uppercase text-muted-foreground">
                            {emoji.extension}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {filtered.length === 0 && (
                  <p className="p-4 text-center text-sm text-muted-foreground">По запросу «{search.trim()}» ничего не найдено</p>
                )}
              </div>
            </>
          )}

          {loaded && emojis.length === 0 && (
            <EmptyState
              icon={<ListChecks />}
              title="Кастомных эмодзи нет"
              description="В этом пространстве пока нет загруженных эмодзи. Их можно добавить через импорт выше."
            />
          )}

          {!loaded && !loading && !loadError && !credsMissing && (
            <p className="text-xs text-muted-foreground">
              Нажмите «Загрузить список», чтобы получить актуальные эмодзи из Rocket.Chat.
            </p>
          )}
        </div>
      </Section>

      <ConfirmDialog
        open={confirmDelete !== null}
        onOpenChange={(open) => {
          if (!open) {
            setConfirmDelete(null);
            setConfirmText('');
          }
        }}
        destructive
        title={confirmDelete === 'all' ? `Удалить все эмодзи (${emojis.length})?` : `Удалить выбранные эмодзи (${selectedIds.size})?`}
        confirmLabel={`Удалить${deleteCount ? ` (${deleteCount})` : ''}`}
        disabled={needsTypedConfirm && confirmText.trim().toLowerCase() !== 'удалить'}
        onConfirm={() => { if (confirmDelete) return runDelete(confirmDelete) }}
        description={
          confirmDelete === 'all'
            ? `Из Rocket.Chat будут удалены все ${emojis.length} кастомных эмодзи. Сообщения, где они использовались, потеряют картинки. Действие необратимо.`
            : `Из Rocket.Chat будут удалены выбранные эмодзи: ${selectedIds.size}. Действие необратимо.`
        }
      >
        {needsTypedConfirm && (
          <div className="space-y-1.5">
            <label htmlFor="emoji-delete-confirm" className="text-[13px] font-medium">
              Для подтверждения введите слово «удалить»
            </label>
            <Input
              id="emoji-delete-confirm"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              autoComplete="off"
              placeholder="удалить"
            />
          </div>
        )}
      </ConfirmDialog>
    </>
  );
}
