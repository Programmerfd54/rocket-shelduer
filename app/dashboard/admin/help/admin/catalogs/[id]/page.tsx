"use client"

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ArrowLeft, Eye, FileText, HelpCircle, Loader2, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Field } from '@/components/ui/field'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { Section } from '@/components/common/Section'
import { HelpRichEditor, normalizeHelpRoles } from '@/components/_components/HelpRichEditor'
import { HelpHtmlContent } from '@/components/_components/HelpHtmlContent'
import {
  HelpFaqDialog,
  HelpListRow,
  HelpRolesField,
  helpRolesLabel,
  validateHelpOrder,
  type HelpFaqValues,
} from '@/components/_components/HelpAdminParts'

type Instruction = { id: string; title: string; content: string; order: number; roles: string[] }
type FAQ = { id: string; question: string; answer: string; order: number; roles: string[] }
type Catalog = {
  id: string
  title: string
  order: number
  roles: string[]
  instructions: Instruction[]
  faqs: FAQ[]
}

const TITLE_MAX = 100

function validateTitle(raw: string): string | undefined {
  const v = raw.trim()
  if (!v) return 'Введите название.'
  if (v.length > TITLE_MAX) return `Не длиннее ${TITLE_MAX} символов.`
  return undefined
}

/** Одинаковый ли набор ролей (порядок не важен), без мутации исходных массивов. */
function sameRoles(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const sa = [...a].sort()
  const sb = [...b].sort()
  return sa.every((v, i) => v === sb[i])
}

function PageSkeleton() {
  return (
    <PageContainer className="px-4 sm:px-6">
      <div role="status" aria-busy="true" aria-label="Загрузка каталога" className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        <Skeleton className="h-40 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-32 w-full rounded-lg" />
      </div>
    </PageContainer>
  )
}

