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
import { Plus, Info, AlertTriangle } from 'lucide-react'
import { Spinner } from '@/components/ui/spinner'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'

interface WorkspaceDialogProps {
  onSuccess: () => void
  userRole?: string
  /** Заблокированный VOL с уже одним пространством не может добавить ещё */
  disableAddButton?: boolean
}

export function WorkspaceDialog({ onSuccess, userRole = 'USER', disableAddButton = false }: WorkspaceDialogProps) {
  const [open, setOpen] = useState(false)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [formData, setFormData] = useState({
    workspaceName: '',
    workspaceUrl: '',
    username: '',
    password: '',
    has2FA: false,
    startDate: '',
    endDate: ''
  })

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    if (!formData.workspaceName || !formData.workspaceUrl || 
        !formData.username || !formData.password) {
      toast.error('Все поля обязательны для заполнения')
      return
    }

    setIsSubmitting(true)

    try {
      const response = await fetch('/api/workspace', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      })

      const data = await response.json()

      if (!response.ok) {
        throw new Error(data.error || 'Failed to connect workspace')
      }

      setFormData({ 
        workspaceName: '', 
        workspaceUrl: '', 
        username: '', 
        password: '', 
        has2FA: false, 
        startDate: '', 
        endDate: '' 
      })
      setOpen(false)
      toast.success('Пространство успешно подключено!')
      onSuccess()
    } catch (error: any) {
      toast.error(error.message || 'Ошибка при подключении пространства')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !disableAddButton && setOpen(o)}>
      <DialogTrigger asChild>
        <Button size="sm" disabled={disableAddButton}>
          <Plus className="mr-2 h-4 w-4" />
          Добавить пространство
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[540px] rounded-xl border-border/80 shadow-lg">
        <form onSubmit={handleSubmit}>
          <DialogHeader className="border-b border-border/60 pb-4">
            <DialogTitle className="text-lg font-semibold tracking-tight">Добавить пространство</DialogTitle>
            <DialogDescription className="text-sm text-muted-foreground">
              Подключите Rocket.Chat пространство к вашему аккаунту
            </DialogDescription>
          </DialogHeader>

          <Alert className="rounded-lg border-primary/30 bg-primary/5">
            <Info className="h-4 w-4 text-primary" />
            <AlertTitle className="text-sm font-medium">Свои учётные данные</AlertTitle>
            <AlertDescription>
              В пространство нужно подключаться со своими учётными данными. Логин — ваш логин в системе (как в планировщике), пароль — пароль от LDAP.
            </AlertDescription>
          </Alert>

          <Alert className="rounded-lg border-amber-500/40 bg-amber-500/10 dark:bg-amber-500/10 mt-4">
            <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-400" />
            <AlertTitle className="text-sm font-medium text-amber-800 dark:text-amber-200">Тестовые пользователи</AlertTitle>
            <AlertDescription>
              Под тестовыми пользователями можно заходить только с разрешения администратора. Подключение с учётными данными, уже используемыми другим пользователем, запрещено.
            </AlertDescription>
          </Alert>

          <div className="grid gap-4 py-2">
            {/* Workspace Name */}
            <div className="grid gap-2">
              <Label htmlFor="workspaceName">
                Название пространства
              </Label>
              <Input
                id="workspaceName"
                value={formData.workspaceName}
                onChange={(e) => setFormData({ ...formData, workspaceName: e.target.value })}
                placeholder="Мое пространство"
                className="rounded-lg border-border/80"
              />
            </div>

            {/* Workspace URL */}
            <div className="grid gap-2">
              <Label htmlFor="workspaceUrl">
                URL пространства
              </Label>
              <Input
                id="workspaceUrl"
                type="url"
                value={formData.workspaceUrl}
                onChange={(e) => setFormData({ ...formData, workspaceUrl: e.target.value })}
                placeholder={userRole === 'VOL' ? 'https://rocketchat-yar-feb-26.21-school.ru' : 'https://rocketchat.example.com'}
                className="rounded-lg border-border/80"
              />
              {userRole === 'VOL' && (
                <p className="text-xs text-muted-foreground">
                  Для волонтёра разрешено только: https://rocketchat-yar-[месяц]-26.21-school.ru (например, feb, mar)
                </p>
              )}
            </div>

            {/* Username */}
            <div className="grid gap-2">
              <Label htmlFor="username">
                Имя пользователя
              </Label>
              <Input
                id="username"
                value={formData.username}
                onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                placeholder="Ваш логин в Rocket.Chat"
                className="rounded-lg border-border/80"
              />
            </div>

            {/* Password */}
            <div className="grid gap-2">
              <Label htmlFor="password">
                Пароль
              </Label>
              <Input
                id="password"
                type="password"
                value={formData.password}
                onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                placeholder="••••••••"
                className="rounded-lg border-border/80"
              />
              <p className="text-xs text-muted-foreground">
                Пароль будет надёжно зашифрован
              </p>
            </div>

            {/* Date Range */}
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startDate">
                  Дата начала
                </Label>
                <Input
                  id="startDate"
                  type="date"
                  value={formData.startDate}
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="endDate">
                  Дата окончания
                </Label>
                <Input
                  id="endDate"
                  type="date"
                  value={formData.endDate}
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                  min={formData.startDate || undefined}
                />
              </div>
            </div>

            {/* 2FA Checkbox */}
            <div className="flex items-center space-x-2">
              <Checkbox
                id="has2FA"
                checked={formData.has2FA}
                onCheckedChange={(checked) => 
                  setFormData({ ...formData, has2FA: checked as boolean })
                }
              />
              <Label
                htmlFor="has2FA"
                className="text-sm font-normal cursor-pointer leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70"
              >
                Включена 2-факторная аутентификация
              </Label>
            </div>
          </div>

          <DialogFooter className="border-t border-border/60 pt-4">
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
                  <Spinner className="mr-2 h-4 w-4" />
                  Подключение...
                </>
              ) : (
                'Подключить'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}