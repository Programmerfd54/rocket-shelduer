"use client"

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { ExternalLink, FolderPlus, ImagePlus, Loader2, Plus, FileText, HelpCircle, BookOpen } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Checkbox } from '@/components/ui/checkbox'
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
import { CopyButton } from '@/components/common/CopyButton'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { Section } from '@/components/common/Section'
import { HelpRichEditor, normalizeHelpRoles } from '@/components/_components/HelpRichEditor'
import {
  HelpFaqDialog,
  HelpListRow,
  helpRolesLabel,
  type HelpFaqValues,
} from '@/components/_components/HelpAdminParts'
import { useCopyToClipboard } from '@/lib/useCopyToClipboard'

type Catalog = {
  id: string
  title: string
  order: number
  roles?: string[]
  instructions: Array<{ id: string; title: string; content: string; order: number }>
  faqs: Array<{ id: string; question: string; answer: string; order: number }>
}
type MainSection = { id: string; title: string; order: number; content: string }
type GlobalFaq = { id: string; question: string; answer: string; order: number; roles?: string[] }
type Visibility = { templatesTabVisible: boolean; helpMainVisible: boolean; helpAdminVisible: boolean }

const TITLE_MAX = 100
const UPLOAD_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp']
const UPLOAD_MAX_BYTES = 5 * 1024 * 1024

/** Ошибка названия (каталог / раздел) или undefined. */
function validateTitle(raw: string): string | undefined {
  const v = raw.trim()
  if (!v) return 'Введите название.'
  if (v.length > TITLE_MAX) return `Не длиннее ${TITLE_MAX} символов.`
  return undefined
}

const NAV_SECTIONS = [
  { id: 'visibility', label: 'Видимость вкладок' },
  { id: 'main', label: 'Основные моменты' },
  { id: 'main-sections', label: 'Разделы основных моментов' },
  { id: 'catalogs', label: 'Каталоги' },
  { id: 'faq', label: 'Глобальный FAQ' },
  { id: 'uploads', label: 'Загрузка изображений' },
] as const

function PageSkeleton() {
  return (
    <PageContainer className="px-4 sm:px-6">
      <div role="status" aria-busy="true" aria-label="Загрузка" className="space-y-6">
        <div className="space-y-2">
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-80 max-w-full" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="space-y-3">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-24 w-full rounded-lg" />
          </div>
        ))}
      </div>
    </PageContainer>
  )
}

