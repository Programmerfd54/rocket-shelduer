"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Server, Calendar } from 'lucide-react'

const items = [
  { href: '/dashboard', label: 'Расписание', icon: LayoutDashboard },
  { href: '/dashboard/workspaces', label: 'Пространства', icon: Server },
  { href: '/dashboard/calendar', label: 'Календарь', icon: Calendar },
]

export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t bg-background safe-area-pb"
      aria-label="Основная навигация"
    >
      <div className="grid grid-cols-3 h-14">
        {items.map(({ href, label, icon: Icon }) => {
          const isActive =
            href === pathname ||
            (href !== '/dashboard' && pathname.startsWith(href))
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 text-[11px] font-medium transition-colors',
                isActive ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-[18px] w-[18px]" strokeWidth={1.75} aria-hidden />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
