"use client"

import { type ReactNode } from 'react'
import { AlertTriangle, LogIn, RotateCcw, UserPlus } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { Progress } from '@/components/ui/progress'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Spinner } from '@/components/ui/spinner'
import { Textarea } from '@/components/ui/textarea'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Section } from '@/components/common/Section'
import { AssignmentMultiSelect, UserAssignmentsPreview } from '@/components/_components/workspace/UserAssignmentsPreview'
import { RcAdminCredentialsForm } from '@/components/_components/workspace/RcAdminCredentialsForm'
import { RcAddedUsersPanel } from '@/components/_components/workspace/RcAddedUsersPanel'
import { Notice } from './Notice'
import { MAX_LOGINS_PER_REQUEST, type AddUsersState } from './useAddUsers'

function Step({ n, children }: { n: number; children: ReactNode }) {
  return (
    <>
      <span className="mr-1.5 tabular-nums text-muted-foreground">{n}.</span>
      {children}
    </>
  )
}

function plural(n: number, one: string, few: string, many: string) {
  const mod10 = n % 10
  const mod100 = n % 100
  if (mod10 === 1 && mod100 !== 11) return one
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few
  return many
}

const RESULT_BADGE: Record<string, { variant: 'success' | 'danger' | 'muted'; label: string }> = {
  ADDED: { variant: 'success', label: 'Добавлен' },
  ERROR: { variant: 'danger', label: 'Ошибка' },
  ALREADY_EXISTS: { variant: 'muted', label: 'Уже существует' },
}

/**
 * Добавление пользователей в Rocket.Chat — единый сценарий из шагов:
 * 1) данные администратора → 2) список логинов → 3) каналы и роли → 4) предпросмотр и создание.
 */
