"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { Checkbox } from '@/components/ui/checkbox'
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
import { HelpRichEditor, HELP_ROLE_OPTIONS } from '@/components/_components/HelpRichEditor'
import { Loader2, ArrowLeft, BookOpen, Users, FolderPlus, FileText, HelpCircle, ImagePlus, Plus, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

type Catalog = {
  id: string
  title: string
  order: number
  roles?: string[]
  instructions: Array<{ id: string; title: string; content: string; order: number }>
  faqs: Array<{ id: string; question: string; answer: string; order: number }>
}

export default function HelpAdminPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [isAdmin, setIsAdmin] = useState(false)
  const [visibility, setVisibility] = useState({
    templatesTabVisible: true,
    helpMainVisible: true,
    helpAdminVisible: true,
  })
  const [mainContent, setMainContent] = useState('')
  const [mainSections, setMainSections] = useState<Array<{ id: string; title: string; order: number; content: string }>>([])
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [globalFaqs, setGlobalFaqs] = useState<Array<{ id: string; question: string; answer: string; order: number; roles?: string[] }>>([])
  const [uploading, setUploading] = useState(false)
  const [faqDialogOpen, setFaqDialogOpen] = useState(false)
  const [faqDialogMode, setFaqDialogMode] = useState<'create' | 'edit'>('create')
  const [faqDialogId, setFaqDialogId] = useState<string | null>(null)
  const [faqQuestion, setFaqQuestion] = useState('')
  const [faqAnswer, setFaqAnswer] = useState('')
  const [faqRoles, setFaqRoles] = useState<string[]>([])
  const [faqOrder, setFaqOrder] = useState(0)
  const [faqSaving, setFaqSaving] = useState(false)
  const [deleteFaqId, setDeleteFaqId] = useState<string | null>(null)
  const [deleteCatalogTarget, setDeleteCatalogTarget] = useState<Catalog | null>(null)
  const [mainSectionDialogOpen, setMainSectionDialogOpen] = useState(false)
  const [mainSectionDialogMode, setMainSectionDialogMode] = useState<'create' | 'edit'>('create')
  const [mainSectionDialogId, setMainSectionDialogId] = useState<string | null>(null)
  const [mainSectionTitle, setMainSectionTitle] = useState('')
  const [mainSectionContent, setMainSectionContent] = useState('')
  const [mainSectionSaving, setMainSectionSaving] = useState(false)
  const [deleteMainSectionId, setDeleteMainSectionId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      const [meRes, visRes, helpRes, sectionsRes, catalogsRes] = await Promise.all([
        fetch('/api/auth/me'),
        fetch('/api/help/visibility'),
        fetch('/api/admin/help/main'),
        fetch('/api/admin/help/main-sections'),
        fetch('/api/admin/help/catalogs'),
      ])
      if (!meRes.ok) {
        router.push('/login')
        return
      }
      const meData = await meRes.json()
      if (meData.user?.role !== 'ADMIN') {
        router.push('/dashboard/help')
        return
      }
      setIsAdmin(true)
      if (visRes.ok) {
        const v = await visRes.json()
        setVisibility({
          templatesTabVisible: v.templatesTabVisible !== false,
          helpMainVisible: v.helpMainVisible !== false,
          helpAdminVisible: v.helpAdminVisible !== false,
        })
      }
      if (helpRes.ok) {
        const h = await helpRes.json()
        setMainContent(h.content ?? '')
      }
      if (sectionsRes.ok) {
        const s = await sectionsRes.json()
        setMainSections(s.sections ?? [])
      }
      if (catalogsRes.ok) {
        const c = await catalogsRes.json()
        setCatalogs(c.catalogs ?? [])
      }
      const faqRes = await fetch('/api/help')
      if (faqRes.ok) {
        const f = await faqRes.json()
        setGlobalFaqs(f.globalFaqs ?? [])
      }
    } catch (e) {
      console.error(e)
      toast.error('Ошибка загрузки')
    } finally {
      setLoading(false)
    }
  }

  const saveVisibility = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/help/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visibility),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Видимость сохранена')
    } catch {
      toast.error('Ошибка сохранения видимости')
    } finally {
      setSaving(false)
    }
  }

  const saveMain = async () => {
    setSaving(true)
    try {
      const res = await fetch('/api/admin/help/main', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: mainContent }),
      })
      if (!res.ok) throw new Error('Failed')
      toast.success('Основные моменты сохранены')
    } catch {
      toast.error('Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  const addMainSection = async () => {
    setMainSectionDialogMode('create')
    setMainSectionDialogId(null)
    setMainSectionTitle('Новый раздел')
    setMainSectionContent('')
    setMainSectionDialogOpen(true)
  }

  const editMainSection = (sec: { id: string; title: string; order: number; content: string }) => {
    setMainSectionDialogMode('edit')
    setMainSectionDialogId(sec.id)
    setMainSectionTitle(sec.title)
    setMainSectionContent(sec.content)
    setMainSectionDialogOpen(true)
  }

  const saveMainSection = async () => {
    setMainSectionSaving(true)
    try {
      if (mainSectionDialogMode === 'create') {
        const res = await fetch('/api/admin/help/main-sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: mainSectionTitle.trim() || 'Новый раздел',
            order: mainSections.length,
            content: mainSectionContent,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setMainSections((prev) => [...prev, { id: data.section.id, title: data.section.title, order: data.section.order, content: data.section.content ?? '' }])
        toast.success('Раздел добавлен')
      } else if (mainSectionDialogId) {
        const res = await fetch(`/api/admin/help/main-sections/${mainSectionDialogId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: mainSectionTitle.trim(), content: mainSectionContent }),
        })
        if (!res.ok) throw new Error('Failed')
        setMainSections((prev) =>
          prev.map((s) =>
            s.id === mainSectionDialogId ? { ...s, title: mainSectionTitle.trim(), content: mainSectionContent } : s
          )
        )
        toast.success('Раздел сохранён')
      }
      setMainSectionDialogOpen(false)
    } catch {
      toast.error('Ошибка сохранения раздела')
    } finally {
      setMainSectionSaving(false)
    }
  }

  const deleteMainSection = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/help/main-sections/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setMainSections((prev) => prev.filter((s) => s.id !== id))
      setDeleteMainSectionId(null)
      toast.success('Раздел удалён')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const addCatalog = async () => {
    try {
      const res = await fetch('/api/admin/help/catalogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: 'Новый каталог', order: catalogs.length }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const cat = data.catalog
      setCatalogs((prev) => [...prev, { id: cat.id, title: cat.title, order: cat.order, roles: cat.roles ?? [], instructions: [], faqs: [] }])
      toast.success('Каталог добавлен')
    } catch {
      toast.error('Ошибка добавления каталога')
    }
  }

  const deleteCatalog = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/help/catalogs/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setCatalogs((prev) => prev.filter((c) => c.id !== id))
      setDeleteCatalogTarget(null)
      toast.success('Каталог удалён')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const openAddGlobalFaq = () => {
    setFaqDialogMode('create')
    setFaqDialogId(null)
    setFaqQuestion('')
    setFaqAnswer('')
    setFaqRoles([])
    setFaqOrder(globalFaqs.length)
    setFaqDialogOpen(true)
  }

  const openEditGlobalFaq = (faq: { id: string; question: string; answer: string; order: number; roles?: string[] }) => {
    setFaqDialogMode('edit')
    setFaqDialogId(faq.id)
    setFaqQuestion(faq.question)
    setFaqAnswer(faq.answer)
    setFaqRoles(Array.isArray(faq.roles) ? [...faq.roles] : [])
    setFaqOrder(faq.order)
    setFaqDialogOpen(true)
  }

  const saveGlobalFaq = async () => {
    setFaqSaving(true)
    try {
      if (faqDialogMode === 'create') {
        const res = await fetch('/api/admin/help/faq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogId: null,
            question: faqQuestion.trim() || 'Вопрос',
            answer: faqAnswer.trim(),
            order: faqOrder,
            roles: faqRoles,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        const faq = data.faq
        setGlobalFaqs((prev) => [...prev, { ...faq, roles: faq.roles ?? [] }].sort((a, b) => a.order - b.order))
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
        setGlobalFaqs((prev) =>
          prev.map((f) =>
            f.id === faqDialogId
              ? { ...f, question: faqQuestion.trim(), answer: faqAnswer.trim(), order: faqOrder, roles: [...faqRoles] }
              : f
          ).sort((a, b) => a.order - b.order)
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

  const deleteGlobalFaq = async (id: string) => {
    try {
      const res = await fetch(`/api/admin/help/faq/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setGlobalFaqs((prev) => prev.filter((f) => f.id !== id))
      setDeleteFaqId(null)
      toast.success('Вопрос удалён')
    } catch {
      toast.error('Ошибка удаления')
    }
  }

  const uploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/help/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Upload failed')
      }
      const data = await res.json()
      navigator.clipboard.writeText(data.url)
      toast.success('Ссылка на изображение скопирована в буфер. Вставьте в текст инструкции.')
    } catch (err: any) {
      toast.error(err.message || 'Ошибка загрузки')
    } finally {
      setUploading(false)
      e.target.value = ''
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!isAdmin) {
    return null
  }

  const sections = [
    { id: 'visibility', label: 'Видимость вкладок', icon: Users },
    { id: 'main', label: 'Основные моменты', icon: BookOpen },
    { id: 'main-sections', label: 'Разделы (вкладки) в «Основные моменты»', icon: FileText },
    { id: 'catalogs', label: 'Каталоги', icon: FolderPlus },
    { id: 'faq', label: 'Глобальный FAQ', icon: HelpCircle },
    { id: 'uploads', label: 'Загрузки', icon: ImagePlus },
  ] as const

  return (
    <div className="min-h-screen bg-background">
      {/* Notion-style: тонкая верхняя панель */}
      <header className="sticky top-0 z-10 border-b border-border/60 bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4">
          <div className="flex items-center gap-4">
            <Link href="/dashboard/help" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="h-5 w-5" />
            </Link>
            <div>
              <h1 className="text-lg font-semibold tracking-tight">Управление справкой</h1>
              <p className="text-xs text-muted-foreground">Настройки и контент для раздела «Справка»</p>
            </div>
          </div>
          <Link href="/dashboard/help">
            <Button variant="ghost" size="sm">Открыть справку</Button>
          </Link>
        </div>
      </header>

      <div className="mx-auto max-w-5xl flex gap-8 px-4 py-8">
        {/* Боковая навигация в стиле Notion */}
        <aside className="hidden lg:block w-52 shrink-0">
          <nav className="sticky top-24 space-y-0.5">
            {sections.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="flex items-center gap-2 rounded-md px-3 py-2 text-sm text-muted-foreground hover:bg-muted/50 hover:text-foreground transition-colors"
              >
                <s.icon className="h-4 w-4 shrink-0" />
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        {/* Основной контент — блоки как в Notion */}
        <main className="min-w-0 flex-1 space-y-10">
          {/* Блок: Видимость */}
          <section id="visibility" className="scroll-mt-24">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-1">Видимость вкладок</h2>
              <p className="text-sm text-muted-foreground mb-4">Скрытые вкладки показывают пользователям сообщение «Администратор обновляет информацию, скоро откроет эту вкладку».</p>
              <div className="space-y-4">
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="templatesTabVisible"
                    checked={visibility.templatesTabVisible}
                    onCheckedChange={(c) => setVisibility((v) => ({ ...v, templatesTabVisible: !!c }))}
                  />
                  <Label htmlFor="templatesTabVisible">Показывать вкладку «Шаблоны» пользователям</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="helpMainVisible"
                    checked={visibility.helpMainVisible}
                    onCheckedChange={(c) => setVisibility((v) => ({ ...v, helpMainVisible: !!c }))}
                  />
                  <Label htmlFor="helpMainVisible">Показывать вкладку «Основные моменты» в справке</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <Checkbox
                    id="helpAdminVisible"
                    checked={visibility.helpAdminVisible}
                    onCheckedChange={(c) => setVisibility((v) => ({ ...v, helpAdminVisible: !!c }))}
                  />
                  <Label htmlFor="helpAdminVisible">Показывать вкладку «От Администратора» в справке</Label>
                </div>
                <Button onClick={saveVisibility} disabled={saving} size="sm">
                  {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                  Сохранить видимость
                </Button>
              </div>
            </div>
          </section>

          {/* Блок: Основные моменты */}
          <section id="main" className="scroll-mt-24">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-1">Основные моменты</h2>
              <p className="text-sm text-muted-foreground mb-4">Текст вкладки «Основные моменты». Форматирование, списки, изображения — через панель инструментов.</p>
              <HelpRichEditor
                value={mainContent}
                onChange={setMainContent}
                minHeight="220px"
                placeholder="Краткая справка по работе с планировщиком…"
              />
              <Button className="mt-4" onClick={saveMain} disabled={saving} size="sm">
                {saving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
                Сохранить
              </Button>
            </div>
          </section>

          {/* Блок: Разделы (вкладки) в «Основные моменты» */}
          <section id="main-sections" className="scroll-mt-24">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-1">Разделы (вкладки) в «Основные моменты»</h2>
              <p className="text-sm text-muted-foreground mb-4">Создайте несколько вкладок внутри «Основные моменты». Если разделов нет, показывается один блок текста выше.</p>
              <Button variant="outline" size="sm" onClick={addMainSection} className="gap-2 mb-4">
                <Plus className="h-4 w-4" />
                Добавить раздел (вкладку)
              </Button>
              <div className="space-y-2">
                {mainSections.map((sec) => (
                  <div key={sec.id} className="flex items-center justify-between gap-2 rounded-lg border p-3 bg-muted/20">
                    <span className="font-medium truncate flex-1 min-w-0">{sec.title}</span>
                    <div className="flex gap-1 shrink-0">
                      <Button variant="ghost" size="sm" onClick={() => editMainSection(sec)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                      <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteMainSectionId(sec.id)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
                {mainSections.length === 0 && (
                  <p className="text-sm text-muted-foreground">Нет разделов. Добавьте раздел — он отобразится как вкладка во вкладке «Основные моменты».</p>
                )}
              </div>
            </div>
          </section>

          {/* Блок: Каталоги */}
          <section id="catalogs" className="scroll-mt-24">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-1">Каталоги (От Администратора)</h2>
              <p className="text-sm text-muted-foreground mb-4">Разделы по шагам. В каждом каталоге — инструкции и FAQ.</p>
              <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={addCatalog} className="gap-2">
            <FolderPlus className="h-4 w-4" />
            Добавить каталог
          </Button>
          {catalogs.map((cat) => (
            <div key={cat.id} className="border rounded-lg p-4 space-y-2">
              <div className="flex items-center justify-between">
                <span className="font-medium">{cat.title}</span>
                <div className="flex gap-2">
                  <Link href={`/dashboard/help/admin/catalogs/${cat.id}`}>
                    <Button variant="ghost" size="sm">Редактировать</Button>
                  </Link>
                  <Button variant="ghost" size="sm" className="text-destructive" onClick={() => setDeleteCatalogTarget(cat)}>
                    Удалить
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                Инструкций: {cat.instructions.length}, FAQ: {cat.faqs.length}
              </p>
            </div>
          ))}
              {catalogs.length === 0 && (
                <p className="text-sm text-muted-foreground">Нет каталогов. Добавьте каталог и перейдите в него для добавления инструкций и FAQ.</p>
              )}
              </div>
            </div>
          </section>

          {/* Блок: Глобальный FAQ */}
          <section id="faq" className="scroll-mt-24">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-1">Глобальный FAQ</h2>
              <p className="text-sm text-muted-foreground mb-4">Вопросы и ответы без привязки к каталогу. Показываются во вкладке «От Администратора».</p>
              <div className="space-y-4">
          <Button variant="outline" size="sm" onClick={openAddGlobalFaq} className="gap-2">
            <Plus className="h-4 w-4" />
            Добавить вопрос
          </Button>
          {globalFaqs.length === 0 ? (
            <p className="text-sm text-muted-foreground">Нет глобальных вопросов. Добавьте первый.</p>
          ) : (
            <ul className="space-y-2">
              {globalFaqs.map((faq) => (
                <li
                  key={faq.id}
                  className="flex items-center justify-between gap-2 rounded-lg border p-3 bg-muted/20"
                >
                  <p className="text-sm font-medium truncate flex-1 min-w-0">{faq.question}</p>
                  <div className="flex gap-1 shrink-0">
                    <Button variant="ghost" size="sm" onClick={() => openEditGlobalFaq(faq)}>
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
              </div>
            </div>
          </section>

          {/* Блок: Загрузки */}
          <section id="uploads" className="scroll-mt-24">
            <div className="rounded-xl border border-border/60 bg-card p-6 shadow-sm">
              <h2 className="text-base font-semibold mb-1">Загрузка изображений</h2>
              <p className="text-sm text-muted-foreground mb-4">Загрузите файл — ссылка скопируется в буфер. Можно вставлять изображения и через кнопку в редакторе.</p>
              <input
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                id="help-upload"
                onChange={uploadImage}
                disabled={uploading}
              />
              <Label htmlFor="help-upload">
                <Button variant="outline" size="sm" asChild disabled={uploading}>
                  <span>
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ImagePlus className="h-4 w-4 mr-2" />}
                    Выбрать изображение
                  </span>
                </Button>
              </Label>
            </div>
          </section>
        </main>
      </div>

      <Dialog open={faqDialogOpen} onOpenChange={setFaqDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {faqDialogMode === 'create' ? 'Добавить вопрос (глобальный FAQ)' : 'Редактировать вопрос'}
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
            <Button onClick={saveGlobalFaq} disabled={faqSaving}>
              {faqSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {faqDialogMode === 'create' ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteCatalogTarget} onOpenChange={(open) => !open && setDeleteCatalogTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить каталог?</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteCatalogTarget && (
                <>
                  Будет удалено: каталог «<strong>{deleteCatalogTarget.title}</strong>», инструкций: {deleteCatalogTarget.instructions.length}, вопросов: {deleteCatalogTarget.faqs.length}.
                  Действие нельзя отменить.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteCatalogTarget && deleteCatalog(deleteCatalogTarget.id)}
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
              onClick={() => deleteFaqId && deleteGlobalFaq(deleteFaqId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={mainSectionDialogOpen} onOpenChange={setMainSectionDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {mainSectionDialogMode === 'create' ? 'Добавить раздел (вкладку)' : 'Редактировать раздел'}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label>Название вкладки</Label>
              <Input
                value={mainSectionTitle}
                onChange={(e) => setMainSectionTitle(e.target.value)}
                placeholder="Например: Быстрый старт"
              />
            </div>
            <div className="space-y-2">
              <Label>Содержимое</Label>
              <HelpRichEditor
                value={mainSectionContent}
                onChange={setMainSectionContent}
                minHeight="200px"
                placeholder="Текст раздела…"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setMainSectionDialogOpen(false)}>
              Отмена
            </Button>
            <Button onClick={saveMainSection} disabled={mainSectionSaving}>
              {mainSectionSaving ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              {mainSectionDialogMode === 'create' ? 'Добавить' : 'Сохранить'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteMainSectionId} onOpenChange={(open) => !open && setDeleteMainSectionId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Удалить раздел?</AlertDialogTitle>
            <AlertDialogDescription>Действие нельзя отменить.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Отмена</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground"
              onClick={() => deleteMainSectionId && deleteMainSection(deleteMainSectionId)}
            >
              Удалить
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
