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
      {
        questionId: ' 01 ', displayOrder: 1, sourceRowAtImport: 4, kind: 'SINGLE',
        answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 4 }],
      },
      {
        questionId: '4', displayOrder: 2, sourceRowAtImport: 6, kind: 'SINGLE',
        answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 6 }],
      },
    ]);
    expect(JSON.stringify(parsed.questions)).not.toContain('題目一');
  });

  it('ignores header-like labels on rows that do not contain both required headers', () => {
    const parsed = parseWorksheet([
      ['題號', '說明', '題號'],
      ['課程內容', '題號與作答欄位說明', ''],
      ['作答', '題號', '題目敘述'],
      ['舊答案一', '1', '題目一'],
    ]);

    expect(parsed.layout).toMatchObject({
      headerRowNumber: 3,
      answerColumnNumber: 1,
      questionColumnNumber: 2,
    });
    expect(parsed.questions).toEqual([
      {
        questionId: '1', displayOrder: 1, sourceRowAtImport: 4, kind: 'SINGLE',
        answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 4 }],
      },
    ]);
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

  it('parses mixed single and grouped questions with dynamic headers, child rows, and spacer rows', () => {
    const parsed = parseWorksheet([
      ['課程', ''],
      [' 作答 ', ' 題號 ', '題目敘述'],
      ['ordinary answer', 'S-1', 'single question'],
      ['（1）', 'G-2', ''],
      ['（2）', '', ''],
      ['', '', 'spacer'],
      ['（1）', 'G-4', ''],
      ['（2）', '', ''],
      ['（3）', '', ''],
      ['（4）', '', ''],
    ]);

    expect(parsed.questions).toMatchObject([
      {
        questionId: 'S-1', displayOrder: 1, kind: 'SINGLE',
        answerSlots: [{ placeholderNumber: 1, sourceRowAtImport: 3 }],
      },
      {
        questionId: 'G-2', displayOrder: 2, kind: 'GROUP',
        answerSlots: [
          { placeholderNumber: 1, sourceRowAtImport: 4 },
          { placeholderNumber: 2, sourceRowAtImport: 5 },
        ],
      },
      {
        questionId: 'G-4', displayOrder: 3, kind: 'GROUP',
        answerSlots: [
          { placeholderNumber: 1, sourceRowAtImport: 7 },
          { placeholderNumber: 2, sourceRowAtImport: 8 },
          { placeholderNumber: 3, sourceRowAtImport: 9 },
          { placeholderNumber: 4, sourceRowAtImport: 10 },
        ],
      },
    ]);
    expect([...parsed.layout.slotRows]).toEqual([
      ['S-1', [3]],
      ['G-2', [4, 5]],
      ['G-4', [7, 8, 9, 10]],
    ]);
    expect(parsed.questions).toHaveLength(3);
  });

  it('rejects one-slot, missing, repeated, reversed, orphaned, and non-contiguous groups with question and row guidance', () => {
    const invalidLayouts = [
      {
        name: 'mixed opening and closing delimiters',
        rows: [['題號', '作答'], ['Q-mixed-delimiter', '（1)'], ['', '(2)']],
        questionId: 'Q-mixed-delimiter',
        row: '2',
      },
      {
        name: 'one marker',
        rows: [['題號', '作答'], ['Q-one', '（1）'], ['Q-next', '']],
        questionId: 'Q-one',
        row: '2',
      },
      {
        name: 'missing marker number',
        rows: [['題號', '作答'], ['Q-missing', '（1）'], ['', '（3）']],
        questionId: 'Q-missing',
        row: '3',
      },
      {
        name: 'repeated marker number',
        rows: [['題號', '作答'], ['Q-repeat', '（1）'], ['', '（2）'], ['', '（2）']],
        questionId: 'Q-repeat',
        row: '4',
      },
      {
        name: 'reversed marker order',
        rows: [['題號', '作答'], ['Q-reversed', '（1）'], ['', '（3）'], ['', '（2）']],
        questionId: 'Q-reversed',
        row: '3',
      },
      {
        name: 'orphaned marker',
        rows: [['題號', '作答'], ['', '（2）'], ['Q-after', '']],
        questionId: 'Q-after',
        row: '2',
      },
      {
        name: 'non-contiguous child rows',
        rows: [['題號', '作答'], ['Q-gap', '（1）'], ['', ''], ['', '（2）']],
        questionId: 'Q-gap',
        row: '4',
      },
    ];

    for (const invalid of invalidLayouts) {
      let thrown: unknown;
      try {
        parseWorksheet(invalid.rows);
      } catch (error) {
        thrown = error;
      }
      expect(thrown, invalid.name).toBeInstanceOf(WorksheetParserError);
      expect((thrown as Error).message, invalid.name).toContain(invalid.questionId);
      expect((thrown as Error).message, invalid.name).toContain(`第 ${invalid.row} 列`);
    }
  });

  it('accepts half-width and full-width group placeholders, including mixed styles', () => {
    const parsed = parseWorksheet([
      ['題號', '作答'],
      ['G-ascii', '(1)'],
      ['', '(2)'],
      ['G-mixed', '(1)'],
      ['', '（2）'],
      ['', '(3)'],
    ]);

    expect(parsed.questions).toMatchObject([
      { questionId: 'G-ascii', kind: 'GROUP', answerSlots: [{ placeholderNumber: 1 }, { placeholderNumber: 2 }] },
      { questionId: 'G-mixed', kind: 'GROUP', answerSlots: [{ placeholderNumber: 1 }, { placeholderNumber: 2 }, { placeholderNumber: 3 }] },
    ]);
  });

  it('accepts 20 group slots and rejects a 21st slot', () => {
    const twenty = [
      ['題號', '作答'],
      ['Q-20', '（1）'],
      ...Array.from({ length: 19 }, (_, index) => ['', `（${index + 2}）`]),
    ];
    const twentyOne = [
      ['題號', '作答'],
      ['Q-21', '（1）'],
      ...Array.from({ length: 20 }, (_, index) => ['', `（${index + 2}）`]),
    ];

    const parsedTwenty = parseWorksheet(twenty);
    expect(parsedTwenty.questions[0]).toMatchObject({ kind: 'GROUP' });
    expect(parsedTwenty.questions[0]?.answerSlots).toHaveLength(20);
    expect(() => parseWorksheet(twentyOne)).toThrowError(expect.objectContaining({ code: 'QUESTION_IDS_INVALID' }));
  });
});
