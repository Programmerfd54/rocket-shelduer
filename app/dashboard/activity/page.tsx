"use client"

import { useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  History,
  User,
  Server,
  MessageSquare,
  Settings,
  Shield,
  LogIn,
  LogOut,
  Plus,
  Edit,
  Trash2,
  Send,
  XCircle,
  RefreshCw,
  Filter
} from 'lucide-react'
import { toast } from 'sonner'
import { formatRelativeTime } from '@/lib/utils'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'

const activityIcons: Record<string, any> = {
  USER_LOGIN: LogIn,
  USER_LOGOUT: LogOut,
  USER_REGISTER: User,
  WORKSPACE_CREATED: Plus,
  WORKSPACE_UPDATED: Edit,
  WORKSPACE_DELETED: Trash2,
  WORKSPACE_CONNECTED: Server,
  MESSAGE_CREATED: Plus,
  MESSAGE_UPDATED: Edit,
  MESSAGE_DELETED: Trash2,
  MESSAGE_SENT: Send,
  MESSAGE_FAILED: XCircle,
  SETTINGS_UPDATED: Settings,
  PASSWORD_CHANGED: Shield,
  ADMIN_ACTION: Shield,
}

const activityColors: Record<string, string> = {
  USER_LOGIN: 'bg-blue-500/10 text-blue-500',
  USER_LOGOUT: 'bg-gray-500/10 text-gray-500',
  USER_REGISTER: 'bg-green-500/10 text-green-500',
  WORKSPACE_CREATED: 'bg-purple-500/10 text-purple-500',
  WORKSPACE_UPDATED: 'bg-yellow-500/10 text-yellow-500',
  WORKSPACE_DELETED: 'bg-red-500/10 text-red-500',
  WORKSPACE_CONNECTED: 'bg-blue-500/10 text-blue-500',
  MESSAGE_CREATED: 'bg-green-500/10 text-green-500',
  MESSAGE_UPDATED: 'bg-yellow-500/10 text-yellow-500',
  MESSAGE_DELETED: 'bg-red-500/10 text-red-500',
  MESSAGE_SENT: 'bg-green-500/10 text-green-500',
  MESSAGE_FAILED: 'bg-red-500/10 text-red-500',
  SETTINGS_UPDATED: 'bg-blue-500/10 text-blue-500',
  PASSWORD_CHANGED: 'bg-purple-500/10 text-purple-500',
  ADMIN_ACTION: 'bg-red-500/10 text-red-500',
}

const activityLabels: Record<string, string> = {
  USER_LOGIN: 'Вход в систему',
  USER_LOGOUT: 'Выход из системы',
  USER_REGISTER: 'Регистрация',
  WORKSPACE_CREATED: 'Создано пространство',
  WORKSPACE_UPDATED: 'Обновлено пространство',
  WORKSPACE_DELETED: 'Удалено пространство',
  WORKSPACE_CONNECTED: 'Подключение к пространству',
  MESSAGE_CREATED: 'Создано сообщение',
  MESSAGE_UPDATED: 'Обновлено сообщение',
  MESSAGE_DELETED: 'Удалено сообщение',
  MESSAGE_SENT: 'Отправлено сообщение',
  MESSAGE_FAILED: 'Ошибка отправки',
  SETTINGS_UPDATED: 'Обновлены настройки',
  PASSWORD_CHANGED: 'Изменён пароль',
  ADMIN_ACTION: 'Действие администратора',
}

