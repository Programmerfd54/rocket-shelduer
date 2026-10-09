import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { requireAuth } from '@/lib/api-auth';
import { isUnsafeId } from '@/lib/security';
import { encryptSettingsSecret, workspaceSettingsAad } from '@/lib/encryption';
import { safeErrorForLog } from '@/lib/sensitive-data';
import { isStudentIntensiveWorkspaceUrl } from '@/lib/workspace-url-flags';
import { isGlobalStaffRole } from '@/lib/roles';

/** Вкладка «LDAP / SMTP»: Lead_SUP и SUP с доступом к пространству (владелец или назначение). */
async function resolveLdapSmtpWorkspace(userId: string, role: string, workspaceId: string) {
  if (!isGlobalStaffRole(role)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Forbidden' }, { status: 403 }) };
  }
  if (isUnsafeId(workspaceId)) {
    return { ok: false as const, response: NextResponse.json({ error: 'Bad request' }, { status: 400 }) };
  }
  const ws = await prisma.workspaceConnection.findUnique({
    where: { id: workspaceId },
    select: { id: true, userId: true, workspaceUrl: true },
  });
  if (!ws) return { ok: false as const, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
  if (ws.userId !== userId) {
    const assignment = await prisma.workspaceAdminAssignment.findFirst({
      where: { userId, workspaceId },
      select: { id: true },
    });
    if (!assignment) {
      return { ok: false as const, response: NextResponse.json({ error: 'Not found' }, { status: 404 }) };
    }
  }
  if (isStudentIntensiveWorkspaceUrl(ws.workspaceUrl)) {
    return {
      ok: false as const,
      response: NextResponse.json({ error: 'Not applicable for this workspace' }, { status: 404 }),
    };
  }
  return { ok: true as const, workspace: ws };
}

/**
 * Пароли LDAP bind / SMTP: только запись (приложение их не расшифровывает и не использует),
 * хранятся зашифрованными v2 (подключ 'workspace-settings-secret', привязка к подключению).
 * Клиенту отдаётся только маска '********' и флаг «задан» — никогда не значение и не шифртекст.
 */
const MASK = '********';
const MAX_SECRET_LENGTH = 4096;
function maskSettings<T extends { ldapBindPass: string | null; smtpPass: string | null }>(settings: T) {
  return {
    ...settings,
    ldapBindPass: settings.ldapBindPass ? MASK : null,
    smtpPass: settings.smtpPass ? MASK : null,
    ldapBindPassSet: !!settings.ldapBindPass,
    smtpPassSet: !!settings.smtpPass,
  };
}

/** GET — LDAP/SMTP/приглашения (секреты маскируются) */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const access = await resolveLdapSmtpWorkspace(user.id, user.role, workspaceId);
    if (!access.ok) return access.response;

    let settings = await prisma.workspaceSettings.findUnique({ where: { workspaceId } });
    if (!settings) {
      settings = await prisma.workspaceSettings.create({
        data: { workspaceId },
      });
    }

    return NextResponse.json({ settings: maskSettings(settings) });
  } catch (e) {
    console.error('ldap-smtp GET', safeErrorForLog(e));
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}

/** PUT — сохранить настройки */
export async function PUT(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireAuth();
    const { id: workspaceId } = await params;
    const access = await resolveLdapSmtpWorkspace(user.id, user.role, workspaceId);
    if (!access.ok) return access.response;

    const body = await request.json().catch(() => ({}));
    const data: Record<string, unknown> = {};

    if (typeof body.ldapEnabled === 'boolean') data.ldapEnabled = body.ldapEnabled;
    if (typeof body.ldapHost === 'string') data.ldapHost = body.ldapHost || null;
    if (typeof body.ldapPort === 'number') data.ldapPort = body.ldapPort;
    if (typeof body.ldapBaseDN === 'string') data.ldapBaseDN = body.ldapBaseDN || null;
    if (typeof body.ldapBindDN === 'string') data.ldapBindDN = body.ldapBindDN || null;
    if (typeof body.ldapUserFilter === 'string') data.ldapUserFilter = body.ldapUserFilter || null;
    const secretAad = workspaceSettingsAad(workspaceId);
    if (
      (typeof body.ldapBindPass === 'string' && body.ldapBindPass.length > MAX_SECRET_LENGTH) ||
      (typeof body.smtpPass === 'string' && body.smtpPass.length > MAX_SECRET_LENGTH)
    ) {
      return NextResponse.json({ error: 'Invalid input' }, { status: 400 });
    }
    if (typeof body.ldapBindPass === 'string' && body.ldapBindPass !== MASK) {
      data.ldapBindPass = body.ldapBindPass ? encryptSettingsSecret(body.ldapBindPass, secretAad) : null;
    }

    if (typeof body.smtpEnabled === 'boolean') data.smtpEnabled = body.smtpEnabled;
    if (typeof body.smtpHost === 'string') data.smtpHost = body.smtpHost || null;
    if (typeof body.smtpPort === 'number') data.smtpPort = body.smtpPort;
    if (typeof body.smtpUser === 'string') data.smtpUser = body.smtpUser || null;
    if (typeof body.smtpFromName === 'string') data.smtpFromName = body.smtpFromName || null;
    if (typeof body.smtpFromAddr === 'string') data.smtpFromAddr = body.smtpFromAddr || null;
    if (typeof body.smtpPass === 'string' && body.smtpPass !== MASK) {
      data.smtpPass = body.smtpPass ? encryptSettingsSecret(body.smtpPass, secretAad) : null;
    }

    if (typeof body.inviteEnabled === 'boolean') data.inviteEnabled = body.inviteEnabled;
    if (typeof body.inviteAutoApprove === 'boolean') data.inviteAutoApprove = body.inviteAutoApprove;
    if (typeof body.inviteDomains === 'string') data.inviteDomains = body.inviteDomains || null;

    const settings = await prisma.workspaceSettings.upsert({
      where: { workspaceId },
      create: { workspaceId, ...(data as object) },
      update: data as object,
    });

    return NextResponse.json({ settings: maskSettings(settings) });
  } catch (e) {
    console.error('ldap-smtp PUT', safeErrorForLog(e));
    return NextResponse.json({ error: 'Failed' }, { status: 500 });
  }
}
