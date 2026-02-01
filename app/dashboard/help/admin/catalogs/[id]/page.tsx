"use client"

import { useState, useEffect, useCallback } from 'react'
import { useRouter, useParams } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Loader2, ArrowLeft, FileText, HelpCircle, Plus, Pencil, Trash2, Eye } from 'lucide-react'
import { toast } from 'sonner'
import { HelpRichEditor, HELP_ROLE_OPTIONS } from '@/components/_components/HelpRichEditor'
import { Checkbox } from '@/components/ui/checkbox'

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

export default function CatalogEditPage() {
  const router = useRouter()
  const params = useParams()
  const catalogId = params?.id as string
  const [loading, setLoading] = useState(true)
  const [catalog, setCatalog] = useState<Catalog | null>(null)
  const [titleEdit, setTitleEdit] = useState('')
  const [catalogRoles, setCatalogRoles] = useState<string[]>([])
  const [savingTitle, setSavingTitle] = useState(false)

  // Instruction dialog
  const [instDialogOpen, setInstDialogOpen] = useState(false)
  const [instDialogMode, setInstDialogMode] = useState<'create' | 'edit'>('create')
  const [instDialogId, setInstDialogId] = useState<string | null>(null)
  const [instTitle, setInstTitle] = useState('')
  const [instContent, setInstContent] = useState('')
  const [instRoles, setInstRoles] = useState<string[]>([])
  const [instOrder, setInstOrder] = useState(0)
  const [instSaving, setInstSaving] = useState(false)
  const [previewInstContent, setPreviewInstContent] = useState<string | null>(null)

  // FAQ dialog
  const [faqDialogOpen, setFaqDialogOpen] = useState(false)
  const [faqDialogMode, setFaqDialogMode] = useState<'create' | 'edit'>('create')
  const [faqDialogId, setFaqDialogId] = useState<string | null>(null)
  const [faqQuestion, setFaqQuestion] = useState('')
  const [faqAnswer, setFaqAnswer] = useState('')
  const [faqRoles, setFaqRoles] = useState<string[]>([])
  const [faqOrder, setFaqOrder] = useState(0)
  const [faqSaving, setFaqSaving] = useState(false)

  const [deleteInstId, setDeleteInstId] = useState<string | null>(null)
  const [deleteFaqId, setDeleteFaqId] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!catalogId) return
    try {
      const res = await fetch(`/api/admin/help/catalogs/${catalogId}`)
      if (res.status === 404) {
        router.replace('/dashboard/help/admin')
        return
      }
      if (!res.ok) throw new Error('Failed to load')
      const data = await res.json()
      setCatalog(data)
      setTitleEdit(data.title ?? '')
      setCatalogRoles(Array.isArray(data.roles) ? data.roles : [])
    } catch (e) {
      toast.error('Ошибка загрузки каталога')
      router.replace('/dashboard/help/admin')
    } finally {
      setLoading(false)
    }
  }, [catalogId, router])

  useEffect(() => {
    load()
  }, [load])

  const saveTitle = async () => {
    if (!catalogId) return
    const titleChanged = titleEdit.trim() !== (catalog?.title ?? '')
    const rolesChanged = JSON.stringify(catalogRoles.sort()) !== JSON.stringify((catalog?.roles ?? []).sort())
    if (!titleChanged && !rolesChanged) return
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
      toast.success('Сохранено')
    } catch {
      toast.error('Ошибка сохранения')
    } finally {
      setSavingTitle(false)
    }
  }

  const openAddInstruction = () => {
    setInstDialogMode('create')
    setInstDialogId(null)
    setInstTitle('')
    setInstContent('')
    setInstRoles([])
    setInstOrder(catalog?.instructions?.length ?? 0)
    setPreviewInstContent('')
    setInstDialogOpen(true)
  }

  const openEditInstruction = (inst: Instruction) => {
    setInstDialogMode('edit')
    setInstDialogId(inst.id)
    setInstTitle(inst.title)
    setInstContent(inst.content)
    setInstRoles(Array.isArray(inst.roles) ? [...inst.roles] : [])
    setInstOrder(inst.order)
    setPreviewInstContent(inst.content)
    setInstDialogOpen(true)
  }

  const saveInstruction = async () => {
    if (!catalogId) return
    setInstSaving(true)
    try {
      if (instDialogMode === 'create') {
        const res = await fetch('/api/admin/help/instructions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogId,
            title: instTitle.trim() || 'Инструкция',
            content: instContent,
            order: instOrder,
            roles: instRoles,
          }),
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
          body: JSON.stringify({
            title: instTitle.trim() || 'Инструкция',
            content: instContent,
            order: instOrder,
            roles: instRoles,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        setCatalog((c) =>
          c
            ? {
                ...c,
                instructions: (c.instructions ?? []).map((i) =>
                  i.id === instDialogId
                    ? { ...i, title: instTitle.trim(), content: instContent, order: instOrder, roles: [...instRoles] }
                    : i
                ).sort((a, b) => a.order - b.order),
              }
            : null
        )
        toast.success('Инструкция сохранена')
      }
      setInstDialogOpen(false)
    } catch {
      toast.error('Ошибка сохранения инструкции')
    } finally {
      setInstSaving(false)
    }
  }

  const deleteInstruction = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/help/instructions/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setCatalog((c) =>
        c ? { ...c, instructions: (c.instructions ?? []).filter((i) => i.id !== id) } : null
      )
      setDeleteInstId(null)
      toast.success('Инструкция удалена')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const openAddFaq = () => {
    setFaqDialogMode('create')
    setFaqDialogId(null)
    setFaqQuestion('')
    setFaqAnswer('')
    setFaqRoles([])
    setFaqOrder(catalog?.faqs?.length ?? 0)
    setFaqDialogOpen(true)
  }

  const openEditFaq = (faq: FAQ) => {
    setFaqDialogMode('edit')
    setFaqDialogId(faq.id)
    setFaqQuestion(faq.question)
    setFaqAnswer(faq.answer)
    setFaqRoles(Array.isArray(faq.roles) ? [...faq.roles] : [])
    setFaqOrder(faq.order)
    setFaqDialogOpen(true)
  }

  const saveFaq = async () => {
    if (!catalogId) return
    setFaqSaving(true)
    try {
      if (faqDialogMode === 'create') {
        const res = await fetch('/api/admin/help/faq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogId,
            question: faqQuestion.trim() || 'Вопрос',
            answer: faqAnswer.trim(),
            order: faqOrder,
            roles: faqRoles,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        const faq = data.faq
        setCatalog((c) =>
          c
            ? {
                ...c,
                faqs: [...(c.faqs ?? []), { ...faq, roles: faq.roles ?? [] }].sort((a, b) => a.order - b.order),
              }
            : null
        )
        toast.success('Вопрос добавлен')
      } else if (faqDialogId) {
        const res = await fetch(`/api/admin/help/faq/${faqDialogId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            question: faqQuestion.trim() || 'Вопрос',
            answer: faqAnswer.trim(),
            order: faqOrder,
            roles: faqRoles,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        setCatalog((c) =>
          c
            ? {
                ...c,
                faqs: (c.faqs ?? []).map((f) =>
                  f.id === faqDialogId
                    ? {
                        ...f,
                        question: faqQuestion.trim(),
                        answer: faqAnswer.trim(),
                        order: faqOrder,
                        roles: [...faqRoles],
                      }
                    : f
                ).sort((a, b) => a.order - b.order),
              }
            : null
        )
        toast.success('Вопрос сохранён')
      }
      setFaqDialogOpen(false)
    } catch {
      toast.error('Ошибка сохранения')
    } finally {
      setFaqSaving(false)
    }
  }

  const deleteFaq = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/help/faq/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setCatalog((c) => (c ? { ...c, faqs: (c.faqs ?? []).filter((f) => f.id !== id) } : null))
      setDeleteFaqId(null)
      toast.success('Вопрос удалён')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  if (loading || !catalog) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  return (
    <div className="container max-w-4xl py-8 px-4 mx-auto">
      <Breadcrumbs
        items={[
          { label: 'Дашборд', href: '/dashboard' },
          { label: 'Справка', href: '/dashboard/help' },
          { label: 'Управление справкой', href: '/dashboard/help/admin' },
          { label: catalog.title, current: true },
        ]}
        className="mb-6"
      />
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-2xl font-bold tracking-tight">Редактирование каталога</h1>
        <Link href="/dashboard/help/admin">
          <Button variant="outline" size="sm">
            <ArrowLeft className="h-4 w-4 mr-1" />
            К управлению справкой
          </Button>
        </Link>
      </div>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg">Название и видимость каталога</CardTitle>
          <CardDescription>Название — заголовок вкладки. Пустой список ролей = каталог виден всем.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Input
              value={titleEdit}
              onChange={(e) => setTitleEdit(e.target.value)}
              placeholder="Название каталога"
              className="max-w-md"
            />
            <Button onClick={saveTitle} disabled={savingTitle}>
              {savingTitle ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Сохранить
            </Button>
          </div>
          <div className="space-y-2">
            <Label className="text-sm">Видимость для ролей (оставьте пустым = для всех)</Label>
            <div className="flex flex-wrap gap-4">
              {HELP_ROLE_OPTIONS.filter((o) => o.value).map((o) => (
                <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                  <Checkbox
                    checked={catalogRoles.includes(o.value)}
                    onCheckedChange={(checked) =>
                      setCatalogRoles((prev) =>
                        checked ? [...prev, o.value] : prev.filter((r) => r !== o.value)
                      )
                    }
                  />
                  <span className="text-sm">{o.label}</span>
                </label>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <FileText className="h-5 w-5" />
            Инструкции
          </CardTitle>
          <CardDescription>Текст инструкций поддерживает HTML (в т.ч. изображения по ссылке из загрузки)</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" size="sm" onClick={openAddInstruction} className="gap-2">
            <Plus className="h-4 w-4" />
            Добавить инструкцию
          </Button>
          {(catalog.instructions ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет инструкций. Добавьте первую.</p>
          ) : (
            <ul className="space-y-2">
              {(catalog.instructions ?? []).map((inst) => (
                <li
                  key={inst.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 bg-muted/20"
                >
                  <div className="min-w-0">
                    <span className="font-medium truncate block">{inst.title}</span>
                    <span className="text-xs text-muted-foreground">
                      Порядок: {inst.order} · {inst.roles?.length ? inst.roles.join(', ') : 'Для всех'} · контент {inst.content.length} симв.
                    </span>
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openEditInstruction(inst)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleteInstId(inst.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card className="mb-6">
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <HelpCircle className="h-5 w-5" />
            FAQ раздела
          </CardTitle>
          <CardDescription>Вопросы и ответы внутри этого каталога</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <Button variant="outline" size="sm" onClick={openAddFaq} className="gap-2">
            <Plus className="h-4 w-4" />
            Добавить вопрос
          </Button>
          {(catalog.faqs ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет вопросов в этом разделе.</p>
          ) : (
            <ul className="space-y-2">
              {(catalog.faqs ?? []).map((faq) => (
                <li
                  key={faq.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 bg-muted/20"
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate">{faq.question}</p>
                    {faq.roles?.length ? (
                      <span className="text-xs text-muted-foreground">{faq.roles.join(', ')}</span>
                    ) : null}
                  </div>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openEditFaq(faq)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="text-destructive"
                      onClick={() => setDeleteFaqId(faq.id)}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Диалог инструкции */}
      <Dialog open={instDialogOpen} onOpenChange={setInstDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {instDialogMode === 'create' ? 'Добавить инструкцию' : 'Редактировать инструкцию'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Название</Label>
              <Input
                value={instTitle}
                onChange={(e) => setInstTitle(e.target.value)}
                placeholder="Заголовок инструкции"
              />
            </div>
            <div className="space-y-2">
              <Label>Видимость для ролей (ничего не выбрано = для всех)</Label>
              <div className="flex flex-wrap gap-4">
                {HELP_ROLE_OPTIONS.filter((o) => o.value).map((o) => (
                  <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={instRoles.includes(o.value)}
                      onCheckedChange={(checked) =>
                        setInstRoles((prev) =>
                          checked ? [...prev, o.value] : prev.filter((r) => r !== o.value)
                        )
                      }
                    />
                    <span className="text-sm">{o.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Содержимое</Label>
              <HelpRichEditor
                value={instContent}
                onChange={(html) => {
                  setInstContent(html)
                  setPreviewInstContent(html)
                }}
                minHeight="200px"
                placeholder="Текст инструкции. Используйте панель для форматирования и вставки изображений."
              />
            </div>
            <div className="space-y-2">
              <Label>Порядок (число)</Label>
              <Input
                type="number"
                value={instOrder}
                onChange={(e) => setInstOrder(Number(e.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label className="flex items-center gap-2">
                <Eye className="h-4 w-4" />
                Как будет отображаться инструкция
              </Label>
              <div className="rounded-lg border bg-muted/30 p-4 min-h-[80px]">
                {previewInstContent ? (
                  <div
                    className="prose prose-sm dark:prose-invert max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewInstContent }}
                  />
                ) : (
                  <p className="text-sm text-muted-foreground">Введите контент выше — здесь появится предпросмотр.</p>
                )}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setInstDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={saveInstruction} disabled={instSaving}>
              {instSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {instDialogMode === 'create' ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Диалог FAQ */}
      <Dialog open={faqDialogOpen} onOpenChange={setFaqDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {faqDialogMode === 'create' ? 'Добавить вопрос' : 'Редактировать вопрос'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Видимость для ролей (ничего не выбрано = для всех)</Label>
              <div className="flex flex-wrap gap-4">
                {HELP_ROLE_OPTIONS.filter((o) => o.value).map((o) => (
                  <label key={o.value} className="flex items-center gap-2 cursor-pointer">
                    <Checkbox
                      checked={faqRoles.includes(o.value)}
                      onCheckedChange={(checked) =>
                        setFaqRoles((prev) =>
                          checked ? [...prev, o.value] : prev.filter((r) => r !== o.value)
                        )
                      }
                    />
                    <span className="text-sm">{o.label}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-2">
              <Label>Вопрос</Label>
              <Input
                value={faqQuestion}
                onChange={(e) => setFaqQuestion(e.target.value)}
                placeholder="Текст вопроса"
              />
            </div>
            <div className="space-y-2">
              <Label>Ответ</Label>
              <Textarea
                value={faqAnswer}
                onChange={(e) => setFaqAnswer(e.target.value)}
                className="min-h-[100px]"
                placeholder="Текст ответа"
              />
            </div>
            <div className="space-y-2">
              <Label>Порядок (число)</Label>
              <Input
                type="number"
                value={faqOrder}
                onChange={(e) => setFaqOrder(Number(e.target.value) || 0)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setFaqDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={saveFaq} disabled={faqSaving}>
              {faqSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {faqDialogMode === 'create' ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteInstId} onOpenChange={() => setDeleteInstId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить инструкцию?</AlertDialogTitle>
            <AlertDialogDescription>Действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteInstId && deleteInstruction(deleteInstId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!deleteFaqId} onOpenChange={() => setDeleteFaqId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить вопрос?</AlertDialogTitle>
            <AlertDialogDescription>Действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteFaqId && deleteFaq(deleteFaqId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
