'use client';

import { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Breadcrumbs } from '@/components/common/Breadcrumbs';
import { Activity, Database, RefreshCw, CheckCircle, XCircle, AlertCircle, Network } from 'lucide-react';

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

export default function AdminHealthPage() {
  const [data, setData] = useState<HealthData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchHealth = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/admin/health');
      if (!res.ok) {
        if (res.status === 403) {
          setError('Доступ только для ADMIN');
          return;
        }
        setError(`Ошибка ${res.status}`);
        return;
      }
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Ошибка запроса');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHealth();
    const t = setInterval(fetchHealth, 60 * 1000);
    return () => clearInterval(t);
  }, []);

  const statusIcon = data?.status === 'ok' ? CheckCircle : data?.status === 'degraded' ? AlertCircle : XCircle;
  const StatusIcon = statusIcon;

  return (
    <div className="space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Админ', href: '/dashboard/admin' },
          { label: 'Health-check', href: '/dashboard/admin/health' },
        ]}
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold flex items-center gap-2">
            <Activity className="h-7 w-7" />
            Health-check
          </h1>
          <p className="text-muted-foreground mt-1">
            Состояние приложения и БД. Обновляется при загрузке и каждые 60 с.
          </p>
        </div>
        <Button variant="outline" onClick={fetchHealth} disabled={loading}>
          <RefreshCw className={`h-4 w-4 mr-2 ${loading ? 'animate-spin' : ''}`} />
          Обновить
        </Button>
      </div>

      {error && (
        <Card className="border-destructive">
          <CardContent className="pt-6">
            <p className="text-destructive">{error}</p>
          </CardContent>
        </Card>
      )}

      {loading && !data && !error && (
        <Card>
          <CardContent className="pt-6">
            <p className="text-muted-foreground">Загрузка...</p>
          </CardContent>
        </Card>
      )}

      {data && (
        <>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Card
              className={
                data.status === 'ok'
                  ? 'border-green-500/50 dark:border-green-600/50'
                  : data.status === 'degraded'
                    ? 'border-amber-500/50 dark:border-amber-600/50'
                    : 'border-destructive/50'
              }
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <StatusIcon
                    className={
                      data.status === 'ok' ? 'text-green-600' : data.status === 'degraded' ? 'text-amber-600' : 'text-destructive'
                    }
                  />
                  Общий статус
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold capitalize">{data.status}</p>
                <p className="text-xs text-muted-foreground">status</p>
              </CardContent>
            </Card>
            <Card
              className={data.db === 'ok' ? 'border-green-500/50 dark:border-green-600/50' : 'border-destructive/50'}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Database className="h-4 w-4" />
                  База данных
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold capitalize">{data.db}</p>
                <p className="text-xs text-muted-foreground">{data.dbVersion ?? 'PostgreSQL'}</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <Network className="h-4 w-4" />
                  Порты
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{data.ports?.application ?? '—'}</p>
                <p className="text-xs text-muted-foreground">приложение</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Задержка</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{data.latencyMs} ms</p>
                <p className="text-xs text-muted-foreground">время ответа</p>
              </CardContent>
            </Card>
            <Card className="border-border">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-medium">Окружение</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-2xl font-bold">{data.nodeEnv}</p>
                <p className="text-xs text-muted-foreground">NODE_ENV</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Проверки</CardTitle>
              <CardDescription>
                Детали по каждому пункту. Реальное состояние переменных (секреты отображаются замаскированно).
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {data.checks.map((c) => (
                  <li
                    key={c.name}
                    className={`flex flex-wrap items-center justify-between gap-2 py-2 border-b border-border/60 last:border-0 ${
                      c.status === 'ok' ? 'border-l-4 border-l-green-500/70 pl-2' : ''
                    } ${c.status === 'error' ? 'border-l-4 border-l-destructive pl-2' : ''} ${c.status === 'skip' ? 'border-l-4 border-l-muted pl-2' : ''}`}
                  >
                    <span className="font-mono text-sm">{c.name}</span>
                    <div className="flex items-center gap-2 flex-wrap">
                      {c.durationMs != null && (
                        <span className="text-xs text-muted-foreground">{c.durationMs} ms</span>
                      )}
                      <Badge
                        variant={c.status === 'ok' ? 'default' : c.status === 'error' ? 'destructive' : 'secondary'}
                      >
                        {c.status}
                      </Badge>
                      {(c.valueDisplay != null || c.message) && (
                        <span className="text-xs text-muted-foreground font-mono max-w-full truncate" title={c.valueDisplay !== '—' ? c.valueDisplay : c.message}>
                          {c.valueDisplay !== '—' && c.valueDisplay ? c.valueDisplay : c.message}
                        </span>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted-foreground mt-4">Обновлено: {new Date(data.timestamp).toLocaleString('ru-RU')}</p>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
