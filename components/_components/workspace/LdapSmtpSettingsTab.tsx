'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Field } from '@/components/ui/field';
import { Section } from '@/components/common/Section';
import { EmptyState } from '@/components/common/EmptyState';
import { AlertCircle, Save } from 'lucide-react';
import { toast } from 'sonner';
import { Spinner } from '@/components/ui/spinner';

type Settings = {
  id: string;
  workspaceId: string;
  ldapEnabled: boolean;
  ldapHost: string | null;
  ldapPort: number | null;
  ldapBaseDN: string | null;
  ldapBindDN: string | null;
  ldapBindPass: string | null;
  ldapUserFilter: string | null;
  smtpEnabled: boolean;
  smtpHost: string | null;
  smtpPort: number | null;
  smtpUser: string | null;
  smtpPass: string | null;
  smtpFromName: string | null;
  smtpFromAddr: string | null;
  inviteEnabled: boolean;
  inviteAutoApprove: boolean;
  inviteDomains: string | null;
};

type Errors = Partial<Record<keyof Settings, string>>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MASKED = '********';

function validatePort(port: number | null | undefined): string | undefined {
  if (port == null) return undefined;
  if (!Number.isInteger(port) || port < 1 || port > 65535) return 'Порт — число от 1 до 65535';
  return undefined;
}

function validate(form: Partial<Settings>): Errors {
  const e: Errors = {};
  if (form.ldapEnabled && !form.ldapHost?.trim()) e.ldapHost = 'Укажите хост LDAP или выключите блок';
  if (form.smtpEnabled && !form.smtpHost?.trim()) e.smtpHost = 'Укажите хост SMTP или выключите отправку';
  const lp = validatePort(form.ldapPort);
  if (lp) e.ldapPort = lp;
  const sp = validatePort(form.smtpPort);
  if (sp) e.smtpPort = sp;
  if (form.smtpFromAddr?.trim() && !EMAIL_RE.test(form.smtpFromAddr.trim())) {
    e.smtpFromAddr = 'Введите корректный email, например noreply@example.com';
  }
  return e;
}

