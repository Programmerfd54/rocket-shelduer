"use client"

import { useState } from 'react'
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Edit, Trash2, Archive, AlertTriangle } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { toast } from 'sonner'

interface WorkspaceEditDialogProps {
  workspace: any
  onSuccess?: () => void
  trigger?: React.ReactNode
}

export function WorkspaceEditDialog({ workspace, onSuccess, trigger }: WorkspaceEditDialogProps) {
  const [open, setOpen] = useState(false)
  const [loading, setLoading] = useState(false)
  const [showArchiveConfirm, setShowArchiveConfirm] = useState(false)
  
  // Form state
  const [workspaceName, setWorkspaceName] = useState(workspace.workspaceName)
  const [workspaceUrl, setWorkspaceUrl] = useState(workspace.workspaceUrl)
  const [username, setUsername] = useState(workspace.username)
  const [password, setPassword] = useState('')
  const [has2FA, setHas2FA] = useState(workspace.has2FA)
  const [startDate, setStartDate] = useState(
    workspace.startDate ? new Date(workspace.startDate).toISOString().split('T')[0] : ''
  )
  const [endDate, setEndDate] = useState(
    workspace.endDate ? new Date(workspace.endDate).toISOString().split('T')[0] : ''
  )
  const [color, setColor] = useState(workspace.color || '#ef4444')

  const handleSave = async () => {
    setLoading(true)
    
    try {
      const updateData: any = {
        workspaceName,
        workspaceUrl,
        username,
        has2FA,
        startDate: startDate || null,
        endDate: endDate || null,
        color,
      }
      
      // Только если пароль введён
      if (password) {
        updateData.password = password
      }

      const response = await fetch(`/api/workspace/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to update workspace')
      }

      toast.success('Пространство обновлено', {
        description: 'Изменения успешно сохранены'
      })
      
      setOpen(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error('Ошибка обновления', {
        description: error.message
      })
    } finally {
      setLoading(false)
    }
  }

  const handleArchive = async () => {
    setLoading(true)
    
    try {
      const response = await fetch(`/api/workspace/${workspace.id}/archive`, {
        method: 'POST',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to archive')
      }

      toast.success('Пространство архивировано', {
        description: 'Данные будут доступны 2 недели, затем удалятся'
      })
      
      setOpen(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error('Ошибка архивации', {
        description: error.message
      })
    } finally {
      setLoading(false)
      setShowArchiveConfirm(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Удалить пространство? Все сообщения и данные будут удалены!')) {
      return
    }

    setLoading(true)
    
    try {
      const response = await fetch(`/api/workspace/${workspace.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error('Failed to delete')
      }

      toast.success('Пространство удалено')
      setOpen(false)
      onSuccess?.()
    } catch (error: any) {
      toast.error('Ошибка удаления', {
        description: error.message
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <Button variant="outline" size="sm">
            <Edit className="w-4 h-4 mr-2" />
            Редактировать
          </Button>
        )}
      </DialogTrigger>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border-border/80 shadow-lg">
        <DialogHeader className="border-b border-border/60 pb-4">
          <DialogTitle className="text-lg font-semibold tracking-tight">Редактирование пространства</DialogTitle>
          <DialogDescription className="text-sm text-muted-foreground">
            Изменение настроек и данных интенсива
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue="general" className="w-full pt-4">
          <TabsList className="grid w-full grid-cols-3 h-10 rounded-lg bg-muted/50 p-1">
            <TabsTrigger value="general">Основное</TabsTrigger>
            <TabsTrigger value="dates">Даты</TabsTrigger>
            <TabsTrigger value="danger">Опасная зона</TabsTrigger>
          </TabsList>

          {/* General Tab */}
          <TabsContent value="general" className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Название интенсива</Label>
              <Input
                id="name"
                value={workspaceName}
                onChange={(e) => setWorkspaceName(e.target.value)}
                placeholder="Мой интенсив"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="url">URL пространства</Label>
              <Input
                id="url"
                value={workspaceUrl}
                onChange={(e) => setWorkspaceUrl(e.target.value)}
                placeholder="https://myworkspace.rocket.chat"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Имя пользователя</Label>
              <Input
                id="username"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                placeholder="admin"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Новый пароль (опционально)</Label>
              <Input
                id="password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Оставьте пустым, если не меняете"
              />
              <p className="text-xs text-muted-foreground">
                Введите только если хотите изменить пароль
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="color">Цвет пространства</Label>
              <div className="flex gap-2">
                <Input
                  id="color"
                  type="color"
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  className="w-20 h-10"
                />
                <Input
                  value={color}
                  onChange={(e) => setColor(e.target.value)}
                  placeholder="#ef4444"
                  className="flex-1"
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="2fa"
                checked={has2FA}
                onCheckedChange={(checked) => setHas2FA(checked as boolean)}
              />
              <Label htmlFor="2fa" className="cursor-pointer">
                Включена двухфакторная аутентификация (2FA)
              </Label>
            </div>
          </TabsContent>

          {/* Dates Tab */}
          <TabsContent value="dates" className="space-y-4 pt-4">
            <div className="bg-muted/50 rounded-lg p-4 mb-4">
              <p className="text-sm text-muted-foreground">
                Укажите даты начала и окончания интенсива. Система будет уведомлять за 7 дней до окончания.
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate">Дата начала интенсива</Label>
              <Input
                id="startDate"
                type="date"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate">Дата окончания интенсива</Label>
              <Input
                id="endDate"
                type="date"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                min={startDate || undefined}
              />
            </div>

            {startDate && endDate && (
              <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg p-4 border border-blue-200 dark:border-blue-800">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-200">
                  Длительность: {Math.ceil((new Date(endDate).getTime() - new Date(startDate).getTime()) / (1000 * 60 * 60 * 24))} дней
                </p>
              </div>
            )}
          </TabsContent>

          {/* Danger Zone Tab */}
          <TabsContent value="danger" className="space-y-4 pt-4">
            <div className="space-y-4">
              {/* Archive */}
              {!workspace.isArchived && (
                <div className="border border-yellow-200 dark:border-yellow-800 rounded-lg p-4 bg-yellow-50 dark:bg-yellow-950/20">
                  <div className="flex items-start gap-3">
                    <Archive className="w-5 h-5 text-yellow-600 dark:text-yellow-400 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                      <h3 className="font-semibold text-yellow-900 dark:text-yellow-200 mb-1">
                        Архивировать пространство
                      </h3>
                      <p className="text-sm text-yellow-800 dark:text-yellow-300 mb-3">
                        После архивации:
                      </p>
                      <ul className="text-sm text-yellow-800 dark:text-yellow-300 space-y-1 mb-4 ml-4 list-disc">
                        <li>Данные будут доступны только для чтения 2 недели</li>
                        <li>Новые сообщения создавать нельзя</li>
                        <li>Через 2 недели все данные будут удалены</li>
                        <li>История сообщений будет недоступна</li>
                      </ul>
                      {!showArchiveConfirm ? (
                        <Button
                          variant="outline"
                          onClick={() => setShowArchiveConfirm(true)}
                          className="border-yellow-300 dark:border-yellow-700"
                        >
                          <Archive className="w-4 h-4 mr-2" />
                          Архивировать
                        </Button>
                      ) : (
                        <div className="space-y-2">
                          <p className="text-sm font-medium text-yellow-900 dark:text-yellow-200">
                            Подтвердите архивацию:
                          </p>
                          <div className="flex gap-2">
                            <Button
                              variant="default"
                              size="sm"
                              onClick={handleArchive}
                              disabled={loading}
                              className="bg-yellow-600 hover:bg-yellow-700"
                            >
                              {loading && <Spinner className="w-4 h-4 mr-2" />}
                              Да, архивировать
                            </Button>
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => setShowArchiveConfirm(false)}
                            >
                              Отмена
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              {/* Delete */}
              <div className="border border-destructive rounded-lg p-4 bg-destructive/5">
                <div className="flex items-start gap-3">
                  <AlertTriangle className="w-5 h-5 text-destructive flex-shrink-0 mt-0.5" />
                  <div className="flex-1">
                    <h3 className="font-semibold text-destructive mb-1">
                      Удалить пространство
                    </h3>
                    <p className="text-sm text-muted-foreground mb-3">
                      Это действие необратимо. Все сообщения, каналы и история будут удалены навсегда.
                    </p>
                    <Button
                      variant="destructive"
                      onClick={handleDelete}
                      disabled={loading}
                    >
                      {loading && <Spinner className="w-4 h-4 mr-2" />}
                      <Trash2 className="w-4 h-4 mr-2" />
                      Удалить навсегда
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Отмена
          </Button>
          <Button onClick={handleSave} disabled={loading}>
            {loading && <Spinner className="w-4 h-4 mr-2" />}
            Сохранить изменения
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}