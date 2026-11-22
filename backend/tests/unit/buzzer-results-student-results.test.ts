import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { BuzzerResultsService } from '../../src/domain/buzzer-results.js';
import { GroupRoster } from '../../src/domain/group-roster.js';

function setup() {
  const activity = new ActivityState();
  activity.replaceGuidedNotesImport(
    { spreadsheetId: 'unit', sheetId: 1, worksheetTitle: 'Sheet' },
    ['1', '2'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
  );
  const service = new BuzzerResultsService({ activity, roster: new GroupRoster(['A', 'B', 'C']) });
  return { activity, service };
}

describe('BuzzerResultsService student results', () => {
  it('returns only the winner and the requesting group answer after ENDED', () => {
    const { activity, service } = setup();
    activity.advance('PREPARING', 'BUZZING');
    service.submitAnswer('A', '1', 'winning answer');
    service.submitAnswer('B', '1', 'private non-winning answer');
    activity.advance('BUZZING', 'ENDED');

    expect(service.getStudentResults('B')).toEqual({ questions: [
      {
        questionId: '1', winningGroupId: 'A', winningAnswer: 'winning answer',
        ownAnswer: 'private non-winning answer', ownStatus: 'SUBMITTED', ownGroupWon: false,
        groups: [
          { groupId: 'A', submitted: true, rank: 1 },
          { groupId: 'B', submitted: true, rank: 2 },
          { groupId: 'C', submitted: false, rank: null },
        ],
      },
      {
        questionId: '2', winningGroupId: null, winningAnswer: null,
        ownAnswer: null, ownStatus: 'NOT_SUBMITTED', ownGroupWon: false,
        groups: [
          { groupId: 'A', submitted: false, rank: null },
          { groupId: 'B', submitted: false, rank: null },
          { groupId: 'C', submitted: false, rank: null },
        ],
      },
    ] });
    expect(JSON.stringify(service.getStudentResults('C'))).not.toContain('private non-winning answer');
    expect(service.getStudentResults('A').questions[0]?.ownGroupWon).toBe(true);
  });

  it('rejects result access before ENDED and keeps the BUZZING reconnect projection group-scoped', () => {
    const { activity, service } = setup();
    expect(() => service.getStudentResults('A')).toThrowError(/STAGE_CONFLICT/);
    activity.advance('PREPARING', 'BUZZING');
    service.submitAnswer('A', '1', 'A private');
    service.submitAnswer('B', '1', 'B private');
    expect(JSON.stringify(service.getOwnProgress('A'))).toContain('A private');
    expect(JSON.stringify(service.getOwnProgress('A'))).not.toContain('B private');
    expect(service.getOwnProgress('A')).toMatchObject({ questions: [
      { questionId: '1', submitted: true, answerText: 'A private', locked: true },
      { questionId: '2', submitted: false, answerText: null, locked: false },
    ] });
  });
});
