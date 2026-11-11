import { describe, expect, it } from 'vitest';
import { mapActivityAnswersToWrites } from '../../../src/guided-notes/worksheet-parser.js';
import type { Question, WinningAnswer } from '../../../src/guided-notes/types.js';

const activityQuestions: readonly Question[] = [
  { questionId: '1', displayOrder: 1, sourceRowAtImport: 3 },
  { questionId: '2', displayOrder: 2, sourceRowAtImport: 5 },
  { questionId: '4', displayOrder: 3, sourceRowAtImport: 7 },
];

const winningAnswers: readonly WinningAnswer[] = [
  { questionId: '1', groupId: 'A', answerText: '=literal answer' },
  { questionId: '4', groupId: 'B', answerText: '新答案四' },
];

describe('mapActivityAnswersToWrites', () => {
  it('discovers the current header and maps reordered rows and columns by exact question ID', () => {
    const values = [
      ['學習單標題'],
      ['說明'],
      ['題目說明', ' 作答 ', ' 題號 ', '其他'],
      ['第四題', '舊答案四', '4', '保留'],
      ['第一題', '舊答案一', '1', '保留'],
      ['', '', '', ''],
      ['第二題', '舊答案二', '2', '保留'],
    ];

    expect(mapActivityAnswersToWrites(values, activityQuestions, winningAnswers)).toEqual([
      { questionId: '1', rowNumber: 5, answerColumnNumber: 2, value: '=literal answer' },
      { questionId: '2', rowNumber: 7, answerColumnNumber: 2, value: '' },
      { questionId: '4', rowNumber: 4, answerColumnNumber: 2, value: '新答案四' },
    ]);
  });

  it('rejects before write when an activity question is absent from the current worksheet', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['4', '舊答案四'],
    ];

    expect(() => mapActivityAnswersToWrites(values, activityQuestions, winningAnswers))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });

  it('rejects before write when an activity question is duplicated in the current worksheet', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['2', '舊答案二'],
      ['1', '重複題號'],
      ['4', '舊答案四'],
    ];

    expect(() => mapActivityAnswersToWrites(values, activityQuestions, winningAnswers))
      .toThrow(expect.objectContaining({ code: 'QUESTION_TARGET_INVALID' }));
  });

  it('ignores extra worksheet IDs and creates exactly one target per activity question', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['99', '額外題目一'],
      ['2', '舊答案二'],
      ['99', '額外題目二'],
      ['4', '舊答案四'],
    ];

    const writes = mapActivityAnswersToWrites(values, activityQuestions, winningAnswers);
    expect(writes.map(({ questionId }) => questionId)).toEqual(['1', '2', '4']);
    expect(writes.map(({ rowNumber }) => rowNumber)).toEqual([2, 4, 6]);
  });

  it('maps each winning answer and uses an empty string for every no-winner question', () => {
    const values = [
      ['題號', '作答'],
      ['1', '舊答案一'],
      ['2', '舊答案二'],
      ['4', '舊答案四'],
    ];

    expect(mapActivityAnswersToWrites(values, activityQuestions, winningAnswers).map(({ value }) => value))
      .toEqual(['=literal answer', '', '新答案四']);
  });
});
