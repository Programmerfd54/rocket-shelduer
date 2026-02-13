'use client';

import { useState, useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Breadcrumbs } from '@/components/common/Breadcrumbs';
import { EmptyState } from '@/components/common/EmptyState';
import { ListSkeletonCard } from '@/components/common/ListSkeleton';
import { LayoutDashboard, Calendar, MessageSquare, RefreshCw } from 'lucide-react';
import { formatDate, formatLocalDate, messageStatusBadgeClasses } from '@/lib/utils';
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

  const loadWorkspaces = async () => {
    const res = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`);
    if (res.ok) {
      const data = await res.json();
      setWorkspaces(data.workspaces || []);
    }
  };

  const loadMessages = async () => {
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
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadWorkspaces();
  }, []);

  useEffect(() => {
    loadMessages();
  }, [workspaceId, status, sort]);

  return (
    <div className="container max-w-4xl py-6 px-4">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Сообщения', current: true },
        ]}
        className="mb-6"
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Запланированные сообщения</h1>
          <p className="text-muted-foreground text-sm mt-1">
            Единый список по всем пространствам. Фильтруйте по пространству и статусу.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/dashboard">
              <LayoutDashboard className="h-4 w-4" />
              Дашборд
            </Link>
          </Button>
          <Button asChild variant="outline" size="sm" className="gap-2">
            <Link href="/dashboard/calendar">
              <Calendar className="h-4 w-4" />
              Календарь
            </Link>
          </Button>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="outline" size="sm" onClick={() => loadMessages()} disabled={loading}>
                <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Обновить список</TooltipContent>
          </Tooltip>
        </div>
      </div>

      <div className="flex flex-wrap gap-3 mb-6">
        <Select value={workspaceId || 'all'} onValueChange={(v) => setWorkspaceId(v === 'all' ? '' : v)}>
          <SelectTrigger className="w-[200px]">
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
          <SelectTrigger className="w-[160px]">
            <SelectValue placeholder="Статус" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Все статусы</SelectItem>
            <SelectItem value="PENDING">Ожидает</SelectItem>
            <SelectItem value="SENT">Отправлено</SelectItem>
            <SelectItem value="FAILED">Ошибка</SelectItem>
            <SelectItem value="CANCELLED">Отменено</SelectItem>
          </SelectContent>
        </Select>
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="w-[160px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="asc">По дате отправки (сначала ближайшие)</SelectItem>
            <SelectItem value="desc">По дате (сначала поздние)</SelectItem>
            <SelectItem value="recent">По дате создания (сначала новые)</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {loading ? (
        <ListSkeletonCard lines={6} />
      ) : messages.length === 0 ? (
        <EmptyState
          icon={<MessageSquare className="h-8 w-8" />}
          title="Нет сообщений"
          description={
            workspaceId || status
              ? 'Попробуйте изменить фильтры или запланируйте сообщение в календаре.'
              : 'Запланируйте первое сообщение в разделе «Календарь» или с дашборда.'
          }
          action={{ label: 'Перейти в календарь', href: '/dashboard/calendar' }}
        />
      ) : (
        <div className="space-y-3">
          {messages.map((m) => (
            <Card key={m.id} className="overflow-hidden">
              <CardContent className="p-4 flex flex-col sm:flex-row sm:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2 mb-1">
                    {m.workspace && (
                      <Link
                        href={`/dashboard/workspaces/${m.workspace.id}`}
                        className="text-sm font-medium text-primary hover:underline"
                      >
                        {m.workspace.workspaceName}
                      </Link>
                    )}
                    <span className="text-muted-foreground">·</span>
                    <span className="text-sm text-muted-foreground">#{m.channelName}</span>
                    <Badge className={messageStatusBadgeClasses[m.status] || ''}>{m.status}</Badge>
                  </div>
                  <p className="text-sm text-foreground line-clamp-2">{m.message}</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    {formatDate(m.scheduledFor)}
                    {m.user && ` · ${m.user.name || m.user.email}`}
                  </p>
                </div>
                {m.workspace && (
                  <Button asChild variant="outline" size="sm" className="shrink-0">
                    <Link href={`/dashboard/workspaces/${m.workspace.id}#messages`}>
                      К пространству
                    </Link>
                  </Button>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
