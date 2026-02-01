"use client"

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { HelpHtmlContent } from '@/components/_components/HelpHtmlContent'
import { Loader2, BookOpen, Users, Construction, ChevronDown, ChevronRight, HelpCircle } from 'lucide-react'
import { cn } from '@/lib/utils'

const PLACEHOLDER_MESSAGE = 'Администратор обновляет информацию, скоро откроет эту вкладку.'

export default function HelpPage() {
  const router = useRouter()
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<{
    helpMainVisible: boolean
    helpAdminVisible: boolean
    mainContent: string | null
    mainSections: Array<{ id: string; title: string; order: number; content: string }>
    catalogs: Array<{
      id: string
      title: string
      order: number
      instructions: Array<{ id: string; title: string; content: string; order: number }>
      faqs: Array<{ id: string; question: string; answer: string; order: number }>
    }>
    globalFaqs: Array<{ id: string; question: string; answer: string; order: number }>
    isAdmin: boolean
  } | null>(null)
  const [openFaqId, setOpenFaqId] = useState<string | null>(null)

  useEffect(() => {
    load()
  }, [])

  const load = async () => {
    try {
      const res = await fetch('/api/help')
      if (!res.ok) {
        if (res.status === 401) {
          router.push('/login')
          return
        }
        throw new Error('Failed to load help')
      }
      const json = await res.json()
      setData(json)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    )
  }

  if (!data) {
    return (
      <div className="container max-w-4xl py-8 px-4">
        <p className="text-muted-foreground">Не удалось загрузить справку.</p>
      </div>
    )
  }

  const showMain = data.helpMainVisible
  const showAdmin = data.helpAdminVisible
  const hasAnyTab = showMain || showAdmin

  if (!hasAnyTab) {
    return (
      <div className="container max-w-4xl py-8 px-4">
        <Breadcrumbs
          items={[
            { label: 'Дашборд', href: '/dashboard' },
            { label: 'Справка', current: true },
          ]}
          className="mb-6"
        />
        <Card>
          <CardContent className="py-12 text-center">
            <Construction className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-muted-foreground">{PLACEHOLDER_MESSAGE}</p>
          </CardContent>
        </Card>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Notion-style: компактный хедер */}
      <header className="border-b border-border/60 bg-background">
        <div className="mx-auto max-w-3xl px-4 py-4">
          <Breadcrumbs
            items={[
              { label: 'Дашборд', href: '/dashboard' },
              { label: 'Справка', current: true },
            ]}
            className="mb-2"
          />
          <h1 className="text-3xl font-bold tracking-tight text-foreground">Справка</h1>
          <p className="text-muted-foreground mt-1 text-sm">Основные моменты и инструкции от администратора</p>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-8">
        <Tabs defaultValue={showMain ? 'main' : 'admin'} className="space-y-8">
          <TabsList className="inline-flex h-10 items-center justify-center rounded-lg bg-muted/50 p-1 border border-border/60">
            {showMain && (
              <TabsTrigger value="main" className="gap-2 rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <BookOpen className="h-4 w-4" />
                Основные моменты
              </TabsTrigger>
            )}
            {showAdmin && (
              <TabsTrigger value="admin" className="gap-2 rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                <Users className="h-4 w-4" />
                От Администратора
              </TabsTrigger>
            )}
          </TabsList>

          {showMain && (
            <TabsContent value="main" className="mt-8">
              {(data.mainSections ?? []).length > 0 ? (
                <Tabs defaultValue={(data.mainSections ?? [])[0].id} className="space-y-6">
                  <TabsList className="inline-flex h-10 flex-wrap gap-1 items-center justify-start rounded-lg bg-muted/50 p-1 border border-border/60">
                    {(data.mainSections ?? []).map((sec) => (
                      <TabsTrigger key={sec.id} value={sec.id} className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm">
                        {sec.title}
                      </TabsTrigger>
                    ))}
                  </TabsList>
                  {(data.mainSections ?? []).map((sec) => (
                    <TabsContent key={sec.id} value={sec.id} className="mt-4">
                      <article className="prose prose-neutral dark:prose-invert max-w-none">
                        <HelpHtmlContent html={sec.content} className="text-[15px] leading-relaxed" />
                      </article>
                    </TabsContent>
                  ))}
                </Tabs>
              ) : (
                <article className="prose prose-neutral dark:prose-invert max-w-none">
                  {data.mainContent ? (
                    <HelpHtmlContent html={data.mainContent} className="text-[15px] leading-relaxed" />
                  ) : (
                    <p className="text-muted-foreground">Пока нет контента.</p>
                  )}
                </article>
              )}
            </TabsContent>
          )}

        {showAdmin && (
          <TabsContent value="admin" className="mt-8">
            {data.globalFaqs.length > 0 && (
              <section className="mb-10">
                <h2 className="text-xl font-semibold mb-1 flex items-center gap-2">
                  <HelpCircle className="h-5 w-5 text-primary" />
                  Частые вопросы
                </h2>
                <p className="text-sm text-muted-foreground mb-4">Нажмите на вопрос, чтобы раскрыть ответ.</p>
                <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
                  {data.globalFaqs.map((faq) => {
                    const isOpen = openFaqId === `global-${faq.id}`
                    return (
                      <div
                        key={faq.id}
                        className={cn(
                          'border-b border-border/60 last:border-0 transition-colors',
                          isOpen && 'bg-muted/10'
                        )}
                      >
                        <button
                          type="button"
                          className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-muted/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-none"
                          onClick={() => setOpenFaqId(isOpen ? null : `global-${faq.id}`)}
                          aria-expanded={isOpen}
                        >
                          {isOpen ? (
                            <ChevronDown className="h-5 w-5 shrink-0 text-muted-foreground" />
                          ) : (
                            <ChevronRight className="h-5 w-5 shrink-0 text-muted-foreground" />
                          )}
                          <span className="font-medium text-foreground flex-1">{faq.question}</span>
                        </button>
                        {isOpen && (
                          <div className="px-5 pb-4 pl-12">
                            <p className="text-sm text-muted-foreground whitespace-pre-wrap">{faq.answer}</p>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}
            {data.catalogs.length > 0 ? (
              <Tabs defaultValue={data.catalogs[0]?.id ?? 'cat'} className="space-y-6">
                <TabsList className="inline-flex h-10 flex-wrap gap-1 items-center justify-start rounded-lg bg-muted/50 p-1 border border-border/60">
                  {data.catalogs.map((cat) => (
                    <TabsTrigger
                      key={cat.id}
                      value={cat.id}
                      className="gap-2 rounded-md px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                    >
                      {cat.title}
                    </TabsTrigger>
                  ))}
                </TabsList>
                {data.catalogs.map((cat) => (
                  <TabsContent key={cat.id} value={cat.id} className="mt-0 space-y-8">
                    <div className="space-y-8">
                      {cat.instructions.length >= 2 ? (
                        <Tabs defaultValue={cat.instructions[0]?.id ?? ''} className="space-y-4">
                          <TabsList className="inline-flex h-10 flex-wrap gap-1 items-center justify-start rounded-lg bg-muted/50 p-1 border border-border/60">
                            {cat.instructions.map((inst) => (
                              <TabsTrigger
                                key={inst.id}
                                value={inst.id}
                                className="rounded-md px-3 data-[state=active]:bg-background data-[state=active]:shadow-sm"
                              >
                                {inst.title}
                              </TabsTrigger>
                            ))}
                          </TabsList>
                          {cat.instructions.map((inst) => (
                            <TabsContent key={inst.id} value={inst.id} className="mt-4">
                              <div className="rounded-xl border border-border/50 bg-card/50 p-6 shadow-sm">
                                <HelpHtmlContent html={inst.content} className="text-[15px] leading-relaxed" />
                              </div>
                            </TabsContent>
                          ))}
                        </Tabs>
                      ) : cat.instructions.length === 1 ? (
                        <div className="rounded-xl border border-border/50 bg-card/50 p-6 shadow-sm">
                          <h3 className="text-lg font-semibold mb-4 text-foreground">{cat.instructions[0].title}</h3>
                          <HelpHtmlContent html={cat.instructions[0].content} className="text-[15px] leading-relaxed" />
                        </div>
                      ) : null}
                      {cat.faqs.length > 0 && (
                        <div className="space-y-1 rounded-xl border border-border/60 bg-muted/5 overflow-hidden">
                          <h4 className="font-medium text-sm text-muted-foreground px-4 pt-4 pb-2">Вопросы по разделу</h4>
                          {cat.faqs.map((faq) => {
                            const faqKey = `cat-${cat.id}-${faq.id}`
                            const isOpen = openFaqId === faqKey
                            return (
                              <div
                                key={faq.id}
                                className={cn(
                                  'border-t border-border/40 first:border-t-0 transition-colors',
                                  isOpen && 'bg-muted/10'
                                )}
                              >
                                <button
                                  type="button"
                                  className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-muted/10 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                                  onClick={() => setOpenFaqId(isOpen ? null : faqKey)}
                                  aria-expanded={isOpen}
                                >
                                  {isOpen ? (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  ) : (
                                    <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                                  )}
                                  <span className="font-medium text-sm text-foreground flex-1">{faq.question}</span>
                                </button>
                                {isOpen && (
                                  <div className="px-4 pb-3 pl-11">
                                    <p className="text-sm text-muted-foreground whitespace-pre-wrap">{faq.answer}</p>
                                  </div>
                                )}
                              </div>
                            )
                          })}
                        </div>
                      )}
                      {cat.instructions.length === 0 && cat.faqs.length === 0 && (
                        <p className="text-muted-foreground text-sm">Пока нет контента в этом разделе.</p>
                      )}
                    </div>
                  </TabsContent>
                ))}
              </Tabs>
            ) : null}
            {data.catalogs.length === 0 && data.globalFaqs.length === 0 && (
              <div className="rounded-xl border border-dashed border-border/60 py-16 text-center text-muted-foreground text-sm">
                Пока нет инструкций и FAQ от администратора.
              </div>
            )}
          </TabsContent>
        )}

      </Tabs>

        {data.isAdmin && (
          <div className="mt-10 pt-6 border-t border-border/60">
            <Link href="/dashboard/help/admin">
              <Button variant="outline" size="sm">Управление справкой</Button>
            </Link>
          </div>
        )}
      </div>
    </div>
  )
}
