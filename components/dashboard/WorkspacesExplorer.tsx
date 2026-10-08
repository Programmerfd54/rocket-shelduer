'use client';

import { useState, useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Server, Archive, RefreshCw, LayoutGrid, List, Shield, Clock, Search, X, SearchX } from 'lucide-react';
import { toast } from 'sonner';
import { cn, formatLocalDate } from '@/lib/utils';
import {
  isIntensiveArchiveToastDismissed,
  setIntensiveArchiveToastDismissed,
} from '@/lib/intensive-archive-toast';
import { canSeeAdminPanel, isWorkspaceStaffRole } from '@/lib/roles';
import { WorkspaceDialog } from '@/components/_components/workspace-dialog';
import WorkspaceForm, { type Workspace } from '@/components/_components/WorkspaceForm';
import { WorkspaceEditDialog } from '@/components/common/WorkspaceEditDialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumbs } from '@/components/common/Breadcrumbs';
import { PageContainer, PageHeader } from '@/components/common/PageHeader';
import { EmptyState } from '@/components/common/EmptyState';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';

const FAVORITES_KEY = 'workspaces_favorites';

type SortKey = 'name' | 'createdAt' | 'endDate' | 'lastConnected';
type QuickFilter = 'all' | 'favorites' | 'expiring' | 'ended';

const DAY_MS = 1000 * 60 * 60 * 24;

function isEnded(w: Workspace) {
  return !!w.endDate && new Date(w.endDate).getTime() < Date.now();
}

function isExpiringSoon(w: Workspace) {
  if (!w.endDate) return false;
  const days = Math.ceil((new Date(w.endDate).getTime() - Date.now()) / DAY_MS);
  return days > 0 && days <= 7;
}

