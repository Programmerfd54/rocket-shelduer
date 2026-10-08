"use client"

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { toast } from 'sonner'
import { BookOpen, ChevronRight, Construction, HelpCircle, Settings2, TriangleAlert, Users } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Skeleton } from '@/components/ui/skeleton'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { HelpHtmlContent } from '@/components/_components/HelpHtmlContent'
import { cn } from '@/lib/utils'

const PLACEHOLDER_MESSAGE = 'Администратор обновляет информацию, скоро откроет эту вкладку.'

type Faq = { id: string; question: string; answer: string; order: number }
type HelpData = {
  helpMainVisible: boolean
  helpAdminVisible: boolean
  mainContent: string | null
  mainSections: Array<{ id: string; title: string; order: number; content: string }>
  catalogs: Array<{
    id: string
    title: string
    order: number
    instructions: Array<{ id: string; title: string; content: string; order: number }>
    faqs: Faq[]
  }>
  globalFaqs: Faq[]
  isAdmin: boolean
}

const breadcrumbs = (
  <Breadcrumbs
    items={[
      { label: 'Дашборд', href: '/dashboard' },
      { label: 'Админ', href: '/dashboard/admin' },
      { label: 'Справка', current: true },
    ]}
  />
)

/** Список вопросов-ответов: плоский «аккордеон» с разделителями. */
function FaqList({
  title,
  faqs,
  keyPrefix,
  openId,
  onToggle,
}: {
  title: string
  faqs: Faq[]
  keyPrefix: string
  openId: string | null
  onToggle: (id: string | null) => void
}) {
  return (
    <section aria-label={title} className="space-y-2">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="divide-y rounded-lg border bg-card">
        {faqs.map((faq) => {
          const key = `${keyPrefix}-${faq.id}`
          const isOpen = openId === key
          return (
            <div key={faq.id}>
              <button
                type="button"
                className="flex min-h-11 w-full items-center gap-2 px-4 py-2.5 text-left text-sm font-medium outline-none transition-colors hover:bg-muted/40 focus-visible:bg-muted/40 focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40"
                onClick={() => onToggle(isOpen ? null : key)}
                aria-expanded={isOpen}
              >
                <ChevronRight
                  className={cn('size-4 shrink-0 text-muted-foreground transition-transform', isOpen && 'rotate-90')}
                  aria-hidden
                />
                <span className="min-w-0 flex-1">{faq.question}</span>
              </button>
              {isOpen && (
                <p className="whitespace-pre-wrap px-4 pb-3 pl-10 text-sm text-muted-foreground">{faq.answer}</p>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** Блок с HTML-контентом справки. */
function ContentCard({ html, title }: { html: string; title?: string }) {
  return (
    <div className="rounded-lg border bg-card p-4 sm:p-5">
      {title && <h2 className="mb-3 text-base font-semibold">{title}</h2>}
      <HelpHtmlContent html={html} className="text-[15px] leading-relaxed" />
    </div>
  )
}

function HelpSkeleton() {
  return (
    <PageContainer size="narrow" className="px-4 sm:px-6">
      <div role="status" aria-busy="true" aria-label="Загрузка справки" className="space-y-4">
        <div className="space-y-2 pb-1">
          <Skeleton className="h-6 w-40" />
          <Skeleton className="h-4 w-72 max-w-full" />
        </div>
        <Skeleton className="h-9 w-72 max-w-full" />
        <div className="space-y-3 rounded-lg border bg-card p-5">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-5/6" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>
    </PageContainer>
  )
}

export default function HelpPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<HelpData | null>(null)
  const [openFaqId, setOpenFaqId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/help')
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login')
          return
        }
        throw new Error('Failed to load help')
      }
      setData(await res.json())
    } catch (e) {
      console.error(e)
      setData(null)
      toast.error('Не удалось загрузить справку', { description: 'Проверьте соединение и попробуйте ещё раз.' })
    } finally {
      setLoading(false)
    }
  }, [router])

  useEffect(() => {
    load()
  }, [load])

  if (loading) return <HelpSkeleton />

  if (!data) {
    return (
      <PageContainer size="narrow" className="px-4 sm:px-6">
        <PageHeader title="Справка" breadcrumbs={breadcrumbs} />
        <EmptyState
          icon={<TriangleAlert />}
          title="Не удалось загрузить справку"
          description="Проверьте соединение и попробуйте ещё раз."
          action={{ label: 'Повторить', onClick: load }}
        />
      </PageContainer>
    )
  }

  const showMain = data.helpMainVisible
  const showAdmin = data.helpAdminVisible
  const mainSections = data.mainSections ?? []

  const manageAction = data.isAdmin ? (
    <Button asChild variant="outline" size="sm">
      <Link href="/dashboard/admin/help/admin">
        <Settings2 aria-hidden />
        Управление справкой
      </Link>
    </Button>
  ) : undefined

  if (!showMain && !showAdmin) {
    return (
      <PageContainer size="narrow" className="px-4 sm:px-6">
        <PageHeader title="Справка" breadcrumbs={breadcrumbs} actions={manageAction} />
        <EmptyState icon={<Construction />} title="Вкладка временно недоступна" description={PLACEHOLDER_MESSAGE} />
      </PageContainer>
    )
  }

  return (
    <PageContainer size="narrow" className="px-4 sm:px-6">
      <PageHeader
        title="Справка"
        description="Основные моменты и инструкции от администратора."
        breadcrumbs={breadcrumbs}
        actions={manageAction}
      />

      <Tabs defaultValue={showMain ? 'main' : 'admin'} className="gap-4">
        <TabsList className="h-auto max-w-full self-start overflow-x-auto">
          {showMain && (
            <TabsTrigger value="main" className="h-8 px-3">
              <BookOpen aria-hidden />
              Основные моменты
            </TabsTrigger>
          )}
          {showAdmin && (
            <TabsTrigger value="admin" className="h-8 px-3">
              <Users aria-hidden />
              От Администратора
            </TabsTrigger>
          )}
        </TabsList>

        {showMain && (
          <TabsContent value="main" className="space-y-4">
            {mainSections.length > 0 ? (
              <Tabs defaultValue={mainSections[0].id} className="gap-4">
                <TabsList className="h-auto max-w-full flex-wrap self-start">
                  {mainSections.map((sec) => (
                    <TabsTrigger key={sec.id} value={sec.id} className="h-8 px-3">
                      {sec.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {mainSections.map((sec) => (
                  <TabsContent key={sec.id} value={sec.id}>
                    <ContentCard html={sec.content} />
                  </TabsContent>
                ))}
              </Tabs>
            ) : data.mainContent ? (
              <ContentCard html={data.mainContent} />
            ) : (
              <EmptyState
                icon={<BookOpen />}
                title="Пока нет контента"
                description="Администратор ещё не добавил основные моменты."
              />
            )}
          </TabsContent>
        )}

        {showAdmin && (
          <TabsContent value="admin" className="space-y-6">
            {data.globalFaqs.length > 0 && (
              <FaqList
                title="Частые вопросы"
                faqs={data.globalFaqs}
                keyPrefix="global"
                openId={openFaqId}
                onToggle={setOpenFaqId}
              />
            )}

            {data.catalogs.length > 0 && (
              <Tabs defaultValue={data.catalogs[0].id} className="gap-4">
                <TabsList className="h-auto max-w-full flex-wrap self-start">
                  {data.catalogs.map((cat) => (
                    <TabsTrigger key={cat.id} value={cat.id} className="h-8 px-3">
                      {cat.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {data.catalogs.map((cat) => (
                  <TabsContent key={cat.id} value={cat.id} className="space-y-6">
                    {cat.instructions.length >= 2 ? (
                      <Tabs defaultValue={cat.instructions[0].id} className="gap-3">
                        <TabsList className="h-auto max-w-full flex-wrap self-start">
                          {cat.instructions.map((inst) => (
                            <TabsTrigger key={inst.id} value={inst.id} className="h-8 px-3">
                              {inst.title}
                            </TabsTrigger>
                          ))}
                        </TabsList>
                        {cat.instructions.map((inst) => (
                          <TabsContent key={inst.id} value={inst.id}>
                            <ContentCard html={inst.content} />
                          </TabsContent>
                        ))}
                      </Tabs>
                    ) : cat.instructions.length === 1 ? (
                      <ContentCard html={cat.instructions[0].content} title={cat.instructions[0].title} />
                    ) : null}

                    {cat.faqs.length > 0 && (
                      <FaqList
                        title="Вопросы по разделу"
                        faqs={cat.faqs}
                        keyPrefix={`cat-${cat.id}`}
                        openId={openFaqId}
                        onToggle={setOpenFaqId}
                      />
                    )}

                    {cat.instructions.length === 0 && cat.faqs.length === 0 && (
                      <EmptyState
                        icon={<HelpCircle />}
                        title="В этом разделе пока пусто"
                        description="Администратор ещё не добавил инструкции и вопросы."
                      />
                    )}
                  </TabsContent>
                ))}
              </Tabs>
            )}

            {data.catalogs.length === 0 && data.globalFaqs.length === 0 && (
              <EmptyState
                icon={<HelpCircle />}
                title="Пока нет инструкций и вопросов"
                description="Здесь появятся материалы от администратора."
              />
            )}
          </TabsContent>
        )}
      </Tabs>
    </PageContainer>
  )
}
