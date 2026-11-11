import { describe, expect, it } from 'vitest';
import {
  parseWorksheet,
  WorksheetParserError,
} from '../../../src/guided-notes/worksheet-parser.js';

describe('parseWorksheet', () => {
  it('finds trimmed headers below the first row in reversed columns and preserves source order and displayed IDs', () => {
    const parsed = parseWorksheet([
      ['課程名稱', '第三週學習單', '教師說明'],
      ['請先閱讀說明', '', '不匯入題目敘述'],
      [' 作答 ', ' 題號 ', '題目敘述'],
      ['舊答案一', ' 01 ', '題目一'],
      ['', '', '空白題目列'],
      ['舊答案四', '4', '題目四'],
      ['', '   ', '沒有題號'],
    ]);

    expect(parsed.layout).toMatchObject({
      headerRowNumber: 3,
      answerColumnNumber: 1,
      questionColumnNumber: 2,
    });
    expect([...parsed.layout.questionRows]).toEqual([[' 01 ', 4], ['4', 6]]);
    expect(parsed.questions).toEqual([
      { questionId: ' 01 ', displayOrder: 1, sourceRowAtImport: 4 },
      { questionId: '4', displayOrder: 2, sourceRowAtImport: 6 },
    ]);
    expect(JSON.stringify(parsed.questions)).not.toContain('題目一');
  });

  it('rejects duplicate displayed IDs with all source rows in the error', () => {
    let thrown: unknown;
    try {
      parseWorksheet([
        ['題號', '作答'],
        ['1', 'first'],
        ['', 'blank'],
        ['1', 'duplicate'],
      ]);
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toBeInstanceOf(WorksheetParserError);
    expect(thrown).toMatchObject({ code: 'QUESTION_IDS_INVALID' });
    expect((thrown as Error).message).toContain('1');
    expect((thrown as Error).message).toContain('2');
    expect((thrown as Error).message).toContain('4');
  });

  it('rejects zero valid IDs and missing, duplicated, or ambiguous headers', () => {
    expect(() => parseWorksheet([
      ['題號', '作答'],
      ['', '尚無題號'],
    ])).toThrowError(expect.objectContaining({ code: 'QUESTION_IDS_INVALID' }));

    for (const values of [
      [['說明', '內容'], ['題號', '其他欄']],
      [['題號', '題號', '作答'], ['1', '', '答案']],
      [['題號', '作答'], ['1', '答案'], ['題號', '作答'], ['2', '答案']],
    ]) {
      expect(() => parseWorksheet(values)).toThrowError(expect.objectContaining({ code: 'SHEET_LAYOUT_INVALID' }));
    }
  });

  it('accepts 100 unique questions and rejects 101 before returning a candidate', () => {
    const hundred = [
      ['題號', '作答'],
      ...Array.from({ length: 100 }, (_, index) => [String(index + 1), '']),
    ];
    const hundredAndOne = [
      ['題號', '作答'],
      ...Array.from({ length: 101 }, (_, index) => [String(index + 1), '']),
    ];

    expect(parseWorksheet(hundred).questions).toHaveLength(100);
    expect(() => parseWorksheet(hundredAndOne)).toThrowError(expect.objectContaining({ code: 'QUESTION_IDS_INVALID' }));
  });
});
