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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full">
          <Avatar className="h-10 w-10">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt="" />}
            <AvatarFallback className={`${avatarColor} text-white`}>
              {initials}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56 rounded-xl border-border/80 shadow-lg" align="end" forceMount>
        <DropdownMenuLabel className="font-normal p-3">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {user.name || "Пользователь"}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator className="bg-border/60" />
        <DropdownMenuGroup>
          <DropdownMenuItem asChild>
            <Link href="/dashboard/settings" className="cursor-pointer">
              <Settings className="mr-2 h-4 w-4" />
              <span>Настройки</span>
            </Link>
          </DropdownMenuItem>
          {(user.role === 'SUPPORT' || user.role === 'ADMIN') && !(user.restrictedFeatures ?? []).includes('adminPanel') && (
            <DropdownMenuItem asChild>
              <Link href="/dashboard/admin" className="cursor-pointer">
                <Users className="mr-2 h-4 w-4" />
                <span>Управление пользователями</span>
              </Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuItem onClick={onLogout} className="cursor-pointer text-red-600">
          <LogOut className="mr-2 h-4 w-4" />
          <span>Выйти</span>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
