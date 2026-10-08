"use client"

import { ReactNode } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  icon: ReactNode
  title: string
  description?: string
  action?: { label: string; onClick?: () => void; href?: string }
  className?: string
  /** Дочерний контент вместо action (например кнопка с Link) */
  children?: ReactNode
}

/** Пустое состояние с иллюстрацией и одним действием (CTA) */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
  children,
}: EmptyStateProps) {
  const content = children ?? (action?.href ? (
    <Button asChild variant="outline" size="sm" className="mt-4">
      <Link href={action.href}>{action.label}</Link>
    </Button>
  ) : action ? (
    <Button variant="outline" size="sm" className="mt-4" onClick={action.onClick}>
      {action.label}
    </Button>
  ) : null)

  return (
    <Card className={cn('border-dashed bg-transparent', className)}>
      <CardContent className="py-12 px-6 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-md bg-muted text-muted-foreground [&>svg]:h-5 [&>svg]:w-5">
          {icon}
        </div>
        <p className="text-sm font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto text-balance">{description}</p>
        )}
        {content}
      </CardContent>
    </Card>
  )
}
