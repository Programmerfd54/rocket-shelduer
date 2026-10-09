'use client';

import { useCallback, useEffect, useLayoutEffect, useState, useSyncExternalStore, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Activity, CalendarRange, FileText, ListChecks, PanelLeft, PanelLeftClose, Settings, ShieldCheck, Users, type LucideIcon } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { canSeeAdminPanel } from '@/lib/roles';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ADMIN_ASIDE_COLLAPSED_KEY,
  ADMIN_PREFS_CHANGED_EVENT,
  readAsideCollapsed,
  writeAsideCollapsed,
} from '@/lib/admin-sidebar-prefs';

function useEmbeddedInIframe(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => typeof window !== 'undefined' && window.self !== window.top,
    () => false,
  );
}

type NavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Роли, которым виден пункт (и разрешён маршрут). */
  roles: string[];
  /** Активен для вложенных путей (например /dashboard/admin/users/[id] → «Пользователи»). */
  match: (pathname: string) => boolean;
};

const NAV: NavItem[] = [
  {
    href: '/dashboard/admin',
    label: 'Пользователи',
    icon: Users,
    roles: ['LEAD_SUP', 'SUP'],
    match: (p) => p === '/dashboard/admin' || p.startsWith('/dashboard/admin/users'),
  },
  {
    href: '/dashboard/admin/templates',
    label: 'Шаблоны',
    icon: FileText,
    roles: ['LEAD_SUP'],
    match: (p) => p.startsWith('/dashboard/admin/templates'),
  },
  {
    href: '/dashboard/admin/intensives',
    label: 'Интенсивы',
    icon: CalendarRange,
    roles: ['LEAD_SUP'],
    // «Организационные пространства» (/dashboard/admin/org-spaces) — не в меню: ссылка «Дополнительно» на странице интенсивов
    match: (p) => p.startsWith('/dashboard/admin/intensives') || p.startsWith('/dashboard/admin/org-spaces'),
  },
  {
    href: '/dashboard/admin/settings',
    label: 'Настройки',
    icon: Settings,
    roles: ['LEAD_SUP'],
    match: (p) => p.startsWith('/dashboard/admin/settings'),
  },
  {
    href: '/dashboard/admin/audit',
    label: 'Журнал действий',
    icon: ListChecks,
    roles: ['LEAD_SUP', 'SUP'],
    match: (p) => p.startsWith('/dashboard/admin/audit'),
  },
  {
    href: '/dashboard/admin/security',
    label: 'Защита',
    icon: ShieldCheck,
    roles: ['LEAD_SUP'],
    match: (p) => p.startsWith('/dashboard/admin/security'),
  },
  {
    href: '/dashboard/admin/health',
    label: 'Состояние',
    icon: Activity,
    roles: ['LEAD_SUP'],
    match: (p) => p.startsWith('/dashboard/admin/health'),
  },
];

/** Пути, закрытые для SUP (только Lead_SUP). */
const LEAD_SUP_ONLY_PREFIXES = ['/dashboard/admin/templates', '/dashboard/admin/intensives', '/dashboard/admin/org-spaces', '/dashboard/admin/settings', '/dashboard/admin/security', '/dashboard/admin/health'];

