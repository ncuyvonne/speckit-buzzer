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

function createGroupSystem(now: () => number = () => 1_000) {
  const activity = new ActivityState();
  expect(activity.replaceGuidedNotesImport(
    { spreadsheetId: 'test', sheetId: 1, worksheetTitle: 'Sheet' },
    [{
      questionId: 'G',
      kind: 'GROUP',
      displayOrder: 1,
      sourceRowAtImport: 2,
      answerSlots: [1, 2, 3].map((placeholderNumber) => ({
        placeholderNumber,
        sourceRowAtImport: placeholderNumber + 1,
      })),
    }],
  )).toBe(true);
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

  it('rejects Unicode White_Space including NEL without consuming an order', () => {
    const { service } = createSystem(['1']);

    expect(service.submitAnswer('A', '1', '\u0085\u3000\t')).toMatchObject({
      accepted: false,
      code: 'ANSWER_EMPTY',
    });
    expect(service.getSubmission('A', '1')).toBeNull();
    expect(service.submitAnswer('B', '1', '\u00a0 valid \u3000')).toMatchObject({
      accepted: true,
      submission: { receivedOrder: 1, answerText: '\u00a0 valid \u3000' },
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

  it('accepts one complete ordered group vector atomically and ranks by server receipt order', () => {
    const { service } = createGroupSystem(() => 42);
    const answersA = [
      { placeholderNumber: 1, answerText: ' 第一格 ' },
      { placeholderNumber: 2, answerText: '答案二' },
      { placeholderNumber: 3, answerText: '任意答案' },
    ];

    const first = service.submitAnswer('A', 'G', answersA);
    const second = service.submitAnswer('B', 'G', [
      { placeholderNumber: 1, answerText: 'B-1' },
      { placeholderNumber: 2, answerText: 'B-2' },
      { placeholderNumber: 3, answerText: 'B-3' },
    ]);

    expect(first).toMatchObject({ accepted: true, submission: {
      kind: 'GROUP', groupId: 'A', questionId: 'G', receivedOrder: 1, acceptedAt: 42, locked: true,
      answers: answersA,
    } });
    expect(second).toMatchObject({ accepted: true, submission: { receivedOrder: 2 } });
    expect(service.getWinner('G')).toMatchObject({ kind: 'GROUP', groupId: 'A', answers: answersA });
    const progress = service.getTeacherProgress().questions[0]!;
    expect(progress).toMatchObject({ winningGroupId: 'A', winningAnswers: answersA });
    expect(progress.groups).toHaveLength(3);
    expect(progress.groups).toContainEqual(expect.objectContaining({ groupId: 'A', submitted: true, answers: answersA }));
    expect(progress.groups).toContainEqual(expect.objectContaining({ groupId: 'B', submitted: true }));
    expect(progress.groups).toContainEqual(expect.objectContaining({ groupId: 'C', submitted: false }));
    expect(service.submitAnswer('A', 'G', answersA)).toMatchObject({ accepted: false, code: 'ANSWER_LOCKED' });
    expect(service.getSubmission('A', 'G')).toMatchObject({ answers: answersA, receivedOrder: 1 });
  });

  it('rejects incomplete, blank, duplicate, unordered and out-of-range group slots without consuming the lock or rank', () => {
    const { service } = createGroupSystem();
    const valid = [1, 2, 3].map((placeholderNumber) => ({ placeholderNumber, answerText: `answer-${placeholderNumber}` }));

    expect(service.submitAnswer('A', 'G', [valid[0]!])).toMatchObject({ accepted: false, code: 'GROUP_ANSWER_INCOMPLETE' });
    expect(service.submitAnswer('A', 'G', [valid[0]!, { placeholderNumber: 2, answerText: ' \t\u3000 ' }, valid[2]!]))
      .toMatchObject({ accepted: false, code: 'GROUP_ANSWER_INCOMPLETE' });
    expect(service.submitAnswer('A', 'G', [valid[0]!, valid[0]!, valid[2]!]))
      .toMatchObject({ accepted: false, code: 'GROUP_ANSWER_INVALID' });
    expect(service.submitAnswer('A', 'G', [valid[1]!, valid[0]!, valid[2]!]))
      .toMatchObject({ accepted: false, code: 'GROUP_ANSWER_INVALID' });
    expect(service.submitAnswer('A', 'G', [...valid, { placeholderNumber: 4, answerText: 'extra' }]))
      .toMatchObject({ accepted: false, code: 'GROUP_ANSWER_INVALID' });
    expect(service.submitAnswer('A', 'G', [valid[0]!, valid[1]!, { placeholderNumber: 4, answerText: 'out-of-range' }]))
      .toMatchObject({ accepted: false, code: 'GROUP_ANSWER_INVALID' });

    expect(service.getSubmission('A', 'G')).toBeNull();
    expect(service.getWinner('G')).toBeNull();
    expect(service.submitAnswer('B', 'G', valid)).toMatchObject({
      accepted: true,
      submission: { receivedOrder: 1, groupId: 'B' },
    });
  });

  it('keeps grouped vectors and winners scoped to the submitting student group after the activity ends', () => {
    const { activity, service } = createGroupSystem();
    const answers = [1, 2, 3].map((placeholderNumber) => ({ placeholderNumber, answerText: `only-A-${placeholderNumber}` }));
    expect(service.submitAnswer('A', 'G', answers).accepted).toBe(true);
    expect(activity.advance('BUZZING', 'ENDED').accepted).toBe(true);

    expect(service.getStudentResults('B').questions[0]).toMatchObject({
      winningGroupId: 'A',
      winningAnswers: answers,
      ownStatus: 'NOT_SUBMITTED',
      ownAnswers: null,
    });
    expect(service.getStudentResults('A').questions[0]).toMatchObject({
      ownGroupWon: true,
      ownStatus: 'SUBMITTED',
      ownAnswers: answers,
    });
  });
});
