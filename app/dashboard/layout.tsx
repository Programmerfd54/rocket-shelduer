"use client"

import { Suspense, useState, useEffect, useMemo, useCallback, useSyncExternalStore } from 'react'
import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import Sidebar from '@/components/_components/Sidebar'
import MobileBottomNav from '@/components/_components/MobileBottomNav'
import { Loader2, CalendarClock, Menu } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from '@/components/ui/sheet'
import { formatLocalDate } from '@/lib/utils'

function useEmbeddedInIframe(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => (typeof window !== 'undefined' ? window.self !== window.top : false),
    () => false,
  )
}

function DashboardLayoutShell({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const embeddedInIframe = useEmbeddedInIframe()
  const chromeOff = searchParams.get('chrome') === '0'
  /** Встроенный режим: iframe без сайдбара — админка шаблонов (chrome=0 или загрузка во фрейме) */
  const isEmbedPath =
    pathname === '/dashboard/admin/templates' ||
    pathname === '/dashboard/templates'
  const embedChrome = isEmbedPath && (chromeOff || embeddedInIframe)
  const [user, setUser] = useState<any>(null)
  const [workspaces, setWorkspaces] = useState([])
  const [groups, setGroups] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)

  const volExpiryWarning = useMemo(() => {
    if (!user || user.role !== 'MEMBER' || !user.volunteerExpiresAt || user.blocked) return null
    const expiresAt = new Date(user.volunteerExpiresAt)
    if (expiresAt <= new Date()) return null
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysLeft > 7) return null
    return { daysLeft, expiresAt }
  }, [user])

  const loadData = useCallback(async () => {
    try {
      const userResponse = await fetch('/api/auth/me')
      if (!userResponse.ok) {
        router.push('/login')
        return
      }
      const userData = await userResponse.json()
      const u = userData.user
      setUser(u)
      if (u?.blocked) {
        router.push('/dashboard/blocked')
        return
      }

      if (embedChrome) {
        return
      }

      const workspacesResponse = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      if (workspacesResponse.ok) {
        const workspacesData = await workspacesResponse.json()
        setWorkspaces(workspacesData.workspaces)
      }

      const groupsResponse = await fetch('/api/workspace-groups')
      if (groupsResponse.ok) {
        const groupsData = await groupsResponse.json()
        setGroups(groupsData.groups)
      }

      const messagesResponse = await fetch('/api/messages?status=PENDING')
      if (messagesResponse.ok) {
        const messagesData = await messagesResponse.json()
        setPendingCount(messagesData.messages?.length || 0)
      }
    } catch (error) {
      console.error('Failed to load data:', error)
      router.push('/login')
    } finally {
      setLoading(false)
    }
  }, [router, embedChrome])

  useEffect(() => {
    void loadData()
  }, [loadData])

  // Редирект заблокированного пользователя на /dashboard/blocked — только в эффекте, не во время рендера
  useEffect(() => {
    if (user?.blocked && pathname !== '/dashboard/blocked') {
      router.replace('/dashboard/blocked')
    }
  }, [user?.blocked, pathname, router])

  // Редирект при необходимости смены пароля (после сброса на логин=пароль)
  useEffect(() => {
    if (user?.requirePasswordChange && pathname !== '/dashboard/change-password') {
      router.replace('/dashboard/change-password')
    }
  }, [user?.requirePasswordChange, pathname, router])

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          Загрузка…
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  if (user.blocked) {
    return <>{children}</>
  }

  if (embedChrome) {
    return (
      <div className="min-h-0 bg-background">
        {volExpiryWarning && (
          <div className="border-b border-amber-500/50 bg-amber-500/10 px-3 py-2 flex items-start gap-3 text-amber-800 dark:text-amber-200 text-sm">
            <CalendarClock className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Срок доступа истекает</p>
              <p className="mt-0.5 opacity-90">
                {volExpiryWarning.daysLeft === 0
                  ? 'Доступ истекает сегодня. Обратитесь к администратору для продления.'
                  : volExpiryWarning.daysLeft === 1
                    ? 'Доступ истекает завтра. Обратитесь к администратору для продления.'
                    : `Доступ истекает через ${volExpiryWarning.daysLeft} дн. (${volExpiryWarning.expiresAt.toLocaleDateString('ru-RU')}). Обратитесь к администратору для продления.`}
              </p>
            </div>
          </div>
        )}
        <main className="min-h-0 min-w-0 overflow-x-hidden">{children}</main>
      </div>
    )
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop: колонка под сайдбар (ширина следует за свёрнутым состоянием), сайдбар поверх */}
      <div
        className={`hidden lg:block lg:shrink-0 transition-[width] duration-200 ease-out ${sidebarCollapsed ? 'lg:w-14' : 'lg:w-60'}`}
        aria-hidden
      />
      <div className="hidden lg:block fixed left-0 top-0 z-40">
        <Sidebar
          user={user}
          workspaces={workspaces}
          groups={groups}
          pendingCount={pendingCount}
          collapsed={sidebarCollapsed}
          onCollapsedChange={setSidebarCollapsed}
        />
      </div>
      {/* Mobile: drawer */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="h-9 w-9 bg-background" aria-label="Открыть меню">
              <Menu className="h-4 w-4" aria-hidden />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-[min(20rem,85vw)] p-0 flex flex-col">
            <Sidebar
              user={user}
              workspaces={workspaces}
              groups={groups}
              pendingCount={pendingCount}
              embedded
            />
          </SheetContent>
        </Sheet>
      </div>
      <main className="flex-1 pt-14 pb-16 lg:pb-0 lg:pt-0 ml-0 px-4 lg:px-8 min-w-0 overflow-x-hidden">
        {volExpiryWarning && (
          <div className="-mx-4 lg:-mx-8 border-b border-amber-500/30 bg-amber-500/10 px-4 lg:px-8 py-2.5 flex items-start gap-3 text-amber-900 dark:text-amber-200">
            <CalendarClock className="h-4 w-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-medium">Срок доступа истекает</p>
              <p className="text-sm mt-0.5 opacity-90">
                {volExpiryWarning.daysLeft === 0
                  ? 'Доступ истекает сегодня. Обратитесь к администратору для продления.'
                  : volExpiryWarning.daysLeft === 1
                    ? 'Доступ истекает завтра. Обратитесь к администратору для продления.'
                    : `Доступ истекает через ${volExpiryWarning.daysLeft} дн. (${volExpiryWarning.expiresAt.toLocaleDateString('ru-RU')}). Обратитесь к администратору для продления.`}
              </p>
            </div>
          </div>
        )}
        {children}
      </main>
      <MobileBottomNav />
    </div>
  )
}

function DashboardLayoutFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
        Загрузка…
      </div>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<DashboardLayoutFallback />}>
      <DashboardLayoutShell>{children}</DashboardLayoutShell>
    </Suspense>
  )
}