export default function ActivityPage() {
  const [logs, setLogs] = useState([])
  const [loading, setLoading] = useState(true)
  const [filterAction, setFilterAction] = useState('all')
  const [scope, setScope] = useState<'me' | 'vol' | 'all'>('me')
  const [userRole, setUserRole] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/auth/me')
      .then((r) => (r.ok ? r.json() : {}))
      .then((d: { user?: { role?: string } }) => setUserRole(d?.user?.role ?? null))
  }, [])

  useEffect(() => {
    loadLogs()
  }, [filterAction, scope, userRole])

  const loadLogs = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams()
      if (filterAction && filterAction !== 'all') params.set('action', filterAction)
      if (scope === 'vol' && userRole === 'SUPPORT') params.set('scope', 'vol')
      if (scope === 'all' && userRole === 'ADMIN') params.set('scope', 'all')
      const url = `/api/activity${params.toString() ? `?${params}` : ''}`
      const response = await fetch(url)
      if (response.ok) {
        const data = await response.json()
        setLogs(data.logs)
      }
    } catch (error) {
      toast.error('Ошибка загрузки логов')
    } finally {
      setLoading(false)
    }
  }

  const groupLogsByDate = (logs: any[]) => {
    const grouped: Record<string, any[]> = {}
    
    logs.forEach(log => {
      const date = new Date(log.createdAt).toLocaleDateString('ru-RU', {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
      
      if (!grouped[date]) {
        grouped[date] = []
      }
      grouped[date].push(log)
    })
    
    return grouped
  }

  const groupedLogs = groupLogsByDate(logs)

  return (
    <div className="p-6 space-y-6">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'История действий', current: true },
        ]}
        className="mb-2"
      />
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">История действий</h1>
          <p className="text-muted-foreground mt-1">
            Все события и активность в системе
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(userRole === 'SUPPORT' || userRole === 'ADMIN') && (
            <Select value={scope} onValueChange={(v: 'me' | 'vol' | 'all') => setScope(v)}>
              <SelectTrigger className="w-[180px]">
                <User className="w-4 h-4 mr-2" />
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="me">Моя активность</SelectItem>
                {userRole === 'SUPPORT' && <SelectItem value="vol">Волонтёры (VOL)</SelectItem>}
                {userRole === 'ADMIN' && <SelectItem value="all">Вся активность</SelectItem>}
              </SelectContent>
            </Select>
          )}
          <Select value={filterAction} onValueChange={setFilterAction}>
            <SelectTrigger className="w-[200px]">
              <Filter className="w-4 h-4 mr-2" />
              <SelectValue placeholder="Все действия" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Все действия</SelectItem>
              <SelectItem value="USER_LOGIN">Входы</SelectItem>
              <SelectItem value="WORKSPACE_CREATED">Создание пространств</SelectItem>
              <SelectItem value="MESSAGE_CREATED">Создание сообщений</SelectItem>
              <SelectItem value="MESSAGE_SENT">Отправка сообщений</SelectItem>
              <SelectItem value="MESSAGE_FAILED">Ошибки</SelectItem>
            </SelectContent>
          </Select>
          <Button variant="outline" onClick={loadLogs}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                <History className="w-5 h-5 text-blue-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">{logs.length}</p>
                <p className="text-xs text-muted-foreground">Всего событий</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-green-500/10 rounded-lg flex items-center justify-center">
                <MessageSquare className="w-5 h-5 text-green-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {logs.filter((l: any) => l.action.startsWith('MESSAGE_')).length}
                </p>
                <p className="text-xs text-muted-foreground">Сообщения</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-purple-500/10 rounded-lg flex items-center justify-center">
                <Server className="w-5 h-5 text-purple-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {logs.filter((l: any) => l.action.startsWith('WORKSPACE_')).length}
                </p>
                <p className="text-xs text-muted-foreground">Пространства</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 bg-red-500/10 rounded-lg flex items-center justify-center">
                <XCircle className="w-5 h-5 text-red-500" />
              </div>
              <div>
                <p className="text-2xl font-bold">
                  {logs.filter((l: any) => l.action === 'MESSAGE_FAILED').length}
                </p>
                <p className="text-xs text-muted-foreground">Ошибки</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Activity Log */}
      <Card className="border-muted">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <History className="w-5 h-5 text-primary" />
            Лог событий
          </CardTitle>
        </CardHeader>
        <CardContent>
          {logs.length === 0 ? (
            <div className="text-center py-16">
              <History className="w-12 h-12 text-muted-foreground mx-auto mb-3" />
              <p className="text-muted-foreground">
                {filterAction && filterAction !== 'all' ? 'Нет событий с выбранным фильтром' : 'Нет событий'}
              </p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedLogs).map(([date, dateLogs]) => (
                <div key={date}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-4 uppercase">
                    {date}
                  </h3>
                  <div className="space-y-4">
                    {dateLogs.map((log: any) => {
                      const Icon = activityIcons[log.action] || History
                      const colorClass = activityColors[log.action] || 'bg-gray-500/10 text-gray-500'
                      
                      let details = null
                      try {
                        details = log.details ? JSON.parse(log.details) : null
                      } catch {
                        details = { message: log.details }
                      }
                      
                      return (
                        <div
                          key={log.id}
                          className="flex items-start gap-4 p-4 border rounded-lg hover:bg-muted/50 transition-colors"
                        >
                          <div className={`w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0 ${colorClass}`}>
                            <Icon className="w-5 h-5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex-1">
                                <p className="font-medium">
                                  {activityLabels[log.action] || log.action}
                                </p>
                                {log.user && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {log.user.name || log.user.email}
                                    {log.user.role && (
                                      <Badge variant="outline" className="ml-2 text-[10px] font-normal">
                                        {log.user.role}
                                      </Badge>
                                    )}
                                  </p>
                                )}
                                {details && details.message && (
                                  <p className="text-sm text-muted-foreground mt-1">
                                    {details.message}
                                  </p>
                                )}
                              </div>
                              <span className="text-xs text-muted-foreground whitespace-nowrap">
                                {formatRelativeTime(log.createdAt)}
                              </span>
                            </div>
                            {log.entityType && (
                              <div className="flex items-center gap-2 mt-2">
                                <Badge variant="secondary" className="text-xs">
                                  {log.entityType}
                                </Badge>
                                {log.ipAddress && log.ipAddress !== 'unknown' && (
                                  <span className="text-xs text-muted-foreground font-mono">
                                    {log.ipAddress}
                                  </span>
                                )}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}