/** Хост student Rocket.Chat — интенсив без корпоративных LDAP/SMTP настроек в UI. */
export const STUDENT_INTENSIVE_RC_HOST = 'rocketchat-student.21-school.ru';

export function isStudentIntensiveWorkspaceUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  const u = url.toLowerCase().trim().replace(/\/+$/, '');
  return u.includes(STUDENT_INTENSIVE_RC_HOST);
}

/**
 * Строгая проверка: URL указывает именно на rocketchat-student.21-school.ru
 * (сравнение hostname, а не подстроки — «…21-school.ru.evil.com» не пройдёт).
 */
export function isStudentRcHostStrict(url: string | null | undefined): boolean {
  if (!url) return false;
  try {
    const raw = url.trim();
    const parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    return parsed.hostname.toLowerCase() === STUDENT_INTENSIVE_RC_HOST;
  } catch {
    return false;
  }
}
