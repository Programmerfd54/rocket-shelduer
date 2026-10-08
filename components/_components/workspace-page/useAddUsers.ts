"use client"

import { useCallback, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { rcAdminCredentialsPayload, rcAdminCredentialsSchema, type RcAdminCredentials } from '@/lib/rc-admin-credentials'
import { resolveUserAssignments, type UserAssignments, type UserChannel } from '@/lib/workspace-user-assignments'

export const MAX_LOGINS_PER_REQUEST = 100
/** Допустимые символы логина Rocket.Chat: латиница, цифры, точка, подчёркивание, дефис */
const LOGIN_RE = /^[A-Za-z0-9._-]{1,64}$/

export type AddUserResult = { login: string; status: string; error?: string }
export type AddedUser = {
  id: string
  username: string
  email: string
  addedAt: string
  lastLoginAt: string | null
  status: string
  errorMessage: string | null
}
type Progress = { current: number; total: number; added: number; errors: number; skipped: number }

export type LoginsAnalysis = {
  /** Уникальные корректные логины (в порядке ввода) */
  valid: string[]
  /** Строки, которые не похожи на логин */
  invalid: string[]
  /** Сколько повторов отброшено */
  duplicates: number
  tooMany: boolean
}

/** Разбор вставленного текста: разделители — перенос строки, запятая, точка с запятой; «@» в начале игнорируется. */
export function analyzeLogins(text: string): LoginsAnalysis {
  const seen = new Map<string, string>()
  const invalid: string[] = []
  let duplicates = 0
  for (const raw of text.split(/[\n,;]+/)) {
    const value = raw.trim().replace(/^@/, '')
    if (!value) continue
    if (!LOGIN_RE.test(value)) {
      if (!invalid.includes(value)) invalid.push(value)
      continue
    }
    const key = value.toLowerCase()
    if (seen.has(key)) duplicates += 1
    else seen.set(key, value)
  }
  const valid = [...seen.values()]
  return { valid, invalid, duplicates, tooMany: valid.length > MAX_LOGINS_PER_REQUEST }
}

const CREDS_ERROR = 'Заполните данные администратора для выбранного способа входа (шаг 1).'

/**
 * Добавление пользователей в Rocket.Chat: учётные данные администратора, список логинов,
 * предпросмотр с каналами/ролями, потоковое создание, повтор ошибочных и таблица добавленных.
 */
export function useAddUsers(workspaceId: string) {
  const [credentials, setCredentials] = useState<RcAdminCredentials>({
    adminAuthMethod: 'password',
    adminUsername: '',
    adminPassword: '',
    adminTotpCode: '',
    adminPersonalToken: '',
    adminUserId: '',
  })
  const credentialsReady = rcAdminCredentialsSchema.safeParse(credentials).success
  const [catalogueProblem, setCatalogueProblem] = useState<{ message: string; details?: string; warning?: boolean } | null>(null)
  const [loginsText, setLoginsText] = useState('')
  const analysis = useMemo(() => analyzeLogins(loginsText), [loginsText])

  const [adding, setAdding] = useState(false)
  const [results, setResults] = useState<AddUserResult[] | null>(null)
  const [addedUsers, setAddedUsers] = useState<AddedUser[]>([])
  const [refreshLoading, setRefreshLoading] = useState(false)
  const [previewLogins, setPreviewLogins] = useState<string[] | null>(null)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [pendingLogins, setPendingLogins] = useState<string[] | null>(null)
  const [progress, setProgress] = useState<Progress | null>(null)

  const [defaultAssignments, setDefaultAssignments] = useState<UserAssignments>({ channels: [], roleIds: [] })
  const [assignmentOverrides, setAssignmentOverrides] = useState<Record<string, Partial<UserAssignments>>>({})
  const [channelsList, setChannelsList] = useState<UserChannel[]>([])
  const [rolesList, setRolesList] = useState<{ _id: string; name: string }[]>([])
  const [rolesLoading, setRolesLoading] = useState(false)
  const [ifUserExists, setIfUserExists] = useState<'skip' | 'reset_password'>('skip')

  const [tableSearch, setTableSearch] = useState('')
  const [tableFilter, setTableFilter] = useState<'all' | 'ADDED' | 'ERROR' | 'ALREADY_EXISTS' | 'never_logged'>('all')
  const [tableSort, setTableSort] = useState<'addedAt' | 'lastLoginAt' | 'status'>('addedAt')
  const [retryLoading, setRetryLoading] = useState(false)
  const [retryProgress, setRetryProgress] = useState<Progress | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  const busy = adding || retryLoading

  const loadAddedUsers = useCallback(async () => {
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users`)
      if (!res.ok) return
      const data = await res.json()
      setAddedUsers(data.users ?? [])
    } catch {
      // фоновое обновление таблицы: при ошибке остаётся прежний список
    }
  }, [workspaceId])

  /** Переход к предпросмотру. Ошибки показываются у поля, тост — краткое резюме. */
  const openPreview = () => {
    if (analysis.valid.length === 0) {
      toast.error('Добавьте хотя бы один логин', { description: 'По одному на строку, например: wrightag' })
      return false
    }
    if (analysis.tooMany) {
      toast.error(`Слишком много логинов: максимум ${MAX_LOGINS_PER_REQUEST} за один запрос`, {
        description: 'Разбейте список на части и добавьте по очереди.',
      })
      return false
    }
    if (analysis.invalid.length > 0) {
      toast.warning(`Пропущено строк с ошибками: ${analysis.invalid.length}`, {
        description: 'Они не попадут в список. Исправьте их или продолжайте только с корректными логинами.',
      })
    }
    setPreviewLogins(analysis.valid)
    return true
  }

  const requestCreate = () => {
    if (!previewLogins?.length) return
    if (!credentialsReady) {
      toast.error(CREDS_ERROR)
      return
    }
    setPendingLogins(previewLogins)
    setConfirmOpen(true)
  }

  const runAdd = async (logins: string[]) => {
    if (!credentialsReady) {
      toast.error(CREDS_ERROR)
      return
    }
    if (logins.length === 0) {
      toast.error('Добавьте хотя бы один логин')
      return
    }
    const toastId = 'add-users'
    setConfirmOpen(false)
    setPendingLogins(null)
    setPreviewLogins(null)
    setAdding(true)
    setResults(null)
    setProgress({ current: 0, total: logins.length, added: 0, errors: 0, skipped: 0 })
    abortRef.current = new AbortController()
    toast.loading(`Создаём пользователей: 0 из ${logins.length}…`, { id: toastId })
    let settled = false
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/add`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Error-Handling': 'local' },
        body: JSON.stringify({
          ...rcAdminCredentialsPayload(credentials),
          users: logins.map((login) => ({
            login,
            ...resolveUserAssignments(defaultAssignments, assignmentOverrides[login]),
          })),
          ifUserExists,
        }),
        signal: abortRef.current.signal,
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Не удалось создать пользователей', {
          id: toastId,
          description: data.details || 'Проверьте учётные данные администратора и повторите.',
        })
        settled = true
        setPreviewLogins(logins)
        return
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const collected: AddUserResult[] = []
      let completed = false
      let streamError: string | null = null
      const handle = (obj: any) => {
        if (obj.t === 'progress') {
          const p = {
            current: obj.current ?? 0,
            total: obj.total ?? 0,
            added: obj.added ?? 0,
            errors: obj.errors ?? 0,
            skipped: obj.skipped ?? 0,
          }
          setProgress(p)
          toast.loading(`Создаём пользователей: ${p.current} из ${p.total}…`, { id: toastId })
        } else if (obj.t === 'result') {
          collected.push({ login: obj.login, status: obj.status, error: obj.error })
          setResults([...collected])
        } else if (obj.t === 'done') {
          completed = true
          setResults(obj.results ?? collected)
        } else if (obj.t === 'error') {
          streamError = obj.error || 'Добавление прервано'
        }
      }
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            handle(JSON.parse(line))
          } catch {}
        }
      }
      if (buffer.trim()) {
        try {
          handle(JSON.parse(buffer))
        } catch {}
      }
      if (streamError) throw new Error(streamError)
      if (!completed) throw new Error('Соединение прервано. Проверьте список добавленных пользователей перед повтором.')
      const added = collected.filter((r) => r.status === 'ADDED').length
      const errs = collected.filter((r) => r.status === 'ERROR').length
      const skipped = collected.filter((r) => r.status === 'ALREADY_EXISTS').length
      const text = `Добавлено: ${added}${errs > 0 ? `, ошибок: ${errs}` : ''}${skipped > 0 ? `, пропущено (уже есть): ${skipped}` : ''}`
      settled = true
      if (errs > 0) toast.warning(text, { id: toastId, description: 'Ошибочных можно повторить ниже, в списке добавленных.' })
      else toast.success(text, { id: toastId })
    } catch (e: any) {
      settled = true
      if (e?.name === 'AbortError') toast.info('Добавление остановлено. Уже созданные аккаунты сохранены.', { id: toastId })
      else toast.error(e?.message || 'Не удалось создать пользователей', { id: toastId })
    } finally {
      if (!settled) toast.dismiss(toastId)
      setAdding(false)
      setProgress(null)
      abortRef.current = null
      await loadAddedUsers()
    }
  }

  const loadRoles = async () => {
    if (!credentialsReady) {
      toast.error(CREDS_ERROR)
      return
    }
    setRolesLoading(true)
    setCatalogueProblem(null)
    const toastId = 'users-roles'
    toast.loading('Загружаем каналы и роли…', { id: toastId })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/roles`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Error-Handling': 'local' },
        body: JSON.stringify(rcAdminCredentialsPayload(credentials)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        const message = data.error || 'Не удалось загрузить каналы и роли'
        setCatalogueProblem({ message, details: data.details })
        setRolesList([])
        setChannelsList([])
        toast.error(message, { id: toastId, description: data.details || 'Проверьте данные администратора.' })
        return
      }
      setRolesList(data.roles ?? [])
      setChannelsList(data.channels ?? [])
      if (Array.isArray(data.warnings) && data.warnings.length) {
        setCatalogueProblem({
          message: 'Часть списков не удалось загрузить',
          warning: true,
          details: data.warnings
            .map((problem: { source: string; error: string; details?: string }) => `${problem.source}: ${problem.error} ${problem.details || ''}`)
            .join(' '),
        })
        toast.warning('Часть списков не удалось загрузить', { id: toastId })
      } else {
        toast.success('Каналы и роли загружены', { id: toastId })
      }
    } catch {
      const problem = {
        message: 'Соединение с приложением прервано.',
        details: 'Проверьте сеть и повторите загрузку. Если используется VPN, дождитесь восстановления подключения.',
      }
      setCatalogueProblem(problem)
      toast.error(problem.message, { id: toastId, description: problem.details })
    } finally {
      setRolesLoading(false)
    }
  }

  const retryFailed = async () => {
    if (!credentialsReady) {
      toast.error(CREDS_ERROR)
      return
    }
    setRetryLoading(true)
    setRetryProgress({ current: 0, total: 1, added: 0, errors: 0, skipped: 0 })
    const toastId = 'retry-failed-users'
    toast.loading('Повторяем для ошибочных…', { id: toastId })
    let settled = false
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/retry-failed`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Error-Handling': 'local' },
        body: JSON.stringify({ ...rcAdminCredentialsPayload(credentials), ...defaultAssignments }),
      })
      const contentType = res.headers.get('content-type') || ''
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        toast.error(data.error || 'Не удалось повторить', { id: toastId, description: data.details })
        settled = true
        return
      }
      if (contentType.includes('application/json') && !contentType.includes('ndjson')) {
        const data = await res.json().catch(() => ({}))
        toast.info(data.message || 'Нечего повторять', { id: toastId })
        settled = true
        return
      }
      const reader = res.body?.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      const handle = async (obj: any) => {
        if (obj.t === 'progress') {
          setRetryProgress({
            current: obj.current ?? 0,
            total: obj.total ?? 0,
            added: obj.added ?? 0,
            errors: obj.errors ?? 0,
            skipped: obj.skipped ?? 0,
          })
        } else if (obj.t === 'done') {
          settled = true
          await loadAddedUsers()
          const text = `Повтор: добавлено ${obj.added ?? 0}, ошибок ${obj.errors ?? 0}, пропущено ${obj.skipped ?? 0}`
          if (obj.errors > 0) toast.warning(text, { id: toastId })
          else toast.success(text, { id: toastId })
        } else if (obj.t === 'error') {
          settled = true
          toast.error(obj.error || 'Не удалось повторить', { id: toastId })
        }
      }
      while (reader) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            await handle(JSON.parse(line))
          } catch {}
        }
      }
      await loadAddedUsers()
    } catch (e: any) {
      settled = true
      toast.error(e?.message || 'Не удалось повторить', { id: toastId, description: 'Проверьте сеть и повторите.' })
    } finally {
      if (!settled) toast.dismiss(toastId)
      setRetryProgress(null)
      setRetryLoading(false)
    }
  }

  const refreshLogin = async () => {
    if (!credentialsReady) {
      toast.error(CREDS_ERROR)
      return
    }
    setRefreshLoading(true)
    const toastId = 'refresh-users-login'
    toast.loading('Обновляем статусы входа…', { id: toastId })
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/users/refresh-login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-Error-Handling': 'local' },
        body: JSON.stringify(rcAdminCredentialsPayload(credentials)),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) {
        toast.error(data.error || 'Не удалось обновить статусы', { id: toastId, description: data.details })
        return
      }
      setAddedUsers(data.users ?? [])
      toast.success('Статусы входа обновлены', { id: toastId })
    } catch (e: any) {
      toast.error(e?.message || 'Не удалось обновить статусы', { id: toastId, description: 'Проверьте сеть и повторите.' })
    } finally {
      setRefreshLoading(false)
    }
  }

  const failedCount = addedUsers.filter((u) => u.status === 'ERROR').length

  const tableUsers = useMemo(() => {
    let list = [...addedUsers]
    const q = tableSearch.trim().toLowerCase()
    if (q) list = list.filter((u) => u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q))
    if (tableFilter === 'ADDED') list = list.filter((u) => u.status === 'ADDED')
    else if (tableFilter === 'ERROR') list = list.filter((u) => u.status === 'ERROR')
    else if (tableFilter === 'ALREADY_EXISTS') list = list.filter((u) => u.status === 'ALREADY_EXISTS')
    else if (tableFilter === 'never_logged') list = list.filter((u) => u.status === 'ADDED' && !u.lastLoginAt)
    if (tableSort === 'addedAt') list.sort((a, b) => new Date(b.addedAt).getTime() - new Date(a.addedAt).getTime())
    else if (tableSort === 'lastLoginAt')
      list.sort((a, b) => (b.lastLoginAt ? new Date(b.lastLoginAt).getTime() : 0) - (a.lastLoginAt ? new Date(a.lastLoginAt).getTime() : 0))
    else if (tableSort === 'status') list.sort((a, b) => a.status.localeCompare(b.status))
    return list
  }, [addedUsers, tableSearch, tableFilter, tableSort])

  return {
    credentials,
    setCredentials,
    credentialsReady,
    catalogueProblem,
    setCatalogueProblem,
    loginsText,
    setLoginsText,
    analysis,
    adding,
    retryLoading,
    busy,
    results,
    addedUsers,
    tableUsers,
    failedCount,
    refreshLoading,
    previewLogins,
    setPreviewLogins,
    confirmOpen,
    setConfirmOpen,
    pendingLogins,
    progress,
    retryProgress,
    defaultAssignments,
    setDefaultAssignments,
    assignmentOverrides,
    setAssignmentOverrides,
    channelsList,
    rolesList,
    rolesLoading,
    ifUserExists,
    setIfUserExists,
    tableSearch,
    setTableSearch,
    tableFilter,
    setTableFilter,
    tableSort,
    setTableSort,
    loadAddedUsers,
    openPreview,
    requestCreate,
    runAdd,
    cancelAdd: () => abortRef.current?.abort(),
    loadRoles,
    retryFailed,
    refreshLogin,
  }
}

export type AddUsersState = ReturnType<typeof useAddUsers>
