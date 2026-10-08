"use client"

import { Search, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

interface MessageFiltersProps {
  statusFilter: string
  workspaceFilter: string
  searchQuery: string
  workspaces: any[]
  onStatusChange: (status: string) => void
  onWorkspaceChange: (workspaceId: string) => void
  onSearchChange: (query: string) => void
}

export default function MessageFilters({
  statusFilter,
  workspaceFilter,
  searchQuery,
  workspaces,
  onStatusChange,
  onWorkspaceChange,
  onSearchChange,
}: MessageFiltersProps) {
  const hasActiveFilters = Boolean(
    (statusFilter && statusFilter !== 'all') ||
    (workspaceFilter && workspaceFilter !== 'all') ||
    searchQuery
  )

  const clearAllFilters = () => {
    onStatusChange('all')
    onWorkspaceChange('all')
    onSearchChange('')
  }

  return (
    <div className="space-y-3 rounded-lg border bg-card p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold">Фильтры</h3>
        {hasActiveFilters && (
          <Button variant="ghost" size="sm" onClick={clearAllFilters} className="text-muted-foreground">
            <X /> Сбросить
          </Button>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <Field label="Поиск" htmlFor="message-filter-search">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              id="message-filter-search"
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Искать в сообщениях…"
              className="pl-8 pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Очистить поиск"
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/40"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
        </Field>

        <Field label="Статус">
          <Select value={statusFilter || 'all'} onValueChange={onStatusChange}>
            <SelectTrigger className="w-full" aria-label="Статус">
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="PENDING">Ожидает</SelectItem>
              <SelectItem value="SENT">Отправлено</SelectItem>
              <SelectItem value="FAILED">Ошибка</SelectItem>
              <SelectItem value="CANCELLED">Отменено</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <Field label="Пространство">
          <Select value={workspaceFilter || 'all'} onValueChange={onWorkspaceChange}>
            <SelectTrigger className="w-full" aria-label="Пространство">
              <SelectValue placeholder="Все пространства" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все пространства</SelectItem>
              {workspaces.map((ws) => (
                <SelectItem key={ws.id} value={ws.id}>
                  {ws.workspaceName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </div>
    </div>
  )
}
