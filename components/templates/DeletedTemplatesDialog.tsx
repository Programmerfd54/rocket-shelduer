'use client'

import { ArchiveRestore, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { EmptyState } from '@/components/common/EmptyState'
import type { OfficialTemplateDto, TemplateScope } from '@/lib/templates/types'
import { SCOPE_TAB_LABELS } from './lib'
import { ChannelTag } from './shared'

/** «Удалённые»: скрытые встроенные шаблоны набора с кнопкой «Восстановить». */
export function DeletedTemplatesDialog({
  open,
  onOpenChange,
  scope,
  templates,
  restoringId,
  onRestore,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  scope: TemplateScope
  templates: OfficialTemplateDto[]
  restoringId: string | null
  onRestore: (t: OfficialTemplateDto) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[85vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Удалённые шаблоны · {SCOPE_TAB_LABELS[scope]}</DialogTitle>
          <DialogDescription>
            Удалённые встроенные шаблоны скрыты у всех пользователей. После восстановления шаблон вернётся вместе с прежними
            изменениями.
          </DialogDescription>
        </DialogHeader>
        {templates.length === 0 ? (
          <EmptyState icon={<ArchiveRestore />} title="Удалённых шаблонов нет" description="Здесь появятся удалённые встроенные шаблоны." />
        ) : (
          <ul className="divide-y rounded-lg border" aria-label="Удалённые шаблоны">
            {templates.map((t) => (
              <li key={t.id} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 px-3 py-2">
                <div className="flex min-w-0 flex-1 basis-[14rem] flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="shrink-0 text-xs text-muted-foreground">{t.dayLabel}</span>
                  <span className="shrink-0 text-sm tabular-nums text-muted-foreground">~{t.time}</span>
                  <ChannelTag channel={t.channel} />
                  <span className="min-w-0 flex-1 basis-32 truncate text-sm font-medium">{t.title}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="ml-auto h-9 sm:h-8"
                  disabled={!!restoringId}
                  onClick={() => onRestore(t)}
                  aria-label={`Восстановить шаблон «${t.title}»`}
                >
                  {restoringId === t.id ? <Loader2 className="animate-spin" aria-hidden /> : <ArchiveRestore aria-hidden />}
                  Восстановить
                </Button>
              </li>
            ))}
          </ul>
        )}
      </DialogContent>
    </Dialog>
  )
}
