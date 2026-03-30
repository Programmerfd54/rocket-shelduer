"use client"

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Badge } from '@/components/ui/badge'
import {
  Send,
  LayoutDashboard,
  Server,
  Calendar,
  History,
  Settings,
  Users,
  FileText,
  ChevronLeft,
  ChevronRight,
  Plus,
  Moon,
  Sun,
  LogOut,
  BookOpen,
} from 'lucide-react'
import { getInitials, generateAvatarColor } from '@/lib/utils'
import { useTheme } from 'next-themes'
import { OnlineOfflineIndicator } from '@/components/_components/OnlineOfflineIndicator'

interface SidebarProps {
  user: any
  workspaces?: any[]
  groups?: any[]
  pendingCount?: number
  /** Внутри drawer на мобильном — без fixed, полная ширина */
  embedded?: boolean
}

export default function Sidebar({ user, workspaces = [], groups = [], pendingCount = 0, embedded = false }: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsed, setCollapsed] = useState(false)
  const [visibility, setVisibility] = useState<{ templatesTabVisible: boolean; helpMainVisible: boolean; helpAdminVisible: boolean } | null>(null)
  const { theme, setTheme, resolvedTheme } = useTheme()

  useEffect(() => {
    fetch('/api/help/visibility')
      .then((r) => r.ok ? r.json() : null)
      .then((v) => v && setVisibility({ templatesTabVisible: v.templatesTabVisible !== false, helpMainVisible: v.helpMainVisible !== false, helpAdminVisible: v.helpAdminVisible !== false }))
      .catch(() => {})
  }, [])

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    router.push('/login')
    router.refresh()
  }
  const isDark = resolvedTheme === 'dark'

  const role = user?.role ?? 'USER'
  const restrictedFeatures = (user?.restrictedFeatures ?? []) as string[]
  const showHistory = role !== 'ADM' && role !== 'VOL'
  const showAdminPanel = (role === 'SUPPORT' || role === 'ADM' || role === 'ADMIN') && !restrictedFeatures.includes('adminPanel')

  const navigation = [
    {
      name: 'Дашборд',
      href: '/dashboard',
      icon: LayoutDashboard,
      active: pathname === '/dashboard',
    },
    {
      name: 'Пространства',
      href: '/dashboard/workspaces',
      icon: Server,
      active: pathname.startsWith('/dashboard/workspaces'),
      badge: workspaces.length > 0 ? workspaces.length : undefined,
    },
    {
      name: 'Календарь',
      href: '/dashboard/calendar',
      icon: Calendar,
      active: pathname === '/dashboard/calendar',
      badge: pendingCount > 0 ? pendingCount : undefined,
    },
    ...(showHistory
      ? [
          {
            name: 'История',
            href: '/dashboard/activity',
            icon: History,
            active: pathname === '/dashboard/activity',
          },
        ]
      : []),
    ...(role !== 'ADMIN'
      ? [
          {
            name: 'Инструкции',
            href: '/dashboard/admin/help',
            icon: BookOpen,
            active: pathname.startsWith('/dashboard/admin/help'),
          },
        ]
      : []),
  ]

  const showTemplatesTab = visibility === null ? true : (visibility.templatesTabVisible || role === 'ADMIN')
  const bottomNavigation = [
    ...(showAdminPanel
      ? [
          {
            name: 'Админ панель',
            href: '/dashboard/admin',
            icon: Users,
            active: pathname.startsWith('/dashboard/admin'),
          },
          ...(showTemplatesTab && role !== 'ADMIN'
            ? [
                {
                  name: 'Шаблоны',
                  href: '/dashboard/admin/templates',
                  icon: FileText,
                  active: pathname === '/dashboard/admin/templates',
                },
              ]
            : []),
        ]
      : []),
    {
      name: 'Настройки',
      href: '/dashboard/settings',
      icon: Settings,
      active: pathname === '/dashboard/settings',
    },
  ]

  const navLinkClass = (active: boolean, collapsedMode: boolean) =>
    cn(
      'group relative flex w-full items-center gap-3 rounded-xl text-sm font-medium transition-colors duration-150',
      collapsedMode ? 'justify-center px-2 py-2' : 'border-l-[3px] pl-3 pr-2 py-2.5',
      collapsedMode && active && 'bg-primary/10 ring-1 ring-primary/20',
      collapsedMode && !active && 'hover:bg-muted/70',
      !collapsedMode && active && 'border-l-primary bg-background text-foreground shadow-sm ring-1 ring-border/50',
      !collapsedMode && !active && 'border-l-transparent text-muted-foreground hover:border-border hover:bg-muted/70 hover:text-foreground'
    )

  return (
    <div
      className={cn(
        'h-screen flex flex-col transition-[width] duration-300 ease-out',
        'bg-gradient-to-b from-card via-card to-muted/30',
        'border-r border-border/40',
        'shadow-[inset_-1px_0_0_0_hsl(var(--border)/0.35)]',
        embedded ? 'relative w-full flex-1' : 'fixed left-0 top-0 z-40',
        !embedded && (collapsed ? 'w-[4.25rem]' : 'w-64')
      )}
    >
      {/* Header */}
      <div
        className={cn(
          'border-b border-border/40 bg-card/80 backdrop-blur-sm px-3 py-4',
          collapsed && !embedded ? 'flex flex-col items-center gap-3' : 'flex items-center justify-between gap-2'
        )}
      >
        {!collapsed && (
          <Link href="/dashboard" className="flex min-w-0 flex-1 items-center gap-3 rounded-xl p-1 -m-1 transition-colors hover:bg-muted/50">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md ring-1 ring-primary/20">
              <Send className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0">
              <h1 className="text-sm font-semibold tracking-tight truncate">RC Scheduler</h1>
              <p className="text-[11px] text-muted-foreground tracking-wide">Планирование</p>
            </div>
          </Link>
        )}
        {collapsed && !embedded && (
          <Link
            href="/dashboard"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-primary-foreground shadow-md ring-1 ring-primary/20"
            aria-label="На дашборд"
          >
            <Send className="h-5 w-5" strokeWidth={2} />
          </Link>
        )}
        {!embedded && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className={cn(
              'h-9 w-9 shrink-0 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground',
              collapsed && 'shrink-0'
            )}
            aria-label={collapsed ? 'Развернуть меню' : 'Свернуть меню'}
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" aria-hidden />
            ) : (
              <ChevronLeft className="h-4 w-4" aria-hidden />
            )}
          </Button>
        )}
      </div>

      {/* User */}
      {!collapsed && (
        <div className="px-3 py-3 border-b border-border/40">
          <div className="flex items-center gap-3 rounded-xl border border-border/50 bg-muted/30 px-3 py-2.5 ring-1 ring-border/30">
            <Avatar className="h-9 w-9 ring-2 ring-background shadow-sm">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback className={`${generateAvatarColor(user?.email)} text-white text-xs font-semibold`}>
                {getInitials(user?.name || user?.email)}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium leading-tight truncate">{user?.name || 'Пользователь'}</p>
              <p className="text-[11px] text-muted-foreground truncate mt-0.5">{user?.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto overflow-x-hidden px-2 py-3">
        <div className="space-y-0.5">
          {!collapsed && (
            <p className="px-3 pb-2 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">Меню</p>
          )}
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href} className="block">
                <span className={navLinkClass(!!item.active, collapsed)}>
                  <span
                    className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                      item.active
                        ? 'bg-primary/12 text-primary'
                        : 'bg-muted/50 text-muted-foreground group-hover:bg-muted group-hover:text-foreground'
                    )}
                  >
                    <Icon className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left truncate">{item.name}</span>
                      {item.badge !== undefined && (
                        <Badge
                          variant="secondary"
                          className="ml-auto h-5 min-w-[1.25rem] justify-center px-1.5 text-[10px] font-semibold tabular-nums bg-background/80 ring-1 ring-border/50"
                        >
                          {item.badge}
                        </Badge>
                      )}
                    </>
                  )}
                </span>
              </Link>
            )
          })}
        </div>

        {/* Workspace Groups */}
        {!collapsed && groups.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border/30">
            <div className="px-3 mb-2 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">Группы</span>
              <Button variant="ghost" size="icon" className="h-7 w-7 rounded-lg text-muted-foreground hover:text-foreground" type="button">
                <Plus className="h-3.5 w-3.5" />
              </Button>
            </div>
            <div className="space-y-0.5">
              {groups.map((group) => {
                const active = pathname === `/dashboard/groups/${group.id}` || pathname.startsWith(`/dashboard/groups/${group.id}/`)
                return (
                  <Link key={group.id} href={`/dashboard/groups/${group.id}`} className="block">
                    <span
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border-l-[3px] pl-3 pr-2 py-2 text-sm transition-colors',
                        active
                          ? 'border-l-primary bg-background shadow-sm ring-1 ring-border/50 text-foreground'
                          : 'border-l-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background shadow-sm"
                        style={{ backgroundColor: group.color }}
                      />
                      <span className="min-w-0 flex-1 truncate text-left font-medium">{group.name}</span>
                      <span className="shrink-0 text-[10px] font-medium tabular-nums text-muted-foreground bg-muted/50 px-1.5 py-0.5 rounded-md">
                        {group._count?.workspaces || 0}
                      </span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}

        {/* Recent Workspaces */}
        {!collapsed && workspaces.length > 0 && (
          <div className="mt-5 pt-4 border-t border-border/30">
            <div className="px-3 mb-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">Недавние</span>
            </div>
            <div className="space-y-0.5">
              {workspaces.slice(0, 5).map((workspace) => {
                const isCurrentWorkspace = pathname === `/dashboard/workspaces/${workspace.id}`
                return (
                  <Link key={workspace.id} href={`/dashboard/workspaces/${workspace.id}`} className="block">
                    <span
                      className={cn(
                        'flex w-full items-center gap-3 rounded-xl border-l-[3px] pl-3 pr-2 py-2 text-sm transition-colors',
                        isCurrentWorkspace
                          ? 'border-l-primary bg-background text-foreground shadow-sm ring-1 ring-border/50'
                          : 'border-l-transparent text-muted-foreground hover:bg-muted/70 hover:text-foreground'
                      )}
                    >
                      <span
                        className="h-2.5 w-2.5 shrink-0 rounded-full ring-2 ring-background shadow-sm"
                        style={{ backgroundColor: workspace.color || '#ef4444' }}
                      />
                      <span className="min-w-0 flex-1 truncate text-left font-medium">{workspace.workspaceName}</span>
                    </span>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Footer: admin links → theme → logout */}
      <div className="border-t border-border/40 bg-muted/20 px-2 py-3 space-y-1">
        {!collapsed && (
          <div className="px-3 pb-2 flex items-center gap-2">
            <OnlineOfflineIndicator compact className="text-muted-foreground" />
            <span className="text-[11px] text-muted-foreground">Сеть</span>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center pb-1">
            <OnlineOfflineIndicator compact />
          </div>
        )}

        {!collapsed && bottomNavigation.length > 0 && (
          <p className="px-3 pt-1 pb-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/90">Система</p>
        )}

        {bottomNavigation.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href} className="block">
              <span className={navLinkClass(!!item.active, collapsed)}>
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors',
                    item.active
                      ? 'bg-primary/12 text-primary'
                      : 'bg-muted/50 text-muted-foreground group-hover:bg-muted group-hover:text-foreground'
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.75} />
                </span>
                {!collapsed && <span className="flex-1 truncate text-left">{item.name}</span>}
              </span>
            </Link>
          )
        })}

        <button
          type="button"
          className={cn(
            'group flex w-full items-center gap-3 rounded-xl text-sm font-medium transition-colors',
            collapsed ? 'justify-center px-2 py-2 text-muted-foreground hover:bg-muted/70' : 'border-l-[3px] border-l-transparent px-3 py-2.5 text-muted-foreground hover:bg-muted/70 hover:text-foreground'
          )}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={isDark ? 'Светлая тема' : 'Тёмная тема'}
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 text-muted-foreground group-hover:bg-muted">
            {isDark ? <Sun className="h-4 w-4" strokeWidth={1.75} /> : <Moon className="h-4 w-4" strokeWidth={1.75} />}
          </span>
          {!collapsed && <span className="flex-1 text-left">{isDark ? 'Светлая тема' : 'Тёмная тема'}</span>}
        </button>

        <button
          type="button"
          className={cn(
            'group flex w-full items-center gap-3 rounded-xl text-sm font-medium transition-colors text-muted-foreground hover:bg-destructive/10 hover:text-destructive',
            collapsed ? 'justify-center px-2 py-2' : 'border-l-[3px] border-l-transparent px-3 py-2.5'
          )}
          onClick={handleLogout}
          aria-label="Выйти"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted/50 group-hover:bg-destructive/15">
            <LogOut className="h-4 w-4" strokeWidth={1.75} />
          </span>
          {!collapsed && <span className="flex-1 text-left">Выйти</span>}
        </button>
      </div>
    </div>
  )
}