import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';

describe('server-owned activity stages', () => {
  it('starts at PREPARING and advances only one stage at a time', () => {
    const activity = new ActivityState();
    expect(activity.stage).toBe('PREPARING');
    expect(activity.advance('PREPARING', 'BUZZING')).toEqual({ accepted: true, stage: 'BUZZING' });
    expect(activity.advance('BUZZING', 'ENDED')).toEqual({ accepted: true, stage: 'ENDED' });
  });

  it.each([
    ['PREPARING', 'ENDED'],
    ['BUZZING', 'PREPARING'],
    ['ENDED', 'BUZZING'],
  ] as const)('rejects transition %s → %s and preserves current state', (from, to) => {
    const activity = new ActivityState();
    const before = activity.stage;
    expect(activity.advance(from, to)).toEqual({ accepted: false, stage: before });
    expect(activity.stage).toBe(before);
  });

  it('rejects stale source stages and all transitions after ENDED', () => {
    const activity = new ActivityState();
    activity.advance('PREPARING', 'BUZZING');
    expect(activity.advance('PREPARING', 'BUZZING')).toEqual({ accepted: false, stage: 'BUZZING' });
    activity.advance('BUZZING', 'ENDED');
    expect(activity.advance('ENDED', 'ENDED')).toEqual({ accepted: false, stage: 'ENDED' });
  });
});
