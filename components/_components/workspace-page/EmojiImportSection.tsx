"use client"

import { useState } from 'react'
import { ChevronDown, ChevronUp, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Field } from '@/components/ui/field'
import { Input } from '@/components/ui/input'
import { PasswordInput } from '@/components/ui/password-input'
import { Progress } from '@/components/ui/progress'
import { Spinner } from '@/components/ui/spinner'
import { CopyButton } from '@/components/common/CopyButton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { Section } from '@/components/common/Section'
import { Notice } from './Notice'
import { DEFAULT_EMOJI_YAML_URL, validateYamlUrl, type EmojiImportState } from './useEmojiImport'

function ErrorList({ errors, label }: { errors: string[]; label: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-1.5">
      <div className="flex items-center gap-1">
        <Button variant="ghost" size="xs" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
          {open ? <ChevronUp /> : <ChevronDown />}
          {label} ({errors.length})
        </Button>
        <CopyButton text={errors.join('\n')} successMessage="Список ошибок скопирован" aria-label="Скопировать список ошибок" size="icon-xs" />
      </div>
      {open && (
        <ul className="mt-1 max-h-32 list-inside list-disc space-y-0.5 overflow-y-auto text-xs text-muted-foreground">
          {errors.map((err, i) => (
            <li key={i}>{err}</li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Массовый импорт кастомных эмодзи из YAML-каталога в Rocket.Chat пространства. */
export function EmojiImportSection({ emoji }: { emoji: EmojiImportState }) {
  const [submitted, setSubmitted] = useState(false)
  const [namesVisible, setNamesVisible] = useState(false)

  const urlError = validateYamlUrl(emoji.yamlUrl)
  const userError = !emoji.adminUsername.trim() ? 'Укажите логин администратора.' : ''
  const passError = !emoji.adminPassword ? 'Укажите пароль администратора.' : ''
  const formValid = !urlError && !userError && !passError

  const pct = emoji.progress?.total ? Math.round((100 * emoji.progress.current) / emoji.progress.total) : 0
  const customUrl = emoji.yamlUrl.trim() !== '' && emoji.yamlUrl.trim() !== DEFAULT_EMOJI_YAML_URL

  const requestImport = () => {
    setSubmitted(true)
    if (!formValid) return
    emoji.setConfirmOpen(true)
  }

  return (
    <Section
      title="Массовый импорт кастомных эмодзи"
      description="Загрузка эмодзи из YAML-каталога в Rocket.Chat этого пространства. Уже существующие эмодзи пропускаются. Учётные данные администратора проверяются перед импортом."
    >
      <div className="space-y-4">
        {emoji.lastStatus && (
          <Notice tone="neutral" icon={<Upload />} title="Последний импорт">
            {new Date(emoji.lastStatus.date).toLocaleString('ru-RU')} — загружено {emoji.lastStatus.uploaded}, пропущено (уже есть) {emoji.lastStatus.skipped}
            {emoji.lastStatus.errorsCount > 0 && `, с ошибками ${emoji.lastStatus.errorsCount}`}.
            {emoji.lastStatus.errors && emoji.lastStatus.errors.length > 0 && (
              <ErrorList errors={emoji.lastStatus.errors} label="Ошибки" />
            )}
          </Notice>
        )}

        {emoji.interrupted && (
          <Notice
            tone="warning"
            icon={<Upload />}
            title="Предыдущий импорт был прерван перезагрузкой страницы"
            action={
              <Button variant="outline" size="sm" onClick={emoji.dismissInterrupted}>
                Понятно
              </Button>
            }
          >
            Обработано {emoji.interrupted.current} из {emoji.interrupted.total}. Загружено {emoji.interrupted.uploaded}, пропущено {emoji.interrupted.skipped}, ошибок {emoji.interrupted.errorsCount}. Запустите импорт снова — уже загруженные эмодзи будут пропущены.
          </Notice>
        )}

        {emoji.importing && emoji.progress && (
          <div className="space-y-2 rounded-lg border bg-muted/30 p-3" role="status" aria-live="polite">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="font-medium">Идёт импорт</span>
              <span className="tabular-nums text-muted-foreground">{pct}%</span>
            </div>
            <Progress value={pct} />
            <p className="text-xs text-muted-foreground">
              Обработано {emoji.progress.current} из {emoji.progress.total} · загружено {emoji.progress.uploaded} · пропущено {emoji.progress.skipped} · ошибок {emoji.progress.errorsCount}
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Не перезагружайте страницу, пока идёт импорт.</p>
              <Button type="button" variant="outline" size="sm" onClick={emoji.cancelImport}>
                Отменить
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field
            label="Логин администратора Rocket.Chat"
            htmlFor="emoji-admin-username"
            required
            error={submitted ? userError : ''}
            hint="Нужен для загрузки эмодзи в каталог этого сервера."
          >
            <Input
              id="emoji-admin-username"
              value={emoji.adminUsername}
              onChange={(e) => emoji.setAdminUsername(e.target.value)}
              placeholder="admin"
              disabled={emoji.importing}
              autoComplete="username"
              aria-invalid={submitted && !!userError}
            />
          </Field>
          <Field label="Пароль администратора" htmlFor="emoji-admin-password" required error={submitted ? passError : ''}>
            <PasswordInput
              id="emoji-admin-password"
              value={emoji.adminPassword}
              onChange={(e) => emoji.setAdminPassword(e.target.value)}
              disabled={emoji.importing}
              autoComplete="current-password"
              aria-invalid={submitted && !!passError}
            />
          </Field>
        </div>

        <Field
          label="Ссылка на каталог (YAML)"
          htmlFor="emoji-yaml-url"
          required
          error={submitted || emoji.yamlUrl.trim() ? urlError : ''}
          hint={customUrl ? 'Используется нестандартный каталог.' : 'По умолчанию — общий каталог эмодзи.'}
        >
          <Input
            id="emoji-yaml-url"
            type="url"
            value={emoji.yamlUrl}
            onChange={(e) => emoji.setYamlUrl(e.target.value)}
            placeholder={DEFAULT_EMOJI_YAML_URL}
            disabled={emoji.importing}
            className="font-mono text-[13px]"
            aria-invalid={!!urlError}
          />
        </Field>

        {emoji.preview && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="flex flex-wrap items-center gap-2">
              В каталоге <strong className="tabular-nums">{emoji.preview.total}</strong> эмодзи.
              {emoji.preview.names.length > 0 && (
                <Button variant="ghost" size="xs" onClick={() => setNamesVisible((v) => !v)}>
                  {namesVisible ? 'Скрыть имена' : 'Показать имена'}
                </Button>
              )}
            </p>
            {namesVisible && emoji.preview.names.length > 0 && (
              <ul className="mt-2 flex max-h-32 flex-wrap gap-1 overflow-y-auto font-mono text-xs text-muted-foreground">
                {emoji.preview.names.map((name, i) => (
                  <li key={i} className="rounded bg-muted px-1.5 py-0.5">{name}</li>
                ))}
                {emoji.preview.total > emoji.preview.names.length && (
                  <li className="py-0.5">… и ещё {emoji.preview.total - emoji.preview.names.length}</li>
                )}
              </ul>
            )}
          </div>
        )}

        <div className="flex flex-wrap gap-2">
          <Button variant="outline" onClick={emoji.runPreview} disabled={emoji.previewLoading || emoji.importing || !!urlError}>
            {emoji.previewLoading && <Spinner />}
            Проверить каталог
          </Button>
          <Button onClick={requestImport} disabled={emoji.importing}>
            {emoji.importing ? <Spinner /> : <Upload />}
            {emoji.importing ? 'Импорт…' : 'Запустить импорт'}
          </Button>
        </div>

        {emoji.result && (
          <div className="rounded-lg border bg-muted/30 p-3 text-sm">
            <p className="font-medium">Результат импорта</p>
            <p className="mt-0.5 text-muted-foreground">
              Загружено: <strong>{emoji.result.uploaded}</strong>, пропущено (уже есть): <strong>{emoji.result.skipped}</strong>
              {emoji.result.errors && emoji.result.errors.length > 0 && (
                <>, с ошибками: <strong>{emoji.result.errors.length}</strong></>
              )}
            </p>
            {emoji.result.errors && emoji.result.errors.length > 0 && <ErrorList errors={emoji.result.errors} label="Ошибки" />}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={emoji.confirmOpen}
        onOpenChange={emoji.setConfirmOpen}
        title="Запустить импорт эмодзи?"
        description={
          emoji.preview
            ? `В каталоге ${emoji.preview.total} эмодзи. Они будут загружены в Rocket.Chat этого пространства, уже существующие — пропущены.`
            : 'Каталог будет скачан по указанной ссылке, все эмодзи загружены в Rocket.Chat этого пространства. Уже существующие эмодзи пропускаются.'
        }
        confirmLabel="Импортировать"
        onConfirm={emoji.runImport}
      />
    </Section>
  )
}
