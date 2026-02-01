'use client'

import { useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { cn } from '@/lib/utils'

interface VirtualListProps<T> {
  items: T[]
  renderItem: (item: T, index: number) => React.ReactNode
  estimateSize?: number
  overscan?: number
  className?: string
  /** Высота контейнера (например '60vh' или 400). По умолчанию min(60vh, 500). */
  height?: string | number
  getItemKey?: (item: T, index: number) => string | number
}

export function VirtualList<T>({
  items,
  renderItem,
  estimateSize = 56,
  overscan = 5,
  className,
  height,
  getItemKey,
}: VirtualListProps<T>) {
  const parentRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => parentRef.current,
    estimateSize: () => estimateSize,
    overscan,
  })

  const defaultHeight = typeof window !== 'undefined' ? 'min(60vh, 500px)' : '500px'
  const styleHeight = height != null
    ? (typeof height === 'number' ? `${height}px` : height)
    : defaultHeight

  return (
    <div
      ref={parentRef}
      className={cn('overflow-auto rounded-lg', className)}
      style={{ height: styleHeight }}
    >
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const item = items[virtualRow.index]
          const key = getItemKey ? getItemKey(item, virtualRow.index) : virtualRow.index
          return (
            <div
              key={key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                transform: `translateY(${virtualRow.start}px)`,
              }}
            >
              {renderItem(item, virtualRow.index)}
            </div>
          )
        })}
      </div>
    </div>
  )
}
