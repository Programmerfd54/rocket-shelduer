/**
 * Версия содержимого шаблона/снимка (sourceVersion пунктов плана) и название по умолчанию.
 * Вынесено из lib/intensives/plan.ts, чтобы lib/templates не зависел от интенсивов (без циклов импорта).
 * Алгоритм хеша не менять: иначе у всех пунктов планов появится «Доступна новая версия».
 */
import crypto from 'crypto';
import type { PlanItemAudience } from '@/lib/intensives/types';

export const MAX_TITLE_LENGTH = 200;

/** Поля снимка, участвующие в версии и в «отличиях». */
export interface SnapshotFields {
  title: string;
  body: string;
  channel: string;
  dayNumber: number | null;
  time: string | null;
  audience: PlanItemAudience;
  categories: string[];
}

export function computeSourceVersion(s: SnapshotFields): string {
  const canonical = JSON.stringify([
    s.title,
    s.body,
    s.channel,
    s.dayNumber,
    s.time,
    s.audience,
    [...s.categories].sort(),
  ]);
  return crypto.createHash('sha256').update(canonical).digest('hex').slice(0, 32);
}

export function fallbackTitle(title: string | null | undefined, body: string): string {
  const t = (title ?? '').trim();
  if (t) return t.slice(0, MAX_TITLE_LENGTH);
  const firstLine = body.split('\n').map((l) => l.trim()).find(Boolean) ?? 'Без названия';
  return firstLine.replace(/[*_#`]/g, '').slice(0, 120);
}

/** Снимок пункта плана из официального шаблона: audience пункта = область шаблона, 'mk' → категория. */
export function snapshotFromOfficial(t: {
  scope: 'ADM' | 'SUP';
  title: string;
  body: string;
  channel: string;
  intensiveDay: number;
  time: string;
  audience: 'all' | 'mk';
}): SnapshotFields {
  return {
    title: t.title,
    body: t.body,
    channel: t.channel,
    dayNumber: t.intensiveDay,
    time: t.time,
    audience: t.scope,
    categories: t.audience === 'mk' ? ['mk'] : [],
  };
}
