"use client"

import { useState } from 'react'
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Checkbox } from "@/components/ui/checkbox"
import { toast } from 'sonner'
import { Settings, Loader2, Archive, AlertTriangle } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog"

interface WorkspaceEditDialogProps {
  workspace: any
  onSuccess: () => void
}

export function WorkspaceEditDialog({ workspace, onSuccess }: WorkspaceEditDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showArchiveDialog, setShowArchiveDialog] = useState(false)
  const [isArchiving, setIsArchiving] = useState(false)
  const [formData, setFormData] = useState({
    workspaceName: workspace.workspaceName,
    workspaceUrl: workspace.workspaceUrl,
    username: workspace.username,
    password: '',
    has2FA: workspace.has2FA,
    startDate: workspace.startDate ? new Date(workspace.startDate).toISOString().split('T')[0] : '',
    endDate: workspace.endDate ? new Date(workspace.endDate).toISOString().split('T')[0] : ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.workspaceName || !formData.workspaceUrl || !formData.username) {
      toast.error('Заполните все обязательные поля')
      return
    }

    setIsSubmitting(true)

    try {
      const updateData: any = {
        workspaceName: formData.workspaceName,
        workspaceUrl: formData.workspaceUrl,
        username: formData.username,
        has2FA: formData.has2FA,
      }

      // Если пароль введен, включаем его в обновление
      if (formData.password) {
        updateData.password = formData.password
      }

      // Добавляем даты интенсива
      if (formData.startDate) {
        updateData.startDate = formData.startDate
      }
      if (formData.endDate) {
        updateData.endDate = formData.endDate
      }

      const response = await fetch(`/api/workspace/${workspace.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(updateData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to update workspace')
      }

      setOpen(false)
      toast.success('Пространство обновлено!')
      onSuccess()
    } catch (error: any) {
      toast.error(error.message || 'Ошибка обновления')
    } finally {
      setIsSubmitting(false)
    }
  }

  const handleArchive = async () => {
    setIsArchiving(true)
    try {
      const response = await fetch(`/api/workspace/${workspace.id}/archive`, {
        method: 'POST',
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to archive workspace')
      }

      setShowArchiveDialog(false)
      setOpen(false)
      toast.success('Пространство заархивировано', {
        description: 'Оно будет удалено через 2 недели. Вы можете восстановить его в разделе Архивы.'
      })
      onSuccess()
    } catch (error: any) {
      toast.error(error.message || 'Ошибка архивирования')
    } finally {
      setIsArchiving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <Settings className="mr-2 h-4 w-4" />
          Настройки
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Настройки пространства</DialogTitle>
            <DialogDescription>
              Обновите параметры подключения
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="workspaceName">Название</Label>
              <Input
                id="workspaceName"
                value={formData.workspaceName}
                onChange={(e) => setFormData({ ...formData, workspaceName: e.target.value })}
                placeholder="Мое пространство"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="workspaceUrl">URL</Label>
              <Input
                id="workspaceUrl"
                type="url"
                value={formData.workspaceUrl}
                onChange={(e) => setFormData({ ...formData, workspaceUrl: e.target.value })}
                placeholder="https://rocketchat.example.com"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="username">Имя пользователя</Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="username"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="password">Новый пароль (оставьте пустым, если не меняется)</Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
              />
              <p className="text-xs text-muted-foreground">
                Введите только если хотите изменить пароль
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="startDate">Дата начала интенсива</Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="endDate">Дата окончания интенсива</Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  min={formData.startDate || undefined}
                />
              </div>
            </div>

            <div className="flex items-center space-x-2">
              <Checkbox
                id="has2FA"
                checked={formData.has2FA}
                onCheckedChange={(checked) => setFormData({ ...formData, has2FA: checked as boolean })}
              />
              <Label htmlFor="has2FA" className="text-sm font-normal cursor-pointer">
                2-факторная аутентификация
              </Label>
            </div>
          </div>

          <DialogFooter className="flex-col sm:flex-row gap-2">
            {!workspace.isArchived && (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setShowArchiveDialog(true)}
                disabled={isSubmitting}
                className="w-full sm:w-auto"
              >
                <Archive className="mr-2 h-4 w-4" />
                Архивировать
              </Button>
            )}
            <div className="flex gap-2 ml-auto">
              <Button
                type="button"
                variant="outline"
                onClick={() => setOpen(false)}
                disabled={isSubmitting}
              >
                Отмена
              </Button>
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Сохранение...
                  </>
                ) : (
                  'Сохранить'
                )}
              </Button>
            </div>
          </DialogFooter>
        </form>
      </DialogContent>

      <AlertDialog open={showArchiveDialog} onOpenChange={setShowArchiveDialog}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-destructive" />
              Архивировать пространство?
            </AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="text-sm text-muted-foreground space-y-2">
                <p>
                  Вы собираетесь заархивировать пространство <strong>{workspace.workspaceName}</strong>.
                </p>
                <div className="bg-destructive/10 border border-destructive/20 rounded-md p-3 mt-3">
                  <p className="text-sm font-semibold text-destructive mb-1">⚠️ Важно:</p>
                  <ul className="text-sm space-y-1 list-disc list-inside text-destructive/90">
                    <li>Все запланированные сообщения будут отменены</li>
                    <li>Пространство будет недоступно для использования</li>
                    <li>Через 2 недели все данные будут <strong>безвозвратно удалены</strong></li>
                    <li>История сообщений и каналов будет недоступна после удаления</li>
                  </ul>
                </div>
                <p className="text-sm mt-3">
                  В течение 2 недель вы сможете восстановить пространство из раздела Архивы.
                </p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isArchiving}>Отмена</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleArchive}
              disabled={isArchiving}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isArchiving ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Архивирование...
                </>
              ) : (
                <>
                  <Archive className="mr-2 h-4 w-4" />
                  Архивировать
                </>
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  )
}
