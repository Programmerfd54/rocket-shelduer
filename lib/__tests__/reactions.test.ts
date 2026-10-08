import { describe, expect, it } from 'vitest';
import {
  extractReactionPairs,
  formatMonthlyPost,
  formatWeeklyPost,
  localClock,
  localDayStart,
  looksLikeBotUsername,
  monthRange,
  periodOf,
  rankEntries,
  shiftPeriod,
  weekStart,
  type RcReactionMessage,
} from '@/lib/reactions/core';
import { isStudentRcHostStrict } from '@/lib/workspace-url-flags';

const TZ = 'Europe/Moscow';
const opts = { excludeOwnMessages: true, includeThreads: false, excludedUsernames: new Set<string>() };

function msg(id: string, author: string, reactions: Record<string, string[]>, extra: Partial<RcReactionMessage> = {}): RcReactionMessage {
  return {
    _id: id,
    rid: 'room1',
    ts: '2026-09-10T10:00:00.000Z',
    u: { username: author },
    reactions: Object.fromEntries(Object.entries(reactions).map(([k, v]) => [k, { usernames: v }])),
    ...extra,
  };
}

function scores(messages: RcReactionMessage[], o = opts) {
  const map: Record<string, number> = {};
  for (const p of extractReactionPairs(messages, o)) map[p.username] = (map[p.username] ?? 0) + 1;
  return map;
}

