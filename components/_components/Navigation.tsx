"use client"

import { Calendar, Settings } from 'lucide-react'
import { cn } from '@/lib/utils'

interface NavigationProps {
  currentView: string
  onViewChange: (view: string) => void
}

export default function Navigation({ currentView, onViewChange }: NavigationProps) {
  const navItems = [
    { id: 'workspaces', label: 'Пространства', icon: Settings },
    { id: 'messages', label: 'Запланированные сообщения', icon: Calendar },
  ]

  return (
    <nav className="bg-card border-b border-border/80 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex gap-1">
          {navItems.map((item) => {
            const Icon = item.icon
            return (
              <button
                key={item.id}
                onClick={() => onViewChange(item.id)}
                className={cn(
                  "py-4 px-4 rounded-t-lg border-b-2 font-medium text-sm inline-flex items-center gap-2 cursor-pointer transition-colors",
                  currentView === item.id
                    ? 'border-primary text-primary bg-background/50'
                    : 'border-transparent text-muted-foreground hover:text-foreground hover:bg-muted/30'
                )}
              >
                <Icon className="w-5 h-5 shrink-0" />
                {item.label}
              </button>
            )
          })}
        </div>
      </div>
    </nav>
  )
}
