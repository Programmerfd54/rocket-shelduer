'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { MessageStatusBadge } from '@/components/common/MessageStatusBadge';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Breadcrumbs } from '@/components/common/Breadcrumbs';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/common/PageHeader';
import { CalendarDays, MessageSquare, RefreshCw, RotateCcw } from 'lucide-react';
import { cn, formatDate, formatLocalDate } from '@/lib/utils';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

type Message = {
  id: string;
  message: string;
  scheduledFor: string;
  status: string;
  channelName: string;
  workspace?: { id: string; workspaceName: string };
  user?: { name: string | null; email: string };
};

export default function MessagesPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [workspaces, setWorkspaces] = useState<{ id: string; workspaceName: string }[]>([]);
  const [loading, setLoading] = useState(true);
  const [workspaceId, setWorkspaceId] = useState<string>('');
  const [status, setStatus] = useState<string>('');
  const [sort, setSort] = useState<string>('asc');

  const hasFilters = Boolean(workspaceId || status);

  const loadWorkspaces = async () => {
    try {
      const res = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`);
      if (res.ok) {
        const data = await res.json();
        setWorkspaces(data.workspaces || []);
      }
    } catch {
      toast.error('Не удалось загрузить список пространств.');
    }
  };

  const loadMessages = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (workspaceId) params.set('workspaceId', workspaceId);
      if (status) params.set('status', status);
      params.set('sort', sort);
      const res = await fetch(`/api/messages?${params.toString()}`);
      if (res.ok) {
        const data = await res.json();
        setMessages(data.messages || []);
      } else {
        toast.error('Не удалось загрузить сообщения. Попробуйте обновить список.');
      }
    } catch {
      toast.error('Ошибка сети: не удалось загрузить сообщения. Проверьте соединение и обновите список.');
    } finally {
      setLoading(false);
    }
  }, [workspaceId, status, sort]);

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    loadMessages();
  }, [loadMessages]);

  const resetFilters = () => {
    setWorkspaceId('');
    setStatus('');
  };

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Сообщения', current: true },
            ]}
          />
        }
        title="Запланированные сообщения"
        description="Единый список по всем пространствам. Фильтруйте по пространству и статусу."
        actions={
          <>
            <Button asChild variant="outline" size="sm">
              <Link href="/dashboard/calendar">
                <CalendarDays /> Календарь
              </Link>
            </Button>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="outline"
                  size="icon-sm"
                  onClick={() => loadMessages()}
                  disabled={loading}
                  aria-label="Обновить список"
                >
                  <RefreshCw className={cn(loading && 'animate-spin')} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Обновить список</TooltipContent>
            </Tooltip>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Select value={workspaceId || 'all'} onValueChange={(v) => setWorkspaceId(v === 'all' ? '' : v)}>
          <SelectTrigger size="sm" className="w-[190px]" aria-label="Пространство">
            <SelectValue placeholder="Все пространства" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все пространства</SelectItem>
            {workspaces.map((w) => (
              <SelectItem key={w.id} value={w.id}>
                {w.workspaceName}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={status || 'all'} onValueChange={(v) => setStatus(v === 'all' ? '' : v)}>
          <SelectTrigger size="sm" className="w-[150px]" aria-label="Статус">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="PENDING">Ожидают отправки</SelectItem>
            <SelectItem value="SENT">Отправлено</SelectItem>
            <SelectItem value="FAILED">Не отправлено</SelectItem>
            <SelectItem value="CANCELLED">Отменено</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger size="sm" className="w-[210px]" aria-label="Сортировка">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">Сначала ближайшие</SelectItem>
            <SelectItem value="desc">Сначала поздние</SelectItem>
            <SelectItem value="recent">Сначала недавно созданные</SelectItem>
          </SelectContent>
        </Select>
        {hasFilters && (
          <Button variant="ghost" size="sm" className="text-muted-foreground" onClick={resetFilters}>
            <RotateCcw /> Сбросить
          </Button>
        )}
        {!loading && messages.length > 0 && (
          <span className="ml-auto text-[13px] text-muted-foreground tabular-nums">Найдено: {messages.length}</span>
        )}
      </div>

      {loading ? (
        <div className="divide-y rounded-lg border bg-card" role="status" aria-busy="true" aria-label="Загрузка сообщений">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="space-y-2 px-4 py-3">
              <div className="flex items-center gap-2">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="h-4 w-20" />
                <Skeleton className="ml-auto h-5 w-20" />
              </div>
              <Skeleton className="h-3.5 w-3/4" />
              <Skeleton className="h-3 w-40" />
            </div>
          ))}
        </div>
      ) : messages.length === 0 ? (
        <EmptyState
          icon={<MessageSquare />}
          title={hasFilters ? 'Ничего не найдено' : 'Нет сообщений'}
          description={
            hasFilters
              ? 'Измените или сбросьте фильтры, чтобы увидеть больше сообщений.'
              : 'Запланируйте первое сообщение в календаре или на странице пространства.'
          }
        >
          <div className="mt-4 flex flex-wrap justify-center gap-2">
            {hasFilters && (
              <Button variant="outline" size="sm" onClick={resetFilters}>
                Сбросить фильтры
              </Button>
            )}
            <Button asChild variant={hasFilters ? 'ghost' : 'outline'} size="sm">
              <Link href="/dashboard/calendar">Перейти в календарь</Link>
            </Button>
          </div>
        </EmptyState>
      ) : (
        <ul className="divide-y rounded-lg border bg-card">
          {messages.map((m) => {
            return (
              <li
                key={m.id}
                className="flex flex-col gap-2 px-4 py-3 transition-colors hover:bg-muted/40 sm:flex-row sm:items-center sm:gap-4"
              >
                <div className="min-w-0 flex-1 space-y-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                    {m.workspace && (
                      <Link
                        href={`/dashboard/workspaces/${m.workspace.id}`}
                        className="font-medium text-foreground hover:underline"
                      >
                        {m.workspace.workspaceName}
                      </Link>
                    )}
                    <span className="text-muted-foreground">#{m.channelName}</span>
                    <MessageStatusBadge status={m.status} scheduledFor={m.scheduledFor} />
                  </div>
                  <p className="line-clamp-2 text-sm text-foreground/90">{m.message}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(m.scheduledFor)}
                    {m.user && ` · ${m.user.name || m.user.email}`}
                  </p>
                </div>
                {m.workspace && (
                  <Button asChild variant="outline" size="sm" className="shrink-0 self-start sm:self-center">
                    <Link href={`/dashboard/workspaces/${m.workspace.id}#messages`}>К пространству</Link>
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </PageContainer>
  );
}
