'use client'

import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { ConfirmDialog } from '@/components/common/ConfirmDialog'
import { FeatureSwitch } from '@/components/intensives/admin/FeatureGate'

type Settings = Record<string, string>

const SECTIONS: { title: string; description?: string; items: { key: string; label: string; hint?: string }[] }[] = [
  {
    title: 'Возможности ролей',
    items: [
      { key: 'sendAsEnabledSup', label: '«Отправить от имени» для SUP', hint: 'SUP может выбирать отправителя при планировании сообщения' },
      { key: 'sendAsEnabledAdm', label: '«Отправить от имени» для ADM', hint: 'ADM может отправлять от имени ADM и волонтёров' },
      { key: 'activityViewVolSup', label: 'SUP видит активность волонтёров' },
      { key: 'templatesTabVisible', label: 'Раздел «Шаблоны» виден всем ролям', hint: 'Если выключено — раздел доступен только Lead_SUP' },
    ],
  },
  {
    title: 'Вкладки пространства',
    description: 'Снимите галочку, чтобы скрыть вкладку у указанной роли.',
    items: [
      { key: 'workspaceTabTemplatesSup', label: 'SUP: «Шаблоны»' },
      { key: 'workspaceTabEmojiImportSup', label: 'SUP: «Настройка пространства»' },
      { key: 'workspaceTabUsersAddSup', label: 'SUP: «Добавление пользователей»' },
      { key: 'workspaceTabTemplatesAdm', label: 'ADM: «Шаблоны»' },
      { key: 'workspaceTabEmojiImportAdm', label: 'ADM: «Настройка пространства»' },
    ],
  },
]

/** Настройки платформы (глобальные SystemSetting) — только Lead_SUP. */
export function AdminSettingsPanel() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [savingKey, setSavingKey] = useState<string | null>(null)
  const [contact, setContact] = useState('')
  const [contactError, setContactError] = useState<string | null>(null)
  const [confirmIntensivesOff, setConfirmIntensivesOff] = useState(false)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/admin/settings')
        const data = await res.json().catch(() => ({}))
        if (cancelled) return
        if (!res.ok) {
          toast.error(data.error || 'Не удалось загрузить настройки', { description: 'Обновите страницу.' })
          setSettings({})
          return
        }
        setSettings(data.settings || {})
        setContact(data.settings?.adminContact ?? '')
      } catch {
        if (!cancelled) {
          toast.error('Ошибка сети', { description: 'Не удалось загрузить настройки.' })
          setSettings({})
        }
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const patch = async (partial: Settings, key: string) => {
    setSavingKey(key)
    try {
      const res = await fetch('/api/admin/settings', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(partial),
      })
      const data = await res.json().catch(() => ({}))
      if (res.ok && data.settings) {
        setSettings(data.settings)
        toast.success('Настройка сохранена')
        return true
      }
      toast.error(data.error || 'Не удалось сохранить', { description: 'Повторите попытку.' })
      return false
    } catch {
      toast.error('Ошибка сети', { description: 'Изменение не сохранено.' })
      return false
    } finally {
      setSavingKey(null)
    }
  }

  if (!settings) {
    return (
      <div className="space-y-3">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-11 w-full" />
        ))}
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {SECTIONS.map((section) => (
        <section key={section.title} className="rounded-lg border bg-card">
          <div className="border-b px-4 py-3">
            <h2 className="text-sm font-semibold">{section.title}</h2>
            {section.description && <p className="text-xs text-muted-foreground">{section.description}</p>}
          </div>
          <ul>
            {section.items.map((item) => {
              const id = `setting-${item.key}`
              return (
                <li key={item.key} className="flex items-center justify-between gap-4 border-b px-4 py-2.5 last:border-b-0">
                  <div className="min-w-0">
                    <Label htmlFor={id} className="text-sm font-medium">
                      {item.label}
                    </Label>
                    {item.hint && <p className="text-xs text-muted-foreground">{item.hint}</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    {savingKey === item.key && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-hidden />}
                    <Checkbox
                      id={id}
                      checked={settings[item.key] !== 'false'}
                      disabled={savingKey !== null}
                      onCheckedChange={(c) => void patch({ [item.key]: c === true ? 'true' : 'false' }, item.key)}
                    />
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Интенсивы</h2>
          <p className="text-xs text-muted-foreground">Новый интерфейс интенсивов, годового календаря и плана анонсов.</p>
        </div>
        <div className="flex items-center justify-between gap-4 px-4 py-2.5">
          <div className="min-w-0">
            <Label htmlFor="setting-feature-intensives" className="text-sm font-medium">
              Интенсивы и годовой календарь
            </Label>
            <p className="text-xs text-muted-foreground">
              Сейчас: <span className="font-medium text-foreground">{settings['feature:intensives'] === 'false' ? 'выключено' : 'включено'}</span>. Выключение скрывает новые возможности,
              но не удаляет данные и не останавливает запланированные сообщения.
            </p>
          </div>
          <FeatureSwitch
            id="setting-feature-intensives"
            checked={settings['feature:intensives'] !== 'false'}
            busy={savingKey === 'feature:intensives'}
            disabled={savingKey !== null}
            onCheckedChange={(next) => {
              if (next) void patch({ 'feature:intensives': 'true' }, 'feature:intensives')
              else setConfirmIntensivesOff(true)
            }}
          />
        </div>
      </section>

      <ConfirmDialog
        open={confirmIntensivesOff}
        onOpenChange={setConfirmIntensivesOff}
        title="Выключить интенсивы?"
        description="Страницы и API интенсивов станут недоступны. Данные сохранятся, запланированные сообщения продолжат отправляться. Включить обратно можно в любой момент."
        confirmLabel="Выключить"
        destructive
        loading={savingKey === 'feature:intensives'}
        onConfirm={async () => {
          const ok = await patch({ 'feature:intensives': 'false' }, 'feature:intensives')
          if (ok) setConfirmIntensivesOff(false)
        }}
      />

      <section className="rounded-lg border bg-card">
        <div className="border-b px-4 py-3">
          <h2 className="text-sm font-semibold">Контакт на странице «Заблокирован»</h2>
          <p className="text-xs text-muted-foreground">Email, ссылка или текст для связи — видят заблокированные пользователи.</p>
        </div>
        <form
          className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start"
          onSubmit={async (e) => {
            e.preventDefault()
            if (contact.trim().length > 300) {
              setContactError('Не длиннее 300 символов')
              return
            }
            await patch({ adminContact: contact.trim() }, 'adminContact')
          }}
        >
          <div className="flex-1 space-y-1">
            <Label htmlFor="setting-adminContact" className="sr-only">
              Контакт
            </Label>
            <Input
              id="setting-adminContact"
              value={contact}
              onChange={(e) => {
                setContact(e.target.value)
                setContactError(null)
              }}
              placeholder="support@example.com или @lead_sup"
              aria-invalid={!!contactError}
            />
            {contactError && <p className="text-xs text-destructive">{contactError}</p>}
          </div>
          <Button type="submit" disabled={savingKey !== null || contact.trim() === (settings.adminContact ?? '')}>
            {savingKey === 'adminContact' && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Сохранить
          </Button>
        </form>
      </section>
    </div>
  )
}
