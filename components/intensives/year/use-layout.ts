"use client"

import { useCallback, useEffect, useState, useSyncExternalStore } from 'react'

/** Медиа-запрос без мигания: на сервере и до гидратации — false. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (cb: () => void) => {
      const mq = window.matchMedia(query)
      mq.addEventListener('change', cb)
      return () => mq.removeEventListener('change', cb)
    },
    [query]
  )
  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false
  )
}

/** Ширина элемента в пикселях (0 — пока не измерена или элемент скрыт). */
export function useElementWidth<T extends HTMLElement>(): [(node: T | null) => void, number] {
  const [node, setNode] = useState<T | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    if (!node) return
    const update = () => setWidth(Math.round(node.getBoundingClientRect().width))
    update()
    const ro = new ResizeObserver(update)
    ro.observe(node)
    return () => ro.disconnect()
  }, [node])
  return [setNode, width]
}
