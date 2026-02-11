import { describe, it, expect } from 'vitest';
import {
  cn,
  checkPasswordStrength,
  getInitials,
  formatDate,
  isFutureDate,
  getActivityLabel,
} from './utils';

describe('cn', () => {
  it('merges class names', () => {
    expect(cn('a', 'b')).toBe('a b');
  });

  it('handles conditional classes', () => {
    expect(cn('base', false && 'hidden', 'visible')).toContain('visible');
  });
});

describe('checkPasswordStrength', () => {
  it('rejects password shorter than 8 characters', () => {
    const r = checkPasswordStrength('short');
    expect(r.valid).toBe(false);
    expect(r.strength).toBe('weak');
  });

  it('accepts password with 8+ chars and reports strength', () => {
    const r = checkPasswordStrength('Password1!');
    expect(r.valid).toBe(true);
    expect(['weak', 'medium', 'strong']).toContain(r.strength);
  });
});

describe('getInitials', () => {
  it('returns ?? for null/undefined', () => {
    expect(getInitials(null)).toBe('??');
    expect(getInitials(undefined)).toBe('??');
  });

  it('returns first two chars for single word', () => {
    expect(getInitials('Alice')).toBe('AL');
  });

  it('returns first and last word initial for full name', () => {
    expect(getInitials('John Doe')).toBe('JD');
  });
});

describe('formatDate', () => {
  it('formats Date and string', () => {
    const d = new Date('2025-02-11T12:00:00');
    expect(formatDate(d)).toMatch(/\d{2}\.\d{2}\.\d{4}/);
    expect(formatDate('2025-02-11T12:00:00')).toMatch(/\d{2}\.\d{2}\.\d{4}/);
  });
});

describe('isFutureDate', () => {
  it('returns true for future date', () => {
    const future = new Date(Date.now() + 86400000);
    expect(isFutureDate(future)).toBe(true);
  });

  it('returns false for past date', () => {
    const past = new Date(Date.now() - 86400000);
    expect(isFutureDate(past)).toBe(false);
  });
});

describe('getActivityLabel', () => {
  it('returns label for known action', () => {
    expect(getActivityLabel('USER_LOGIN')).toBe('Вход в систему');
  });

  it('returns action key for unknown action', () => {
    expect(getActivityLabel('UNKNOWN_ACTION')).toBe('UNKNOWN_ACTION');
  });
});
