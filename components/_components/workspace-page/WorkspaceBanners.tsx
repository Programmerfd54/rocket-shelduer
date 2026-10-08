"use client"

import { useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, Archive, Clock, RefreshCw, RotateCcw, Users, XCircle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Spinner } from '@/components/ui/spinner'
import { Notice } from './Notice'

function pluralDays(n: number) {
  const abs = Math.abs(n)
  const mod10 = abs % 10
  const mod100 = abs % 100
  if (mod10 === 1 && mod100 !== 11) return 'день'
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return 'дня'
  return 'дней'
}

/** Ошибки загрузки, статус архива/подключения, окончание интенсива, назначение. */
export function WorkspaceBanners({
  workspace,
  loadError,
  loading,
  isVolMember,
  unarchiveLoading,
  checkingConnection,
  leaveAssignmentLoading,
  onRetryLoad,
  onUnarchive,
  onCheckConnection,
  onArchiveRequest,
  onLeaveAssignmentRequest,
}: {
  workspace: any | null
  loadError: { message: string; isNetworkError?: boolean } | null
  loading: boolean
  isVolMember: boolean
  unarchiveLoading: boolean
  checkingConnection: boolean
  leaveAssignmentLoading: boolean
  onRetryLoad: () => void
  onUnarchive: () => void
  onCheckConnection: () => void
  onArchiveRequest: () => void
  onLeaveAssignmentRequest: () => void
}) {
  const [now] = useState(() => Date.now())
  const endDate = workspace?.endDate ? new Date(workspace.endDate) : null
  const daysUntilEnd = endDate ? Math.ceil((endDate.getTime() - now) / (1000 * 60 * 60 * 24)) : 0
  const isEnded = !!endDate && endDate.getTime() < now
  const isEndingSoon = !!endDate && daysUntilEnd > 0 && daysUntilEnd <= 7

  return (
    <div className="space-y-3 empty:hidden">
      {loadError && (
        <Notice
          tone="danger"
          icon={<AlertTriangle />}
          title={loadError.isNetworkError ? 'Нет подключения к серверу' : 'Не удалось загрузить пространство'}
          action={
            <Button variant="outline" size="sm" onClick={onRetryLoad} disabled={loading}>
              {loading ? <Spinner /> : <RefreshCw />}
              Повторить
            </Button>
          }
        >
          {loadError.message}
        </Notice>
      )}

      {loadError && !workspace && (
        <p className="text-sm">
          <Link href="/dashboard/workspaces" className="text-primary hover:underline">
            ← К списку пространств
          </Link>
        </p>
      )}

      {workspace?.isArchived && (
        <Notice
          tone="warning"
          icon={<Archive />}
          title="Пространство в архиве"
          action={
            <Button variant="outline" size="sm" onClick={onUnarchive} disabled={unarchiveLoading}>
              {unarchiveLoading ? <Spinner /> : <RotateCcw />}
              Вернуть из архива
            </Button>
          }
        >
          Работа с каналами и сообщениями недоступна, пока пространство в архиве. Верните его, чтобы продолжить.
        </Notice>
      )}

      {workspace && !workspace.isArchived && !workspace.isActive && (
        <Notice
          tone="warning"
          icon={<AlertTriangle />}
          title="Подключение к Rocket.Chat неактивно"
          action={
            <Button variant="outline" size="sm" onClick={onCheckConnection} disabled={checkingConnection}>
              {checkingConnection ? <Spinner /> : <RefreshCw />}
              Проверить подключение
            </Button>
          }
        >
          Проверьте подключение, чтобы подтянулись каналы и сообщения.
        </Notice>
      )}

      {workspace && endDate && isEnded && !workspace.isArchived && (
        <Notice
          tone="danger"
          icon={<XCircle />}
          title="Интенсив завершён"
          action={
            !isVolMember ? (
              <Button variant="outline" size="sm" onClick={onArchiveRequest}>
                <Archive />
                Архивировать
              </Button>
            ) : undefined
          }
        >
          Он закончился {Math.abs(daysUntilEnd)} {pluralDays(daysUntilEnd)} назад.
          {!isVolMember && ' Рекомендуем заархивировать пространство.'}
        </Notice>
      )}

      {workspace && endDate && isEndingSoon && !workspace.isArchived && (
        <Notice tone="warning" icon={<Clock />} title="Интенсив скоро завершится">
          Осталось {daysUntilEnd} {pluralDays(daysUntilEnd)} (до {endDate.toLocaleDateString('ru-RU')}).
        </Notice>
      )}

      {workspace?.isAssigned && workspace?.hasOwnConnection !== false && (
        <Notice
          tone="info"
          icon={<Users />}
          title="Вы назначены на это пространство"
          action={
            <Button variant="outline" size="sm" disabled={leaveAssignmentLoading} onClick={onLeaveAssignmentRequest}>
              {leaveAssignmentLoading && <Spinner />}
              Отказаться от назначения
            </Button>
          }
        >
          Календарь и сообщения общие для всех назначенных. Если откажетесь, пространство пропадёт из вашего списка — позже его можно добавить самостоятельно.
        </Notice>
      )}
    </div>
  )
}
