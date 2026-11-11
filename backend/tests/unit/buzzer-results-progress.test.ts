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
            { groupId: 'B', submitted: true, answerText: '  first  ' },
            { groupId: 'A', submitted: true, answerText: 'later' },
            { groupId: 'C', submitted: false, answerText: null },
          ],
          winningGroupId: 'B',
          winningAnswer: '  first  ',
        },
        {
          questionId: '1',
          groups: [
            { groupId: 'B', submitted: false, answerText: null },
            { groupId: 'A', submitted: false, answerText: null },
            { groupId: 'C', submitted: true, answerText: 'last question' },
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
      { groupId: 'B', submitted: false, answerText: null },
      { groupId: 'A', submitted: false, answerText: null },
      { groupId: 'C', submitted: false, answerText: null },
    ]);
  });
});
