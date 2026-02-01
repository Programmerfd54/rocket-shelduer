"use client"

import { Card, CardContent } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Clock, Edit2, Trash2, MessageSquare, AlertCircle } from 'lucide-react'
import { formatDate } from '@/lib/utils'

interface Message {
  id: string
  workspaceId: string
  channelName: string
  message: string
  scheduledFor: Date | string
  status: 'PENDING' | 'SENT' | 'FAILED' | 'CANCELLED'
  sentAt?: Date | null
  error?: string | null
  workspace: {
    workspaceName: string
  }
}

interface MessageSchedulerProps {
  messages: Message[]
  onEdit: (message: Message) => void
  onDelete: (messageId: string) => void
}

export default function MessageScheduler({ messages, onEdit, onDelete }: MessageSchedulerProps) {
  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'PENDING':
        return (
          <Badge variant="secondary" className="bg-yellow-50 text-yellow-700 border-yellow-200 hover:bg-yellow-50">
            <Clock className="w-3 h-3 mr-1" />
            Ожидает
          </Badge>
        )
      case 'SENT':
        return (
          <Badge className="bg-green-500 hover:bg-green-600">
            <svg className="w-3 h-3 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            Отправлено
          </Badge>
        )
      case 'FAILED':
        return (
          <Badge variant="destructive">
            <AlertCircle className="w-3 h-3 mr-1" />
            Ошибка
          </Badge>
        )
      case 'CANCELLED':
        return (
          <Badge variant="outline" className="text-muted-foreground">
            Отменено
          </Badge>
        )
      default:
        return <Badge>{status}</Badge>
    }
  }

  if (messages.length === 0) {
    return (
      <Card className="rounded-xl border-border/80 border-dashed bg-muted/20">
        <CardContent className="flex flex-col items-center justify-center py-16">
          <div className="w-16 h-16 bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl flex items-center justify-center mb-4 shadow-sm">
            <MessageSquare className="w-8 h-8 text-primary" />
          </div>
          <h3 className="text-lg font-semibold mb-2">Нет запланированных сообщений</h3>
          <p className="text-sm text-muted-foreground text-center max-w-sm">
            Добавьте пространство и запланируйте первое сообщение
          </p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-3">
      {messages.map((message) => (
        <Card 
          key={message.id} 
          className="group rounded-xl border-border/80 shadow-sm hover:shadow-md transition-all duration-200"
        >
          <CardContent className="p-5">
            <div className="space-y-4">
              {/* Header */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-2 flex-wrap">
                    <div className="flex items-center gap-2">
                      <div className="w-6 h-6 bg-gradient-to-br from-red-500 to-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
                        <span className="text-xs text-white font-semibold">
                          {message.workspace.workspaceName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className="font-semibold text-sm">
                        {message.workspace.workspaceName}
                      </span>
                    </div>
                    <span className="text-muted-foreground">→</span>
                    <div className="flex items-center gap-1.5 text-sm">
                      <span className="text-muted-foreground">#</span>
                      <span className="font-medium">{message.channelName}</span>
                    </div>
                  </div>
                  
                  <div className="flex items-center gap-3 text-sm text-muted-foreground flex-wrap">
                    <span className="flex items-center gap-1.5">
                      <Clock className="w-3.5 h-3.5" />
                      {formatDate(message.scheduledFor)}
                    </span>
                    {getStatusBadge(message.status)}
                  </div>
                </div>
                
                <div className="flex items-center gap-1 flex-shrink-0">
                  {message.status === 'PENDING' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onEdit(message)}
                      className="h-8 w-8 p-0 hover:bg-primary/10 hover:text-primary"
                      title="Редактировать"
                    >
                      <Edit2 className="w-4 h-4" />
                    </Button>
                  )}
                  {message.status !== 'SENT' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDelete(message.id)}
                      className="h-8 w-8 p-0 hover:bg-destructive/10 hover:text-destructive"
                      title="Удалить"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  )}
                </div>
              </div>
              
              {/* Message Content */}
              <div className="bg-muted/30 rounded-xl p-4 border border-border/60">
                <p className="text-sm whitespace-pre-wrap leading-relaxed">
                  {message.message}
                </p>
              </div>

              {/* Error Message */}
              {message.error && (
                <div className="flex items-start gap-2 p-3 bg-destructive/10 border border-destructive/20 rounded-lg">
                  <AlertCircle className="w-4 h-4 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-destructive mb-1">Ошибка отправки</p>
                    <p className="text-xs text-destructive/80">{message.error}</p>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  )
}