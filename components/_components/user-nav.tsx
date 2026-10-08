"use client"

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"
import { Settings, Users, LogOut } from "lucide-react"
import Link from "next/link"
import { getInitials, generateAvatarColor } from "@/lib/utils"
import { clearWorkspaceEmojisCache } from "@/lib/useWorkspaceEmojis"

interface UserNavProps {
  user: {
    email: string
    name?: string | null
    role: string
    avatarUrl?: string | null
    restrictedFeatures?: string[]
  }
  onLogout: () => void
}

export function UserNav({ user, onLogout }: UserNavProps) {
  const initials = getInitials(user.name || user.email)
  const avatarColor = generateAvatarColor(user.email)
  const canOpenAdmin =
    (user.role === 'LEAD_SUP' || user.role === 'SUP') &&
    !(user.restrictedFeatures ?? []).includes('adminPanel')

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="icon" className="rounded-full" aria-label="Меню пользователя">
          <Avatar className="size-8">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className={`${avatarColor} text-xs text-white`}>
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end">
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-0.5">
            <p className="truncate text-sm font-medium leading-none">
              {user.name || "Пользователь"}
            </p>
            <p className="truncate font-mono text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings" className="cursor-pointer">
              <Settings aria-hidden />
              <span>Настройки</span>
            </Link>
          </DropdownMenuItem>
          {canOpenAdmin && (
            <DropdownMenuItem asChild>
              <Link href="/dashboard/admin" className="cursor-pointer">
                <Users aria-hidden />
                <span>Пользователи</span>
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={() => {
          clearWorkspaceEmojisCache()
          onLogout()
        }} className="cursor-pointer">
          <LogOut aria-hidden />
          <span>Выйти</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