export default function HelpAdminPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const copy = useCopyToClipboard()
  const chromeMinimal = searchParams.get('chrome') === '0'
  /** Для ссылок внутри приложения при встраивании в iframe (chrome=0) */
  const helpAdminRouteSuffix = chromeMinimal ? '?chrome=0' : ''
  const containerClass = chromeMinimal ? 'max-w-none px-3 py-3 lg:py-3' : 'px-4 sm:px-6'

  const [loading, setLoading] = useState(true)
  const [isAdmin, setIsAdmin] = useState(false)

  // Видимость вкладок
  const [visibility, setVisibility] = useState<Visibility>({
    templatesTabVisible: true,
    helpMainVisible: true,
    helpAdminVisible: true,
  })
  const [savedVisibility, setSavedVisibility] = useState<Visibility | null>(null)
  const [savingVisibility, setSavingVisibility] = useState(false)

  // Основные моменты
  const [mainContent, setMainContent] = useState('')
  const [savedMainContent, setSavedMainContent] = useState('')
  const [savingMain, setSavingMain] = useState(false)

  const [mainSections, setMainSections] = useState<MainSection[]>([])
  const [catalogs, setCatalogs] = useState<Catalog[]>([])
  const [globalFaqs, setGlobalFaqs] = useState<GlobalFaq[]>([])

  // Диалог раздела «Основных моментов»
  const [sectionDialogOpen, setSectionDialogOpen] = useState(false)
  const [sectionMode, setSectionMode] = useState<'create' | 'edit'>('create')
  const [sectionId, setSectionId] = useState<string | null>(null)
  const [sectionTitle, setSectionTitle] = useState('')
  const [sectionContent, setSectionContent] = useState('')
  const [sectionSubmitted, setSectionSubmitted] = useState(false)
  const [sectionSaving, setSectionSaving] = useState(false)
  const [deleteSection, setDeleteSection] = useState<MainSection | null>(null)

  // Диалог нового каталога
  const [catalogDialogOpen, setCatalogDialogOpen] = useState(false)
  const [catalogTitle, setCatalogTitle] = useState('')
  const [catalogSubmitted, setCatalogSubmitted] = useState(false)
  const [catalogSaving, setCatalogSaving] = useState(false)
  const [deleteCatalogTarget, setDeleteCatalogTarget] = useState<Catalog | null>(null)

  // Глобальный FAQ
  const [faqDialog, setFaqDialog] = useState<{ mode: 'create' | 'edit'; faq: GlobalFaq | null } | null>(null)
  const [deleteFaq, setDeleteFaq] = useState<GlobalFaq | null>(null)

  const [deleting, setDeleting] = useState(false)

  // Загрузка изображений
  const [uploading, setUploading] = useState(false)
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null)
  const uploadInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const load = async () => {
      try {
        const meRes = await fetch('/api/auth/me')
        if (!meRes.ok) {
          router.push('/login')
          return
        }
        const meData = await meRes.json()
        const role = meData.user?.role
        if (role !== 'LEAD_SUP') {
          router.push('/dashboard/admin/help')
          return
        }
        setIsAdmin(true)

        const sRes = await fetch('/api/admin/settings')
        if (sRes.ok) {
          const d = await sRes.json()
          const st = d.settings || {}
          const v: Visibility = {
            templatesTabVisible: st.templatesTabVisible !== 'false',
            helpMainVisible: st.helpMainVisible !== 'false',
            helpAdminVisible: st.helpAdminVisible !== 'false',
          }
          setVisibility(v)
          setSavedVisibility(v)
        }

        const [helpRes, sectionsRes, catalogsRes] = await Promise.all([
          fetch('/api/admin/help/main'),
          fetch('/api/admin/help/main-sections'),
          fetch('/api/admin/help/catalogs'),
        ])
        if (helpRes.ok) {
          const h = await helpRes.json()
          setMainContent(h.content ?? '')
          setSavedMainContent(h.content ?? '')
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
        if (!helpRes.ok || !sectionsRes.ok || !catalogsRes.ok) {
          toast.error('Часть данных справки не загрузилась', { description: 'Обновите страницу и попробуйте ещё раз.' })
        }
      } catch (e) {
        console.error(e)
        toast.error('Не удалось загрузить справку', { description: 'Проверьте соединение и обновите страницу.' })
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [router])

  /* ---------- видимость ---------- */

  const visibilityDirty =
    !!savedVisibility &&
    (visibility.templatesTabVisible !== savedVisibility.templatesTabVisible ||
      visibility.helpMainVisible !== savedVisibility.helpMainVisible ||
      visibility.helpAdminVisible !== savedVisibility.helpAdminVisible)

  const saveVisibility = async () => {
    setSavingVisibility(true)
    try {
      const res = await fetch('/api/admin/help/visibility', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(visibility),
      })
      if (!res.ok) throw new Error('Failed')
      setSavedVisibility(visibility)
      toast.success('Видимость вкладок сохранена')
    } catch {
      toast.error('Не удалось сохранить видимость', { description: 'Попробуйте ещё раз.' })
    } finally {
      setSavingVisibility(false)
    }
  }

  /* ---------- основные моменты ---------- */

  const mainDirty = mainContent !== savedMainContent

  const saveMain = async () => {
    setSavingMain(true)
    try {
      const res = await fetch('/api/admin/help/main', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: mainContent }),
      })
      if (!res.ok) throw new Error('Failed')
      setSavedMainContent(mainContent)
      toast.success('Основные моменты сохранены')
    } catch {
      toast.error('Не удалось сохранить текст', { description: 'Изменения остались в редакторе — попробуйте ещё раз.' })
    } finally {
      setSavingMain(false)
    }
  }

  /* ---------- разделы основных моментов ---------- */

  const openAddSection = () => {
    setSectionMode('create')
    setSectionId(null)
    setSectionTitle('')
    setSectionContent('')
    setSectionSubmitted(false)
    setSectionDialogOpen(true)
  }

  const openEditSection = (sec: MainSection) => {
    setSectionMode('edit')
    setSectionId(sec.id)
    setSectionTitle(sec.title)
    setSectionContent(sec.content)
    setSectionSubmitted(false)
    setSectionDialogOpen(true)
  }

  const sectionTitleError = validateTitle(sectionTitle)

  const saveSection = async (e: React.FormEvent) => {
    e.preventDefault()
    setSectionSubmitted(true)
    if (sectionTitleError || sectionSaving) return
    const title = sectionTitle.trim()
    setSectionSaving(true)
    try {
      if (sectionMode === 'create') {
        const res = await fetch('/api/admin/help/main-sections', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, order: mainSections.length, content: sectionContent }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        setMainSections((prev) => [
          ...prev,
          { id: data.section.id, title: data.section.title, order: data.section.order, content: data.section.content ?? '' },
        ])
        toast.success('Раздел добавлен')
      } else if (sectionId) {
        const res = await fetch(`/api/admin/help/main-sections/${sectionId}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title, content: sectionContent }),
        })
        if (!res.ok) throw new Error('Failed')
        setMainSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, title, content: sectionContent } : s)))
        toast.success('Раздел сохранён')
      }
      setSectionDialogOpen(false)
    } catch {
      toast.error('Не удалось сохранить раздел', { description: 'Проверьте данные и попробуйте ещё раз.' })
    } finally {
      setSectionSaving(false)
    }
  }

  const confirmDeleteSection = async () => {
    if (!deleteSection) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/help/main-sections/${deleteSection.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setMainSections((prev) => prev.filter((s) => s.id !== deleteSection.id))
      toast.success('Раздел удалён')
      setDeleteSection(null)
    } catch {
      toast.error('Не удалось удалить раздел', { description: 'Попробуйте ещё раз.' })
    } finally {
      setDeleting(false)
    }
  }

  /* ---------- каталоги ---------- */

  const openAddCatalog = () => {
    setCatalogTitle('')
    setCatalogSubmitted(false)
    setCatalogDialogOpen(true)
  }

  const catalogTitleError = validateTitle(catalogTitle)

  const addCatalog = async (e: React.FormEvent) => {
    e.preventDefault()
    setCatalogSubmitted(true)
    if (catalogTitleError || catalogSaving) return
    setCatalogSaving(true)
    try {
      const res = await fetch('/api/admin/help/catalogs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: catalogTitle.trim(), order: catalogs.length }),
      })
      if (!res.ok) throw new Error('Failed')
      const data = await res.json()
      const cat = data.catalog
      setCatalogs((prev) => [
        ...prev,
        { id: cat.id, title: cat.title, order: cat.order, roles: cat.roles ?? [], instructions: [], faqs: [] },
      ])
      toast.success('Каталог добавлен', { description: 'Откройте его, чтобы добавить инструкции и вопросы.' })
      setCatalogDialogOpen(false)
    } catch {
      toast.error('Не удалось добавить каталог', { description: 'Попробуйте ещё раз.' })
    } finally {
      setCatalogSaving(false)
    }
  }

  const confirmDeleteCatalog = async () => {
    if (!deleteCatalogTarget) return
    setDeleting(true)
    try {
      const res = await fetch(`/api/admin/help/catalogs/${deleteCatalogTarget.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error('Failed')
      setCatalogs((prev) => prev.filter((c) => c.id !== deleteCatalogTarget.id))
      toast.success('Каталог удалён')
      setDeleteCatalogTarget(null)
    } catch {
      toast.error('Не удалось удалить каталог', { description: 'Попробуйте ещё раз.' })
    } finally {
      setDeleting(false)
    }
  }

  /* ---------- глобальный FAQ ---------- */

  const faqInitial: HelpFaqValues =
    faqDialog?.mode === 'edit' && faqDialog.faq
      ? {
          question: faqDialog.faq.question,
          answer: faqDialog.faq.answer,
          roles: normalizeHelpRoles(faqDialog.faq.roles),
          order: faqDialog.faq.order,
        }
      : { question: '', answer: '', roles: [], order: globalFaqs.length }

  const submitGlobalFaq = async (v: HelpFaqValues): Promise<boolean> => {
    try {
      if (faqDialog?.mode === 'edit' && faqDialog.faq) {
        const id = faqDialog.faq.id
        const res = await fetch(`/api/admin/help/faq/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ question: v.question, answer: v.answer, order: v.order, roles: v.roles }),
        })
        if (!res.ok) throw new Error('Failed')
        setGlobalFaqs((prev) =>
          prev.map((f) => (f.id === id ? { ...f, ...v, roles: [...v.roles] } : f)).sort((a, b) => a.order - b.order)
        )
        toast.success('Вопрос сохранён')
      } else {
        const res = await fetch('/api/admin/help/faq', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            catalogId: null,
            question: v.question,
            answer: v.answer,
            order: v.order,
            roles: v.roles,
          }),
        })
        if (!res.ok) throw new Error('Failed')
        const data = await res.json()
        const faq = data.faq
        setGlobalFaqs((prev) => [...prev, { ...faq, roles: faq.roles ?? [] }].sort((a, b) => a.order - b.order))
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
      setGlobalFaqs((prev) => prev.filter((f) => f.id !== deleteFaq.id))
      toast.success('Вопрос удалён')
      setDeleteFaq(null)
    } catch {
      toast.error('Не удалось удалить вопрос', { description: 'Попробуйте ещё раз.' })
    } finally {
      setDeleting(false)
    }
  }

  /* ---------- загрузка изображения ---------- */

  const uploadImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (!UPLOAD_TYPES.includes(file.type)) {
      toast.error('Неподходящий формат', { description: 'Допустимы JPEG, PNG, GIF и WebP.' })
      return
    }
    if (file.size > UPLOAD_MAX_BYTES) {
      toast.error('Файл слишком большой', { description: 'Максимальный размер изображения — 5 МБ.' })
      return
    }
    setUploading(true)
    const toastId = toast.loading('Загружаем изображение…')
    try {
      const form = new FormData()
      form.append('file', file)
      const res = await fetch('/api/admin/help/upload', { method: 'POST', body: form })
      if (!res.ok) {
        const d = await res.json().catch(() => ({}))
        throw new Error(d.error || 'Upload failed')
      }
      const data = await res.json()
      setUploadedUrl(data.url)
      toast.dismiss(toastId)
      const copied = await copy(data.url, 'Изображение загружено, ссылка скопирована')
      if (!copied) toast.success('Изображение загружено', { description: 'Скопируйте ссылку из поля ниже.' })
    } catch (err) {
      toast.error('Не удалось загрузить изображение', {
        id: toastId,
        description: err instanceof Error && err.message !== 'Upload failed' ? err.message : 'Попробуйте ещё раз.',
      })
    } finally {
      setUploading(false)
    }
  }

  if (loading || !isAdmin) return <PageSkeleton />

  const breadcrumbs = chromeMinimal ? undefined : (
    <Breadcrumbs
      items={[
        { label: 'Дашборд', href: '/dashboard' },
        { label: 'Справка', href: '/dashboard/admin/help' },
        { label: 'Управление справкой', current: true },
      ]}
    />
  )

  return (
    <PageContainer className={containerClass}>
      <PageHeader
        title="Управление справкой"
        description="Настройки и содержимое раздела «Справка». Изменения видны пользователям сразу после сохранения."
        breadcrumbs={breadcrumbs}
        actions={
          <Button asChild variant="outline" size="sm">
            <Link href="/dashboard/admin/help">
              <ExternalLink aria-hidden />
              Открыть справку
            </Link>
          </Button>
        }
      />

      <div className="flex gap-8">
        <aside className="hidden w-48 shrink-0 lg:block">
          <nav aria-label="Разделы страницы" className="sticky top-6 space-y-0.5">
            {NAV_SECTIONS.map((s) => (
              <a
                key={s.id}
                href={`#${s.id}`}
                className="block rounded-md px-2.5 py-1.5 text-[13px] text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/40"
              >
                {s.label}
              </a>
            ))}
          </nav>
        </aside>

        <div className="min-w-0 flex-1 space-y-8">
          <Section
            id="visibility"
            className="scroll-mt-6"
            title="Видимость вкладок"
            description="Скрытая вкладка показывает пользователям сообщение «Администратор обновляет информацию, скоро откроет эту вкладку»."
          >
            <div className="space-y-3">
              {(
                [
                  ['templatesTabVisible', 'Показывать вкладку «Шаблоны» пользователям'],
                  ['helpMainVisible', 'Показывать вкладку «Основные моменты» в справке'],
                  ['helpAdminVisible', 'Показывать вкладку «От Администратора» в справке'],
                ] as const
              ).map(([key, label]) => (
                <div key={key} className="flex items-center gap-2">
                  <Checkbox
                    id={key}
                    checked={visibility[key]}
                    onCheckedChange={(c) => setVisibility((v) => ({ ...v, [key]: !!c }))}
                  />
                  <Label htmlFor={key} className="text-sm font-normal">
                    {label}
                  </Label>
                </div>
              ))}
              <div className="pt-1">
                <Button onClick={saveVisibility} disabled={savingVisibility || !visibilityDirty} size="sm">
                  {savingVisibility && <Loader2 className="animate-spin" />}
                  Сохранить
                </Button>
              </div>
            </div>
          </Section>

          <Section
            id="main"
            className="scroll-mt-6"
            title="Основные моменты"
            description="Текст вкладки «Основные моменты». Форматирование, списки и изображения — через панель инструментов."
          >
            <div className="space-y-3">
              <HelpRichEditor
                value={mainContent}
                onChange={setMainContent}
                minHeight="220px"
                placeholder="Краткая справка по работе с планировщиком…"
              />
              <div className="flex items-center gap-3">
                <Button onClick={saveMain} disabled={savingMain || !mainDirty} size="sm">
                  {savingMain && <Loader2 className="animate-spin" />}
                  Сохранить
                </Button>
                {mainDirty && <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>}
              </div>
            </div>
          </Section>

          <Section
            id="main-sections"
            className="scroll-mt-6"
            bare
            title="Разделы основных моментов"
            description="Каждый раздел отображается отдельной вкладкой внутри «Основных моментов». Если разделов нет, показывается текст выше."
            actions={
              <Button variant="outline" size="sm" onClick={openAddSection}>
                <Plus aria-hidden />
                Добавить раздел
              </Button>
            }
          >
            {mainSections.length === 0 ? (
              <EmptyState
                icon={<FileText />}
                title="Разделов пока нет"
                description="Добавьте раздел — он появится вкладкой в «Основных моментах»."
              />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {mainSections.map((sec) => (
                  <HelpListRow
                    key={sec.id}
                    title={sec.title}
                    editLabel={`Изменить раздел «${sec.title}»`}
                    deleteLabel={`Удалить раздел «${sec.title}»`}
                    onEdit={() => openEditSection(sec)}
                    onDelete={() => setDeleteSection(sec)}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="catalogs"
            className="scroll-mt-6"
            bare
            title="Каталоги «От Администратора»"
            description="Разделы по темам. В каждом каталоге — свои инструкции и вопросы."
            actions={
              <Button variant="outline" size="sm" onClick={openAddCatalog}>
                <FolderPlus aria-hidden />
                Добавить каталог
              </Button>
            }
          >
            {catalogs.length === 0 ? (
              <EmptyState
                icon={<BookOpen />}
                title="Каталогов пока нет"
                description="Добавьте каталог, затем откройте его, чтобы создать инструкции и вопросы."
              />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {catalogs.map((cat) => (
                  <HelpListRow
                    key={cat.id}
                    title={cat.title}
                    meta={`Инструкций: ${cat.instructions.length} · Вопросов: ${cat.faqs.length}`}
                    editLabel={`Открыть каталог «${cat.title}»`}
                    deleteLabel={`Удалить каталог «${cat.title}»`}
                    editHref={`/dashboard/admin/help/admin/catalogs/${cat.id}${helpAdminRouteSuffix}`}
                    onDelete={() => setDeleteCatalogTarget(cat)}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="faq"
            className="scroll-mt-6"
            bare
            title="Глобальный FAQ"
            description="Вопросы и ответы без привязки к каталогу. Показываются во вкладке «От Администратора»."
            actions={
              <Button variant="outline" size="sm" onClick={() => setFaqDialog({ mode: 'create', faq: null })}>
                <Plus aria-hidden />
                Добавить вопрос
              </Button>
            }
          >
            {globalFaqs.length === 0 ? (
              <EmptyState
                icon={<HelpCircle />}
                title="Вопросов пока нет"
                description="Добавьте первый вопрос — он появится в справке."
              />
            ) : (
              <ul className="divide-y rounded-lg border bg-card">
                {globalFaqs.map((faq) => (
                  <HelpListRow
                    key={faq.id}
                    title={faq.question}
                    meta={helpRolesLabel(normalizeHelpRoles(faq.roles))}
                    editLabel="Изменить вопрос"
                    deleteLabel="Удалить вопрос"
                    onEdit={() => setFaqDialog({ mode: 'edit', faq })}
                    onDelete={() => setDeleteFaq(faq)}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            id="uploads"
            className="scroll-mt-6"
            title="Загрузка изображений"
            description="Загрузите файл — ссылка скопируется в буфер. Вставлять изображения можно и кнопкой в редакторе."
          >
            <div className="space-y-3">
              <input
                ref={uploadInputRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                className="hidden"
                onChange={uploadImage}
                disabled={uploading}
                aria-label="Выбрать изображение для загрузки"
              />
              <Button variant="outline" size="sm" disabled={uploading} onClick={() => uploadInputRef.current?.click()}>
                {uploading ? <Loader2 className="animate-spin" /> : <ImagePlus aria-hidden />}
                {uploading ? 'Загрузка…' : 'Выбрать изображение'}
              </Button>
              <p className="text-xs text-muted-foreground">JPEG, PNG, GIF или WebP, до 5 МБ.</p>
              {uploadedUrl && (
                <div className="flex items-center gap-1">
                  <Input readOnly value={uploadedUrl} aria-label="Ссылка на загруженное изображение" className="font-mono text-xs" />
                  <CopyButton text={uploadedUrl} variant="outline" size="icon" aria-label="Скопировать ссылку" />
                </div>
              )}
            </div>
          </Section>
        </div>
      </div>

      {/* Раздел основных моментов */}
      <Dialog open={sectionDialogOpen} onOpenChange={(o) => !sectionSaving && setSectionDialogOpen(o)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>{sectionMode === 'create' ? 'Новый раздел' : 'Редактировать раздел'}</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveSection} noValidate className="space-y-4">
            <Field
              label="Название вкладки"
              htmlFor="help-section-title"
              required
              error={sectionSubmitted ? sectionTitleError : undefined}
            >
              <Input
                id="help-section-title"
                value={sectionTitle}
                onChange={(e) => setSectionTitle(e.target.value)}
                placeholder="Например: Быстрый старт"
                aria-invalid={sectionSubmitted && !!sectionTitleError}
                disabled={sectionSaving}
                autoFocus
              />
            </Field>
            <Field label="Содержимое">
              <HelpRichEditor
                value={sectionContent}
                onChange={setSectionContent}
                minHeight="200px"
                placeholder="Текст раздела…"
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setSectionDialogOpen(false)} disabled={sectionSaving}>
                Отмена
              </Button>
              <Button type="submit" disabled={sectionSaving || (sectionSubmitted && !!sectionTitleError)}>
                {sectionSaving && <Loader2 className="animate-spin" />}
                {sectionMode === 'create' ? 'Добавить' : 'Сохранить'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Новый каталог */}
      <Dialog open={catalogDialogOpen} onOpenChange={(o) => !catalogSaving && setCatalogDialogOpen(o)}>
        <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
          <DialogHeader>
            <DialogTitle>Новый каталог</DialogTitle>
          </DialogHeader>
          <form onSubmit={addCatalog} noValidate className="space-y-4">
            <Field
              label="Название каталога"
              htmlFor="help-catalog-title"
              required
              hint="Станет названием вкладки в справке."
              error={catalogSubmitted ? catalogTitleError : undefined}
            >
              <Input
                id="help-catalog-title"
                value={catalogTitle}
                onChange={(e) => setCatalogTitle(e.target.value)}
                placeholder="Например: Работа с анонсами"
                aria-invalid={catalogSubmitted && !!catalogTitleError}
                disabled={catalogSaving}
                autoFocus
              />
            </Field>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setCatalogDialogOpen(false)} disabled={catalogSaving}>
                Отмена
              </Button>
              <Button type="submit" disabled={catalogSaving || (catalogSubmitted && !!catalogTitleError)}>
                {catalogSaving && <Loader2 className="animate-spin" />}
                Добавить
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <HelpFaqDialog
        open={faqDialog !== null}
        onOpenChange={(o) => !o && setFaqDialog(null)}
        title={faqDialog?.mode === 'edit' ? 'Редактировать вопрос' : 'Новый вопрос (глобальный FAQ)'}
        submitLabel={faqDialog?.mode === 'edit' ? 'Сохранить' : 'Добавить'}
        initial={faqInitial}
        onSubmit={submitGlobalFaq}
      />

      <ConfirmDialog
        open={!!deleteSection}
        onOpenChange={(o) => !o && setDeleteSection(null)}
        title="Удалить раздел?"
        description={
          deleteSection && (
            <>
              Раздел «<strong>{deleteSection.title}</strong>» и его содержимое будут удалены. Действие нельзя отменить.
            </>
          )
        }
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={confirmDeleteSection}
      />

      <ConfirmDialog
        open={!!deleteCatalogTarget}
        onOpenChange={(o) => !o && setDeleteCatalogTarget(null)}
        title="Удалить каталог?"
        description={
          deleteCatalogTarget && (
            <>
              Каталог «<strong>{deleteCatalogTarget.title}</strong>» будет удалён вместе с инструкциями (
              {deleteCatalogTarget.instructions.length}) и вопросами ({deleteCatalogTarget.faqs.length}). Действие нельзя
              отменить.
            </>
          )
        }
        confirmLabel="Удалить"
        destructive
        loading={deleting}
        onConfirm={confirmDeleteCatalog}
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
