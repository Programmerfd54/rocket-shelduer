'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResetAccountTab } from '@/components/_components/workspace/ResetAccountTab'
import { UserAccessTab } from '@/components/_components/workspace/UserAccessTab'
import { EmptyState } from '@/components/common/EmptyState'
import { Lock, KeyRound, ShieldCheck } from 'lucide-react'

/** Вкладка «Сбор и состояние»: сброс учётки — SUP и Lead_SUP; у ADM под замком. */
export function AccountsAndStatusTab({
  workspaceId,
  currentUserRole,
}: {
  workspaceId: string
  currentUserRole: string
}) {
  const canReset = currentUserRole === 'SUP' || currentUserRole === 'LEAD_SUP'
  const defaultSub = canReset ? 'reset' : 'access'

  return (
    <Tabs key={`${workspaceId}-${currentUserRole}`} defaultValue={defaultSub} className="w-full space-y-4">
      <TabsList className="grid w-full grid-cols-2 sm:inline-flex sm:w-fit">
        <TabsTrigger value="reset" disabled={!canReset} className="gap-2">
          <KeyRound aria-hidden />
          <span>Сброс учётки</span>
          {!canReset && <Lock className="text-muted-foreground" aria-label="Недоступно для вашей роли" />}
        </TabsTrigger>
        <TabsTrigger value="access" className="gap-2">
          <ShieldCheck aria-hidden />
          Состояние входа
        </TabsTrigger>
      </TabsList>

      <TabsContent value="reset" className="mt-0 space-y-4 focus-visible:outline-none">
        {canReset ? (
          <ResetAccountTab workspaceId={workspaceId} />
        ) : (
          <EmptyState
            icon={<Lock />}
            title="Сброс учётки недоступен"
            description="Роль ADM не включает массовый сброс паролей. Обратитесь к SUP или Lead_SUP."
          />
        )}
      </TabsContent>

      <TabsContent value="access" className="mt-0 focus-visible:outline-none">
        <UserAccessTab workspaceId={workspaceId} currentUserRole={currentUserRole} />
      </TabsContent>
    </Tabs>
  )
}