export default function AdminSectionLayout({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();
  const embeddedInIframe = useEmbeddedInIframe();
  const [user, setUser] = useState<{ role: string; restrictedFeatures?: string[] } | null>(null);
  const [ready, setReady] = useState(false);
  const [asideCollapsed, setAsideCollapsed] = useState(false);

  const syncSidebarPrefs = useCallback(() => {
    setAsideCollapsed(readAsideCollapsed());
  }, []);

  useLayoutEffect(() => {
    syncSidebarPrefs();
  }, [syncSidebarPrefs]);

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (!e.key || e.key === ADMIN_ASIDE_COLLAPSED_KEY) syncSidebarPrefs();
    };
    window.addEventListener('storage', onStorage);
    window.addEventListener(ADMIN_PREFS_CHANGED_EVENT, syncSidebarPrefs);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener(ADMIN_PREFS_CHANGED_EVENT, syncSidebarPrefs);
    };
  }, [syncSidebarPrefs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/auth/me');
        if (!res.ok) {
          router.replace('/login');
          return;
        }
        const d = await res.json();
        const u = d.user;
        if (!u || cancelled) return;
        if (u.blocked) {
          router.replace('/dashboard/blocked');
          return;
        }
        const restricted = (u.restrictedFeatures ?? []) as string[];
        if (restricted.includes('adminPanel')) {
          router.replace('/dashboard');
          toast.error('Доступ в админ панель ограничен', { description: 'Обратитесь к Lead_SUP.' });
          return;
        }
        if (!canSeeAdminPanel(u.role, restricted)) {
          router.replace('/dashboard');
          toast.error('Доступ запрещён', { description: 'Админ панель доступна ролям Lead_SUP и SUP.' });
          return;
        }
        setUser(u);
      } finally {
        if (!cancelled) setReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const leadSupOnlyPath = LEAD_SUP_ONLY_PREFIXES.some((p) => pathname.startsWith(p));
  const forbiddenForRole = Boolean(user && leadSupOnlyPath && user.role !== 'LEAD_SUP');

  useEffect(() => {
    if (forbiddenForRole) {
      router.replace('/dashboard/admin');
      toast.error('Раздел доступен только Lead_SUP');
    }
  }, [forbiddenForRole, router]);

  const toggleAside = () => {
    const next = !asideCollapsed;
    setAsideCollapsed(next);
    writeAsideCollapsed(next);
  };

  if (!ready || !user || forbiddenForRole) {
    return (
      <div className="mx-auto w-full max-w-5xl space-y-3 px-4 py-8">
        <Skeleton className="h-7 w-48" />
        <Skeleton className="h-4 w-80" />
        <Skeleton className="mt-6 h-64 w-full" />
      </div>
    );
  }

  const chrome0 = searchParams.get('chrome') === '0';
  const stripAdminChrome = (chrome0 || embeddedInIframe) && pathname === '/dashboard/admin/templates';
  if (stripAdminChrome) {
    return <div className="min-h-0 w-full bg-background">{children}</div>;
  }

  const items = NAV.filter((i) => i.roles.includes(user.role));

  return (
    <div className="flex min-h-screen w-full max-w-full overflow-x-hidden bg-background">
      <aside
        className={cn(
          'hidden shrink-0 border-r bg-sidebar transition-[width] duration-150 md:block',
          asideCollapsed ? 'w-14' : 'w-56',
        )}
      >
        <div className="sticky top-0 max-h-screen overflow-y-auto">
          <div className={cn('flex items-center py-3', asideCollapsed ? 'justify-center' : 'justify-between px-4')}>
            {!asideCollapsed && <p className="text-sm font-semibold">Админ панель</p>}
            <Button
              type="button"
              variant="ghost"
              size="icon"
              className="size-8 text-muted-foreground"
              aria-label={asideCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
              title={asideCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
              onClick={toggleAside}
            >
              {asideCollapsed ? <PanelLeft className="size-4" /> : <PanelLeftClose className="size-4" />}
            </Button>
          </div>
          <nav className={cn('space-y-0.5 pb-4', asideCollapsed ? 'px-2' : 'px-3')} aria-label="Разделы админ панели">
            {items.map((item) => {
              const active = item.match(pathname);
              const Icon = item.icon;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={asideCollapsed ? item.label : undefined}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-2 rounded-md text-sm transition-colors',
                    asideCollapsed ? 'justify-center' : 'px-2.5',
                    active
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:bg-muted/60 hover:text-foreground',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden />
                  {!asideCollapsed && <span className="truncate">{item.label}</span>}
                </Link>
              );
            })}
          </nav>
        </div>
      </aside>
      <div className="flex w-full min-w-0 flex-1 flex-col">
        <nav className="flex gap-1 overflow-x-auto border-b bg-background px-3 py-2 md:hidden [scrollbar-width:none]" aria-label="Разделы админ панели">
          {items.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              aria-current={item.match(pathname) ? 'page' : undefined}
              className={cn(
                'flex h-9 shrink-0 items-center rounded-md px-3 text-sm',
                item.match(pathname) ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground',
              )}
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="min-w-0 flex-1">{children}</div>
      </div>
    </div>
  );
}
