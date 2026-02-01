'use client'

import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { LayoutDashboard, Calendar } from 'lucide-react'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

export default function MessagesPage() {

  return (
    <div className="container max-w-3xl py-8 px-4">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Сообщения', current: true },
        ]}
        className="mb-6"
      />
      <h1 className="text-2xl font-bold tracking-tight mb-2">Запланированные сообщения</h1>
      <p className="text-muted-foreground mb-6">
        Список сообщений по пространствам и календарь — на дашборде и в разделе «Календарь».
      </p>
      <div className="flex flex-wrap gap-3">
        <Button asChild variant="default" className="gap-2">
          <Link href="/dashboard">
            <LayoutDashboard className="h-4 w-4" />
            Дашборд
          </Link>
        </Button>
        <Button asChild variant="outline" className="gap-2">
          <Link href="/dashboard/calendar">
            <Calendar className="h-4 w-4" />
            Календарь
          </Link>
        </Button>
      </div>
    </div>
  )
}
