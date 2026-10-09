'use client'

/**
 * Страница «Шаблоны анонсов»: /dashboard/admin/templates (Lead_SUP) и /dashboard/templates (SUP, ADM, MEMBER).
 * Режим встраивания ?chrome=0 — без хлебных крошек и с узкими отступами.
 *
 *  - Lead_SUP: вкладки «Шаблоны SUP» / «Шаблоны ADM» с полным управлением (docs/templates-api.md) + «Мои шаблоны».
 *  - SUP: те же вкладки только для чтения + «Мои шаблоны»; ADM/MEMBER: «Шаблоны ADM» + «Мои шаблоны».
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Construction } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Breadcrumbs } from '@/components/common/Breadcrumbs'
import { EmptyState } from '@/components/common/EmptyState'
import { PageContainer, PageHeader } from '@/components/common/PageHeader'
import { LoadError } from '@/components/intensives/admin/kit'
import { ApiError, apiFetch } from '@/lib/intensives/ui'
import type { OfficialTemplateDto, TemplateScope } from '@/lib/templates/types'
import { MyTemplatesTab } from './MyTemplatesTab'
import { OfficialTemplatesTab } from './OfficialTemplatesTab'
import { ScheduleFromTemplateDialog } from './ScheduleFromTemplateDialog'
import { SCOPE_TAB_LABELS, errText, type LoadStatus, type ScheduleSource, type UserTemplate } from './lib'
import { TemplatesSkeleton } from './shared'

const TEMPLATES_PLACEHOLDER_MESSAGE = 'Администратор обновляет информацию, скоро откроет эту вкладку.'
const ALLOWED_ROLES = ['ADM', 'SUP', 'LEAD_SUP', 'MEMBER']

type TabValue = 'support' | 'adm' | 'mine'
const TAB_SCOPE: Record<'support' | 'adm', TemplateScope> = { support: 'SUP', adm: 'ADM' }
const SCOPE_TAB: Record<TemplateScope, TabValue> = { SUP: 'support', ADM: 'adm' }

type ListState<T> = { status: LoadStatus; items: T[]; error: string | null }

export function TemplatesHub() {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const chromeMinimal = searchParams.get('chrome') === '0'
  const isAdminRoute = pathname.startsWith('/dashboard/admin')

  const [boot, setBoot] = useState<'loading' | 'ready' | 'error'>('loading')
  const [bootKey, setBootKey] = useState(0)
  const [role, setRole] = useState<string | null>(null)
  const [tabVisible, setTabVisible] = useState(true)
  const [activeTab, setActiveTab] = useState<TabValue>('adm')
  const [official, setOfficial] = useState<ListState<OfficialTemplateDto>>({ status: 'loading', items: [], error: null })
  const [mine, setMine] = useState<ListState<UserTemplate>>({ status: 'loading', items: [], error: null })
  const [scheduleSource, setScheduleSource] = useState<ScheduleSource | null>(null)
  const officialSeq = useRef(0)
  const mineSeq = useRef(0)

  const isLead = role === 'LEAD_SUP'
  const seesSup = role === 'SUP' || role === 'LEAD_SUP'

  /** Загрузка официальных шаблонов. silent — не прятать текущий список (после изменений). */
  const fetchOfficial = useCallback(async (lead: boolean, silent = false) => {
    const seq = ++officialSeq.current
    try {
      const d = await apiFetch<{ templates?: OfficialTemplateDto[] }>(`/api/templates/official${lead ? '?includeDeleted=1' : ''}`)
      if (seq !== officialSeq.current) return
      setOfficial({ status: 'ready', items: d.templates ?? [], error: null })
    } catch (e) {
      if (seq !== officialSeq.current) return
      if (e instanceof ApiError && e.status === 403) {
        setOfficial({ status: 'forbidden', items: [], error: null })
        return
      }
      if (silent) {
        toast.error('Не удалось обновить список шаблонов', { description: errText(e) })
        setOfficial((s) => (s.status === 'ready' ? s : { status: 'error', items: [], error: errText(e) }))
        return
      }
      setOfficial({ status: 'error', items: [], error: errText(e) })
    }
  }, [])

  const fetchMine = useCallback(async (silent = false) => {
    const seq = ++mineSeq.current
    try {
      const d = await apiFetch<{ templates?: UserTemplate[] }>('/api/templates/mine')
      if (seq !== mineSeq.current) return
      setMine({ status: 'ready', items: d.templates ?? [], error: null })
    } catch (e) {
      if (seq !== mineSeq.current) return
      if (silent) {
        toast.error('Не удалось обновить список шаблонов', { description: errText(e) })
        setMine((s) => (s.status === 'ready' ? s : { status: 'error', items: [], error: errText(e) }))
        return
      }
      setMine({ status: 'error', items: [], error: errText(e) })
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      // Без X-Error-Handling: при 401 глобальный обработчик отправит на вход
      fetch('/api/auth/me').then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status))))),
      fetch('/api/help/visibility').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ])
      .then(([meData, visData]) => {
        if (cancelled) return
        const r: string | null = meData?.user?.role ?? null
        if (!r || !ALLOWED_ROLES.includes(r)) {
          router.replace('/dashboard')
          return
        }
        setRole(r)
        if (visData) setTabVisible(visData.templatesTabVisible !== false)
        setActiveTab(r === 'SUP' || r === 'LEAD_SUP' ? 'support' : 'adm')
        setBoot('ready')
        void fetchOfficial(r === 'LEAD_SUP')
        void fetchMine()
      })
      .catch(() => {
        if (cancelled) return
        setBoot('error')
        toast.error('Не удалось загрузить шаблоны', { description: 'Обновите страницу или проверьте соединение.' })
      })
    return () => {
      cancelled = true
    }
  }, [router, fetchOfficial, fetchMine, bootKey])

  const reloadOfficial = useCallback(() => fetchOfficial(isLead, true), [fetchOfficial, isLead])
  const reloadMine = useCallback(() => fetchMine(true), [fetchMine])
  const retryOfficial = () => {
    setOfficial({ status: 'loading', items: [], error: null })
    void fetchOfficial(isLead)
  }
  const retryMine = () => {
    setMine({ status: 'loading', items: [], error: null })
    void fetchMine()
  }

  const containerClass = chromeMinimal ? 'max-w-none px-3 py-3 lg:py-3' : 'px-4 sm:px-6'
  const breadcrumbs = chromeMinimal ? undefined : (
    <Breadcrumbs
      items={
        isAdminRoute
          ? [
              { label: 'Админ панель', href: '/dashboard/admin' },
              { label: 'Шаблоны анонсов', current: true },
            ]
          : [
              { label: 'Пространства', href: '/dashboard/workspaces' },
              { label: 'Шаблоны анонсов', current: true },
            ]
      }
    />
  )

  if (boot === 'ready' && !isLead && !tabVisible) {
    return (
      <PageContainer size="narrow" className={containerClass}>
        <PageHeader title="Шаблоны анонсов" breadcrumbs={breadcrumbs} />
        <EmptyState icon={<Construction />} title="Вкладка временно недоступна" description={TEMPLATES_PLACEHOLDER_MESSAGE}>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => router.push('/dashboard')}>
            На главную
          </Button>
        </EmptyState>
      </PageContainer>
    )
  }

  const tabList: { value: TabValue; label: string }[] = seesSup
    ? [
        { value: 'support', label: SCOPE_TAB_LABELS.SUP },
        { value: 'adm', label: SCOPE_TAB_LABELS.ADM },
        { value: 'mine', label: 'Мои шаблоны' },
      ]
    : [
        { value: 'adm', label: SCOPE_TAB_LABELS.ADM },
        { value: 'mine', label: 'Мои шаблоны' },
      ]

  const officialFor = (scope: TemplateScope) => official.items.filter((t) => t.scope === scope)
  const activeCount = (scope: TemplateScope) => official.items.filter((t) => t.scope === scope && !t.isDeleted).length

  const renderOfficial = (tab: 'support' | 'adm') => {
    const scope = TAB_SCOPE[tab]
    return (
      <OfficialTemplatesTab
        scope={scope}
        templates={officialFor(scope)}
        status={official.status}
        error={official.error}
        onRetry={retryOfficial}
        manage={isLead}
        reload={reloadOfficial}
        onSchedule={setScheduleSource}
        onSwitchScope={(s) => setActiveTab(SCOPE_TAB[s])}
      />
    )
  }

  return (
    <PageContainer className={containerClass}>
      <PageHeader
        title="Шаблоны анонсов"
        description={
          isLead
            ? 'Официальные шаблоны SUP и ADM: изменение, добавление, удаление и восстановление. Личные шаблоны — во вкладке «Мои шаблоны».'
            : 'Встроенные шаблоны по каналу и дню. Свои шаблоны — во вкладке «Мои шаблоны», они подтягиваются в пространство.'
        }
        breadcrumbs={breadcrumbs}
      />

      {boot === 'loading' ? (
        <TemplatesSkeleton />
      ) : boot === 'error' ? (
        <LoadError
          message="Не удалось загрузить страницу. Проверьте соединение и повторите."
          onRetry={() => {
            setBoot('loading')
            setBootKey((k) => k + 1)
          }}
        />
      ) : (
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabValue)} className="w-full gap-4">
          <TabsList className="h-auto max-w-full self-start overflow-x-auto" aria-label="Наборы шаблонов">
            {tabList.map((tab) => {
              const count =
                tab.value === 'mine'
                  ? mine.status === 'ready'
                    ? mine.items.length
                    : null
                  : official.status === 'ready'
                    ? activeCount(TAB_SCOPE[tab.value])
                    : null
              return (
                <TabsTrigger key={tab.value} value={tab.value} className="h-8 px-3">
                  {tab.label}
                  {count !== null && <span className="text-xs tabular-nums text-muted-foreground">{count}</span>}
                </TabsTrigger>
              )
            })}
          </TabsList>

          {seesSup && <TabsContent value="support">{renderOfficial('support')}</TabsContent>}
          <TabsContent value="adm">{renderOfficial('adm')}</TabsContent>
          <TabsContent value="mine">
            <MyTemplatesTab
              templates={mine.items}
              status={mine.status}
              error={mine.error}
              onRetry={retryMine}
              reload={reloadMine}
              canManageChannels={isLead}
              onSchedule={setScheduleSource}
            />
          </TabsContent>
        </Tabs>
      )}

      {scheduleSource && (
        <ScheduleFromTemplateDialog
          key={`${scheduleSource.userTemplateId ?? ''}:${scheduleSource.channel}:${scheduleSource.time}:${scheduleSource.body.length}`}
          source={scheduleSource}
          onClose={() => setScheduleSource(null)}
        />
      )}
    </PageContainer>
  )
}
