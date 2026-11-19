import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { BuzzerResultsService } from '../../src/domain/buzzer-results.js';
import { GroupRoster } from '../../src/domain/group-roster.js';

describe('ended student ranking projection', () => {
  it('returns every rank and unanswered group without exposing other non-winning answers', () => {
    const activity = new ActivityState();
    activity.replaceGuidedNotesImport(
      { spreadsheetId: 'unit', sheetId: 1, worksheetTitle: 'Sheet' },
      ['1', '2'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
    );
    const results = new BuzzerResultsService({ activity, roster: new GroupRoster(['A', 'B', 'C']) });
    activity.advance('PREPARING', 'BUZZING');
    results.submitAnswer('A', '1', 'winner answer');
    results.submitAnswer('B', '1', 'private non-winner answer');
    results.submitAnswer('B', '2', 'B winner on question 2');
    activity.advance('BUZZING', 'ENDED');

    const forA = results.getStudentResults('A');
    const forC = results.getStudentResults('C');
    expect(forA.questions[0]).toMatchObject({
      winningGroupId: 'A', winningAnswer: 'winner answer', ownAnswer: 'winner answer',
      ownStatus: 'SUBMITTED', ownGroupWon: true,
      groups: [
        { groupId: 'A', submitted: true, rank: 1 },
        { groupId: 'B', submitted: true, rank: 2 },
        { groupId: 'C', submitted: false, rank: null },
      ],
    });
    expect(forC.questions[0]).toMatchObject({
      winningGroupId: 'A', winningAnswer: 'winner answer', ownAnswer: null,
      ownStatus: 'NOT_SUBMITTED', ownGroupWon: false,
    });
    expect(JSON.stringify(forC)).not.toContain('private non-winner answer');
    expect(JSON.stringify(forA)).not.toContain('private non-winner answer');
    expect(forC.questions[1]?.groups).toEqual([
      { groupId: 'A', submitted: false, rank: null },
      { groupId: 'B', submitted: true, rank: 1 },
      { groupId: 'C', submitted: false, rank: null },
    ]);
  });
});
