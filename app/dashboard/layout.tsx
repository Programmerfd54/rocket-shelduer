"use client"

import { useState, useEffect, useMemo } from 'react'
import { useRouter, usePathname } from 'next/navigation'
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

export default function DashboardLayoutClient({
  children,
}: {
  children: React.ReactNode
}) {
  const router = useRouter()
  const pathname = usePathname()
  const [user, setUser] = useState<any>(null)
  const [workspaces, setWorkspaces] = useState([])
  const [groups, setGroups] = useState([])
  const [pendingCount, setPendingCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  const volExpiryWarning = useMemo(() => {
    if (!user || user.role !== 'VOL' || !user.volunteerExpiresAt || user.blocked) return null
    const expiresAt = new Date(user.volunteerExpiresAt)
    if (expiresAt <= new Date()) return null
    const daysLeft = Math.ceil((expiresAt.getTime() - Date.now()) / (1000 * 60 * 60 * 24))
    if (daysLeft > 7) return null
    return { daysLeft, expiresAt }
  }, [user])

  useEffect(() => {
    loadData()
  }, [])

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

  const loadData = async () => {
    try {
      // Load user
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

      // Load workspaces
      const workspacesResponse = await fetch(`/api/workspace?today=${formatLocalDate(new Date())}`)
      if (workspacesResponse.ok) {
        const workspacesData = await workspacesResponse.json()
        setWorkspaces(workspacesData.workspaces)
      }

      // Load groups
      const groupsResponse = await fetch('/api/workspace-groups')
      if (groupsResponse.ok) {
        const groupsData = await groupsResponse.json()
        setGroups(groupsData.groups)
      }

      // Load pending messages count
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
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gradient-to-br from-background to-muted/10">
        <div className="text-center space-y-4">
          <Loader2 className="w-12 h-12 animate-spin text-primary mx-auto" />
          <p className="text-sm text-muted-foreground">Загрузка...</p>
        </div>
      </div>
    )
  }

  if (!user) {
    return null
  }

  // Заблокированный пользователь видит только страницу «Доступ ограничен» без сайдбара
  if (user.blocked) {
    return <>{children}</>
  }

  return (
    <div className="flex min-h-screen bg-background">
      {/* Desktop: колонка под сайдбар (фиксированная ширина), сайдбар поверх */}
      <div className="hidden lg:block lg:w-64 lg:shrink-0" aria-hidden>
        <div className="lg:w-64 lg:h-screen lg:pointer-events-none" />
      </div>
      <div className="hidden lg:block fixed left-0 top-0 z-40">
        <Sidebar
          user={user}
          workspaces={workspaces}
          groups={groups}
          pendingCount={pendingCount}
        />
      </div>
      {/* Mobile: drawer */}
      <div className="lg:hidden fixed top-4 left-4 z-50">
        <Sheet open={mobileMenuOpen} onOpenChange={setMobileMenuOpen}>
          <SheetTrigger asChild>
            <Button variant="outline" size="icon" className="h-10 w-10 shadow-md">
              <Menu className="h-5 w-5" aria-label="Меню" />
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
      <main className="flex-1 pt-14 pb-14 lg:pb-0 lg:pt-0 ml-0 px-4 lg:px-6 transition-all duration-300 min-w-0 overflow-x-hidden">
        {volExpiryWarning && (
          <div className="rounded-none border-x-0 border-t-0 border border-amber-500/50 bg-amber-500/10 px-4 py-3 flex items-start gap-3 text-amber-800 dark:text-amber-200">
            <CalendarClock className="h-5 w-5 shrink-0 mt-0.5" />
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