describe('extractReactionPairs — 1 сообщение = максимум 1 балл', () => {
  it('пример из ТЗ: 👍 на A, ❤️ на B, 👍+❤️+🔥 на C → 3 балла', () => {
    const r = scores([
      msg('A', 'adm', { ':thumbsup:': ['anna'] }),
      msg('B', 'adm', { ':heart:': ['anna'] }),
      msg('C', 'adm', { ':thumbsup:': ['anna'], ':heart:': ['anna'], ':fire:': ['anna'] }),
    ]);
    expect(r).toEqual({ anna: 3 });
  });

  it('удаление одной из нескольких emoji сохраняет балл, удаление всех — снимает', () => {
    expect(scores([msg('C', 'adm', { ':heart:': ['anna'] })])).toEqual({ anna: 1 });
    expect(scores([msg('C', 'adm', {})])).toEqual({});
  });

  it('реакции на собственные сообщения не считаются (без учёта регистра)', () => {
    expect(scores([msg('A', 'Anna', { ':thumbsup:': ['anna', 'ivan'] })])).toEqual({ ivan: 1 });
    expect(scores([msg('A', 'anna', { ':thumbsup:': ['anna'] })], { ...opts, excludeOwnMessages: false })).toEqual({ anna: 1 });
  });

  it('системные, скрытые сообщения и треды (по настройке) исключаются', () => {
    const list = [
      msg('S', 'adm', { ':x:': ['anna'] }, { t: 'uj' }),
      msg('H', 'adm', { ':x:': ['anna'] }, { _hidden: true }),
      msg('T', 'adm', { ':x:': ['anna'] }, { tmid: 'root' }),
    ];
    expect(scores(list)).toEqual({});
    expect(scores(list, { ...opts, includeThreads: true })).toEqual({ anna: 1 });
  });

  it('исключённые логины не участвуют', () => {
    const r = scores([msg('A', 'adm', { ':x:': ['Anna', 'bot1'] })], { ...opts, excludedUsernames: new Set(['bot1']) });
    expect(r).toEqual({ Anna: 1 });
  });

  it('понимает ts в формате { $date }', () => {
    const pairs = extractReactionPairs([msg('A', 'adm', { ':x:': ['anna'] }, { ts: { $date: Date.UTC(2026, 8, 1) } })], opts);
    expect(pairs[0].messageTs.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });
});

describe('rankEntries', () => {
  it('ничьи делят место, нулевые очки не попадают в рейтинг', () => {
    const r = rankEntries([
      { username: 'ivan', score: 87 },
      { username: 'anna', score: 87 },
      { username: 'maria', score: 74 },
      { username: 'zero', score: 0 },
    ]);
    expect(r.map((e) => [e.username, e.place])).toEqual([['anna', 1], ['ivan', 1], ['maria', 3]]);
  });
});

describe('периоды и время', () => {
  it('месяц считается по часовому поясу', () => {
    // 31 августа 22:30 UTC = 1 сентября 01:30 МСК
    expect(periodOf(new Date('2026-08-31T22:30:00Z'), TZ)).toBe('2026-09');
    expect(monthRange('2026-09', TZ).start.toISOString()).toBe('2026-08-31T21:00:00.000Z');
    expect(monthRange('2026-12', TZ).end.toISOString()).toBe('2026-12-31T21:00:00.000Z');
  });

  it('shiftPeriod переходит через год', () => {
    expect(shiftPeriod('2026-01', -1)).toBe('2025-12');
    expect(shiftPeriod('2026-12', 1)).toBe('2027-01');
  });

  it('неделя начинается с понедельника в часовом поясе', () => {
    // среда 23 сентября 2026
    expect(weekStart(new Date('2026-09-23T12:00:00Z'), TZ).toISOString()).toBe('2026-09-20T21:00:00.000Z');
    expect(localDayStart(new Date('2026-09-23T12:00:00Z'), TZ, -7).toISOString()).toBe('2026-09-15T21:00:00.000Z');
    expect(localClock(new Date('2026-09-23T12:00:00Z'), TZ)).toEqual({ hour: 15, isoDay: 3, dayOfMonth: 23 });
  });
});

describe('тексты публикаций', () => {
  const entries = rankEntries([
    { username: 'anna', score: 23 },
    { username: 'ivan', score: 19 },
    { username: 'maria', score: 17 },
    { username: 'oleg', score: 5 },
  ]);

  it('еженедельный пост: медали, итог и напоминание', () => {
    const text = formatWeeklyPost({
      entries,
      totalMessages: 247,
      from: new Date('2026-09-13T21:00:00Z'),
      to: new Date('2026-09-20T20:59:59Z'),
      tz: TZ,
      topN: 3,
      mention: false,
    });
    expect(text).toContain('🥇 *anna* — 23');
    expect(text).toContain('🥉 *maria* — 17');
    expect(text).not.toContain('oleg');
    expect(text).toContain('*247* сообщений');
    expect(text).toContain('14 сентября — 20 сентября');
  });

  it('итоги месяца: победители при ничьей, без гендерных форм', () => {
    const tie = rankEntries([
      { username: 'anna', score: 87 },
      { username: 'ivan', score: 87 },
    ]);
    const text = formatMonthlyPost({ period: '2026-09', entries: tie, topN: 10, mention: false });
    expect(text).toContain('Итоги месяца: сентябрь 2026');
    expect(text).toContain('Победители месяца — @anna и @ivan!');
    expect(text).toContain('*87* сообщений с реакцией');
  });

  it('промежуточный рейтинг не объявляет победителя', () => {
    const text = formatMonthlyPost({ period: '2026-09', entries, topN: 10, mention: true, interim: true, totalMessages: 21 });
    expect(text).toContain('промежуточные итоги');
    expect(text).toContain('🥇 @anna — 23');
    expect(text).not.toContain('Победител');
    expect(text).toContain('*21* сообщение');
  });
});

describe('ограничение по пространству', () => {
  it('принимает только rocketchat-student.21-school.ru', () => {
    expect(isStudentRcHostStrict('https://rocketchat-student.21-school.ru/')).toBe(true);
    expect(isStudentRcHostStrict('rocketchat-student.21-school.ru')).toBe(true);
    expect(isStudentRcHostStrict('https://ROCKETCHAT-STUDENT.21-school.ru/home')).toBe(true);
    expect(isStudentRcHostStrict('https://rocketchat-student.21-school.ru.evil.com')).toBe(false);
    expect(isStudentRcHostStrict('https://rocketchat.21-school.ru')).toBe(false);
    expect(isStudentRcHostStrict('')).toBe(false);
  });

  it('эвристика ботов', () => {
    expect(looksLikeBotUsername('rocket.cat')).toBe(true);
    expect(looksLikeBotUsername('news.bot')).toBe(true);
    expect(looksLikeBotUsername('abbot')).toBe(false);
  });
});
