"use client"

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'
import { LayoutDashboard, Server, Calendar } from 'lucide-react'

const items = [
  { href: '/dashboard', label: 'Дашборд', icon: LayoutDashboard },
  { href: '/dashboard/workspaces', label: 'Пространства', icon: Server },
  { href: '/dashboard/calendar', label: 'Календарь', icon: Calendar },
]

export default function MobileBottomNav() {
  const pathname = usePathname()

  return (
    <nav
      className="lg:hidden fixed bottom-0 left-0 right-0 z-40 border-t border-border/80 bg-card/95 backdrop-blur supports-[backdrop-filter]:bg-card/80 safe-area-pb"
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
                'flex flex-col items-center justify-center gap-0.5 text-xs font-medium transition-colors',
                isActive
                  ? 'text-primary bg-primary/10'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
              )}
              aria-current={isActive ? 'page' : undefined}
            >
              <Icon className="h-5 w-5" aria-hidden />
              <span>{label}</span>
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