export function LdapSmtpSettingsTab({ workspaceId }: { workspaceId: string }) {
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<Partial<Settings>>({});
  const [saved, setSaved] = useState<string>('{}');
  const [showErrors, setShowErrors] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/ldap-smtp`);
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.settings) {
        setForm(data.settings);
        setSaved(JSON.stringify(data.settings));
      } else {
        setLoadError(data.error ?? 'Не удалось загрузить настройки');
      }
    } catch {
      setLoadError('Нет связи с сервером');
    } finally {
      setLoading(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    load();
  }, [load]);

  const errors = useMemo(() => validate(form), [form]);
  const err = (k: keyof Settings) => (showErrors ? errors[k] : undefined);
  const dirty = JSON.stringify(form) !== saved;

  const save = async () => {
    setShowErrors(true);
    if (Object.keys(errors).length > 0) {
      toast.error('Исправьте отмеченные поля, затем сохраните снова');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`/api/workspace/${workspaceId}/ldap-smtp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.settings) {
        setForm(data.settings);
        setSaved(JSON.stringify(data.settings));
        setShowErrors(false);
        toast.success('Настройки сохранены');
      } else {
        toast.error(data.error ?? 'Не удалось сохранить настройки. Повторите попытку.');
      }
    } catch {
      toast.error('Нет связи с сервером. Настройки не сохранены — повторите попытку.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="max-w-3xl space-y-6" role="status" aria-busy="true" aria-label="Загрузка настроек">
        {[0, 1, 2].map((i) => (
          <div key={i} className="space-y-3 rounded-lg border bg-card p-5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ))}
      </div>
    );
  }

  if (loadError) {
    return (
      <EmptyState
        className="max-w-3xl"
        icon={<AlertCircle />}
        title="Не удалось загрузить настройки"
        description={loadError}
        action={{ label: 'Повторить', onClick: load }}
      />
    );
  }

  const set = (k: keyof Settings, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const parsePort = (text: string) => (text ? parseInt(text, 10) : null);
  const passHint = (v: string | null | undefined) =>
    v === MASKED ? 'Пароль сохранён. Оставьте поле пустым, чтобы не менять.' : undefined;

  return (
    <div className="max-w-3xl space-y-6">
      <p className="text-sm text-muted-foreground">
        Настройки LDAP, SMTP и приглашений хранятся в приложении. Чтобы они вступили в силу в Rocket.Chat, может
        потребоваться настройка на стороне сервера.
      </p>

      <Section
        title="LDAP"
        description="Подключение каталога, если он используется в вашей инфраструктуре."
        actions={<Badge variant={form.ldapEnabled ? 'success' : 'muted'}>{form.ldapEnabled ? 'Включён' : 'Выключен'}</Badge>}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="ldap-enabled"
              checked={!!form.ldapEnabled}
              onCheckedChange={(c) => set('ldapEnabled', c === true)}
            />
            <Label htmlFor="ldap-enabled">Включить блок LDAP</Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Хост" htmlFor="ldap-host" required={!!form.ldapEnabled} error={err('ldapHost')}>
              <Input
                id="ldap-host"
                className="font-mono"
                value={form.ldapHost ?? ''}
                onChange={(e) => set('ldapHost', e.target.value)}
                placeholder="ldap.example.com"
                aria-invalid={!!err('ldapHost')}
              />
            </Field>
            <Field label="Порт" htmlFor="ldap-port" error={err('ldapPort')}>
              <Input
                id="ldap-port"
                type="number"
                inputMode="numeric"
                value={form.ldapPort ?? ''}
                onChange={(e) => set('ldapPort', parsePort(e.target.value))}
                placeholder="389"
                aria-invalid={!!err('ldapPort')}
              />
            </Field>
          </div>
          <Field label="Base DN" htmlFor="ldap-base-dn">
            <Input id="ldap-base-dn" className="font-mono" value={form.ldapBaseDN ?? ''} onChange={(e) => set('ldapBaseDN', e.target.value)} placeholder="dc=example,dc=com" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Bind DN" htmlFor="ldap-bind-dn">
              <Input id="ldap-bind-dn" className="font-mono" value={form.ldapBindDN ?? ''} onChange={(e) => set('ldapBindDN', e.target.value)} />
            </Field>
            <Field label="Пароль bind" htmlFor="ldap-bind-pass" hint={passHint(form.ldapBindPass)}>
              <Input
                id="ldap-bind-pass"
                type="password"
                autoComplete="new-password"
                value={form.ldapBindPass === MASKED ? '' : (form.ldapBindPass ?? '')}
                onChange={(e) => set('ldapBindPass', e.target.value)}
                placeholder="Оставьте пустым, чтобы не менять"
              />
            </Field>
          </div>
          <Field label="Фильтр пользователей" htmlFor="ldap-user-filter">
            <Input id="ldap-user-filter" className="font-mono" value={form.ldapUserFilter ?? ''} onChange={(e) => set('ldapUserFilter', e.target.value)} placeholder="(objectClass=person)" />
          </Field>
        </div>
      </Section>

      <Section
        title="SMTP"
        description="Отправка писем: уведомления и приглашения."
        actions={<Badge variant={form.smtpEnabled ? 'success' : 'muted'}>{form.smtpEnabled ? 'Включён' : 'Выключен'}</Badge>}
      >
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="smtp-enabled"
              checked={!!form.smtpEnabled}
              onCheckedChange={(c) => set('smtpEnabled', c === true)}
            />
            <Label htmlFor="smtp-enabled">Включить SMTP</Label>
          </div>
          <div className="grid gap-3 sm:grid-cols-[1fr_140px]">
            <Field label="Хост" htmlFor="smtp-host" required={!!form.smtpEnabled} error={err('smtpHost')}>
              <Input id="smtp-host" className="font-mono" value={form.smtpHost ?? ''} onChange={(e) => set('smtpHost', e.target.value)} placeholder="smtp.example.com" aria-invalid={!!err('smtpHost')} />
            </Field>
            <Field label="Порт" htmlFor="smtp-port" error={err('smtpPort')}>
              <Input
                id="smtp-port"
                type="number"
                inputMode="numeric"
                value={form.smtpPort ?? ''}
                onChange={(e) => set('smtpPort', parsePort(e.target.value))}
                placeholder="587"
                aria-invalid={!!err('smtpPort')}
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Пользователь" htmlFor="smtp-user">
              <Input id="smtp-user" autoComplete="off" value={form.smtpUser ?? ''} onChange={(e) => set('smtpUser', e.target.value)} />
            </Field>
            <Field label="Пароль SMTP" htmlFor="smtp-pass" hint={passHint(form.smtpPass)}>
              <Input
                id="smtp-pass"
                type="password"
                autoComplete="new-password"
                value={form.smtpPass === MASKED ? '' : (form.smtpPass ?? '')}
                onChange={(e) => set('smtpPass', e.target.value)}
                placeholder="Оставьте пустым, чтобы не менять"
              />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Имя отправителя" htmlFor="smtp-from-name">
              <Input id="smtp-from-name" value={form.smtpFromName ?? ''} onChange={(e) => set('smtpFromName', e.target.value)} />
            </Field>
            <Field label="Email отправителя" htmlFor="smtp-from-addr" error={err('smtpFromAddr')}>
              <Input id="smtp-from-addr" type="email" value={form.smtpFromAddr ?? ''} onChange={(e) => set('smtpFromAddr', e.target.value)} placeholder="noreply@example.com" aria-invalid={!!err('smtpFromAddr')} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Приглашения" description="Кто и как может присоединиться по приглашению.">
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <Checkbox
              id="invite-enabled"
              checked={!!form.inviteEnabled}
              onCheckedChange={(c) => set('inviteEnabled', c === true)}
            />
            <Label htmlFor="invite-enabled">Приглашения включены</Label>
          </div>
          <div className="flex items-start gap-2">
            <Checkbox
              id="invite-auto"
              className="mt-0.5"
              checked={!!form.inviteAutoApprove}
              onCheckedChange={(c) => set('inviteAutoApprove', c === true)}
            />
            <div className="space-y-0.5">
              <Label htmlFor="invite-auto">Автоодобрение</Label>
              <p className="text-xs text-muted-foreground">Заявки будут одобряться без ручной проверки.</p>
            </div>
          </div>
          <Field
            label="Разрешённые домены"
            htmlFor="invite-domains"
            hint="JSON-массив или список через запятую."
          >
            <Textarea
              id="invite-domains"
              className="font-mono text-sm"
              value={form.inviteDomains ?? ''}
              onChange={(e) => set('inviteDomains', e.target.value)}
              placeholder='["student.21-school.ru"]'
            />
          </Field>
        </div>
      </Section>

      <div className="flex items-center gap-3">
        <Button onClick={save} disabled={saving || !dirty}>
          {saving ? <Spinner /> : <Save />}
          {saving ? 'Сохраняем…' : 'Сохранить'}
        </Button>
        {dirty && !saving && <span className="text-xs text-muted-foreground">Есть несохранённые изменения</span>}
      </div>
    </div>
  );
}
