"use client"

import { useState } from 'react'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  Send,
  LayoutDashboard,
  Server,
  Calendar,
  History,
  Settings,
  Users,
  PanelLeftClose,
  PanelLeftOpen,
  Moon,
  Sun,
  LogOut,
  ChevronsUpDown,
  type LucideIcon,
} from 'lucide-react'
import { getInitials, generateAvatarColor } from '@/lib/utils'
import { canSeeAdminPanel } from '@/lib/roles'
import { useTheme } from 'next-themes'
import { OnlineOfflineIndicator } from '@/components/_components/OnlineOfflineIndicator'
import { clearWorkspaceEmojisCache } from '@/lib/useWorkspaceEmojis'

interface SidebarProps {
  user: any
  workspaces?: any[]
  groups?: any[]
  pendingCount?: number
  /** Внутри drawer на мобильном — без fixed, полная ширина */
  embedded?: boolean
  /** Управляемое сворачивание (чтобы контент занимал освободившееся место) */
  collapsed?: boolean
  onCollapsedChange?: (collapsed: boolean) => void
}

type NavItem = {
  name: string
  href: string
  icon: LucideIcon
  active: boolean
  badge?: number
}

const ROLE_LABELS: Record<string, string> = {
  LEAD_SUP: 'Lead_SUP',
  SUP: 'SUP',
  ADM: 'ADM',
  MEMBER: 'Волонтёр',
}

