import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';

describe('fair-ranking settings', () => {
  it('defaults to disabled and accepts a disabled null delay', () => {
    const activity = new ActivityState();
    expect(activity.fairRankingSettings).toEqual({ enabled: false, delaySeconds: null });
    expect(activity.setFairRankingSettings({ enabled: false, delaySeconds: null })).toBe(true);
    expect(activity.fairRankingSettings).toEqual({ enabled: false, delaySeconds: null });
  });

  it.each([1, 3, 30])('accepts a finite delay within the 1–30 second range (%s)', (delaySeconds) => {
    const activity = new ActivityState();
    expect(activity.setFairRankingSettings({ enabled: true, delaySeconds })).toBe(true);
    expect(activity.fairRankingSettings).toEqual({ enabled: true, delaySeconds });
  });

  it.each([null, 0, 0.99, 30.01, -0.5, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an enabled invalid delay without changing saved settings (%s)',
    (delaySeconds) => {
      const activity = new ActivityState();
      const before = activity.fairRankingSettings;
      expect(activity.setFairRankingSettings({ enabled: true, delaySeconds })).toBe(false);
      expect(activity.fairRankingSettings).toEqual(before);
    },
  );

  it.each([0, 0.99, 30.01, -1, Number.NaN, Number.POSITIVE_INFINITY])(
    'rejects an out-of-range disabled delay when non-null (%s)',
    (delaySeconds) => {
      const activity = new ActivityState();
      expect(activity.setFairRankingSettings({ enabled: false, delaySeconds })).toBe(false);
      expect(activity.fairRankingSettings).toEqual({ enabled: false, delaySeconds: null });
    },
  );

  it('rejects setting changes after the activity starts', () => {
    const activity = new ActivityState();
    expect(activity.advance('PREPARING', 'BUZZING').accepted).toBe(true);
    expect(activity.setFairRankingSettings({ enabled: true, delaySeconds: 1.25 })).toBe(false);
    expect(activity.fairRankingSettings).toEqual({ enabled: false, delaySeconds: null });
  });
});
