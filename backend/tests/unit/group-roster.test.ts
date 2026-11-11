import { describe, expect, it } from 'vitest';
import { loadConfig } from '../../src/config.js';
import { GroupRoster } from '../../src/domain/group-roster.js';

describe('configured group roster', () => {
  it('keeps trimmed, opaque group IDs canonical and supports exact lookup', () => {
    const config = loadConfig({ GROUP_IDS: '  Team / Alpha! , 向日葵#2 ' });
    const roster = new GroupRoster(config.groups);

    expect(roster.ids).toEqual(['Team / Alpha!', '向日葵#2']);
    expect(roster.has('Team / Alpha!')).toBe(true);
    expect(roster.has('team / alpha!')).toBe(false);
    expect(roster.has('向日葵#2')).toBe(true);
  });

  it.each([
    ['', 'empty'],
    ['1,,2', 'empty'],
    ['1, 1', 'duplicate'],
    ['1,team\u0000two', 'control'],
  ])('rejects invalid roster value %j', (groupIds, reason) => {
    expect(() => loadConfig({ GROUP_IDS: groupIds })).toThrow(new RegExp(reason, 'i'));
  });

  it('rejects IDs that cannot fit the maximum student.join envelope', () => {
    expect(() => loadConfig({ GROUP_IDS: 'g'.repeat(16_400) })).toThrow(/16 KiB|message limit/i);
  });
});