export default function Sidebar({
  user,
  workspaces = [],
  groups = [],
  pendingCount = 0,
  embedded = false,
  collapsed: collapsedProp,
  onCollapsedChange,
}: SidebarProps) {
  const pathname = usePathname()
  const router = useRouter()
  const [collapsedState, setCollapsedState] = useState(false)
  const collapsed = collapsedProp ?? collapsedState
  const setCollapsed = (v: boolean) => {
    setCollapsedState(v)
    onCollapsedChange?.(v)
  }
  const { setTheme, resolvedTheme } = useTheme()
  const isCollapsed = collapsed && !embedded

  const handleLogout = async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    clearWorkspaceEmojisCache()
    router.push('/login')
    router.refresh()
  }
  const isDark = resolvedTheme === 'dark'

  const role = user?.role ?? 'MEMBER'
  const restrictedFeatures = (user?.restrictedFeatures ?? []) as string[]
  const isVolunteer = role === 'MEMBER' && user?.volunteerExpiresAt
  const showHistory = role !== 'ADM' && !isVolunteer
  const showAdminPanel = canSeeAdminPanel(role, restrictedFeatures)

  const navigation: NavItem[] = [
    { name: 'Расписание', href: '/dashboard', icon: LayoutDashboard, active: pathname === '/dashboard' },
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
      ? [{ name: 'История', href: '/dashboard/activity', icon: History, active: pathname === '/dashboard/activity' }]
      : []),
  ]

  const systemNavigation: NavItem[] = [
    ...(showAdminPanel
      ? [{ name: 'Администрирование', href: '/dashboard/admin', icon: Users, active: pathname.startsWith('/dashboard/admin') }]
      : []),
    { name: 'Настройки', href: '/dashboard/settings', icon: Settings, active: pathname === '/dashboard/settings' },
  ]

  const renderNavItem = (item: NavItem) => {
    const Icon = item.icon
    const link = (
      <Link
        key={item.href}
        href={item.href}
        aria-current={item.active ? 'page' : undefined}
        className={cn(
          'group flex h-8 items-center gap-2.5 rounded-md text-[13px] font-medium transition-colors',
          isCollapsed ? 'justify-center px-0' : 'px-2.5',
          item.active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
        )}
      >
        <Icon
          className={cn('h-4 w-4 shrink-0', item.active ? 'text-primary' : 'text-sidebar-foreground/55 group-hover:text-sidebar-foreground/80')}
          strokeWidth={1.75}
          aria-hidden
        />
        {!isCollapsed && (
          <>
            <span className="flex-1 truncate">{item.name}</span>
            {item.badge !== undefined && (
              <span className="text-[11px] font-medium tabular-nums text-sidebar-foreground/50">{item.badge}</span>
            )}
          </>
        )}
      </Link>
    )
    if (!isCollapsed) return link
    return (
      <Tooltip key={item.href}>
        <TooltipTrigger asChild>{link}</TooltipTrigger>
        <TooltipContent side="right">{item.name}</TooltipContent>
      </Tooltip>
    )
  }

  const renderDotLink = (href: string, label: string, color: string, active: boolean, count?: number) => (
    <Link
      key={href}
      href={href}
      className={cn(
        'flex h-8 items-center gap-2.5 rounded-md px-2.5 text-[13px] transition-colors',
        active
          ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground'
          : 'text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-sidebar-foreground',
      )}
    >
      <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: color }} aria-hidden />
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count !== undefined && <span className="text-[11px] tabular-nums text-sidebar-foreground/50">{count}</span>}
    </Link>
  )

  return (
    <div
      className={cn(
        'flex h-screen flex-col bg-sidebar text-sidebar-foreground transition-[width] duration-200 ease-out',
        'border-r border-sidebar-border',
        embedded ? 'relative w-full flex-1' : 'fixed left-0 top-0 z-40',
        !embedded && (isCollapsed ? 'w-14' : 'w-60'),
      )}
    >
      {/* Шапка: логотип + сворачивание */}
      <div className={cn('flex h-12 shrink-0 items-center gap-2 px-3', isCollapsed && 'justify-center px-0')}>
        <Link
          href="/dashboard"
          className={cn('flex min-w-0 items-center gap-2 rounded-md', !isCollapsed && 'flex-1')}
          aria-label="RC Scheduler — на дашборд"
        >
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <Send className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </span>
          {!isCollapsed && <span className="truncate text-sm font-semibold tracking-tight">RC Scheduler</span>}
        </Link>
        {!embedded && !isCollapsed && (
          <button
            type="button"
            onClick={() => setCollapsed(true)}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Свернуть меню"
          >
            <PanelLeftClose className="h-4 w-4" aria-hidden />
          </button>
        )}
      </div>
      {isCollapsed && (
        <div className="flex justify-center pb-1">
          <button
            type="button"
            onClick={() => setCollapsed(false)}
            className="flex h-7 w-7 items-center justify-center rounded-md text-sidebar-foreground/50 transition-colors hover:bg-sidebar-accent hover:text-sidebar-foreground"
            aria-label="Развернуть меню"
          >
            <PanelLeftOpen className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      {/* Навигация */}
      <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden py-2', isCollapsed ? 'px-2' : 'px-2.5')} aria-label="Разделы">
        <div className="space-y-0.5">{navigation.map(renderNavItem)}</div>

        {!isCollapsed && groups.length > 0 && (
          <div className="mt-5">
            <p className="px-2.5 pb-1 text-[11px] font-medium text-sidebar-foreground/45">Группы</p>
            <div className="space-y-0.5">
              {groups.map((group) =>
                renderDotLink(
                  `/dashboard/groups/${group.id}`,
                  group.name,
                  group.color,
                  pathname === `/dashboard/groups/${group.id}` || pathname.startsWith(`/dashboard/groups/${group.id}/`),
                  group._count?.workspaces || 0,
                ),
              )}
            </div>
          </div>
        )}

        {!isCollapsed && workspaces.length > 0 && (
          <div className="mt-5">
            <p className="px-2.5 pb-1 text-[11px] font-medium text-sidebar-foreground/45">Недавние пространства</p>
            <div className="space-y-0.5">
              {workspaces
                .slice(0, 5)
                .map((w) =>
                  renderDotLink(
                    `/dashboard/workspaces/${w.id}`,
                    w.workspaceName,
                    w.color || '#ef4444',
                    pathname === `/dashboard/workspaces/${w.id}`,
                  ),
                )}
            </div>
          </div>
        )}
      </nav>

      {/* Низ: система + профиль */}
      <div className={cn('shrink-0 space-y-0.5 border-t border-sidebar-border py-2', isCollapsed ? 'px-2' : 'px-2.5')}>
        {systemNavigation.map(renderNavItem)}

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              className={cn(
                'mt-1 flex w-full items-center gap-2.5 rounded-md py-1.5 text-left transition-colors hover:bg-sidebar-accent/70',
                isCollapsed ? 'justify-center px-0' : 'px-2',
              )}
              aria-label="Меню профиля"
            >
              <Avatar className="h-6 w-6">
                {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
                <AvatarFallback className={`${generateAvatarColor(user?.email)} text-[10px] font-semibold text-white`}>
                  {getInitials(user?.name || user?.email)}
                </AvatarFallback>
              </Avatar>
              {!isCollapsed && (
                <>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-medium leading-tight">{user?.name || 'Пользователь'}</span>
                    <span className="block truncate text-[11px] leading-tight text-sidebar-foreground/50">
                      {ROLE_LABELS[role] ?? role}
                    </span>
                  </span>
                  <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-sidebar-foreground/40" aria-hidden />
                </>
              )}
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent side={isCollapsed ? 'right' : 'top'} align="start" className="w-56">
            <DropdownMenuLabel className="font-normal">
              <p className="truncate text-sm font-medium">{user?.name || 'Пользователь'}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => router.push('/dashboard/settings')}>
              <Settings aria-hidden /> Настройки профиля
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setTheme(isDark ? 'light' : 'dark')}>
              {isDark ? <Sun aria-hidden /> : <Moon aria-hidden />}
              {isDark ? 'Светлая тема' : 'Тёмная тема'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onSelect={handleLogout}>
              <LogOut aria-hidden /> Выйти
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <div className={cn('flex items-center gap-2 px-2 pt-1', isCollapsed && 'justify-center px-0')}>
          <OnlineOfflineIndicator compact className="text-sidebar-foreground/50" />
          {!isCollapsed && <span className="text-[11px] text-sidebar-foreground/45">Соединение</span>}
        </div>
      </div>
    </div>
  )
}
