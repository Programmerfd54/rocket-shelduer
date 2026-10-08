'use client';

import { useState, useEffect, useCallback, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Breadcrumbs } from '@/components/common/Breadcrumbs';
import { PageContainer, PageHeader } from '@/components/common/PageHeader';
import { Section } from '@/components/common/Section';
import { EmptyState } from '@/components/common/EmptyState';
import { Activity, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { ROLE_LABELS } from '@/lib/roles';

type CheckItem = {
  name: string;
  status: 'ok' | 'error' | 'skip';
  message?: string;
  durationMs?: number;
  valueDisplay?: string;
};

type HealthData = {
  status: 'ok' | 'degraded';
  db: 'ok' | 'error';
  dbVersion?: string;
  latencyMs: number;
  nodeEnv: string;
  ports?: { application: string };
  checks: CheckItem[];
  timestamp: string;
};

const CHECK_LABELS: Record<CheckItem['status'], string> = {
  ok: 'Ок',
  error: 'Ошибка',
  skip: 'Пропущено',
};

function Stat({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1 p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="text-base font-semibold leading-tight">{children}</div>
      {hint && <p className="truncate text-xs text-muted-foreground" title={hint}>{hint}</p>}
    </div>
  );
}

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = useCallback(async (manual = false) => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health');
      if (!res.ok) {
        const msg =
          res.status === 403
            ? `Доступ только для ${ROLE_LABELS.LEAD_SUP}`
            : `Не удалось получить состояние (ошибка ${res.status}). Повторите позже.`;
        setError(msg);
        if (manual) toast.error(msg);
        return;
      }
      const json = await res.json();
      setData(json);
      if (manual) toast.success('Состояние обновлено');
    } catch {
      const msg = 'Не удалось получить состояние. Проверьте соединение и повторите.';
      setError(msg);
      if (manual) toast.error(msg);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchHealth();
    const t = setInterval(() => fetchHealth(), 60 * 1000);
    return () => clearInterval(t);
  }, [fetchHealth]);

  const overallOk = data?.status === 'ok';

  return (
    <PageContainer>
      <PageHeader
        breadcrumbs={
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Состояние', current: true },
            ]}
          />
        }
        title="Состояние системы"
        description="Приложение, база данных и переменные окружения. Обновляется при открытии и каждые 60 секунд."
        actions={
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchHealth(true)}
            disabled={loading}
            aria-label="Обновить состояние"
          >
            <RefreshCw className={`size-4 ${loading ? 'animate-spin' : ''}`} />
            Обновить
          </Button>
        }
      />

      {error && !data && (
        <EmptyState
          icon={<Activity />}
          title="Состояние недоступно"
          description={error}
          action={{ label: 'Повторить', onClick: () => fetchHealth(true) }}
        />
      )}

      {error && data && (
        <p role="alert" className="mb-4 rounded-md border border-destructive/30 px-3 py-2 text-sm text-destructive">
          {error}
        </p>
      )}

      {loading && !data && !error && (
        <div className="space-y-6" role="status" aria-busy="true" aria-label="Загрузка">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-5">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="space-y-2 bg-card p-4">
                <Skeleton className="h-3 w-16" />
                <Skeleton className="h-5 w-20" />
                <Skeleton className="h-3 w-24" />
              </div>
            ))}
          </div>
          <div className="divide-y rounded-lg border bg-card">
            {Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3 px-4 py-3">
                <Skeleton className="h-4 w-44" />
                <Skeleton className="h-5 w-14" />
              </div>
            ))}
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border bg-border lg:grid-cols-5 [&>div]:bg-card">
            <Stat label="Общий статус">
              <Badge variant={overallOk ? 'success' : 'warning'}>
                {overallOk ? 'Работает' : 'Есть проблемы'}
              </Badge>
            </Stat>
            <Stat label="База данных" hint={data.dbVersion ?? 'PostgreSQL'}>
              <Badge variant={data.db === 'ok' ? 'success' : 'danger'}>
                {data.db === 'ok' ? 'Доступна' : 'Ошибка'}
              </Badge>
            </Stat>
            <Stat label="Порт приложения">
              <span className="font-mono">{data.ports?.application ?? '—'}</span>
            </Stat>
            <Stat label="Задержка ответа">
              <span className="tabular-nums">{data.latencyMs} мс</span>
            </Stat>
            <Stat label="Окружение" hint="NODE_ENV">
              <span className="font-mono">{data.nodeEnv}</span>
            </Stat>
          </div>

          <Section
            bare
            title="Проверки"
            description="Состояние каждого пункта. Секреты отображаются в маскированном виде."
          >
            {data.checks.length === 0 ? (
              <EmptyState icon={<Activity />} title="Проверок нет" description="Сервер не вернул ни одной проверки." />
            ) : (
              <div className="overflow-hidden rounded-lg border bg-card">
                <ul className="divide-y">
                  {data.checks.map((c) => {
                    const detail = c.valueDisplay && c.valueDisplay !== '—' ? c.valueDisplay : c.message;
                    return (
                      <li
                        key={c.name}
                        className="flex flex-col gap-1 px-4 py-2.5 hover:bg-muted/40 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
                      >
                        <span className="break-all font-mono text-sm">{c.name}</span>
                        <div className="flex min-w-0 items-center gap-2 sm:justify-end">
                          {detail && (
                            <span
                              className="min-w-0 max-w-[16rem] truncate font-mono text-xs text-muted-foreground"
                              title={detail}
                            >
                              {detail}
                            </span>
                          )}
                          {c.durationMs != null && (
                            <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                              {c.durationMs} мс
                            </span>
                          )}
                          <Badge
                            variant={c.status === 'ok' ? 'success' : c.status === 'error' ? 'danger' : 'muted'}
                          >
                            {CHECK_LABELS[c.status] ?? c.status}
                          </Badge>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
            <p className="mt-3 text-xs text-muted-foreground">
              Обновлено: {new Date(data.timestamp).toLocaleString('ru-RU')}
            </p>
          </Section>
        </div>
      )}
    </PageContainer>
  );
}
