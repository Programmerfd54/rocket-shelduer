"use client"

import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { ListMinus, MoreHorizontal, Trash2, UserX } from 'lucide-react'

export type AddedUser = {
  id: string
  username: string
  email: string
  addedAt: string
  lastLoginAt: string | null
  status: string
  errorMessage: string | null
}
export type RowAction = 'deactivate' | 'delete' | 'unlist'

function StatusBadge({ status }: { status: string }) {
  if (status === 'ADDED') return <Badge variant="success">Добавлен</Badge>
  if (status === 'ERROR') return <Badge variant="danger">Ошибка</Badge>
  if (status === 'ALREADY_EXISTS') return <Badge variant="muted">Уже существует</Badge>
  return <Badge variant="muted">{status}</Badge>
}

export function RcUsersTable({ users, selected, disabled, onToggle, onToggleAll, onAction }: {
  users: AddedUser[]
  selected: Set<string>
  disabled?: boolean
  onToggle: (id: string, checked: boolean) => void
  onToggleAll: (checked: boolean) => void
  onAction: (action: RowAction, user: AddedUser) => void
}) {
  const selectedCount = users.filter(u => selected.has(u.id)).length
  const allChecked = users.length > 0 && selectedCount === users.length
  const headState: boolean | 'indeterminate' = allChecked ? true : selectedCount > 0 ? 'indeterminate' : false

  return (
    <div className="rounded-lg border overflow-hidden">
      <div className="max-h-[32rem] overflow-auto">
        <table className="w-full text-sm">
          <thead className="sticky top-0 z-10 bg-muted/60">
            <tr className="border-b text-left text-xs text-muted-foreground">
              <th className="w-10 px-3 py-2.5">
                <Checkbox checked={headState} disabled={disabled || users.length === 0} aria-label="Выбрать всех в списке"
                  onCheckedChange={checked => onToggleAll(checked === true)} />
              </th>
              <th className="px-3 py-2.5 font-medium">Логин</th>
              <th className="px-3 py-2.5 font-medium">Почта</th>
              <th className="px-3 py-2.5 font-medium">Статус</th>
              <th className="px-3 py-2.5 font-medium">Вход в систему</th>
              <th className="w-12 px-3 py-2.5"><span className="sr-only">Действия</span></th>
            </tr>
          </thead>
          <tbody>
            {users.length === 0 && (
              <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">Никого не найдено. Измените поиск или фильтр.</td></tr>
            )}
            {users.map(u => {
              const checked = selected.has(u.id)
              return (
                <tr key={u.id} data-state={checked ? 'selected' : undefined}
                  className="border-b last:border-b-0 hover:bg-muted/40 data-[state=selected]:bg-muted/60">
                  <td className="px-3 py-2">
                    <Checkbox checked={checked} disabled={disabled} aria-label={`Выбрать ${u.username}`}
                      onCheckedChange={value => onToggle(u.id, value === true)} />
                  </td>
                  <td className="px-3 py-2 font-mono text-[13px]">{u.username}</td>
                  <td className="px-3 py-2 text-muted-foreground">{u.email}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <StatusBadge status={u.status} />
                      {u.errorMessage && <span className="text-xs text-muted-foreground break-words max-w-[22rem]">{u.errorMessage}</span>}
                    </div>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap">
                    {u.lastLoginAt
                      ? <span className="text-foreground">Входил {new Date(u.lastLoginAt).toLocaleString('ru-RU')}</span>
                      : <span className="text-muted-foreground">Не входил</span>}
                  </td>
                  <td className="px-3 py-1.5 text-right">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`Действия для ${u.username}`}>
                          <MoreHorizontal className="size-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className="w-56">
                        <DropdownMenuItem onSelect={() => onAction('deactivate', u)}>
                          <UserX /> Деактивировать в Rocket.Chat
                        </DropdownMenuItem>
                        <DropdownMenuItem variant="destructive" onSelect={() => onAction('delete', u)}>
                          <Trash2 /> Удалить из Rocket.Chat
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem onSelect={() => onAction('unlist', u)}>
                          <ListMinus /> Убрать из списка
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}
