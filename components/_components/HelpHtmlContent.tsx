'use client'

import { useRef, useEffect, useCallback } from 'react'
import { cn } from '@/lib/utils'
import { HELPDOC_ICONS } from '@/lib/helpIcons'

/** Рендерит HTML контент справки и подменяет относительные пути изображений на абсолютные для корректной загрузки. */
export function HelpHtmlContent({
  html,
  className,
}: {
  html: string
  className?: string
}) {
  const ref = useRef<HTMLDivElement>(null)

  const injectIconsAndAssets = useCallback(() => {
    if (typeof window === 'undefined' || !ref.current) return
    const root = ref.current
    const origin = window.location.origin
    root.querySelectorAll('img[src^="/"]').forEach((img) => {
      const src = img.getAttribute('src')
      if (src && src.startsWith('/') && !src.startsWith('//')) {
        img.setAttribute('src', origin + src)
      }
    })
    root.querySelectorAll<HTMLAnchorElement>('a[href^="/help-uploads/"]').forEach((a) => {
      const name = a.getAttribute('href')?.replace(/^\/help-uploads\//, '').split('?')[0] || ''
      if (name) {
        a.href = `/api/help/download?file=${encodeURIComponent(name)}`
        a.setAttribute('download', a.getAttribute('download') ?? name)
      }
    })
    // Иконки: подставляем SVG по data-icon (для всех пользователей при просмотре справки)
    root.querySelectorAll<HTMLElement>('span[data-icon]').forEach((span) => {
      if (span.querySelector('svg')) return
      const name = span.getAttribute('data-icon')
      const color = span.getAttribute('data-icon-color')
      const svg = name && name in HELPDOC_ICONS ? HELPDOC_ICONS[name] : ''
      if (svg) span.innerHTML = svg
      if (color) span.style.color = color
    })
  }, [])

  useEffect(() => {
    injectIconsAndAssets()
    const rafId = requestAnimationFrame(() => injectIconsAndAssets())
    const timeoutId = window.setTimeout(() => injectIconsAndAssets(), 300)
    return () => {
      cancelAnimationFrame(rafId)
      window.clearTimeout(timeoutId)
    }
  }, [html, injectIconsAndAssets])

  return (
    <div
      ref={ref}
      className={cn('help-content prose prose-sm dark:prose-invert max-w-none', className)}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
}
