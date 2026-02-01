"use client"

import { useState, useEffect, useCallback } from 'react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import * as toast from '@/lib/toast'
import { Calendar, Clock, Eye, User } from 'lucide-react'
import { cn } from '@/lib/utils'
import MessagePreview from './message-preview'
import MessageEditor from './message-editor'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'

interface MessageDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workspaceId: string
  channelId: string
  channelName: string
  editingMessage?: any
  onSuccess: () => void
  /** Подстановка из шаблона: текст, время, дата (YYYY-MM-DD) */
  initialMessage?: string
  initialTime?: string
  initialDate?: string
  /** Роль текущего пользователя — для SUP доступно «Отправить от имени» */
  currentUserRole?: string
}

export default function MessageDialog({
  open,
  onOpenChange,
  workspaceId,
  channelId,
  channelName,
  editingMessage,
  onSuccess,
  initialMessage,
  initialTime,
  initialDate,
  currentUserRole = 'USER',
}: MessageDialogProps) {
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [workspace, setWorkspace] = useState<any>(null)
  const [emojis, setEmojis] = useState<any[]>([])
  const [workspaceUrl, setWorkspaceUrl] = useState<string>('')
  const [sendAsUserId, setSendAsUserId] = useState<string>('')
  const [usersForSendAs, setUsersForSendAs] = useState<{ id: string; name: string | null; email: string }[]>([])
  const [formData, setFormData] = useState({
    message: '',
    scheduledFor: '',
    scheduledDate: '',
    scheduledTime: '',
  })

  // SUP/ADM/ADMIN: загрузка списка пользователей для «Отправить от имени» (ADM — только ADM и VOL)
  useEffect(() => {
    if (open && (currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN') && !editingMessage) {
      fetch('/api/admin/users')
        .then((r) => (r.ok ? r.json() : { users: [] }))
        .then((d) => {
          const raw = (d.users || []).map((u: { id: string; name: string | null; email: string; role?: string }) => ({
            id: u.id,
            name: u.name || u.email,
            email: u.email,
            role: u.role,
          }))
          const list = currentUserRole === 'ADM'
            ? raw.filter((u: { role?: string }) => u.role === 'ADM' || u.role === 'VOL')
            : raw
          setUsersForSendAs(list)
        })
        .catch(() => setUsersForSendAs([]))
    } else {
      setUsersForSendAs([])
      setSendAsUserId('')
    }
  }, [open, currentUserRole, editingMessage])

  // Load workspace for username and emojis
  useEffect(() => {
    if (open && workspaceId) {
      // Load workspace
      fetch(`/api/workspace/${workspaceId}`)
        .then(res => res.json())
        .then(data => {
          setWorkspace(data.workspace)
          setWorkspaceUrl(data.workspace?.workspaceUrl || '')
        })
        .catch(console.error)
      
      // Load emojis (с таймаутом, чтобы не блокировать UI)
      const emojiTimeout = setTimeout(() => {
        // Если загрузка слишком долгая, используем пустой массив (стандартные эмодзи будут показаны)
        setEmojis([])
      }, 3000) // 3 секунды таймаут
      
      fetch(`/api/workspace/${workspaceId}/emojis`)
        .then(res => res.json())
        .then(data => {
          clearTimeout(emojiTimeout)
          setEmojis(data.emojis || [])
          if (data.workspaceUrl) {
            setWorkspaceUrl(data.workspaceUrl)
          }
        })
        .catch(() => {
          clearTimeout(emojiTimeout)
          setEmojis([]) // Используем стандартные эмодзи
        })
    }
  }, [open, workspaceId])

  const [draftSavedAt, setDraftSavedAt] = useState(0)

  // Auto-save draft to localStorage
  const saveDraft = useCallback(() => {
    if (formData.message.trim()) {
      const draftKey = `message-draft-${workspaceId}-${channelId}`
      localStorage.setItem(draftKey, JSON.stringify({
        message: formData.message,
        scheduledDate: formData.scheduledDate,
        scheduledTime: formData.scheduledTime,
        timestamp: Date.now()
      }))
      setDraftSavedAt(Date.now())
    }
  }, [formData, workspaceId, channelId])

  useEffect(() => {
    if (!draftSavedAt) return
    const t = setTimeout(() => setDraftSavedAt(0), 2000)
    return () => clearTimeout(t)
  }, [draftSavedAt])

  // Load draft from localStorage
  useEffect(() => {
    if (open && !editingMessage) {
      const draftKey = `message-draft-${workspaceId}-${channelId}`
      const savedDraft = localStorage.getItem(draftKey)
      if (savedDraft) {
        try {
          const draft = JSON.parse(savedDraft)
          // Load draft if it's less than 24 hours old
          if (Date.now() - draft.timestamp < 24 * 60 * 60 * 1000) {
            setFormData(prev => ({
              ...prev,
              message: draft.message || prev.message,
              scheduledDate: draft.scheduledDate || prev.scheduledDate,
              scheduledTime: draft.scheduledTime || prev.scheduledTime,
            }))
          }
        } catch (e) {
          console.error('Failed to load draft:', e)
        }
      }
    }
  }, [open, workspaceId, channelId, editingMessage])

  // Auto-save on message change
  useEffect(() => {
    if (open && formData.message.trim() && !editingMessage) {
      const timeoutId = setTimeout(saveDraft, 1000) // Debounce 1 second
      return () => clearTimeout(timeoutId)
    }
  }, [formData.message, open, editingMessage, saveDraft])

  useEffect(() => {
    if (editingMessage) {
      const scheduledDate = new Date(editingMessage.scheduledFor)
      const dateStr = scheduledDate.toISOString().split('T')[0]
      const timeStr = scheduledDate.toTimeString().slice(0, 5)
      
      setFormData({
        message: editingMessage.message || '',
        scheduledFor: editingMessage.scheduledFor || '',
        scheduledDate: dateStr,
        scheduledTime: timeStr,
      })
    } else if (open && (initialMessage != null || initialTime != null || initialDate != null)) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      const dateStr = initialDate || tomorrow.toISOString().split('T')[0]
      const timeStr = initialTime || '09:00'
      setFormData({
        message: initialMessage || '',
        scheduledFor: '',
        scheduledDate: dateStr,
        scheduledTime: timeStr,
      })
    } else if (open) {
      const tomorrow = new Date()
      tomorrow.setDate(tomorrow.getDate() + 1)
      tomorrow.setHours(9, 0, 0, 0)
      const dateStr = tomorrow.toISOString().split('T')[0]
      const timeStr = '09:00'
      setFormData({
        message: '',
        scheduledFor: '',
        scheduledDate: dateStr,
        scheduledTime: timeStr,
      })
    }
  }, [editingMessage, open, initialMessage, initialTime, initialDate])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.message.trim()) {
      toast.error('Введите текст сообщения', { title: 'Пустое сообщение' })
      return
    }

    // Для отправленных сообщений дата не обязательна
    let scheduledFor = editingMessage?.scheduledFor ? new Date(editingMessage.scheduledFor) : null
    
    if (!editingMessage || editingMessage.status === 'PENDING') {
      if (!formData.scheduledDate || !formData.scheduledTime) {
        toast.error('Выберите дату и время отправки', { title: 'Нет даты' })
        return
      }

      // Combine date and time
      scheduledFor = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`)
      
      if (scheduledFor <= new Date()) {
        toast.error('Время отправки должно быть в будущем', { title: 'Неверное время' })
        return
      }
    }

    setIsSubmitting(true)

    const url = editingMessage
      ? `/api/messages/${editingMessage.id}`
      : '/api/messages'
    const method = editingMessage ? 'PATCH' : 'POST'

    const savePromise = fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        workspaceId,
        channelId,
        channelName,
        message: formData.message,
        ...(scheduledFor && { scheduledFor: scheduledFor.toISOString() }),
        ...((currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN') && !editingMessage && sendAsUserId && { asUserId: sendAsUserId }),
      }),
    })
      .then((res) => res.json().then((data) => ({ ok: res.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) throw new Error(data.error || 'Ошибка при сохранении сообщения')
        return data
      })

    toast.promise(savePromise, {
      loading: 'Сохранение...',
      success: editingMessage ? 'Сообщение обновлено!' : 'Сообщение запланировано!',
      error: (e: Error) => e?.message ?? 'Ошибка при сохранении сообщения',
    })

    savePromise
      .then(() => {
        if (!editingMessage) {
          const draftKey = `message-draft-${workspaceId}-${channelId}`
          localStorage.removeItem(draftKey)
        }
        onOpenChange(false)
        onSuccess()
        if (!editingMessage) {
          const tomorrow = new Date()
          tomorrow.setDate(tomorrow.getDate() + 1)
          tomorrow.setHours(9, 0, 0, 0)
          const dateStr = tomorrow.toISOString().split('T')[0]
          setFormData({
            message: '',
            scheduledFor: '',
            scheduledDate: dateStr,
            scheduledTime: '09:00',
          })
        }
      })
      .finally(() => setIsSubmitting(false))
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !(e.target instanceof HTMLTextAreaElement) && !e.shiftKey) {
      e.preventDefault()
      const form = (e.target as HTMLElement).closest('form')
      if (form) form.requestSubmit()
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[620px] rounded-xl border-border/80 shadow-lg" onKeyDown={handleKeyDown}>
        <form onSubmit={handleSubmit}>
          <DialogHeader className="space-y-1.5 pb-2 border-b border-border/60">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              {editingMessage ? 'Редактировать сообщение' : 'Создать отложенное сообщение'}
            </DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Канал: <span className="font-medium text-foreground">#{channelName}</span>
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-5 py-5">
            <Tabs defaultValue="edit" className="w-full">
              <TabsList className="grid w-full grid-cols-2 h-10 rounded-lg bg-muted/50 p-1">
                <TabsTrigger value="edit" className="rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  Редактор
                </TabsTrigger>
                <TabsTrigger value="preview" className="flex items-center gap-2 rounded-md data-[state=active]:bg-background data-[state=active]:shadow-sm">
                  <Eye className="w-4 h-4" />
                  Предпросмотр
                </TabsTrigger>
              </TabsList>
              
              <TabsContent value="edit" className="space-y-2 mt-4">
                <div className="flex items-center justify-between">
                  <Label htmlFor="message">Текст сообщения</Label>
                  <span className={cn(
                    "text-xs text-muted-foreground",
                    formData.message.length > 4000 && "text-destructive font-medium"
                  )}>
                    {formData.message.length} / 4000 символов
                  </span>
                </div>
                <MessageEditor
                  value={formData.message}
                  onChange={(value) => setFormData({ ...formData, message: value })}
                  placeholder="Введите текст сообщения..."
                  maxLength={4000}
                  emojis={emojis}
                  workspaceId={workspaceId}
                  workspaceUrl={workspaceUrl}
                />
                {draftSavedAt > 0 && (
                  <p className="text-xs text-green-600 dark:text-green-400">Черновик сохранён</p>
                )}
              </TabsContent>
              
              <TabsContent value="preview" className="mt-4">
                {formData.message.trim() ? (
                  <MessagePreview
                    message={formData.message}
                    username={workspace?.username || 'user'}
                    channelName={channelName}
                    workspaceName={workspace?.workspaceName}
                    workspaceId={workspaceId}
                    workspaceUrl={workspaceUrl}
                    emojis={emojis}
                  />
                ) : (
                  <div className="text-center py-8 text-muted-foreground text-sm">
                    Введите текст сообщения для предпросмотра
                  </div>
                )}
              </TabsContent>
            </Tabs>

            {(currentUserRole === 'SUPPORT' || currentUserRole === 'ADM' || currentUserRole === 'ADMIN') && !editingMessage && usersForSendAs.length > 0 && (
              <div className="space-y-2 rounded-lg border border-border/80 bg-muted/30 p-4">
                <Label className="flex items-center gap-2 text-sm font-medium">
                  <User className="w-4 h-4 text-muted-foreground" />
                  Отправить от имени
                </Label>
                <Select value={sendAsUserId || '__me__'} onValueChange={(v) => setSendAsUserId(v === '__me__' ? '' : v)}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Я (текущий пользователь)" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__me__">Я (текущий пользователь)</SelectItem>
                    {usersForSendAs.map((u) => (
                      <SelectItem key={u.id} value={u.id}>
                        {u.name || u.email} {u.email && u.name ? `(${u.email})` : ''}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-amber-600 dark:text-amber-500 font-medium">
                  Используйте «Отправить от имени» только чтобы подстраховать коллегу.
                </p>
                <p className="text-xs text-muted-foreground">
                  Сообщение в списке будет отображаться как созданное выбранным пользователем.
                </p>
                <p className="text-xs text-muted-foreground/90">
                  Чтобы в Rocket.Chat сообщение отправилось от его имени, у пользователя должно быть подключено это же пространство (тот же URL) к своему аккаунту. Иначе сообщение уйдёт от владельца пространства.
                </p>
              </div>
            )}

            {(!editingMessage || editingMessage.status === 'PENDING') && (
              <>
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="scheduledDate">
                      <Calendar className="inline w-4 h-4 mr-1" />
                      Дата отправки
                    </Label>
                    <Input
                      id="scheduledDate"
                      type="date"
                      value={formData.scheduledDate}
                      onChange={(e) => setFormData({ ...formData, scheduledDate: e.target.value })}
                      min={new Date().toISOString().split('T')[0]}
                      required={!editingMessage || editingMessage.status === 'PENDING'}
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="scheduledTime">
                      <Clock className="inline w-4 h-4 mr-1" />
                      Время отправки
                    </Label>
                    <Input
                      id="scheduledTime"
                      type="time"
                      value={formData.scheduledTime}
                      onChange={(e) => setFormData({ ...formData, scheduledTime: e.target.value })}
                      required={!editingMessage || editingMessage.status === 'PENDING'}
                    />
                  </div>
                </div>

                {formData.scheduledDate && formData.scheduledTime && (() => {
                  const scheduled = new Date(`${formData.scheduledDate}T${formData.scheduledTime}`)
                  const isPast = scheduled <= new Date()
                  return (
                    <div className={isPast ? 'rounded-lg border border-destructive/50 bg-destructive/5 px-4 py-3' : 'rounded-lg border border-border/80 bg-muted/30 px-4 py-3'}>
                      {isPast ? (
                        <p className="text-sm text-destructive font-medium">Время в прошлом — выберите будущую дату и время</p>
                      ) : (
                        <p className="text-sm text-muted-foreground">
                          Сообщение будет отправлено:{' '}
                          <span className="font-semibold text-foreground">
                            {scheduled.toLocaleString('ru-RU', {
                              day: 'numeric',
                              month: 'long',
                              year: 'numeric',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </span>
                        </p>
                      )}
                    </div>
                  )
                })()}
              </>
            )}

            {editingMessage && editingMessage.status === 'SENT' && (
              <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/20 px-4 py-3">
                <p className="text-sm text-blue-900 dark:text-blue-200">
                  ⚠️ Это сообщение уже отправлено. Изменения будут применены в Rocket.Chat.
                </p>
              </div>
            )}
          </div>

          <DialogFooter className="gap-2 border-t border-border/60 pt-4">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
              disabled={isSubmitting}
            >
              Отмена
            </Button>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? (
                <>
                  <Spinner className="mr-2 h-4 w-4" />
                  Сохранение...
                </>
              ) : (
                editingMessage ? 'Сохранить изменения' : 'Запланировать'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
