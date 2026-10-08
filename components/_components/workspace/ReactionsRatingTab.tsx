'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatDistanceToNow, format } from 'date-fns'
import { ru } from 'date-fns/locale'
import { toast } from 'sonner'
import {
  AlertTriangle,
  Hash,
  Lock,
  Megaphone,
  RefreshCw,
  Search,
  Send,
  Settings2,
  Trophy,
  X,
} from 'lucide-react'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Field } from '@/components/ui/field'
import { Checkbox } from '@/components/ui/checkbox'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Spinner } from '@/components/ui/spinner'
import { Section } from '@/components/common/Section'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { EmptyState } from '@/components/common/EmptyState'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { cn } from '@/lib/utils'

// ── Типы ответа API ──

type RatingChannel = { id: string; name: string; type: 'c' | 'p' }

type Settings = {
  enabled: boolean
  channels: RatingChannel[]
  excludeOwnMessages: boolean
  excludeBots: boolean
  includeThreads: boolean
  excludedUsernames: string[]
  timezone: string
  reportChannelId: string | null
  reportChannelName: string | null
  weeklyEnabled: boolean
  weeklyDay: number
  reportHour: number
  monthlyEnabled: boolean
  topN: number
  mentionUsers: boolean
  lastSyncAt: string | null
  lastSyncError: string | null
}

type Entry = { place: number; username: string; score: number; week: number | null }

type Leaderboard = {
  period: string
  label: string
  isCurrent: boolean
  finalized: boolean
  announcedAt: string | null
  entries: Entry[]
  totals: { participants: number; messages: number; points: number }
}

type HistoryRow = {
  period: string
  label: string
  winners: string[]
  winnerScore: number
  participants: number
  messages: number
  announcedAt: string | null
}

type ApiData = {
  configured: boolean
  settings: Settings
  leaderboard: Leaderboard
  periods: { period: string; label: string }[]
  history: HistoryRow[]
}

type WsChannel = { id: string; name: string; displayName?: string; type: string }

const WEEK_DAYS = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье']

const TIMEZONES = [
  { id: 'Europe/Kaliningrad', label: 'Калининград (UTC+2)' },
  { id: 'Europe/Moscow', label: 'Москва, Казань, Великий Новгород (UTC+3)' },
  { id: 'Europe/Samara', label: 'Самара (UTC+4)' },
  { id: 'Asia/Yekaterinburg', label: 'Екатеринбург, Сургут (UTC+5)' },
  { id: 'Asia/Tashkent', label: 'Ташкент (UTC+5)' },
  { id: 'Asia/Omsk', label: 'Омск (UTC+6)' },
  { id: 'Asia/Novosibirsk', label: 'Новосибирск (UTC+7)' },
  { id: 'Asia/Krasnoyarsk', label: 'Красноярск (UTC+7)' },
  { id: 'Asia/Irkutsk', label: 'Иркутск (UTC+8)' },
  { id: 'Asia/Yakutsk', label: 'Якутск (UTC+9)' },
  { id: 'Asia/Vladivostok', label: 'Владивосток (UTC+10)' },
  { id: 'Asia/Magadan', label: 'Магадан (UTC+11)' },
]

const MEDAL = ['🥇', '🥈', '🥉']

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error([data.error || 'Ошибка запроса', data.details].filter(Boolean).join(': '))
  return data as T
}

function relative(date: string | null) {
  if (!date) return 'ещё не обновлялся'
  return `обновлён ${formatDistanceToNow(new Date(date), { addSuffix: true, locale: ru })}`
}


// ── Главный компонент ──

