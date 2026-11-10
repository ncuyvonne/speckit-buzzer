import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';

const withRoster = (overrides: Record<string, string | undefined> = {}) =>
  loadConfig({ GROUP_IDS: '1, 2,3', ...overrides });

describe('loadConfig', () => {
  it('loads a valid trimmed roster and preserves a nonblank password exactly', () => {
    const config = withRoster({ TEACHER_PASSWORD: '  Exact Password  ' });

    expect(config.groups).toEqual(['1', '2', '3']);
    expect(config.teacherPassword).toBe('  Exact Password  ');
    expect(config.teacherLoginEnabled).toBe(true);
  });

  it.each([undefined, '', ' \t\r\n '])(
    'keeps students available but disables teacher login for password %j',
    (password) => {
      const config = withRoster({ TEACHER_PASSWORD: password });

      expect(config.groups).toEqual(['1', '2', '3']);
      expect(config.teacherLoginEnabled).toBe(false);
      expect(config.teacherPassword).toBeNull();
    },
  );

  it('disables teacher login when the maximum-request envelope exceeds 16 KiB', () => {
    const password = 'x'.repeat(16_300);
    const config = withRoster({ TEACHER_PASSWORD: password });

    expect(config.teacherLoginEnabled).toBe(false);
    expect(config.teacherPassword).toBeNull();
  });

  it('rejects a missing roster and an empty roster entry', () => {
    expect(() => loadConfig({})).toThrow(/GROUP_IDS/i);
    expect(() => loadConfig({ GROUP_IDS: '1,,2' })).toThrow(/empty/i);
  });

  it('rejects duplicates after trimming', () => {
    expect(() => loadConfig({ GROUP_IDS: 'A, A ' })).toThrow(/duplicate/i);
  });

  it('rejects control characters in a group ID', () => {
    expect(() => loadConfig({ GROUP_IDS: 'A,team\u0007B' })).toThrow(/control/i);
  });

  it('rejects an ID whose join request exceeds the 16 KiB message limit', () => {
    const tooLongId = 'g'.repeat(16_400);
    expect(() => loadConfig({ GROUP_IDS: tooLongId })).toThrow(/16 KiB|message limit/i);
  });
});
