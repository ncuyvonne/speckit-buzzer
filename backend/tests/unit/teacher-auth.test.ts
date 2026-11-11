import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { isTeacherPasswordValid } from '../../src/domain/teacher-auth.js';

const configured = loadConfig({ GROUP_IDS: '1,2', TEACHER_PASSWORD: 'Case-Sensitive Password' });

describe('teacher password verification', () => {
  it('accepts the exact configured password', () => {
    expect(isTeacherPasswordValid(configured, 'Case-Sensitive Password')).toBe(true);
  });

  it.each(['case-sensitive password', 'incorrect', '', '   '])('rejects nonmatching password %j', (password) => {
    expect(isTeacherPasswordValid(configured, password)).toBe(false);
  });

  it('rejects login when the password is not configured', () => {
    const config = loadConfig({ GROUP_IDS: '1' });
    expect(isTeacherPasswordValid(config, 'anything')).toBe(false);
  });

  it('rejects login when the configured password request cannot fit within 16 KiB', () => {
    const config = loadConfig({ GROUP_IDS: '1', TEACHER_PASSWORD: 'x'.repeat(16_300) });
    expect(config.teacherLoginEnabled).toBe(false);
    expect(isTeacherPasswordValid(config, 'x'.repeat(16_300))).toBe(false);
  });

  it('returns only a boolean and does not reflect the submitted credential', () => {
    const password = 'never-reflect-this-value';
    const result = isTeacherPasswordValid(configured, password);
    expect(result).toBe(false);
    expect(JSON.stringify(result)).not.toContain(password);
  });
});
