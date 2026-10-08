"use client"

import { useMemo, useState } from 'react'

export type MessagePeriodFilter = 'all' | '2weeks' | 'intensive'

export type MessageAuthor = {
  id: string
  name: string | null
  email: string
  username?: string | null
  role?: string
}

/**
 * Состояние и производные списки вкладки «Сообщения»: период, автор, выбранный канал.
 * Вынесено в хук, чтобы фильтры не сбрасывались при переключении вкладок.
 */
export function useMessagesView({
  messages,
  externalStatuses,
  startDate,
  endDate,
}: {
  messages: any[]
  externalStatuses: Record<string, string>
  startDate?: string | null
  endDate?: string | null
}) {
  const [periodFilter, setPeriodFilter] = useState<MessagePeriodFilter>('all')
  const [authorFilter, setAuthorFilter] = useState<string | null>(null)
  const [pickedChannelId, setSelectedChannelId] = useState<string | null>(null)

  const byPeriod = useMemo(() => {
    const list = messages || []
    if (periodFilter === 'all') return list
    const now = new Date()
    if (periodFilter === '2weeks') {
      const end = new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000)
      return list.filter((m) => {
        const d = new Date(m.scheduledFor)
        return d >= now && d <= end
      })
    }
    if (periodFilter === 'intensive' && startDate && endDate) {
      const start = new Date(startDate)
      const end = new Date(endDate)
      return list.filter((m) => {
        const d = new Date(m.scheduledFor)
        return d >= start && d <= end
      })
    }
    return list
  }, [messages, periodFilter, startDate, endDate])

  const baseMessages = useMemo(
    () => (authorFilter ? byPeriod.filter((m) => m.user?.id === authorFilter) : byPeriod),
    [byPeriod, authorFilter],
  )

  const channelsWithMessages = useMemo(() => {
    const map = new Map<string, { channelId: string; channelName: string; messageCount: number }>()
    for (const m of baseMessages) {
      const entry = map.get(m.channelId)
      if (entry) entry.messageCount += 1
      else map.set(m.channelId, { channelId: m.channelId, channelName: m.channelName || 'Неизвестный канал', messageCount: 1 })
    }
    return Array.from(map.values())
  }, [baseMessages])

  const authors = useMemo(() => {
    const seen = new Set<string>()
    return (messages || [])
      .filter((m) => m.user?.id && !seen.has(m.user.id) && seen.add(m.user.id))
      .map((m) => m.user as MessageAuthor)
      .sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email))
  }, [messages])

  // Выбранный канал должен существовать в текущем срезе; иначе берём первый (или null)
  const selectedChannelId =
    pickedChannelId && channelsWithMessages.some((c) => c.channelId === pickedChannelId)
      ? pickedChannelId
      : (channelsWithMessages[0]?.channelId ?? null)

  const messagesOfChannel = useMemo(() => {
    if (!selectedChannelId) return []
    return baseMessages
      .filter((m) => m.channelId === selectedChannelId)
      .map((m) => ({ ...m, externalStatus: externalStatuses[m.id] }))
      .sort((a, b) => new Date(a.scheduledFor).getTime() - new Date(b.scheduledFor).getTime())
  }, [baseMessages, selectedChannelId, externalStatuses])

  return {
    periodFilter,
    setPeriodFilter,
    authorFilter,
    setAuthorFilter,
    authors,
    channelsWithMessages,
    selectedChannelId,
    setSelectedChannelId,
    messagesOfChannel,
  }
}

export type MessagesView = ReturnType<typeof useMessagesView>
