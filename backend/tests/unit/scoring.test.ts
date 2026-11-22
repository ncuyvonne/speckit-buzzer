import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { BuzzerResultsService } from '../../src/domain/buzzer-results.js';
import { GroupRoster } from '../../src/domain/group-roster.js';
import { ScoringService } from '../../src/domain/scoring.js';

function setup(groupIds = ['10', '2', 'A']) {
  const activity = new ActivityState();
  activity.replaceGuidedNotesImport(
    { spreadsheetId: 'unit', sheetId: 1, worksheetTitle: 'Sheet' },
    ['Q1', 'Q2', 'Q3'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
  );
  const roster = new GroupRoster(groupIds);
  const answers = new BuzzerResultsService({ activity, roster, now: () => 100 });
  const scoring = new ScoringService({ activity, roster, buzzerResults: answers });
  return { activity, answers, scoring };
}

describe('ScoringService', () => {
  it('allows manual marks only after ENDED and only for questions with a winner', () => {
    const { activity, answers, scoring } = setup();
    expect(scoring.markCorrectness('Q1', 'CORRECT')).toMatchObject({ accepted: false, code: 'STAGE_CONFLICT' });
    activity.advance('PREPARING', 'BUZZING');
    answers.submitAnswer('2', 'Q1', 'the teacher judges this');
    activity.advance('BUZZING', 'ENDED');
    expect(scoring.markCorrectness('missing', 'CORRECT')).toMatchObject({ accepted: false, code: 'QUESTION_INVALID' });
    expect(scoring.markCorrectness('Q2', 'CORRECT')).toMatchObject({ accepted: false, code: 'WINNER_NOT_FOUND' });
  });

  it('replaces or clears one judgement and recalculates at most one point per winner question', () => {
    const { activity, answers, scoring } = setup();
    activity.advance('PREPARING', 'BUZZING');
    answers.submitAnswer('2', 'Q1', 'answer');
    answers.submitAnswer('2', 'Q2', 'answer');
    activity.advance('BUZZING', 'ENDED');

    expect(scoring.markCorrectness('Q1', 'CORRECT')).toMatchObject({ accepted: true });
    expect(scoring.markCorrectness('Q1', 'INCORRECT')).toMatchObject({ accepted: true });
    expect(scoring.markCorrectness('Q2', 'CORRECT')).toMatchObject({ accepted: true });
    expect(scoring.getScoreboard().find((entry) => entry.groupId === '2')).toMatchObject({ score: 1, successfulQuestionCount: 2 });
    expect(scoring.markCorrectness('Q1', null)).toMatchObject({ accepted: true });
    expect(scoring.getScoreboard().find((entry) => entry.groupId === '2')).toMatchObject({ score: 1, successfulQuestionCount: 2 });
  });

  it('includes every group and assigns deterministic score, success-count, and natural ID order ranks', () => {
    const { activity, answers, scoring } = setup(['10', 'A10', '2', 'A2', 'A1']);
    activity.advance('PREPARING', 'BUZZING');
    answers.submitAnswer('10', 'Q1', 'a');
    answers.submitAnswer('2', 'Q2', 'b');
    answers.submitAnswer('A10', 'Q3', 'c');
    answers.submitAnswer('A2', 'Q3', 'd');
    activity.advance('BUZZING', 'ENDED');
    scoring.markCorrectness('Q1', 'CORRECT');
    scoring.markCorrectness('Q2', 'CORRECT');
    scoring.markCorrectness('Q3', 'INCORRECT');

    expect(scoring.getScoreboard()).toEqual([
      { rank: 1, groupId: '2', score: 1, successfulQuestionCount: 1 },
      { rank: 2, groupId: '10', score: 1, successfulQuestionCount: 1 },
      { rank: 3, groupId: 'A10', score: 0, successfulQuestionCount: 1 },
      { rank: 4, groupId: 'A1', score: 0, successfulQuestionCount: 0 },
      { rank: 5, groupId: 'A2', score: 0, successfulQuestionCount: 0 },
    ]);
  });
});
