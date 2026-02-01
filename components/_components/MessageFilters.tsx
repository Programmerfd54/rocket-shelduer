"use client"

import { Search, Filter, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  const hasActiveFilters = statusFilter || workspaceFilter || searchQuery

  const clearAllFilters = () => {
    onStatusChange('all')
    onWorkspaceChange('all')
    onSearchChange('')
  }

  return (
    <div className="bg-card p-5 rounded-xl border border-border/80 shadow-sm">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <Filter className="w-5 h-5 text-primary" />
          <h3 className="font-semibold text-card-foreground">Фильтры</h3>
        </div>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            onClick={clearAllFilters}
            className="h-8 text-xs hover:bg-destructive/10 hover:text-destructive"
          >
            <X className="w-3 h-3 mr-1" />
            Сбросить
          </Button>
        )}
      </div>
      
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Поиск */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted-foreground">
            Поиск
          </label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder="Искать в сообщениях..."
              className="w-full pl-10 pr-3 py-2.5 border rounded-lg bg-background text-foreground placeholder:text-muted-foreground focus:ring-2 focus:ring-primary focus:border-primary transition-all cursor-text"
            />
            {searchQuery && (
              <button
                onClick={() => onSearchChange('')}
                className="absolute right-3 top-1/2 transform -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="w-4 h-4" />
              </button>
            )}
          </div>
        </div>

        {/* Фильтр по статусу */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted-foreground">
            Статус
          </label>
          <Select value={statusFilter || 'all'} onValueChange={onStatusChange}>
            <SelectTrigger>
              <SelectValue placeholder="Все статусы" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все статусы</SelectItem>
              <SelectItem value="PENDING">⏳ Ожидает</SelectItem>
              <SelectItem value="SENT">✓ Отправлено</SelectItem>
              <SelectItem value="FAILED">✗ Ошибка</SelectItem>
              <SelectItem value="CANCELLED">⊘ Отменено</SelectItem>
            </SelectContent>
          </Select>
        </div>

        {/* Фильтр по пространству */}
        <div className="space-y-2">
          <label className="block text-sm font-medium text-muted-foreground">
            Пространство
          </label>
          <Select value={workspaceFilter || 'all'} onValueChange={onWorkspaceChange}>
            <SelectTrigger>
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
        </div>
      </div>
    </div>
  )
}