export default function CatalogEditPage() {
  const router = useRouter()
  const params = useParams()
  const searchParams = useSearchParams()
  const catalogId = params?.id as string
  const chromeMinimal = searchParams.get('chrome') === '0'
  /** Сохраняем режим встраивания в iframe (chrome=0) для внутренних ссылок */
  const routeQ = chromeMinimal ? '?chrome=0' : ''
  const containerClass = chromeMinimal ? 'max-w-none px-3 py-3 lg:py-3' : 'px-4 sm:px-6'

  const [loading, setLoading] = useState(true)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [titleEdit, setTitleEdit] = useState('')
  const [catalogRoles, setCatalogRoles] = useState<string[]>([])
  const [savingTitle, setSavingTitle] = useState(false)
  const [titleSubmitted, setTitleSubmitted] = useState(false)

  // Диалог инструкции
  const [instDialogOpen, setInstDialogOpen] = useState(false)
  const [instDialogMode, setInstDialogMode] = useState<'create' | 'edit'>('create')
  const [instDialogId, setInstDialogId] = useState<string | null>(null)
  const [instTitle, setInstTitle] = useState('')
  const [instContent, setInstContent] = useState('')
  const [instRoles, setInstRoles] = useState<string[]>([])
  const [instOrder, setInstOrder] = useState('0')
  const [instSubmitted, setInstSubmitted] = useState(false)
  const [instSaving, setInstSaving] = useState(false)
  const [showPreview, setShowPreview] = useState(false)

  // Диалог вопроса
  const [faqDialog, setFaqDialog] = useState<{ mode: 'create' | 'edit'; faq: FAQ | null } | null>(null)

  const [deleteInst, setDeleteInst] = useState<Instruction | null>(null)
  const [deleteFaq, setDeleteFaq] = useState<FAQ | null>(null)
  const [deleting, setDeleting] = useState(false)

  const backHref = `/dashboard/admin/help/admin${routeQ}`

  const load = useCallback(async () => {
    if (!catalogId) return
    try {
      const res = await fetch(`/api/admin/help/catalogs/${catalogId}`)
      if (res.status === 404) {
        toast.error('Каталог не найден', { description: 'Возможно, он был удалён.' })
        router.replace(backHref)
        return
      }
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setCatalog(data)
      setTitleEdit(data.title ?? '')
      setCatalogRoles(normalizeHelpRoles(data.roles))
    } catch {
      toast.error('Не удалось загрузить каталог', { description: 'Вы вернулись к управлению справкой.' })
      router.replace(backHref)
    } finally {
      setLoading(false)
    }
  }, [catalogId, router, backHref])

  useEffect(() => {
    load()
  }, [load])

  /* ---------- название и роли каталога ---------- */

  const titleError = validateTitle(titleEdit)
  const titleChanged = titleEdit.trim() !== (catalog?.title ?? '')
  const rolesChanged = !sameRoles(catalogRoles, normalizeHelpRoles(catalog?.roles))
  const catalogDirty = titleChanged || rolesChanged

  const saveTitle = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!catalogId || !catalogDirty) return
    setTitleSubmitted(true)
    if (titleError) return
    setSavingTitle(true)
    try {
      const res = await fetch(`/api/admin/help/catalogs/${catalogId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(titleChanged ? { title: titleEdit.trim() } : {}),
          ...(rolesChanged ? { roles: catalogRoles } : {}),
        }),
      })
      if (!res.ok) throw new Error('Failed')
      setCatalog((c) => (c ? { ...c, title: titleEdit.trim(), roles: [...catalogRoles] } : null))
      toast.success('Каталог сохранён')
    } catch {
      toast.error('Не удалось сохранить каталог', { description: 'Попробуйте ещё раз.' })
    } finally {
      setSavingTitle(false)
    }
  }

  /* ---------- инструкции ---------- */

  const openAddInstruction = () => {
    setInstDialogMode('create')
    setInstDialogId(null)
    setInstTitle('')
    setInstContent('')
    setInstRoles([])
    setInstOrder(String(catalog?.instructions?.length ?? 0))
    setInstSubmitted(false)
    setShowPreview(false)
    setInstDialogOpen(true)
  }

  const openEditInstruction = (inst: Instruction) => {
    setInstDialogMode('edit')
    setInstDialogId(inst.id)
    setInstTitle(inst.title)
    setInstContent(inst.content)
    setInstRoles(normalizeHelpRoles(inst.roles))
    setInstOrder(String(inst.order))
    setInstSubmitted(false)
    setShowPreview(false)
    setInstDialogOpen(true)
  }

  const instTitleError = validateTitle(instTitle)
  const instOrderError = validateHelpOrder(instOrder)
  const instHasErrors = Boolean(instTitleError || instOrderError)

  const saveInstruction = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!catalogId) return
    setInstSubmitted(true)
    if (instHasErrors || instSaving) return
    const title = instTitle.trim()
    const order = Number(instOrder)
    setInstSaving(true)
    try {
      if (instDialogMode === 'create') {
        const res = await fetch('/api/admin/help/instructions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ catalogId, title, content: instContent, order, roles: instRoles }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        const inst = data.instruction
        setCatalog((c) =>
          c
            ? {
                ...c,
                instructions: [...(c.instructions ?? []), { ...inst, roles: inst.roles ?? [] }].sort(
                  (a, b) => a.order - b.order
                ),
              }
            : null
        )
        toast.success('Инструкция добавлена')
      } else if (instDialogId) {
        const res = await fetch(`/api/admin/help/instructions/${instDialogId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: instContent, order, roles: instRoles }),
        })
        if (!res.ok) throw new Error('Failed')
        setCatalog((c) =>
          c
            ? {
                ...c,
                instructions: (c.instructions ?? [])
                  .map((i) =>
                    i.id === instDialogId ? { ...i, title, content: instContent, order, roles: [...instRoles] } : i
                  )
                  .sort((a, b) => a.order - b.order),
              }
            : null
        )
        toast.success('Инструкция сохранена')
      }
      setInstDialogOpen(false)
    } catch {
      toast.error('Не удалось сохранить инструкцию', { description: 'Данные остались в форме — попробуйте ещё раз.' })
    } finally {
      setInstSaving(false)
    }
  }

  const confirmDeleteInstruction = async () => {
    if (!deleteInst) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/help/instructions/${deleteInst.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setCatalog((c) => (c ? { ...c, instructions: (c.instructions ?? []).filter((i) => i.id !== deleteInst.id) } : null))
      toast.success('Инструкция удалена')
      setDeleteInst(null)
    } catch {
      toast.error('Не удалось удалить инструкцию', { description: 'Попробуйте ещё раз.' })
    } finally {
      setDeleting(false)
    }
  }

  /* ---------- вопросы ---------- */

  const faqInitial: HelpFaqValues =
    faqDialog?.mode === 'edit' && faqDialog.faq
      ? {
          question: faqDialog.faq.question,
          answer: faqDialog.faq.answer,
          roles: normalizeHelpRoles(faqDialog.faq.roles),
          order: faqDialog.faq.order,
        }
      : { question: '', answer: '', roles: [], order: catalog?.faqs?.length ?? 0 }

  const submitFaq = async (v: HelpFaqValues): Promise<boolean> => {
    if (!catalogId) return false
    try {
      if (faqDialog?.mode === 'edit' && faqDialog.faq) {
        const id = faqDialog.faq.id
        const res = await fetch(`/api/admin/help/faq/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: v.question, answer: v.answer, order: v.order, roles: v.roles }),
        })
        if (!res.ok) throw new Error('Failed')
        setCatalog((c) =>
          c
            ? {
                ...c,
                faqs: (c.faqs ?? [])
                  .map((f) => (f.id === id ? { ...f, ...v, roles: [...v.roles] } : f))
                  .sort((a, b) => a.order - b.order),
              }
            : null
        )
        toast.success('Вопрос сохранён')
      } else {
        const res = await fetch('/api/admin/help/faq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogId,
            question: v.question,
            answer: v.answer,
            order: v.order,
            roles: v.roles,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        const faq = data.faq
        setCatalog((c) =>
          c
            ? { ...c, faqs: [...(c.faqs ?? []), { ...faq, roles: faq.roles ?? [] }].sort((a, b) => a.order - b.order) }
            : null
        )
        toast.success('Вопрос добавлен')
      }
      setFaqDialog(null)
      return true
    } catch {
      toast.error('Не удалось сохранить вопрос', { description: 'Данные остались в форме — попробуйте ещё раз.' })
      return false
    }
  }

  const confirmDeleteFaq = async () => {
    if (!deleteFaq) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/help/faq/${deleteFaq.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setCatalog((c) => (c ? { ...c, faqs: (c.faqs ?? []).filter((f) => f.id !== deleteFaq.id) } : null))
      toast.success('Вопрос удалён')
      setDeleteFaq(null)
    } catch {
      toast.error('Не удалось удалить вопрос', { description: 'Попробуйте ещё раз.' })
    } finally {
      setDeleting(false)
    }
  }

  if (loading || !catalog) return <PageSkeleton />

  const instructions = catalog.instructions ?? []
  const faqs = catalog.faqs ?? []

  const breadcrumbs = chromeMinimal ? undefined : (
    <Breadcrumbs
      items={[
        { label: 'Дашборд', href: '/dashboard' },
        { label: 'Справка', href: '/dashboard/admin/help' },
        { label: 'Управление справкой', href: backHref },
        { label: catalog.title, current: true },
      ]}
    />
  )

  return (
    <PageContainer size="narrow" className={containerClass}>
      <PageHeader
        title={catalog.title}
        description="Редактирование каталога: название, видимость, инструкции и вопросы."
        breadcrumbs={breadcrumbs}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href={backHref}>
              <ArrowLeft aria-hidden />
              К управлению справкой
            </Link>
          </Button>
        }
      />

      <div className="space-y-8">
        <Section
          title="Название и видимость"
          description="Название — заголовок вкладки в справке. Пустой список ролей — каталог виден всем."
        >
          <form onSubmit={saveTitle} noValidate className="space-y-4">
            <Field
              label="Название каталога"
              htmlFor="catalog-title"
              required
              error={titleSubmitted ? titleError : undefined}
              className="max-w-md"
            >
              <Input
                id="catalog-title"
                value={titleEdit}
                onChange={(e) => setTitleEdit(e.target.value)}
                placeholder="Название каталога"
                aria-invalid={titleSubmitted && !!titleError}
                disabled={savingTitle}
              />
            </Field>
            <HelpRolesField value={catalogRoles} onChange={setCatalogRoles} disabled={savingTitle} />
            <Button type="submit" size="sm" disabled={savingTitle || !catalogDirty}>
              {savingTitle && <Loader2 className="animate-spin" />}
              Сохранить
            </Button>
          </form>
        </Section>

        <Section
          bare
          title="Инструкции"
          description="Текст оформляется в редакторе: заголовки, списки, ссылки, изображения."
          actions={
            <Button variant="outline" size="sm" onClick={openAddInstruction}>
              <Plus aria-hidden />
              Добавить инструкцию
            </Button>
          }
        >
          {instructions.length === 0 ? (
            <EmptyState
              icon={<FileText />}
              title="Инструкций пока нет"
              description="Добавьте первую инструкцию для этого каталога."
            />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {instructions.map((inst) => (
                <HelpListRow
                  key={inst.id}
                  title={inst.title}
                  meta={`Порядок: ${inst.order} · ${helpRolesLabel(normalizeHelpRoles(inst.roles))}`}
                  editLabel={`Изменить инструкцию «${inst.title}»`}
                  deleteLabel={`Удалить инструкцию «${inst.title}»`}
                  onEdit={() => openEditInstruction(inst)}
                  onDelete={() => setDeleteInst(inst)}
                />
              ))}
            </ul>
          )}
        </Section>

        <Section
          bare
          title="Вопросы раздела"
          description="Вопросы и ответы внутри этого каталога."
          actions={
            <Button variant="outline" size="sm" onClick={() => setFaqDialog({ mode: 'create', faq: null })}>
              <Plus aria-hidden />
              Добавить вопрос
            </Button>
          }
        >
          {faqs.length === 0 ? (
            <EmptyState
              icon={<HelpCircle />}
              title="Вопросов пока нет"
              description="Добавьте вопрос и ответ для этого каталога."
            />
          ) : (
            <ul className="divide-y rounded-lg border bg-card">
              {faqs.map((faq) => (
                <HelpListRow
                  key={faq.id}
                  title={faq.question}
                  meta={`Порядок: ${faq.order} · ${helpRolesLabel(normalizeHelpRoles(faq.roles))}`}
                  editLabel="Изменить вопрос"
                  deleteLabel="Удалить вопрос"
                  onEdit={() => setFaqDialog({ mode: 'edit', faq })}
                  onDelete={() => setDeleteFaq(faq)}
                />
              ))}
            </ul>
          )}
        </Section>
      </div>

      {/* Инструкция */}
      <Dialog open={instDialogOpen} onOpenChange={(o) => !instSaving && setInstDialogOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{instDialogMode === 'create' ? 'Новая инструкция' : 'Редактировать инструкцию'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveInstruction} noValidate className="space-y-4">
            <Field
              label="Название"
              htmlFor="inst-title"
              required
              error={instSubmitted ? instTitleError : undefined}
            >
              <Input
                id="inst-title"
                value={instTitle}
                onChange={(e) => setInstTitle(e.target.value)}
                placeholder="Заголовок инструкции"
                aria-invalid={instSubmitted && !!instTitleError}
                disabled={instSaving}
                autoFocus
              />
            </Field>
            <HelpRolesField value={instRoles} onChange={setInstRoles} disabled={instSaving} />
            <Field label="Содержимое">
              <HelpRichEditor
                value={instContent}
                onChange={setInstContent}
                minHeight="200px"
                placeholder="Текст инструкции. Для форматирования и изображений используйте панель сверху."
              />
            </Field>
            <Field
              label="Порядок"
              htmlFor="inst-order"
              hint="Чем меньше число, тем выше в списке."
              error={instSubmitted ? instOrderError : undefined}
              className="max-w-40"
            >
              <Input
                id="inst-order"
                type="number"
                inputMode="numeric"
                min={0}
                step={1}
                value={instOrder}
                onChange={(e) => setInstOrder(e.target.value)}
                aria-invalid={instSubmitted && !!instOrderError}
                disabled={instSaving}
              />
            </Field>
            <div className="space-y-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="-ml-2.5"
                aria-expanded={showPreview}
                onClick={() => setShowPreview((v) => !v)}
              >
                <Eye aria-hidden />
                {showPreview ? 'Скрыть предпросмотр' : 'Показать, как будет выглядеть'}
              </Button>
              {showPreview && (
                <div className="min-h-20 rounded-md border bg-muted/30 p-4">
                  {instContent.replace(/<[^>]*>/g, '').trim() || instContent.includes('<img') ? (
                    <HelpHtmlContent html={instContent} className="text-[15px] leading-relaxed" />
                  ) : (
                    <p className="text-sm text-muted-foreground">Введите текст выше — здесь появится предпросмотр.</p>
                  )}
                </div>
              )}
            </div>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setInstDialogOpen(false)} disabled={instSaving}>
                Отмена
              </Button>
              <Button type="submit" disabled={instSaving || (instSubmitted && instHasErrors)}>
                {instSaving && <Loader2 className="animate-spin" />}
                {instDialogMode === 'create' ? 'Добавить' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <HelpFaqDialog
        open={faqDialog !== null}
        onOpenChange={(o) => !o && setFaqDialog(null)}
        title={faqDialog?.mode === 'edit' ? 'Редактировать вопрос' : 'Новый вопрос'}
        submitLabel={faqDialog?.mode === 'edit' ? 'Сохранить' : 'Добавить'}
        initial={faqInitial}
        onSubmit={submitFaq}
      />

      <ConfirmDialog
        open={!!deleteInst}
        onOpenChange={(o) => !o && setDeleteInst(null)}
        title="Удалить инструкцию?"
        description={
          deleteInst && (
            <>
              Инструкция «<strong>{deleteInst.title}</strong>» будет удалена. Действие нельзя отменить.
            </>
          )
        }
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={confirmDeleteInstruction}
      />

      <ConfirmDialog
        open={!!deleteFaq}
        onOpenChange={(o) => !o && setDeleteFaq(null)}
        title="Удалить вопрос?"
        description={
          deleteFaq && (
            <>
              Вопрос «<strong>{deleteFaq.question}</strong>» будет удалён. Действие нельзя отменить.
            </>
          )
        }
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={confirmDeleteFaq}
      />
    </PageContainer>
  )
}