export function WorkspacesExplorer({ embedded = false }: { embedded?: boolean }) {
  const router = useRouter();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [groups, setGroups] = useState<
    Array<{ id: string; name: string; workspaces: { workspaceId: string }[] }>
  >([]);
  const [loading, setLoading] = useState(true);
  const [userRole, setUserRole] = useState<string>('MEMBER');
  const [userRestrictedFeatures, setUserRestrictedFeatures] = useState<string[]>([]);
  const [userBlocked, setUserBlocked] = useState(false);
  const [userVolunteerExpiresAt, setUserVolunteerExpiresAt] = useState<string | null>(null);
  const [userVolunteerIntensive, setUserVolunteerIntensive] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortBy, setSortBy] = useState<SortKey>('createdAt');
  const [viewMode, setViewMode] = useState<'grid' | 'compact'>('compact');
  const [quickFilter, setQuickFilter] = useState<QuickFilter>('all');
  const [groupFilter, setGroupFilter] = useState<string>('all');
  const [settingsWorkspace, setSettingsWorkspace] = useState<Workspace | null>(null);

  const [favoriteIds, setFavoriteIds] = useState<Set<string>>(() => {
    if (typeof window === 'undefined') return new Set();
    try {
      const raw = localStorage.getItem(FAVORITES_KEY);
      if (!raw) return new Set();
      const arr = JSON.parse(raw) as string[];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  });

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => r.json())
      .then((d) => {
        const u = d?.user;
        setUserRole(u?.role ?? 'MEMBER');
        setUserRestrictedFeatures(Array.isArray(u?.restrictedFeatures) ? u.restrictedFeatures : []);
        setUserBlocked(!!u?.blocked);
        setUserVolunteerExpiresAt(u?.volunteerExpiresAt ?? null);
        setUserVolunteerIntensive(u?.volunteerIntensive ?? null);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (isIntensiveArchiveToastDismissed()) return;
    const ended = workspaces.filter(
      (ws) => ws.endDate && new Date(ws.endDate) < new Date() && !ws.isArchived,
    );
    if (ended.length > 0) {
      const id = toast.warning('Завершенные интенсивы', {
        description: `${ended.length} ${ended.length === 1 ? 'интенсив завершен' : 'интенсива завершены'}. Рекомендуется заархивировать их.`,
        duration: 10000,
        action: {
          label: 'Перейти в архивы',
          onClick: () => router.push('/dashboard/workspaces/archived'),
        },
        cancel: {
          label: 'Больше не уведомлять',
          onClick: () => {
            setIntensiveArchiveToastDismissed();
            toast.dismiss(id);
          },
        },
      });
    }
  }, [workspaces, router]);

  const isVolunteerMember = userRole === 'MEMBER' && !!userVolunteerExpiresAt;

  const handleWorkspaceSettings = (ws: Workspace) => {
    if (isVolunteerMember) return;
    if (ws.isAssigned) {
      router.push(`/dashboard/workspaces/${ws.id}`);
      return;
    }
    setSettingsWorkspace(ws);
  };

  const loadWorkspaces = async () => {
    try {
      setLoading(true);
      const response = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`);
      if (response.ok) {
        const data = await response.json();
        setWorkspaces(data.workspaces || []);
        setGroups(data.groups || []);
      } else {
        toast.error('Не удалось загрузить пространства', {
          description: 'Обновите страницу или попробуйте позже.',
        });
      }
    } catch (error) {
      console.error('Failed to load workspaces:', error);
      toast.error('Не удалось загрузить пространства', {
        description: 'Проверьте подключение к сети и обновите страницу.',
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadWorkspaces();
  }, []);

  const groupNamesByWorkspaceId = useMemo(() => {
    const map: Record<string, string> = {};
    for (const g of groups) {
      for (const w of g.workspaces || []) {
        map[w.workspaceId] = g.name;
      }
    }
    return map;
  }, [groups]);

  const filteredAndSorted = useMemo(() => {
    let list = workspaces;
    if (quickFilter === 'favorites') list = list.filter((w) => favoriteIds.has(w.id));
    else if (quickFilter === 'expiring') list = list.filter(isExpiringSoon);
    else if (quickFilter === 'ended') list = list.filter(isEnded);
    if (groupFilter !== 'all') list = list.filter((w) => groupNamesByWorkspaceId[w.id] === groupFilter);
    const q = searchQuery.trim().toLowerCase();
    if (q) {
      list = list.filter(
        (w) =>
          w.workspaceName?.toLowerCase().includes(q) ||
          w.workspaceUrl?.toLowerCase().includes(q) ||
          w.username?.toLowerCase().includes(q),
      );
    }
    list = [...list].sort((a, b) => {
      if (sortBy === 'name') return (a.workspaceName || '').localeCompare(b.workspaceName || '');
      if (sortBy === 'createdAt') return new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime();
      if (sortBy === 'endDate') {
        const aEnd = a.endDate ? new Date(a.endDate).getTime() : 0;
        const bEnd = b.endDate ? new Date(b.endDate).getTime() : 0;
        return aEnd - bEnd;
      }
      if (sortBy === 'lastConnected') {
        const aLast = a.lastConnected ? new Date(a.lastConnected).getTime() : 0;
        const bLast = b.lastConnected ? new Date(b.lastConnected).getTime() : 0;
        return bLast - aLast;
      }
      return 0;
    });
    const fav = list.filter((w) => favoriteIds.has(w.id));
    const rest = list.filter((w) => !favoriteIds.has(w.id));
    return [...fav, ...rest];
  }, [workspaces, searchQuery, sortBy, favoriteIds, quickFilter, groupFilter, groupNamesByWorkspaceId]);

  const handleOpenWorkspace = (workspace: Workspace) => {
    router.push(`/dashboard/workspaces/${workspace.id}`);
  };

  const handleTestConnection = async (workspaceId: string) => {
    toast.loading('Проверка подключения к Rocket.Chat...', { id: 'test-connection' });
    try {
      const response = await fetch(`/api/workspace/${workspaceId}/channels`);
      if (response.ok) {
        toast.success('Подключение работает', { id: 'test-connection' });
        loadWorkspaces();
      } else {
        const errorData = await response.json().catch(() => ({}));
        toast.error(errorData.error || 'Не удалось подключиться к Rocket.Chat', {
          id: 'test-connection',
          action: {
            label: 'Повторить',
            onClick: () => handleTestConnection(workspaceId),
          },
        });
      }
    } catch {
      toast.error('Ошибка проверки подключения', {
        id: 'test-connection',
        description: 'Проверьте сеть и повторите попытку.',
        action: {
          label: 'Повторить',
          onClick: () => handleTestConnection(workspaceId),
        },
      });
    }
  };

  const handleArchive = async (workspaceId: string) => {
    const res = await fetch(`/api/workspace/${workspaceId}/archive`, { method: 'POST' });
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || 'Ошибка архивации');
    }
    await loadWorkspaces();
  };

  const toggleFavorite = (workspaceId: string) => {
    setFavoriteIds((prev) => {
      const next = new Set(prev);
      if (next.has(workspaceId)) next.delete(workspaceId);
      else next.add(workspaceId);
      try {
        localStorage.setItem(FAVORITES_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  };

  const isFavorite = (workspaceId: string) => favoriteIds.has(workspaceId);

  const volExpiryInfo = useMemo(() => {
    if (userRole !== 'MEMBER' || !userVolunteerExpiresAt || userBlocked) return null;
    const expiresAt = new Date(userVolunteerExpiresAt);
    if (expiresAt <= new Date()) return null;
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
    return { daysLeft, expiresAt };
  }, [userRole, userVolunteerExpiresAt, userBlocked]);

  const counts = useMemo(
    () => ({
      all: workspaces.length,
      favorites: workspaces.filter((w) => favoriteIds.has(w.id)).length,
      expiring: workspaces.filter(isExpiringSoon).length,
      ended: workspaces.filter(isEnded).length,
    }),
    [workspaces, favoriteIds],
  );

  const groupNames = useMemo(
    () => [...new Set(Object.values(groupNamesByWorkspaceId))].sort((a, b) => a.localeCompare(b)),
    [groupNamesByWorkspaceId],
  );

  const addWorkspaceDisabled = isVolunteerMember || (userBlocked && workspaces.length >= 1);
  const addWorkspaceDisabledReason = isVolunteerMember
    ? 'Волонтёр не может добавлять пространства — их назначает SUP или Lead_SUP.'
    : addWorkspaceDisabled
      ? 'Заблокированный пользователь может подключить только одно пространство.'
      : undefined;

  const hasActiveFilters = searchQuery.trim() !== '' || quickFilter !== 'all' || groupFilter !== 'all';
  const resetFilters = () => {
    setSearchQuery('');
    setQuickFilter('all');
    setGroupFilter('all');
  };

  const chips: Array<{ key: QuickFilter; label: string; count: number; hidden?: boolean }> = [
    { key: 'all', label: 'Все', count: counts.all },
    { key: 'favorites', label: 'Избранные', count: counts.favorites, hidden: counts.favorites === 0 && quickFilter !== 'favorites' },
    { key: 'expiring', label: 'Скоро истекут', count: counts.expiring, hidden: counts.expiring === 0 && quickFilter !== 'expiring' },
    { key: 'ended', label: 'Завершённые', count: counts.ended, hidden: counts.ended === 0 && quickFilter !== 'ended' },
  ];

  const headerActions = (
    <>
      <Button variant="outline" size="sm" onClick={loadWorkspaces} disabled={loading}>
        <RefreshCw className={loading ? 'animate-spin' : ''} aria-hidden />
        Обновить
      </Button>
      {!isVolunteerMember ? (
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/workspaces/archived">
            <Archive aria-hidden />
            Архивы
          </Link>
        </Button>
      ) : (
        <Button variant="outline" size="sm" disabled title="Архивы недоступны для волонтёров">
          <Archive aria-hidden />
          Архивы
        </Button>
      )}
      {canSeeAdminPanel(userRole, userRestrictedFeatures) && (
        <Button variant="outline" size="sm" asChild>
          <Link href="/dashboard/admin">
            <Shield aria-hidden />
            Админка
          </Link>
        </Button>
      )}
      <WorkspaceDialog
        onSuccess={loadWorkspaces}
        userRole={userRole}
        disableAddButton={addWorkspaceDisabled}
        disabledReason={addWorkspaceDisabledReason}
      />
    </>
  );

  const content = (
    <>
      <PageHeader
        breadcrumbs={
          !embedded ? (
            <Breadcrumbs
              items={[
                { label: 'Дашборд', href: '/dashboard' },
                { label: 'Пространства', current: true },
              ]}
            />
          ) : undefined
        }
        title="Пространства"
        description="Подключённые пространства Rocket.Chat: ваши и назначенные вам."
        actions={headerActions}
      />

      <div className="space-y-4">
        {volExpiryInfo && (
          <Alert>
            <Clock aria-hidden />
            <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <span className="font-medium text-foreground">Доступ волонтёра:</span> активен до{' '}
                {volExpiryInfo.expiresAt.toLocaleDateString('ru-RU')}
                {volExpiryInfo.daysLeft <= 7 && (
                  <span className="font-medium text-amber-700 dark:text-amber-300">
                    {' '}
                    (осталось {volExpiryInfo.daysLeft} {volExpiryInfo.daysLeft === 1 ? 'день' : 'дней'})
                  </span>
                )}
              </div>
              {isVolunteerMember && workspaces.length > 0 && <Badge variant="outline">Активных: 1/1</Badge>}
            </AlertDescription>
          </Alert>
        )}

        {/* Панель инструментов: поиск, фильтры-чипы, сортировка, вид */}
        {workspaces.length > 0 && (
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
              <div className="relative flex-1 sm:max-w-sm">
                <Search
                  className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                  aria-hidden
                />
                <Input
                  placeholder="Поиск по названию, адресу, логину"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="h-8 pl-8 pr-8 text-[13px]"
                  aria-label="Поиск пространств"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    className="absolute right-1.5 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-sm text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
                    aria-label="Очистить поиск"
                  >
                    <X className="size-3.5" aria-hidden />
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2 sm:ml-auto">
                {groupNames.length > 0 && (
                  <Select value={groupFilter} onValueChange={setGroupFilter}>
                    <SelectTrigger size="sm" className="w-[160px]" aria-label="Фильтр по группе">
                      <SelectValue placeholder="Группа" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Все группы</SelectItem>
                      {groupNames.map((g) => (
                        <SelectItem key={g} value={g}>
                          {g}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <Select value={sortBy} onValueChange={(v) => setSortBy(v as SortKey)}>
                  <SelectTrigger size="sm" className="w-[210px]" aria-label="Сортировка">
                    <SelectValue placeholder="Сортировка" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="name">По названию</SelectItem>
                    <SelectItem value="createdAt">По дате добавления</SelectItem>
                    <SelectItem value="endDate">По дате окончания</SelectItem>
                    <SelectItem value="lastConnected">По последнему подключению</SelectItem>
                  </SelectContent>
                </Select>
                <div className="flex gap-0.5 rounded-md border p-0.5" role="group" aria-label="Вид списка">
                  <Button
                    variant={viewMode === 'compact' ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    className="size-7"
                    onClick={() => setViewMode('compact')}
                    title="Список"
                    aria-label="Список"
                    aria-pressed={viewMode === 'compact'}
                  >
                    <List aria-hidden />
                  </Button>
                  <Button
                    variant={viewMode === 'grid' ? 'secondary' : 'ghost'}
                    size="icon-xs"
                    className="size-7"
                    onClick={() => setViewMode('grid')}
                    title="Карточки"
                    aria-label="Карточки"
                    aria-pressed={viewMode === 'grid'}
                  >
                    <LayoutGrid aria-hidden />
                  </Button>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Быстрые фильтры">
              {chips
                .filter((c) => !c.hidden)
                .map((c) => {
                  const active = quickFilter === c.key;
                  return (
                    <button
                      key={c.key}
                      type="button"
                      onClick={() => setQuickFilter(c.key)}
                      aria-pressed={active}
                      className={cn(
                        'inline-flex h-7 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40',
                        active
                          ? 'border-foreground/20 bg-accent text-foreground'
                          : 'border-transparent text-muted-foreground hover:bg-accent/60 hover:text-foreground',
                      )}
                    >
                      {c.label}
                      <span className="tabular-nums text-muted-foreground">{c.count}</span>
                    </button>
                  );
                })}
              {hasActiveFilters && (
                <>
                  <span className="mx-1 text-xs text-muted-foreground" aria-live="polite">
                    Найдено: {filteredAndSorted.length} из {workspaces.length}
                  </span>
                  <Button variant="ghost" size="xs" onClick={resetFilters}>
                    Сбросить
                  </Button>
                </>
              )}
            </div>
          </div>
        )}

        {loading && workspaces.length === 0 ? (
          <div
            className="divide-y overflow-hidden rounded-lg border bg-card"
            role="status"
            aria-busy="true"
            aria-label="Загрузка пространств"
          >
            {[1, 2, 3, 4, 5, 6].map((i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <Skeleton className="size-4 shrink-0" />
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-1/3 max-w-[220px]" />
                  <Skeleton className="h-3 w-1/2 max-w-[320px]" />
                </div>
                <Skeleton className="hidden h-3 w-24 md:block" />
                <Skeleton className="h-8 w-20 shrink-0" />
              </div>
            ))}
          </div>
        ) : (
          <WorkspaceForm
            workspaces={filteredAndSorted}
            onOpenWorkspace={handleOpenWorkspace}
            onTestConnection={handleTestConnection}
            onArchive={isWorkspaceStaffRole(userRole) ? handleArchive : undefined}
            loading={false}
            userRole={userRole}
            volunteerExpiresAt={userVolunteerExpiresAt}
            volunteerIntensive={userVolunteerIntensive}
            viewMode={viewMode}
            groupNamesByWorkspaceId={groupNamesByWorkspaceId}
            isFavorite={isFavorite}
            onToggleFavorite={toggleFavorite}
            onWorkspaceSettings={!isVolunteerMember ? handleWorkspaceSettings : undefined}
          />
        )}

        {!loading && workspaces.length > 0 && filteredAndSorted.length === 0 && (
          <EmptyState
            icon={<SearchX />}
            title="Ничего не найдено"
            description={
              searchQuery.trim()
                ? `По запросу «${searchQuery.trim()}» с выбранными фильтрами пространств нет.`
                : 'Под выбранные фильтры не подходит ни одно пространство.'
            }
            action={{ label: 'Сбросить поиск и фильтры', onClick: resetFilters }}
          />
        )}

        {!loading && workspaces.length === 0 && (
          <EmptyState
            icon={<Server />}
            title="Пока нет пространств"
            description={
              isVolunteerMember
                ? 'Пространство появится здесь, когда SUP или Lead_SUP назначит вас.'
                : 'Подключите первое пространство Rocket.Chat, чтобы планировать отложенные сообщения. Понадобятся адрес сервера и данные для входа.'
            }
          >
            {!addWorkspaceDisabled && (
              <div className="mt-4 flex justify-center">
                <WorkspaceDialog onSuccess={loadWorkspaces} userRole={userRole} triggerLabel="Подключить пространство" />
              </div>
            )}
          </EmptyState>
        )}
      </div>

      {settingsWorkspace && (
        <WorkspaceEditDialog
          key={settingsWorkspace.id}
          workspace={settingsWorkspace}
          open={true}
          onOpenChange={(o) => {
            if (!o) setSettingsWorkspace(null);
          }}
          onSuccess={() => {
            setSettingsWorkspace(null);
            loadWorkspaces();
          }}
        />
      )}
    </>
  );

  if (embedded) return <div>{content}</div>;
  return <PageContainer size="wide">{content}</PageContainer>;
}