export function AddUsersSection({ workspaceId, users }: { workspaceId: string; users: AddUsersState }) {
  const { analysis } = users
  const hasText = users.loginsText.trim().length > 0
  const inPreview = users.previewLogins !== null
  const progress = users.progress ?? users.retryProgress
  const progressPct = progress ? Math.round((progress.current / Math.max(1, progress.total)) * 100) : 0

  const loginsError = !hasText
    ? ''
    : analysis.tooMany
      ? `Слишком много логинов: ${analysis.valid.length}. Максимум ${MAX_LOGINS_PER_REQUEST} за один запрос — разбейте список на части.`
      : analysis.invalid.length > 0
        ? `Не похоже на логин (${analysis.invalid.length}): ${analysis.invalid.slice(0, 8).join(', ')}${analysis.invalid.length > 8 ? '…' : ''}. Допустимы латиница, цифры, «.», «_» и «-». Исправьте или удалите эти строки.`
        : ''
  const canPreview = analysis.valid.length > 0 && !analysis.tooMany && analysis.invalid.length === 0 && !users.busy

  const resultCounts = {
    added: users.results?.filter((r) => r.status === 'ADDED').length ?? 0,
    errors: users.results?.filter((r) => r.status === 'ERROR').length ?? 0,
    existed: users.results?.filter((r) => r.status === 'ALREADY_EXISTS').length ?? 0,
  }
  const pendingCount = users.pendingLogins?.length ?? 0

  return (
    <div className="space-y-4">
      <div className="space-y-0.5">
        <h2 className="text-base font-semibold tracking-tight">Добавление пользователей в Rocket.Chat</h2>
        <p className="max-w-3xl text-[13px] text-muted-foreground text-pretty">
          Создайте учётные записи по списку логинов. Для каждого: почта — логин@student.21-school.ru, пароль равен логину, при первом входе пользователь сменит пароль. До {MAX_LOGINS_PER_REQUEST} пользователей за один запрос.
        </p>
      </div>

      <Section title={<Step n={1}>Учётные данные администратора Rocket.Chat</Step>}>
        <RcAdminCredentialsForm
          value={users.credentials}
          onChange={(value) => {
            users.setCredentials(value)
            users.setCatalogueProblem(null)
          }}
          disabled={users.busy || users.rolesLoading || users.refreshLoading}
        />
      </Section>

      <Section
        title={<Step n={2}>Список логинов</Step>}
        description={inPreview ? undefined : 'Вставьте логины — по одному на строку или через запятую.'}
      >
        {!inPreview ? (
          <div className="space-y-3">
            <Field
              label="Логины пользователей"
              htmlFor="users-logins"
              error={loginsError}
              hint={`Например: wrightag. Повторы и «@» в начале убираются автоматически.`}
            >
              <Textarea
                id="users-logins"
                placeholder={'wrightag\nuser2\nuser3'}
                value={users.loginsText}
                onChange={(e) => users.setLoginsText(e.target.value)}
                disabled={users.busy}
                rows={6}
                aria-invalid={!!loginsError}
                className="min-h-[140px] font-mono text-sm"
              />
            </Field>
            {hasText && (
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" aria-live="polite">
                <span>
                  Корректных логинов: <strong className="tabular-nums text-foreground">{analysis.valid.length}</strong> из {MAX_LOGINS_PER_REQUEST}
                </span>
                {analysis.duplicates > 0 && <span>повторов убрано: {analysis.duplicates}</span>}
                {analysis.invalid.length > 0 && <span className="text-destructive">с ошибками: {analysis.invalid.length}</span>}
              </p>
            )}
            <Button onClick={users.openPreview} disabled={!canPreview}>
              Предпросмотр{analysis.valid.length > 0 ? ` (${analysis.valid.length})` : ''}
            </Button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm">
              В списке <strong className="tabular-nums">{users.previewLogins!.length}</strong>{' '}
              {plural(users.previewLogins!.length, 'логин', 'логина', 'логинов')}
            </p>
            <Button variant="outline" size="sm" onClick={() => users.setPreviewLogins(null)} disabled={users.busy}>
              Изменить список
            </Button>
          </div>
        )}
      </Section>

      <Section
        title={<Step n={3}>Каналы и роли (необязательно)</Step>}
        description="Общие настройки применяются ко всем пользователям, у которых нет индивидуального выбора. Роли модератора и владельца канала назначаются отдельно в Rocket.Chat."
      >
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={users.loadRoles}
              disabled={users.rolesLoading || users.busy || !users.credentialsReady}
              title={!users.credentialsReady ? 'Сначала заполните данные администратора (шаг 1)' : undefined}
            >
              {users.rolesLoading && <Spinner />}
              Загрузить каналы и роли
            </Button>
            <p className="text-xs text-muted-foreground">
              {users.credentialsReady
                ? 'Списки берутся из этого пространства под указанным администратором.'
                : 'Станет доступно после заполнения шага 1.'}
            </p>
          </div>

          {users.catalogueProblem && (
            <Notice
              tone={users.catalogueProblem.warning ? 'warning' : 'danger'}
              icon={<AlertTriangle />}
              title={users.catalogueProblem.message}
            >
              {users.catalogueProblem.details}
            </Notice>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Общие каналы и группы">
              <AssignmentMultiSelect
                label="Общие каналы и группы"
                options={users.channelsList.map((channel) => ({
                  id: channel.id,
                  label: `${channel.name || channel.id}${channel.type === 'p' ? ' (группа)' : ''}`,
                }))}
                selected={users.defaultAssignments.channels.map((channel) => channel.id)}
                onChange={(ids) =>
                  users.setDefaultAssignments((previous) => ({
                    ...previous,
                    channels: ids.map((id) => users.channelsList.find((channel) => channel.id === id) || previous.channels.find((channel) => channel.id === id)!),
                  }))
                }
                disabled={users.busy || users.rolesLoading}
              />
            </Field>
            <Field label="Общие роли пространства">
              <AssignmentMultiSelect
                label="Общие роли пространства"
                options={users.rolesList.map((role) => ({ id: role._id, label: role.name || role._id }))}
                selected={users.defaultAssignments.roleIds}
                onChange={(roleIds) => users.setDefaultAssignments((previous) => ({ ...previous, roleIds }))}
                disabled={users.busy || users.rolesLoading}
              />
            </Field>
          </div>

          <Field label="Если пользователь уже существует" htmlFor="users-if-exists" className="sm:max-w-xs">
            <Select value={users.ifUserExists} onValueChange={(v: 'skip' | 'reset_password') => users.setIfUserExists(v)} disabled={users.busy}>
              <SelectTrigger id="users-if-exists" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="skip">Пропускать</SelectItem>
                <SelectItem value="reset_password">Сбросить пароль (скоро)</SelectItem>
              </SelectContent>
            </Select>
          </Field>
        </div>
      </Section>

      {inPreview && (
        <Section
          title={<Step n={4}>Предпросмотр и создание</Step>}
          description="Выберите каналы и роли напротив каждого пользователя. Пока выбор не изменён, действуют общие настройки из шага 3."
        >
          <div className="space-y-4">
            <UserAssignmentsPreview
              logins={users.previewLogins!}
              channels={users.channelsList}
              roles={users.rolesList}
              defaults={users.defaultAssignments}
              overrides={users.assignmentOverrides}
              onChange={users.setAssignmentOverrides}
              disabled={users.busy || users.rolesLoading}
            />
            <div className="flex flex-wrap items-center gap-2">
              {Object.keys(users.assignmentOverrides).length > 0 && (
                <Button type="button" variant="outline" size="sm" disabled={users.busy} onClick={() => users.setAssignmentOverrides({})}>
                  Вернуть общие настройки всем
                </Button>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t pt-4">
              <Button onClick={users.requestCreate} disabled={users.busy || !users.credentialsReady}>
                {users.adding ? <Spinner /> : <UserPlus />}
                {users.adding ? 'Создаём…' : `Создать ${users.previewLogins!.length} ${plural(users.previewLogins!.length, 'пользователя', 'пользователей', 'пользователей')}`}
              </Button>
              <Button variant="outline" onClick={() => users.setPreviewLogins(null)} disabled={users.busy}>
                Назад
              </Button>
              {!users.credentialsReady && (
                <p className="text-xs text-muted-foreground">Заполните данные администратора в шаге 1, чтобы продолжить.</p>
              )}
            </div>
          </div>
        </Section>
      )}

      {progress && (
        <div className="space-y-2 rounded-lg border bg-card p-4" role="status" aria-live="polite">
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="font-medium">
              {users.progress
                ? `Создано ${users.progress.current} из ${users.progress.total}`
                : `Повтор: ${users.retryProgress?.current ?? 0} из ${users.retryProgress?.total ?? 0}`}
            </span>
            <span className="tabular-nums text-muted-foreground">{progressPct}%</span>
          </div>
          <Progress value={progressPct} />
          {users.progress && (
            <p className="text-xs text-muted-foreground">
              Успешно: {users.progress.added} · ошибок: {users.progress.errors} · пропущено: {users.progress.skipped}
            </p>
          )}
          {users.progress && users.adding && (
            <Button type="button" variant="outline" size="sm" onClick={users.cancelAdd}>
              Остановить
            </Button>
          )}
        </div>
      )}

      {users.results && users.results.length > 0 && (
        <Section
          title="Результат"
          actions={
            <span className="flex items-center gap-1.5">
              <Badge variant="success">{resultCounts.added} добавлено</Badge>
              {resultCounts.errors > 0 && <Badge variant="danger">{resultCounts.errors} с ошибкой</Badge>}
              {resultCounts.existed > 0 && <Badge variant="muted">{resultCounts.existed} уже было</Badge>}
            </span>
          }
        >
          <ul className="-my-2 max-h-64 divide-y overflow-y-auto">
            {users.results.map((r, i) => {
              const meta = RESULT_BADGE[r.status] ?? { variant: 'muted' as const, label: r.status }
              return (
                <li key={`${r.login}-${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2 text-sm">
                  <span className="font-mono">{r.login}</span>
                  <Badge variant={meta.variant}>{meta.label}</Badge>
                  {r.error && <span className="min-w-0 break-words text-xs text-muted-foreground">{r.error}</span>}
                </li>
              )
            })}
          </ul>
        </Section>
      )}

      {(users.addedUsers.length > 0 || (users.results?.length ?? 0) > 0) && (
        <Section
          bare
          title={
            <>
              Добавленные пользователи <span className="font-normal tabular-nums text-muted-foreground">{users.addedUsers.length}</span>
            </>
          }
          description={!users.credentialsReady ? 'Для обновления статусов и повтора заполните данные администратора (шаг 1).' : undefined}
          actions={
            <>
              <Button variant="outline" size="sm" onClick={users.refreshLogin} disabled={users.refreshLoading || !users.credentialsReady}>
                {users.refreshLoading ? <Spinner /> : <LogIn />}
                Обновить статусы входа
              </Button>
              {users.failedCount > 0 && (
                <Button variant="outline" size="sm" onClick={users.retryFailed} disabled={users.busy || !users.credentialsReady}>
                  {users.retryLoading ? <Spinner /> : <RotateCcw />}
                  Повторить для ошибочных ({users.failedCount})
                </Button>
              )}
            </>
          }
        >
          <div className="space-y-3">
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
              <Input
                placeholder="Поиск по логину или почте…"
                aria-label="Поиск по логину или почте"
                value={users.tableSearch}
                onChange={(e) => users.setTableSearch(e.target.value)}
                className="sm:max-w-xs"
              />
              <Select value={users.tableFilter} onValueChange={(v: typeof users.tableFilter) => users.setTableFilter(v)}>
                <SelectTrigger className="w-full sm:w-48" aria-label="Фильтр по статусу">
                  <SelectValue placeholder="Фильтр" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Все</SelectItem>
                  <SelectItem value="ADDED">Добавлено</SelectItem>
                  <SelectItem value="ERROR">Ошибка</SelectItem>
                  <SelectItem value="ALREADY_EXISTS">Уже существует</SelectItem>
                  <SelectItem value="never_logged">Ни разу не входили</SelectItem>
                </SelectContent>
              </Select>
              <Select value={users.tableSort} onValueChange={(v: typeof users.tableSort) => users.setTableSort(v)}>
                <SelectTrigger className="w-full sm:w-52" aria-label="Сортировка">
                  <SelectValue placeholder="Сортировка" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="addedAt">По дате добавления</SelectItem>
                  <SelectItem value="lastLoginAt">По последнему входу</SelectItem>
                  <SelectItem value="status">По статусу</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <RcAddedUsersPanel
              workspaceId={workspaceId}
              users={users.tableUsers}
              credentials={users.credentials}
              credentialsReady={users.credentialsReady}
              onChanged={users.loadAddedUsers}
            />
          </div>
        </Section>
      )}

      <ConfirmDialog
        open={users.confirmOpen}
        onOpenChange={users.setConfirmOpen}
        title="Создать пользователей?"
        description={
          <p>
            В Rocket.Chat будет создано {pendingCount} {plural(pendingCount, 'пользователь', 'пользователя', 'пользователей')} с выбранными каналами и ролями. Остановить создание можно в процессе — уже созданные аккаунты сохранятся.
          </p>
        }
        confirmLabel={`Создать (${pendingCount})`}
        onConfirm={() => (users.pendingLogins?.length ? users.runAdd(users.pendingLogins) : undefined)}
      />
    </div>
  )
}
