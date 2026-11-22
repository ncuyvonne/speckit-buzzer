import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { BuzzerResultsService } from '../../src/domain/buzzer-results.js';
import { GroupRoster } from '../../src/domain/group-roster.js';

function createSystem(
  now: () => number,
  questionIds = ['1', '2', '3'],
  fairRanking = { enabled: false, delaySeconds: null as number | null },
) {
  const activity = new ActivityState();
  activity.replaceGuidedNotesImport(
    { spreadsheetId: 'ranking', sheetId: 1, worksheetTitle: 'Sheet' },
    questionIds.map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
  );
  if (fairRanking.enabled) expect(activity.setFairRankingSettings(fairRanking)).toBe(true);
  activity.advance('PREPARING', 'BUZZING');
  const service = new BuzzerResultsService({ activity, roster: new GroupRoster(['A', 'B', 'C']), now });
  return { activity, service };
}

describe('fair ranking', () => {
  it('uses server receive time and accepted order when fairness is disabled', () => {
    const times = [42, 42];
    const { service } = createSystem(() => times.shift()! , ['1']);

    service.submitAnswer('B', '1', 'B answer');
    service.submitAnswer('A', '1', 'A answer');

    expect(service.getTeacherProgress().questions[0]).toMatchObject({
      winningGroupId: 'B',
      groups: [
        { groupId: 'A', submitted: true, rank: 2 },
        { groupId: 'B', submitted: true, rank: 1 },
        { groupId: 'C', submitted: false, rank: null },
      ],
    });
  });

  it('adds K times the configured decimal delay using other-question wins at acceptance', () => {
    const times = [1_000, 1_001, 2_000, 1_750];
    const { service } = createSystem(() => times.shift()!, ['1', '2', '3'], { enabled: true, delaySeconds: 1.25 });

    service.submitAnswer('A', '1', 'A wins one');
    service.submitAnswer('A', '2', 'A wins two');
    service.submitAnswer('B', '3', 'B answer');
    service.submitAnswer('A', '3', 'A answer');

    expect(service.getSubmission('A', '3')).toMatchObject({
      receivedAtMs: 1_750,
      priorWinCountSnapshot: 2,
      effectiveAtMs: 4_250,
    });
    expect(service.getTeacherProgress().questions[2]).toMatchObject({
      winningGroupId: 'B',
      groups: [
        { groupId: 'A', rank: 2 },
        { groupId: 'B', rank: 1 },
        { groupId: 'C', submitted: false, rank: null },
      ],
    });
  });

  it('keeps an accepted answer snapshot when another question winner later changes', () => {
    const times = [100, 200, 50];
    const { service } = createSystem(() => times.shift()!, ['1', '2'], { enabled: true, delaySeconds: 1.5 });

    service.submitAnswer('A', '1', 'initial winner');
    service.submitAnswer('A', '2', 'snapshot answer');
    service.submitAnswer('B', '1', 'earlier effective time');

    expect(service.getWinner('1')?.groupId).toBe('B');
    expect(service.getSubmission('A', '2')).toMatchObject({
      priorWinCountSnapshot: 1,
      effectiveAtMs: 1_700,
    });
  });

  it('uses accepted order to break equal effective times and produces contiguous ranks', () => {
    const times = [10, 100, 1_350];
    const { service } = createSystem(() => times.shift()!, ['1', '2', '3'], { enabled: true, delaySeconds: 1.25 });

    service.submitAnswer('A', '1', 'prior win');
    service.submitAnswer('A', '3', 'effective 200');
    service.submitAnswer('B', '3', 'effective 200');

    expect(service.getTeacherProgress().questions[2]).toMatchObject({
      winningGroupId: 'A',
      groups: [
        { groupId: 'A', rank: 1 },
        { groupId: 'B', rank: 2 },
        { groupId: 'C', submitted: false, rank: null },
      ],
    });
  });

  it('excludes rejected and duplicate answers from accepted order, ranks, and win counts', () => {
    const times = [100, 101];
    const { service } = createSystem(() => times.shift()!, ['1']);

    service.submitAnswer('A', '1', 'accepted');
    expect(service.submitAnswer('B', '1', ' \t　 ')).toMatchObject({ accepted: false, code: 'ANSWER_EMPTY' });
    expect(service.submitAnswer('A', '1', 'duplicate')).toMatchObject({ accepted: false, code: 'ANSWER_LOCKED' });
    expect(service.submitAnswer('B', '1', 'next accepted')).toMatchObject({
      accepted: true,
      submission: { acceptedOrder: 2 },
    });

    const question = service.getTeacherProgress().questions[0]!;
    expect(question.groups.map((group) => group.rank)).toEqual([1, 2, null]);
    expect(Object.keys(question).some((key) => key.toLowerCase().includes('score') || key.toLowerCase().includes('correct')))
      .toBe(false);
  });
});
