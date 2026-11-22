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

  it('defaults to unlimited and accepts only integer limits from 0 through 3600 while preparing', () => {
    const activity = new ActivityState();
    expect(activity.timeLimitSeconds).toBe(0);
    for (const seconds of [0, 1, 3600]) {
      expect(activity.setTimeLimitSeconds(seconds)).toBe(true);
      expect(activity.timeLimitSeconds).toBe(seconds);
    }
    for (const seconds of [-1, 3601, 1.5, Number.NaN]) {
      expect(() => activity.setTimeLimitSeconds(seconds)).toThrow(/0.*3600/);
    }
    expect(activity.timeLimitSeconds).toBe(3600);
  });

  it('does not allow changing the time limit after PREPARING', () => {
    const activity = new ActivityState();
    activity.advance('PREPARING', 'BUZZING');
    expect(activity.setTimeLimitSeconds(30)).toBe(false);
    expect(activity.timeLimitSeconds).toBe(0);
  });

  it('resets only ENDED activities while retaining the worksheet and returning the time limit to zero', () => {
    const activity = new ActivityState();
    const worksheet = { spreadsheetId: 'reset-test', sheetId: 1, worksheetTitle: 'Sheet' };
    const questions = [{ questionId: 'Q1', displayOrder: 1, sourceRowAtImport: 2 }];
    activity.replaceGuidedNotesImport(worksheet, questions);
    activity.setTimeLimitSeconds(5);
    expect(activity.reset()).toBe(false);
    activity.advance('PREPARING', 'BUZZING');
    activity.advance('BUZZING', 'ENDED');

    expect(activity.reset()).toBe(true);
    expect(activity.stage).toBe('PREPARING');
    expect(activity.timeLimitSeconds).toBe(0);
    expect(activity.deadlineAt).toBeNull();
    expect(activity.worksheet).toEqual(worksheet);
    expect(activity.questions).toEqual(questions);
    expect(activity.reset()).toBe(false);
  });
});
