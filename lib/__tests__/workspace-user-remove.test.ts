import { describe, expect, it } from 'vitest';
import {
  buildRemoveConfirmation, isRemoveConfirmed, parseLoginList, summarizeRemoveResults, userRemoveRequestSchema,
} from '@/lib/workspace-user-remove';

const creds = { adminUsername: 'admin', adminPassword: 'test-only' };

describe('parseLoginList', () => {
  it('splits by lines, commas and semicolons, strips @ and dedupes case-insensitively', () => {
    const parsed = parseLoginList('@Alice\nbob, carol;alice\n\n  dave  ');
    expect(parsed.logins).toEqual(['Alice', 'bob', 'carol', 'dave']);
    expect(parsed.duplicates).toBe(1);
    expect(parsed.invalid).toEqual([]);
    expect(parsed.tooMany).toBe(false);
  });

  it('reports invalid logins without dropping valid ones', () => {
    const parsed = parseLoginList('good.login\nbad login\nbad/slash\nok_1');
    expect(parsed.logins).toEqual(['good.login', 'ok_1']);
    expect(parsed.invalid.map(item => item.login)).toEqual(['bad login', 'bad/slash']);
  });

  it('flags more than 100 logins', () => {
    const text = Array.from({ length: 101 }, (_, i) => `user${i}`).join('\n');
    expect(parseLoginList(text).tooMany).toBe(true);
    expect(parseLoginList(text.split('\n').slice(0, 100).join('\n')).tooMany).toBe(false);
  });
});

describe('isRemoveConfirmed', () => {
  it('accepts the confirmation word regardless of case and spaces', () => {
    expect(isRemoveConfirmed(' удалить ')).toBe(true);
    expect(isRemoveConfirmed('УДАЛИТЬ')).toBe(true);
    expect(isRemoveConfirmed('удалит')).toBe(false);
    expect(isRemoveConfirmed('')).toBe(false);
  });
});

describe('buildRemoveConfirmation', () => {
  const logins = Array.from({ length: 13 }, (_, i) => `u${i}`);
  it('requires the word and limits the preview for permanent delete', () => {
    const text = buildRemoveConfirmation('delete', logins);
    expect(text.requiresWord).toBe(true);
    expect(text.shown).toHaveLength(10);
    expect(text.more).toBe(3);
    expect(text.description).toMatch(/безвозвратно/);
  });
  it('does not require the word for deactivation', () => {
    const text = buildRemoveConfirmation('deactivate', ['a']);
    expect(text.requiresWord).toBe(false);
    expect(text.more).toBe(0);
    expect(text.description).toMatch(/активации/);
  });
});

describe('summarizeRemoveResults', () => {
  it('chooses the toast level from outcomes', () => {
    expect(summarizeRemoveResults('delete', [{ username: 'a', status: 'removed' }]).level).toBe('success');
    expect(summarizeRemoveResults('delete', [{ username: 'a', status: 'removed' }, { username: 'b', status: 'error' }]).level).toBe('warning');
    expect(summarizeRemoveResults('delete', [{ username: 'a', status: 'error' }]).level).toBe('error');
    expect(summarizeRemoveResults('deactivate', [{ username: 'a', status: 'skipped' }]).level).toBe('warning');
  });
});

describe('userRemoveRequestSchema', () => {
  it('requires targets', () => {
    expect(userRemoveRequestSchema.safeParse({ ...creds, mode: 'deactivate' }).success).toBe(false);
  });
  it('requires the confirmation word for delete only', () => {
    expect(userRemoveRequestSchema.safeParse({ ...creds, mode: 'delete', ids: ['1'] }).success).toBe(false);
    expect(userRemoveRequestSchema.safeParse({ ...creds, mode: 'delete', ids: ['1'], confirm: 'УДАЛИТЬ' }).success).toBe(true);
    expect(userRemoveRequestSchema.safeParse({ ...creds, mode: 'deactivate', ids: ['1'] }).success).toBe(true);
  });
  it('validates logins and the 100 limit', () => {
    expect(userRemoveRequestSchema.safeParse({ ...creds, mode: 'deactivate', usernames: ['bad login'] }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => `u${i}`);
    expect(userRemoveRequestSchema.safeParse({ ...creds, mode: 'deactivate', usernames: many }).success).toBe(false);
    const parsed = userRemoveRequestSchema.parse({ ...creds, mode: 'deactivate', usernames: ['@alice'] });
    expect(parsed.usernames).toEqual(['alice']);
  });
});
