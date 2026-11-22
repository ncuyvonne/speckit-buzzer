import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { BuzzerResultsService } from '../../src/domain/buzzer-results.js';
import { GroupRoster } from '../../src/domain/group-roster.js';

function setup() {
  const activity = new ActivityState();
  activity.replaceGuidedNotesImport(
    { spreadsheetId: 'unit', sheetId: 1, worksheetTitle: 'Sheet' },
    ['4', '1'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
  );
  activity.advance('PREPARING', 'BUZZING');
  const roster = new GroupRoster(['B', 'A', 'C']);
  const service = new BuzzerResultsService({ activity, roster, now: () => 100 });
  return { service };
}

describe('BuzzerResultsService teacher progress', () => {
  it('projects all questions and roster groups in configured order with blank and winning states', () => {
    const { service } = setup();
    service.submitAnswer('B', '4', '  first  ');
    service.submitAnswer('A', '4', 'later');
    service.submitAnswer('C', '1', 'last question');

    expect(service.getTeacherProgress()).toEqual({
      questions: [
        {
          questionId: '4',
          groups: [
            { groupId: 'B', submitted: true, rank: 1, answerText: '  first  ' },
            { groupId: 'A', submitted: true, rank: 2, answerText: 'later' },
            { groupId: 'C', submitted: false, rank: null, answerText: null },
          ],
          winningGroupId: 'B',
          winningAnswer: '  first  ',
        },
        {
          questionId: '1',
          groups: [
            { groupId: 'B', submitted: false, rank: null, answerText: null },
            { groupId: 'A', submitted: false, rank: null, answerText: null },
            { groupId: 'C', submitted: true, rank: 1, answerText: 'last question' },
          ],
          winningGroupId: 'C',
          winningAnswer: 'last question',
        },
      ],
    });
  });

  it('represents every group as unsubmitted when no answers exist', () => {
    const { service } = setup();
    expect(service.getTeacherProgress().questions[0]?.groups).toEqual([
      { groupId: 'B', submitted: false, rank: null, answerText: null },
      { groupId: 'A', submitted: false, rank: null, answerText: null },
      { groupId: 'C', submitted: false, rank: null, answerText: null },
    ]);
  });
});

describe('BuzzerResultsService own progress summary', () => {
  it('counts one accepted top-level question, excludes duplicates and other groups, and includes total questions', () => {
    const { service } = setup();
    expect(service.getOwnProgress('A')).toMatchObject({ submittedCount: 0, totalQuestionCount: 2 });
    expect(service.submitAnswer('A', '4', 'group answer')).toMatchObject({ accepted: true });
    expect(service.submitAnswer('A', '4', 'duplicate')).toMatchObject({ accepted: false, code: 'ANSWER_LOCKED' });
    expect(service.submitAnswer('A', 'missing', 'invalid')).toMatchObject({ accepted: false, code: 'QUESTION_INVALID' });
    expect(service.submitAnswer('B', '1', 'other group')).toMatchObject({ accepted: true });
    expect(service.getOwnProgress('A')).toMatchObject({ submittedCount: 1, totalQuestionCount: 2 });
    expect(JSON.stringify(service.getOwnProgress('A'))).not.toContain('other group');
  });

  it('does not count rejected submissions at or after the deadline', () => {
    let now = 100;
    const activity = new ActivityState();
    activity.replaceGuidedNotesImport({ spreadsheetId: 'unit', sheetId: 1, worksheetTitle: 'Sheet' }, [
      { questionId: 'Q1', displayOrder: 1, sourceRowAtImport: 2 },
    ]);
    activity.setTimeLimitSeconds(1);
    activity.advance('PREPARING', 'BUZZING');
    activity.startCountdown(now);
    const service = new BuzzerResultsService({ activity, roster: new GroupRoster(['A']), now: () => now });
    now = 1_100;
    expect(service.submitAnswer('A', 'Q1', 'late')).toMatchObject({ accepted: false, code: 'ANSWER_TIMED_OUT' });
    expect(service.getOwnProgress('A')).toMatchObject({ submittedCount: 0, totalQuestionCount: 1 });
  });
});
