'use client'

import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { ResetAccountTab } from '@/components/_components/workspace/ResetAccountTab'
import { UserAccessTab } from '@/components/_components/workspace/UserAccessTab'
import { Card, CardContent } from '@/components/ui/card'
import { Lock, KeyRound, ShieldCheck } from 'lucide-react'
import { cn } from '@/lib/utils'

/** Вкладка «Сбор и состояние»: горизонтальные подвкладки — сброс учётки и состояние входа. У ADM сброс под замком. */
export function AccountsAndStatusTab({
  workspaceId,
  currentUserRole,
}: {
  workspaceId: string
  currentUserRole: string
}) {
  const canReset = currentUserRole === 'SUPPORT' || currentUserRole === 'ADMIN'
  const defaultSub = canReset ? 'reset' : 'access'

  return (
    <Tabs key={`${workspaceId}-${currentUserRole}`} defaultValue={defaultSub} className="w-full space-y-4">
      <TabsList
        style={{ height: 'auto', minHeight: '2.75rem' }}
        className="grid w-full grid-cols-2 gap-1 p-1 bg-muted/50 rounded-xl border border-border/60 items-stretch content-stretch"
      >
        <TabsTrigger
          value="reset"
          disabled={!canReset}
          className={cn(
            'rounded-lg text-sm min-h-10 h-full! box-border px-2.5 py-2 flex items-center justify-center gap-2 text-center shadow-none data-[state=active]:shadow-sm data-[state=active]:bg-background data-[state=active]:ring-1 data-[state=active]:ring-border/50',
            !canReset && 'opacity-60 cursor-not-allowed'
          )}
        >
          <KeyRound className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          <span>Сброс учётки</span>
          {!canReset && <Lock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />}
        </TabsTrigger>
        <TabsTrigger
          value="access"
          className="rounded-lg text-sm min-h-10 h-full! box-border px-2.5 py-2 flex items-center justify-center gap-2 text-center shadow-none data-[state=active]:shadow-sm data-[state=active]:bg-background data-[state=active]:ring-1 data-[state=active]:ring-border/50"
        >
          <ShieldCheck className="h-4 w-4 shrink-0 opacity-80" aria-hidden />
          Состояние входа
        </TabsTrigger>
      </TabsList>

      <TabsContent value="reset" className="mt-0 focus-visible:outline-none space-y-4">
        {canReset ? (
          <ResetAccountTab workspaceId={workspaceId} />
        ) : (
          <Card className="rounded-2xl border border-border/80 bg-muted/20">
            <CardContent className="p-6 flex flex-col sm:flex-row items-start gap-4">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground">
                <Lock className="h-6 w-6" />
              </div>
              <div>
                <h3 className="font-semibold text-foreground">Сброс учётки недоступен</h3>
                <p className="text-sm text-muted-foreground mt-1">
                  Роль ADM не включает массовый сброс паролей в Rocket.Chat. Обратитесь к SUPPORT или администратору приложения.
                </p>
              </div>
            </CardContent>
          </Card>
        )}
      </TabsContent>

      <TabsContent value="access" className="mt-0 focus-visible:outline-none">
        <UserAccessTab workspaceId={workspaceId} currentUserRole={currentUserRole} />
      </TabsContent>
    </Tabs>
  )
}
