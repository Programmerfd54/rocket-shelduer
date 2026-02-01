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
  Folder,
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
    {
      name: 'Инструкции',
      href: '/dashboard/help',
      icon: BookOpen,
      active: pathname.startsWith('/dashboard/help'),
    },
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
          ...(showTemplatesTab
            ? [
                {
                  name: 'Шаблоны',
                  href: '/dashboard/templates',
                  icon: FileText,
                  active: pathname === '/dashboard/templates',
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

  return (
    <div
      className={cn(
        "h-screen bg-card border-r border-border/80 transition-all duration-300 flex flex-col shadow-sm",
        embedded ? "relative w-full flex-1" : "fixed left-0 top-0 z-40",
        !embedded && (collapsed ? "w-16" : "w-64")
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between p-4 border-b border-border/60">
        {!collapsed && (
          <Link href="/dashboard" className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-br from-primary to-primary/90 rounded-xl flex items-center justify-center shadow-md">
              <Send className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-sm font-semibold">RC Scheduler</h1>
              <p className="text-xs text-muted-foreground">Планирование</p>
            </div>
          </Link>
        )}
        {!embedded && (
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setCollapsed(!collapsed)}
            className={cn("h-8 w-8 focus-visible:ring-2", collapsed && "mx-auto")}
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

      {/* User Info + Logout */}
      {!collapsed && (
        <div className="p-4 border-b space-y-3">
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
              <AvatarFallback className={`${generateAvatarColor(user?.email)} text-white font-semibold`}>
                {getInitials(user?.name || user?.email)}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">{user?.name || 'Пользователь'}</p>
              <p className="text-xs text-muted-foreground truncate">Логин: {user?.email}</p>
            </div>
          </div>
        </div>
      )}

      {/* Main Navigation */}
      <nav className="flex-1 overflow-y-auto p-2">
        <div className="space-y-1">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <Link key={item.href} href={item.href}>
                <Button
                  variant={item.active ? 'secondary' : 'ghost'}
                  className={cn(
                    "w-full justify-start rounded-lg h-9",
                    collapsed ? "px-2" : "px-3",
                    item.active && "bg-primary/10 text-primary hover:bg-primary/20"
                  )}
                >
                  <Icon className={cn("h-5 w-5", !collapsed && "mr-3")} />
                  {!collapsed && (
                    <>
                      <span className="flex-1 text-left">{item.name}</span>
                      {item.badge && (
                        <Badge variant="secondary" className="ml-auto">
                          {item.badge}
                        </Badge>
                      )}
                    </>
                  )}
                </Button>
              </Link>
            )
          })}
        </div>

        {/* Workspace Groups */}
        {!collapsed && groups.length > 0 && (
          <div className="mt-6">
            <div className="px-3 mb-2 flex items-center justify-between">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Группы
              </span>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <Plus className="h-3 w-3" />
              </Button>
            </div>
            <div className="space-y-1">
              {groups.map((group) => (
                <Link key={group.id} href={`/dashboard/groups/${group.id}`}>
                  <Button
                    variant="ghost"
                    className="w-full justify-start px-3"
                  >
                    <div
                      className="h-3 w-3 rounded-full mr-3"
                      style={{ backgroundColor: group.color }}
                    />
                    <span className="flex-1 text-left text-sm">{group.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {group._count?.workspaces || 0}
                    </span>
                  </Button>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Recent Workspaces — подсветка текущего пространства (подраздел) */}
        {!collapsed && workspaces.length > 0 && (
          <div className="mt-6">
            <div className="px-3 mb-2">
              <span className="text-xs font-semibold text-muted-foreground uppercase">
                Недавние
              </span>
            </div>
            <div className="space-y-1">
              {workspaces.slice(0, 5).map((workspace) => {
                const isCurrentWorkspace = pathname === `/dashboard/workspaces/${workspace.id}`
                return (
                  <Link key={workspace.id} href={`/dashboard/workspaces/${workspace.id}`}>
                    <Button
                      variant={isCurrentWorkspace ? 'secondary' : 'ghost'}
                      className={cn(
                        'w-full justify-start px-3 rounded-lg',
                        isCurrentWorkspace && 'bg-primary/10 text-primary hover:bg-primary/20'
                      )}
                    >
                      <div
                        className="h-3 w-3 rounded-full mr-3 shrink-0"
                        style={{ backgroundColor: workspace.color || '#ef4444' }}
                      />
                      <span className="flex-1 text-left text-sm truncate">
                        {workspace.workspaceName}
                      </span>
                    </Button>
                  </Link>
                )
              })}
            </div>
          </div>
        )}
      </nav>

      {/* Bottom Navigation */}
      <div className="border-t p-2 space-y-1">
        {!collapsed && (
          <div className="px-3 py-1.5 flex items-center gap-2">
            <OnlineOfflineIndicator compact className="text-muted-foreground" />
            <span className="text-xs text-muted-foreground">Сеть</span>
          </div>
        )}
        {collapsed && (
          <div className="flex justify-center py-1">
            <OnlineOfflineIndicator compact />
          </div>
        )}
        {/* Theme Toggle */}
        <Button
          variant="ghost"
          className={cn("w-full justify-start focus-visible:ring-2", collapsed ? "px-2" : "px-3")}
          onClick={() => setTheme(isDark ? 'light' : 'dark')}
          aria-label={isDark ? 'Светлая тема' : 'Тёмная тема'}
        >
          {isDark ? (
            <Sun className={cn("h-5 w-5", !collapsed && "mr-3")} aria-hidden />
          ) : (
            <Moon className={cn("h-5 w-5", !collapsed && "mr-3")} aria-hidden />
          )}
          {!collapsed && <span>{isDark ? 'Светлая тема' : 'Тёмная тема'}</span>}
        </Button>

        {/* Logout — всегда внизу */}
        <Button
          variant="ghost"
          className={cn("w-full justify-start text-muted-foreground hover:text-foreground focus-visible:ring-2", collapsed ? "px-2" : "px-3")}
          onClick={handleLogout}
          aria-label="Выйти"
        >
          <LogOut className={cn("h-5 w-5", !collapsed && "mr-3")} aria-hidden />
          {!collapsed && <span>Выйти</span>}
        </Button>

        {bottomNavigation.map((item) => {
          const Icon = item.icon
          return (
            <Link key={item.href} href={item.href}>
              <Button
                variant={item.active ? 'secondary' : 'ghost'}
                className={cn(
                  "w-full justify-start",
                  collapsed ? "px-2" : "px-3",
                  item.active && "bg-primary/10 text-primary"
                )}
              >
                <Icon className={cn("h-5 w-5", !collapsed && "mr-3")} />
                {!collapsed && <span>{item.name}</span>}
              </Button>
            </Link>
          )
        })}
      </div>
    </div>
  )
}