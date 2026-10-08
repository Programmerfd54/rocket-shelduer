import { describe, expect, it } from 'vitest';
import { compileUserRegex, isPotentiallyCatastrophic, MAX_PATTERN_LENGTH } from '../safe-regex';

describe('compileUserRegex', () => {
  it('accepts ordinary username patterns', () => {
    for (const p of ['^[a-z][a-z0-9]*$', '^[a-z]{3,20}$', '^(stud|staff)_[0-9]+$', '^[a-z]+(_[a-z]+)?$']) {
      expect(compileUserRegex(p), p).toBeInstanceOf(RegExp);
    }
  });

  it('rejects classic catastrophic-backtracking patterns', () => {
    for (const p of ['(a+)+$', '(a*)*b', '(a|a)+$', '^(\\w+\\s?)*$', '((ab)*)+$', '(.*a){20}', '(\\d+)+x']) {
      expect(isPotentiallyCatastrophic(p), p).toBe(true);
      expect(compileUserRegex(p), p).toBeNull();
    }
  });

  it('rejects backreferences, invalid syntax and overly long patterns', () => {
    expect(compileUserRegex('(a)\\1')).toBeNull();
    expect(compileUserRegex('[a-')).toBeNull();
    expect(compileUserRegex('a'.repeat(MAX_PATTERN_LENGTH + 1))).toBeNull();
  });

  it('ignores quantifiers inside character classes and escaped parens', () => {
    expect(compileUserRegex('^[+*]+$')).toBeInstanceOf(RegExp);
    expect(compileUserRegex('^\\(a+\\)+$')).toBeInstanceOf(RegExp);
  });
});