export function ReactionsRatingTab({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<ApiData | null>(null)
  const [period, setPeriod] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [sub, setSub] = useState('board')
  const [loadError, setLoadError] = useState<string | null>(null)

  const base = `/api/workspace/${workspaceId}/reactions`

  const load = useCallback(
    async (p?: string | null) => {
      setLoading(true)
      try {
        const q = p ? `?period=${encodeURIComponent(p)}` : ''
        const d = await api<ApiData>(`${base}${q}`)
        setData(d)
        setPeriod(d.leaderboard.period)
        setLoadError(null)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Не удалось загрузить рейтинг'
        setLoadError(message)
        toast.error(message)
      } finally {
        setLoading(false)
      }
    },
    [base],
  )

  useEffect(() => {
    load()
  }, [load])

  const sync = async () => {
    setSyncing(true)
    const toastId = toast.loading('Обновляем рейтинг из Rocket.Chat…')
    try {
      const r = await api<{ result: { messages: number; added: number; removed: number; errors: string[] } }>(base, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sync' }),
      })
      const { messages, added, removed, errors } = r.result
      if (errors.length) toast.warning(`Обновлено с ошибками: ${errors[0]}`, { id: toastId })
      else toast.success(`Проверено сообщений: ${messages}. Новых баллов: ${added}, снято: ${removed}`, { id: toastId })
      await load(period)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось обновить. Повторите попытку.', { id: toastId })
    } finally {
      setSyncing(false)
    }
  }

  if (loading && !data) {
    return (
      <div className="space-y-4" role="status" aria-busy="true" aria-label="Загрузка рейтинга">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-4 w-80 max-w-full" />
          </div>
          <Skeleton className="h-8 w-40" />
        </div>
        <Skeleton className="h-9 w-72 max-w-full" />
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-16" />
          ))}
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    )
  }
  if (!data) {
    return (
      <EmptyState
        icon={<AlertTriangle />}
        title="Рейтинг не загрузился"
        description={loadError ?? 'Неизвестная ошибка'}
        action={{ label: 'Повторить', onClick: () => load(period) }}
      />
    )
  }

  const { settings, leaderboard } = data
  const hasChannels = settings.channels.length > 0

  return (
    <div className="space-y-5">
      {/* Шапка */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight">Рейтинг реакций</h3>
            <Badge variant={settings.enabled ? 'success' : 'muted'}>{settings.enabled ? 'Активен' : 'Выключен'}</Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            1 сообщение, на котором есть хотя бы одна реакция пира, = 1 балл. Несколько emoji на одном посте баллы не умножают.
          </p>
          <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="size-3" aria-hidden />
            {relative(settings.lastSyncAt)}
            {settings.enabled && ' · автообновление каждые 15 минут'}
          </p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Select value={period ?? undefined} onValueChange={(p) => load(p)}>
            <SelectTrigger className="w-[180px] capitalize" aria-label="Период">
              <SelectValue placeholder="Период" />
            </SelectTrigger>
            <SelectContent>
              {data.periods.map((p) => (
                <SelectItem key={p.period} value={p.period} className="capitalize">
                  {p.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button
            variant="outline"
            onClick={sync}
            disabled={syncing || !data.configured || !hasChannels}
            title={!hasChannels ? 'Сначала выберите каналы в настройках' : !data.configured ? 'Подключите пространство к Rocket.Chat' : undefined}
          >
            {syncing ? <Spinner /> : <RefreshCw />}
            Обновить
          </Button>
        </div>
      </div>

      {settings.lastSyncError && (
        <div role="alert" className="flex items-start gap-3 rounded-lg border bg-card px-4 py-3 text-sm">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" aria-hidden />
          <div className="min-w-0">
            <p className="font-medium">Не все каналы удалось прочитать</p>
            <p className="mt-0.5 whitespace-pre-line break-words text-[13px] text-muted-foreground">{settings.lastSyncError}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Подключённая учётка должна состоять в каждом выбранном канале.
            </p>
          </div>
        </div>
      )}

      <Tabs value={sub} onValueChange={setSub} className="w-full space-y-4">
        <TabsList className="grid w-full grid-cols-3 sm:inline-flex sm:w-fit">
          <TabsTrigger value="board" className="gap-1.5">
            <Trophy aria-hidden /> Рейтинг
          </TabsTrigger>
          <TabsTrigger value="posts" className="gap-1.5">
            <Megaphone aria-hidden /> Публикации
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-1.5">
            <Settings2 aria-hidden /> Настройки
          </TabsTrigger>
        </TabsList>

        <TabsContent value="board" className="mt-0 space-y-4">
          {!hasChannels ? (
            <EmptySetup onSetup={() => setSub('settings')} />
          ) : (
            <BoardView leaderboard={leaderboard} loading={loading} />
          )}
        </TabsContent>

        <TabsContent value="posts" className="mt-0 space-y-4">
          <PostsView
            base={base}
            data={data}
            period={period}
            onChanged={() => load(period)}
            onOpenSettings={() => setSub('settings')}
          />
        </TabsContent>

        <TabsContent value="settings" className="mt-0">
          <SettingsView
            base={base}
            workspaceId={workspaceId}
            initial={settings}
            onSaved={async (channelsChanged) => {
              if (channelsChanged) await sync()
              else await load(period)
              setSub('board')
            }}
          />
        </TabsContent>
      </Tabs>
    </div>
  )
}

// ── Рейтинг ──

function EmptySetup({ onSetup }: { onSetup: () => void }) {
  return (
    <EmptyState
      icon={<Trophy />}
      title="Рейтинг ещё не настроен"
      description="Выберите каналы, реакции в которых участвуют в рейтинге, — например, #general или канал с новостями."
      action={{ label: 'Настроить рейтинг', onClick: onSetup }}
    />
  )
}

function Stat({ label, value, hint }: { label: string; value: React.ReactNode; hint?: string }) {
  return (
    <div className="rounded-lg border bg-card p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-1 truncate text-xl font-semibold tabular-nums tracking-tight" title={typeof value === 'string' ? value : undefined}>{value}</div>
      {hint && <div className="mt-0.5 truncate text-xs text-muted-foreground">{hint}</div>}
    </div>
  )
}

function BoardView({ leaderboard, loading }: { leaderboard: Leaderboard; loading: boolean }) {
  const [query, setQuery] = useState('')
  const { entries, totals } = leaderboard
  const max = entries[0]?.score ?? 0
  const leaders = entries.filter((e) => e.place === 1)
  const q = query.trim().replace(/^@/, '').toLowerCase()
  const found = q ? entries.find((e) => e.username.toLowerCase() === q) : undefined
  const filtered = q ? entries.filter((e) => e.username.toLowerCase().includes(q)) : entries

  return (
    <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')} aria-busy={loading}>
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="font-medium capitalize">{leaderboard.label}</span>
        {leaderboard.finalized ? (
          <Badge variant="info">
            <Lock /> Итоги зафиксированы
          </Badge>
        ) : leaderboard.isCurrent ? (
          <Badge variant="success">Месяц идёт</Badge>
        ) : (
          <Badge variant="muted">Прошлый период</Badge>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Участников" value={totals.participants} />
        <Stat label="Постов с реакцией" value={totals.messages} hint="уникальных сообщений" />
        <Stat label="Баллов всего" value={totals.points} />
        <Stat
          label={leaders.length > 1 ? 'Лидеры' : 'Лидер'}
          value={leaders.length ? leaders.map((l) => l.username).join(', ') : '—'}
          hint={leaders.length ? `${leaders[0].score} баллов` : 'пока нет'}
        />
      </div>

      {entries.length === 0 ? (
        <EmptyState
          icon={<Trophy />}
          title="В этом периоде реакций пока нет"
          description="Нажмите «Обновить», чтобы подтянуть свежие данные из Rocket.Chat."
        />
      ) : (
        <>
          <Podium entries={entries} />

          <div className="relative">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Найти пира по логину — покажем место и результат"
              aria-label="Поиск пира по логину"
              className="pl-9"
            />
          </div>

          {q && (
            <PersonalCard entry={found} query={q} total={entries.length} isCurrent={leaderboard.isCurrent} />
          )}

          <div className="overflow-hidden rounded-lg border bg-card">
            <div className="grid grid-cols-[3rem_1fr_auto] items-center gap-3 border-b bg-muted px-4 py-2 text-xs font-medium text-muted-foreground sm:grid-cols-[3.5rem_1fr_12rem_4.5rem_4.5rem]">
              <span>Место</span>
              <span>Пир</span>
              <span className="hidden sm:block">Активность</span>
              <span className="text-right">Баллы</span>
              <span className="hidden text-right sm:block">Неделя</span>
            </div>
            <div className="max-h-[480px] divide-y overflow-y-auto">
              {filtered.map((e) => (
                <div
                  key={e.username}
                  className={cn(
                    'grid grid-cols-[3rem_1fr_auto] items-center gap-3 px-4 py-2 text-sm transition-colors hover:bg-muted/40 sm:grid-cols-[3.5rem_1fr_12rem_4.5rem_4.5rem]',
                    found?.username === e.username && 'bg-muted/60',
                  )}
                >
                  <span className="font-medium tabular-nums text-muted-foreground">
                    {e.place <= 3 ? <span className="text-base">{MEDAL[e.place - 1]}</span> : `#${e.place}`}
                  </span>
                  <span className="truncate font-medium">@{e.username}</span>
                  <span className="hidden h-1.5 overflow-hidden rounded-sm bg-muted sm:block">
                    <span
                      className="block h-full rounded-sm bg-primary/70"
                      style={{ width: `${max ? Math.max(4, (e.score / max) * 100) : 0}%` }}
                    />
                  </span>
                  <span className="text-right font-semibold tabular-nums">{e.score}</span>
                  <span className="hidden text-right text-xs tabular-nums sm:block">
                    {e.week == null ? (
                      <span className="text-muted-foreground">—</span>
                    ) : e.week > 0 ? (
                      <span className="font-medium text-emerald-700 dark:text-emerald-400">+{e.week}</span>
                    ) : (
                      <span className="text-muted-foreground">0</span>
                    )}
                  </span>
                </div>
              ))}
              {filtered.length === 0 && <div className="px-4 py-6 text-center text-sm text-muted-foreground">Никого не нашли по запросу «{query.trim()}»</div>}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function Podium({ entries }: { entries: Entry[] }) {
  // Порядок на пьедестале: 2 — 1 — 3
  const top = entries.slice(0, 3)
  const order = [top[1], top[0], top[2]]
  const heights = ['h-16', 'h-24', 'h-12']
  return (
    <div className="rounded-lg border bg-card px-4 pb-0 pt-5">
      <div className="mx-auto grid max-w-lg grid-cols-3 items-end gap-3">
        {order.map((e, i) =>
          e ? (
            <div key={e.username} className="flex min-w-0 flex-col items-center">
              <div className="mb-0.5 text-xl">{MEDAL[e.place - 1] ?? '🏅'}</div>
              <div className="max-w-full truncate text-sm font-semibold">@{e.username}</div>
              <div className="mb-2 text-xs tabular-nums text-muted-foreground">{e.score} баллов</div>
              <div
                className={cn(
                  'flex w-full items-start justify-center rounded-t-md bg-muted pt-2 text-base font-semibold text-muted-foreground',
                  heights[i],
                )}
              >
                {e.place}
              </div>
            </div>
          ) : (
            <div key={`empty-${i}`} />
          ),
        )}
      </div>
    </div>
  )
}

function PersonalCard({ entry, query, total, isCurrent }: { entry?: Entry; query: string; total: number; isCurrent: boolean }) {
  if (!entry) {
    return (
      <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
        У <span className="font-medium text-foreground">@{query}</span> в этом периоде пока нет баллов (или логин введён не полностью).
      </div>
    )
  }
  return (
    <div className="rounded-lg border bg-card px-4 py-3">
      <div className="text-xs font-medium text-muted-foreground">Статистика @{entry.username}</div>
      <div className="mt-2 grid grid-cols-3 gap-3 text-center">
        <div>
          <div className="text-xl font-semibold tabular-nums">{entry.score}</div>
          <div className="text-xs text-muted-foreground">постов с реакцией</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums">#{entry.place}</div>
          <div className="text-xs text-muted-foreground">место из {total}</div>
        </div>
        <div>
          <div className="text-xl font-semibold tabular-nums">
            {isCurrent && entry.week != null ? `+${entry.week}` : '—'}
          </div>
          <div className="text-xs text-muted-foreground">за эту неделю</div>
        </div>
      </div>
    </div>
  )
}

// ── Публикации ──

function PostsView({
  base,
  data,
  period,
  onChanged,
  onOpenSettings,
}: {
  base: string
  data: ApiData
  period: string | null
  onChanged: () => void
  onOpenSettings: () => void
}) {
  const { settings } = data
  const [preview, setPreview] = useState<{ kind: 'weekly' | 'monthly'; period?: string | null; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [recalcPeriod, setRecalcPeriod] = useState<string>(period ?? '')
  const [confirmRecalc, setConfirmRecalc] = useState(false)

  useEffect(() => {
    if (period) setRecalcPeriod(period)
  }, [period])

  const post = (body: Record<string, unknown>) =>
    api<Record<string, unknown>>(base, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })

  const openPreview = async (kind: 'weekly' | 'monthly') => {
    setBusy(kind)
    try {
      const r = (await post({ action: 'preview', kind, period })) as { text: string }
      setPreview({ kind, period, text: r.text })
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось собрать текст')
    } finally {
      setBusy(null)
    }
  }

  const publish = async () => {
    if (!preview) return
    setBusy('publish')
    const toastId = toast.loading('Ставим публикацию в очередь…')
    try {
      // Текст формирует сервер из сохранённых результатов — клиент передаёт только тип и период
      await post({ action: 'publish', kind: preview.kind, period: preview.period })
      toast.success(`Публикация поставлена в очередь — уйдёт в #${settings.reportChannelName} в течение минуты`, { id: toastId })
      setPreview(null)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось опубликовать. Повторите попытку.', { id: toastId })
    } finally {
      setBusy(null)
    }
  }

  const recalc = async () => {
    setBusy('recalc')
    const toastId = toast.loading('Пересчитываем статистику…')
    try {
      await post({ action: 'recalculate', period: recalcPeriod })
      toast.success('Статистика пересчитана', { id: toastId })
      setConfirmRecalc(false)
      onChanged()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось пересчитать', { id: toastId })
    } finally {
      setBusy(null)
    }
  }

  const periodLabel = data.periods.find((p) => p.period === period)?.label ?? ''
  const hasReportChannel = !!settings.reportChannelId

  return (
    <div className="space-y-6">
      {!hasReportChannel && (
        <div className="flex flex-col justify-between gap-3 rounded-lg border border-dashed px-4 py-3 text-sm sm:flex-row sm:items-center">
          <span className="text-muted-foreground">Канал для публикаций не выбран — посты рейтинга некуда отправлять.</span>
          <Button size="sm" variant="outline" onClick={onOpenSettings}>
            Выбрать канал
          </Button>
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2">
        <PostCard
          title="Рейтинг за неделю"
          description="Топ за последние 7 полных дней и сколько постов получили реакции."
          schedule={
            settings.weeklyEnabled
              ? `Авто: ${WEEK_DAYS[settings.weeklyDay - 1].toLowerCase()}, ${String(settings.reportHour).padStart(2, '0')}:00`
              : 'Автопубликация выключена'
          }
          active={settings.weeklyEnabled}
          busy={busy === 'weekly'}
          disabled={!hasReportChannel}
          onClick={() => openPreview('weekly')}
        />
        <PostCard
          title={data.leaderboard.finalized ? 'Итоги месяца' : 'Промежуточный рейтинг месяца'}
          description={`Рейтинг за ${periodLabel || 'выбранный месяц'}${data.leaderboard.finalized ? ' с объявлением победителя.' : ' — без объявления победителя.'}`}
          schedule={
            settings.monthlyEnabled
              ? `Авто: итоги 1-го числа, ${String(settings.reportHour).padStart(2, '0')}:00`
              : 'Автообъявление победителя выключено'
          }
          active={settings.monthlyEnabled}
          busy={busy === 'monthly'}
          disabled={!hasReportChannel}
          onClick={() => openPreview('monthly')}
        />
      </div>

      {/* История месяцев */}
      <Section title="Победители прошлых месяцев" bare>
        {data.history.length === 0 ? (
          <EmptyState
            icon={<Trophy />}
            title="Пока нет итогов"
            description="Итоги появятся здесь 1-го числа следующего месяца."
          />
        ) : (
          <div className="divide-y rounded-lg border bg-card">
            {data.history.map((h) => (
              <div key={h.period} className="flex items-center gap-3 px-4 py-3 text-sm">
                <div className="min-w-0 flex-1">
                  <div className="font-medium capitalize">{h.label}</div>
                  <div className="truncate text-xs text-muted-foreground">
                    {h.winners.length ? h.winners.map((w) => `@${w}`).join(', ') : 'без победителя'} · {h.winnerScore} баллов ·{' '}
                    {h.participants} участников
                  </div>
                </div>
                {h.announcedAt ? (
                  <Badge variant="success" className="shrink-0">
                    объявлено {format(new Date(h.announcedAt), 'd MMM', { locale: ru })}
                  </Badge>
                ) : (
                  <Badge variant="muted" className="shrink-0">
                    не объявлялось
                  </Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Пересчёт */}
      <Section
        title="Пересчитать период"
        description="Заново прочитает все сообщения месяца и восстановит статистику — после сбоя или смены настроек. Итоги не публикуются повторно."
      >
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Период" htmlFor="rr-recalc-period">
            <Select value={recalcPeriod} onValueChange={setRecalcPeriod}>
              <SelectTrigger id="rr-recalc-period" className="w-[180px] capitalize">
                <SelectValue placeholder="Период" />
              </SelectTrigger>
              <SelectContent>
                {data.periods.map((p) => (
                  <SelectItem key={p.period} value={p.period} className="capitalize">
                    {p.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Button
            variant="outline"
            disabled={!recalcPeriod || busy === 'recalc' || settings.channels.length === 0}
            onClick={() => setConfirmRecalc(true)}
            title={settings.channels.length === 0 ? 'Сначала выберите каналы в настройках' : undefined}
          >
            {busy === 'recalc' ? <Spinner /> : <RefreshCw />}
            Пересчитать
          </Button>
        </div>
      </Section>

      <Dialog open={!!preview} onOpenChange={(o) => !o && busy !== 'publish' && setPreview(null)}>
        <DialogContent className="sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Публикация в #{settings.reportChannelName}</DialogTitle>
            <DialogDescription>Текст формируется автоматически по сохранённым результатам рейтинга и не редактируется. Сообщение уйдёт от имени владельца пространства через очередь отложенных.</DialogDescription>
          </DialogHeader>
          <Textarea
            value={preview?.text ?? ''}
            readOnly
            rows={14}
            aria-label="Текст публикации"
            className="font-mono text-[13px] leading-relaxed"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPreview(null)} disabled={busy === 'publish'}>
              Отмена
            </Button>
            <Button onClick={publish} disabled={busy === 'publish' || !preview?.text.trim()}>
              {busy === 'publish' ? <Spinner /> : <Send />}
              Опубликовать
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmRecalc}
        onOpenChange={setConfirmRecalc}
        title={`Пересчитать ${data.periods.find((p) => p.period === recalcPeriod)?.label ?? 'период'}?`}
        description="Статистика периода будет собрана заново из сообщений Rocket.Chat по текущим настройкам. Если итоги месяца уже зафиксированы, они обновятся, но повторно объявлены не будут."
        confirmLabel="Пересчитать"
        loading={busy === 'recalc'}
        onConfirm={recalc}
      />
    </div>
  )
}

function PostCard({
  title,
  description,
  schedule,
  active,
  busy,
  disabled,
  onClick,
}: {
  title: string
  description: string
  schedule: string
  active: boolean
  busy: boolean
  disabled: boolean
  onClick: () => void
}) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border bg-card p-4">
      <div className="min-w-0">
        <div className="text-sm font-medium">{title}</div>
        <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>
      </div>
      <div className="mt-auto flex flex-wrap items-center justify-between gap-2">
        <Badge variant={active ? 'success' : 'muted'} className="whitespace-normal text-left">
          {schedule}
        </Badge>
        <Button size="sm" variant="outline" onClick={onClick} disabled={busy || disabled}>
          {busy ? <Spinner /> : null}
          Предпросмотр
        </Button>
      </div>
    </div>
  )
}

// ── Настройки ──

function SettingsBlock({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <Section title={title} description={description}>
      <div className="space-y-4">{children}</div>
    </Section>
  )
}

function Toggle({
  checked,
  onChange,
  label,
  hint,
  id,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  hint?: string
  id: string
}) {
  return (
    <label htmlFor={id} className="flex cursor-pointer items-start gap-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(v) => onChange(v === true)} className="mt-0.5" />
      <span className="min-w-0">
        <span className="block text-sm">{label}</span>
        {hint && <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>}
      </span>
    </label>
  )
}

function SettingsView({
  base,
  workspaceId,
  initial,
  onSaved,
}: {
  base: string
  workspaceId: string
  initial: Settings
  onSaved: (channelsChanged: boolean) => void | Promise<void>
}) {
  const [form, setForm] = useState<Settings>(initial)
  const [excludedText, setExcludedText] = useState(initial.excludedUsernames.join('\n'))
  const [channels, setChannels] = useState<WsChannel[] | null>(null)
  const [channelsError, setChannelsError] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(initial)
    setExcludedText(initial.excludedUsernames.join('\n'))
  }, [initial])

  useEffect(() => {
    api<{ channels: WsChannel[] }>(`/api/workspace/${workspaceId}/channels`)
      .then((d) => setChannels(d.channels.filter((c) => c.type === 'c' || c.type === 'p')))
      .catch((e) => setChannelsError(e instanceof Error ? e.message : 'Не удалось загрузить каналы'))
  }, [workspaceId])

  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setForm((f) => ({ ...f, [k]: v }))

  const selected = useMemo(() => new Set(form.channels.map((c) => c.id)), [form.channels])
  const visible = useMemo(() => {
    const f = filter.trim().toLowerCase()
    const list = channels ?? []
    return (f ? list.filter((c) => c.name.toLowerCase().includes(f) || c.displayName?.toLowerCase().includes(f)) : list).sort(
      (a, b) => Number(selected.has(b.id)) - Number(selected.has(a.id)) || a.name.localeCompare(b.name),
    )
  }, [channels, filter, selected])

  const toggleChannel = (c: WsChannel) => {
    set(
      'channels',
      selected.has(c.id) ? form.channels.filter((x) => x.id !== c.id) : [...form.channels, { id: c.id, name: c.name, type: c.type === 'p' ? 'p' : 'c' }],
    )
  }

  const rulesChanged = (() => {
    const before = [...initial.channels.map((c) => c.id)].sort().join()
    const after = [...form.channels.map((c) => c.id)].sort().join()
    return (
      before !== after ||
      initial.excludeOwnMessages !== form.excludeOwnMessages ||
      initial.excludeBots !== form.excludeBots ||
      initial.includeThreads !== form.includeThreads ||
      initial.timezone !== form.timezone ||
      initial.excludedUsernames.join('\n') !== excludedText.trim()
    )
  })()
  const willRecalc = rulesChanged && form.channels.length > 0
  const dirty = JSON.stringify(form) !== JSON.stringify(initial) || excludedText !== initial.excludedUsernames.join('\n')

  const save = async () => {
    setSaving(true)
    const toastId = toast.loading('Сохраняем настройки…')
    try {
      const body = { ...form, excludedUsernames: excludedText }
      await api(base, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      toast.success('Настройки сохранены', { id: toastId })
      await onSaved(willRecalc)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Не удалось сохранить. Повторите попытку.', { id: toastId })
    } finally {
      setSaving(false)
    }
  }

  const needsReportChannel = (form.weeklyEnabled || form.monthlyEnabled) && !form.reportChannelId
  const enabledNoChannels = form.enabled && form.channels.length === 0

  return (
    <div className="space-y-6">
      <SettingsBlock title="Статус">
        <Toggle
          id="rr-enabled"
          checked={form.enabled}
          onChange={(v) => set('enabled', v)}
          label="Рейтинг включён"
          hint="Автоматически обновлять данные каждые 15 минут, публиковать недельный рейтинг и итоги месяца."
        />
      </SettingsBlock>

      <SettingsBlock
        title="Каналы в рейтинге"
        description="Учитываются реакции только в выбранных каналах. Личные сообщения не учитываются никогда. Список — каналы, где состоит ваша подключённая учётка."
      >
        <div className="flex min-h-7 flex-wrap gap-1.5">
          {form.channels.length === 0 ? (
            <span className={cn('text-xs', enabledNoChannels ? 'text-destructive' : 'text-muted-foreground')}>
              {enabledNoChannels ? 'Рейтинг включён, но каналы не выбраны — считать нечего. Отметьте каналы ниже.' : 'Каналы не выбраны'}
            </span>
          ) : (
            form.channels.map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => set('channels', form.channels.filter((x) => x.id !== c.id))}
                className="inline-flex items-center gap-1 rounded-md bg-muted px-2 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/40"
                title="Убрать из рейтинга"
                aria-label={`Убрать канал ${c.name} из рейтинга`}
              >
                {c.type === 'p' ? <Lock className="size-3" aria-hidden /> : <Hash className="size-3" aria-hidden />}
                {c.name}
                <X className="size-3 text-muted-foreground" aria-hidden />
              </button>
            ))
          )}
        </div>
        <div className="relative">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Поиск канала" aria-label="Поиск канала" className="pl-9" />
        </div>
        <div className="max-h-64 divide-y overflow-y-auto rounded-md border">
          {channelsError ? (
            <div className="space-y-2 p-4 text-sm">
              <p className="text-destructive">{channelsError}</p>
              <p className="text-xs text-muted-foreground">Проверьте подключение пространства к Rocket.Chat и обновите страницу.</p>
            </div>
          ) : channels == null ? (
            <div className="space-y-2 p-3" role="status" aria-busy="true" aria-label="Загрузка каналов">
              {Array.from({ length: 4 }).map((_, i) => (
                <Skeleton key={i} className="h-6 w-full" />
              ))}
            </div>
          ) : visible.length === 0 ? (
            <div className="p-4 text-center text-sm text-muted-foreground">Каналы не найдены</div>
          ) : (
            visible.map((c) => (
              <label key={c.id} className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm hover:bg-muted/40">
                <Checkbox checked={selected.has(c.id)} onCheckedChange={() => toggleChannel(c)} />
                {c.type === 'p' ? <Lock className="size-3.5 text-muted-foreground" aria-hidden /> : <Hash className="size-3.5 text-muted-foreground" aria-hidden />}
                <span className="truncate">{c.name}</span>
                {c.displayName && c.displayName !== c.name && <span className="truncate text-xs text-muted-foreground">{c.displayName}</span>}
              </label>
            ))
          )}
        </div>
      </SettingsBlock>

      <SettingsBlock title="Правила подсчёта" description="Рекомендуемые значения уже выставлены.">
        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle
            id="rr-own"
            checked={form.excludeOwnMessages}
            onChange={(v) => set('excludeOwnMessages', v)}
            label="Не учитывать реакции на свои сообщения"
          />
          <Toggle id="rr-bots" checked={form.excludeBots} onChange={(v) => set('excludeBots', v)} label="Не учитывать реакции ботов" />
          <Toggle
            id="rr-threads"
            checked={form.includeThreads}
            onChange={(v) => set('includeThreads', v)}
            label="Учитывать ответы в тредах"
            hint="По умолчанию считаются только сообщения основной ленты."
          />
        </div>
        <Field
          label="Не участвуют в рейтинге"
          htmlFor="rr-excluded"
          hint="Например, аккаунты adm и служебные учётки — их реакции не дают баллов."
        >
          <Textarea
            id="rr-excluded"
            value={excludedText}
            onChange={(e) => setExcludedText(e.target.value)}
            rows={3}
            placeholder={'Логины через перенос строки или запятую, например:\nyar_adm\nnews_bot'}
            className="font-mono text-sm"
          />
        </Field>
        <Field
          label="Часовой пояс"
          htmlFor="rr-timezone"
          hint="Границы месяца и недели считаются в этом поясе. Период поста — по дате самого сообщения."
        >
          <Select value={form.timezone} onValueChange={(v) => set('timezone', v)}>
            <SelectTrigger id="rr-timezone" className="w-full sm:w-[360px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEZONES.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>
      </SettingsBlock>

      <SettingsBlock title="Публикации" description="Посты уходят от имени владельца пространства и появляются во вкладке «Сообщения».">
        <Field
          label="Канал рейтинга"
          htmlFor="rr-report-channel"
          error={needsReportChannel ? 'Для автопубликаций выберите канал.' : undefined}
        >
          <Select
            value={form.reportChannelId ?? '__none'}
            onValueChange={(v) => {
              const ch = channels?.find((c) => c.id === v)
              setForm((f) => ({ ...f, reportChannelId: v === '__none' ? null : v, reportChannelName: ch?.name ?? null }))
            }}
          >
            <SelectTrigger id="rr-report-channel" aria-invalid={needsReportChannel} className="w-full sm:w-[360px]">
              <SelectValue placeholder="Не выбран" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">Не выбран</SelectItem>
              {form.reportChannelId && !channels?.some((c) => c.id === form.reportChannelId) && (
                <SelectItem value={form.reportChannelId}>#{form.reportChannelName}</SelectItem>
              )}
              {(channels ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  #{c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Toggle id="rr-weekly" checked={form.weeklyEnabled} onChange={(v) => set('weeklyEnabled', v)} label="Публиковать рейтинг каждую неделю" />
          <Toggle
            id="rr-monthly"
            checked={form.monthlyEnabled}
            onChange={(v) => set('monthlyEnabled', v)}
            label="Объявлять победителя месяца"
            hint="1-го числа итоги фиксируются всегда; публикуются — только с этой галочкой."
          />
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="День недельного поста" htmlFor="rr-weekly-day">
            <Select value={String(form.weeklyDay)} onValueChange={(v) => set('weeklyDay', Number(v))} disabled={!form.weeklyEnabled}>
              <SelectTrigger id="rr-weekly-day" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WEEK_DAYS.map((d, i) => (
                  <SelectItem key={d} value={String(i + 1)}>
                    {d}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Время публикации" htmlFor="rr-hour">
            <Select value={String(form.reportHour)} onValueChange={(v) => set('reportHour', Number(v))}>
              <SelectTrigger id="rr-hour" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Array.from({ length: 24 }, (_, h) => (
                  <SelectItem key={h} value={String(h)}>
                    {String(h).padStart(2, '0')}:00
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <Field label="Мест в посте" htmlFor="rr-top" hint="От 3 до 50">
            <Input
              id="rr-top"
              type="number"
              min={3}
              max={50}
              value={form.topN}
              onChange={(e) => set('topN', Math.min(50, Math.max(3, Number(e.target.value) || 3)))}
            />
          </Field>
        </div>

        <Toggle
          id="rr-mention"
          checked={form.mentionUsers}
          onChange={(v) => set('mentionUsers', v)}
          label="Упоминать участников топа через @"
          hint="Пиры получат уведомление. Победителя месяца упоминаем всегда."
        />
      </SettingsBlock>

      <div className="sticky bottom-0 z-10 -mx-1 flex flex-wrap items-center justify-end gap-3 border-t bg-background px-1 py-3">
        {dirty && !saving && (
          <span className="mr-auto text-xs text-muted-foreground">
            {willRecalc
              ? 'Изменены каналы или правила — после сохранения рейтинг будет пересчитан.'
              : 'Есть несохранённые изменения'}
          </span>
        )}
        <Button onClick={save} disabled={saving || needsReportChannel || !dirty} className="min-w-40">
          {saving ? <Spinner /> : null}
          {saving ? 'Сохраняем…' : 'Сохранить настройки'}
        </Button>
      </div>
    </div>
  )
}
