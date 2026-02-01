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
    <Button asChild variant="default" size="sm" className="mt-4 rounded-lg gap-2">
      <Link href={action.href}>{action.label}</Link>
    </Button>
  ) : action ? (
    <Button variant="default" size="sm" className="mt-4 rounded-lg gap-2" onClick={action.onClick}>
      {action.label}
    </Button>
  ) : null)

  return (
    <Card className={cn('border-dashed border-border/80 rounded-2xl bg-muted/10', className)}>
      <CardContent className="py-14 px-6 text-center">
        <div className="w-16 h-16 rounded-2xl bg-muted/50 flex items-center justify-center mx-auto mb-4 text-muted-foreground [&>svg]:w-8 [&>svg]:h-8">
          {icon}
        </div>
        <p className="font-medium text-foreground">{title}</p>
        {description && (
          <p className="text-sm text-muted-foreground mt-1 max-w-sm mx-auto">{description}</p>
        )}
        {content}
      </CardContent>
    </Card>
  )
}
