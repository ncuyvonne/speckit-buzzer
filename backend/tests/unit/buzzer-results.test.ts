import { beforeEach, describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { GroupRoster } from '../../src/domain/group-roster.js';
import { BuzzerResultsService } from '../../src/domain/buzzer-results.js';

function createSystem(questionIds: string[] = ['1', '2'], now: () => number = () => 1_000) {
  const activity = new ActivityState();
  if (questionIds.length > 0) {
    expect(activity.replaceGuidedNotesImport(
      { spreadsheetId: 'test', sheetId: 1, worksheetTitle: 'Sheet' },
      questionIds.map((questionId, index) => ({
        questionId,
        displayOrder: index + 1,
        sourceRowAtImport: index + 2,
      })),
    )).toBe(true);
  }
  expect(activity.advance('PREPARING', 'BUZZING').accepted).toBe(true);
  const roster = new GroupRoster(['A', 'B', 'C']);
  const service = new BuzzerResultsService({ activity, roster, now });
  return { activity, roster, service };
}

describe('BuzzerResultsService submission', () => {
  it('accepts the first nonblank answer, preserves its exact text, and locks the group/question pair', () => {
    const { service } = createSystem();

    const accepted = service.submitAnswer('A', '1', '  first answer  ');
    expect(accepted.accepted).toBe(true);
    expect(accepted.submission).toMatchObject({
      groupId: 'A',
      questionId: '1',
      answerText: '  first answer  ',
      receivedOrder: 1,
      acceptedAt: 1_000,
      locked: true,
    });
    expect(service.submitAnswer('A', '1', 'replacement')).toMatchObject({
      accepted: false,
      code: 'ANSWER_LOCKED',
    });
    expect(service.getSubmission('A', '1')?.answerText).toBe('  first answer  ');
  });

  it('rejects Unicode whitespace and invalid questions without consuming an order or lock', () => {
    const { service } = createSystem();

    expect(service.submitAnswer('A', '1', ' \t\u3000\n')).toMatchObject({
      accepted: false,
      code: 'ANSWER_EMPTY',
    });
    expect(service.submitAnswer('A', 'missing', 'answer')).toMatchObject({
      accepted: false,
      code: 'QUESTION_INVALID',
    });
    expect(service.getSubmission('A', '1')).toBeNull();
    expect(service.submitAnswer('A', '1', 'valid')).toMatchObject({
      accepted: true,
      submission: { receivedOrder: 1 },
    });
  });

  it('rejects an empty question list and invalid groups without mutating state', () => {
    const empty = createSystem([]);
    expect(empty.service.submitAnswer('A', '1', 'answer')).toMatchObject({
      accepted: false,
      code: 'QUESTION_INVALID',
    });
    expect(empty.service.getSubmission('A', '1')).toBeNull();

    const { service } = createSystem();
    expect(service.submitAnswer('not-configured', '1', 'answer')).toMatchObject({
      accepted: false,
      code: 'GROUP_INVALID',
    });
    expect(service.submitAnswer('B', '1', 'accepted')).toMatchObject({
      accepted: true,
      submission: { receivedOrder: 1 },
    });
  });

  it('rejects submissions outside BUZZING without changing submissions or winners', () => {
    const { activity, service } = createSystem();
    expect(activity.advance('BUZZING', 'ENDED').accepted).toBe(true);

    expect(service.submitAnswer('A', '1', 'too late')).toMatchObject({
      accepted: false,
      code: 'STAGE_CONFLICT',
    });
    expect(service.getSubmission('A', '1')).toBeNull();
    expect(service.getWinner('1')).toBeNull();
  });

  it('serializes same-group concurrent submissions and preserves the first accepted answer', async () => {
    const { service } = createSystem();
    const results = await Promise.all([
      Promise.resolve().then(() => service.submitAnswer('A', '1', 'first')),
      Promise.resolve().then(() => service.submitAnswer('A', '1', 'second')),
    ]);

    expect(results.filter((result) => result.accepted)).toHaveLength(1);
    expect(results.filter((result) => !result.accepted)).toMatchObject([{ accepted: false, code: 'ANSWER_LOCKED' }]);
    expect(service.getSubmission('A', '1')?.answerText).toBe('first');
    expect(service.getWinner('1')?.groupId).toBe('A');
  });

  it('uses accepted server order as the unique winner when server timestamps are identical', () => {
    const { service } = createSystem(['1'], () => 42);

    const first = service.submitAnswer('B', '1', 'B answer');
    const second = service.submitAnswer('A', '1', 'A answer');

    expect(first.accepted).toBe(true);
    expect(second.accepted).toBe(true);
    if (first.accepted && second.accepted) {
      expect(first.submission.acceptedAt).toBe(second.submission.acceptedAt);
      expect(first.submission.receivedOrder).toBeLessThan(second.submission.receivedOrder);
    }
    expect(service.getWinner('1')).toMatchObject({ groupId: 'B', answerText: 'B answer' });
  });
});
