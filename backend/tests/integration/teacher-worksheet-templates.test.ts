import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { ActivityState } from '../../src/domain/activity-state.js';
import { GuidedNotesService } from '../../src/guided-notes/service.js';
import type { WinningAnswer, WorksheetReference } from '../../src/guided-notes/types.js';
import { FakeGoogleSheetsAdapter, type FakeWorksheetFixture } from '../support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../support/fake-winning-results.js';

const worksheetTitle = '工作表1';

interface ParsedCsvFixture {
  readonly fixture: FakeWorksheetFixture;
  readonly values: string[][];
}

interface ExpectedWrite {
  readonly address: string;
  readonly value: string;
}

interface TeacherTemplateCase {
  readonly name: string;
  readonly filename: string;
  readonly spreadsheetId: string;
  readonly sheetId: number;
  readonly questionIds: readonly string[];
  readonly questionLayouts: readonly { questionId: string; kind: 'SINGLE' | 'GROUP'; answerCount: number }[];
  readonly answers: readonly WinningAnswer[];
  readonly expectedWrites: readonly ExpectedWrite[];
  readonly sourceCells: readonly ExpectedWrite[];
}

function parseCsvGrid(source: string): string[][] {
  const text = source.replace(/^\uFEFF/u, '');
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += character;
      }
      continue;
    }

    if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ',') {
      row.push(cell);
      cell = '';
    } else if (character === '\r' || character === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else {
      cell += character;
    }
  }

  if (quoted) throw new Error('CSV_FIXTURE_UNCLOSED_QUOTE');
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function columnLetters(oneBasedColumn: number): string {
  let value = oneBasedColumn;
  let letters = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    letters = String.fromCharCode(65 + remainder) + letters;
    value = Math.floor((value - 1) / 26);
  }
  return letters;
}

function columnNumber(letters: string): number {
  return [...letters].reduce((value, letter) => value * 26 + letter.charCodeAt(0) - 64, 0);
}

async function loadTemplateFixture(testCase: TeacherTemplateCase): Promise<ParsedCsvFixture> {
  const source = await readFile(
    new URL(`../fixtures/feature004/${testCase.filename}`, import.meta.url),
    'utf8',
  );
  const parsedRows = parseCsvGrid(source);
  const columnCount = Math.max(...parsedRows.map((csvRow) => csvRow.length));
  const values = parsedRows.map((csvRow) => Array.from(
    { length: columnCount },
    (_, index) => csvRow[index] ?? '',
  ));
  const cells: Record<string, string> = {};

  values.forEach((csvRow, rowIndex) => csvRow.forEach((value, columnIndex) => {
    if (value !== '') cells[`${columnLetters(columnIndex + 1)}${rowIndex + 1}`] = value;
  }));

  const worksheet: WorksheetReference = {
    spreadsheetId: testCase.spreadsheetId,
    sheetId: testCase.sheetId,
    worksheetTitle,
  };
  return {
    fixture: { worksheet, rowCount: values.length, columnCount, cells },
    values,
  };
}

async function importAndExportTemplate(testCase: TeacherTemplateCase): Promise<void> {
  const { fixture, values } = await loadTemplateFixture(testCase);
  const sheets = new FakeGoogleSheetsAdapter([fixture]);
  const activity = new ActivityState();
  const results = new FakeWinningResultsProvider({ status: 'READY', answers: [] });
  const service = new GuidedNotesService({ activity, sheets, winningResultsProvider: results });

  const imported = await service.importWorksheet({
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${testCase.spreadsheetId}/edit`,
    worksheetTitle,
  });
  expect(imported.questionIds).toEqual(testCase.questionIds);
  expect(imported.questionCount).toBe(testCase.questionIds.length);
  expect(imported.questionLayouts).toEqual(testCase.questionLayouts);
  for (const { address, value } of testCase.sourceCells) {
    const match = /^([A-Z]+)(\d+)$/u.exec(address);
    expect(match, `invalid expected cell address ${address}`).not.toBeNull();
    const row = Number(match![2]) - 1;
    const column = columnNumber(match![1]!) - 1;
    expect(values[row]?.[column], `${testCase.name} source cell ${address}`).toBe(value);
  }

  expect(activity.advance('PREPARING', 'BUZZING').accepted).toBe(true);
  expect(activity.advance('BUZZING', 'ENDED').accepted).toBe(true);
  results.snapshot = { status: 'READY', answers: testCase.answers };
  await expect(service.exportAnswers()).resolves.toEqual({
    writtenCellCount: testCase.expectedWrites.length,
    clearedCellCount: 0,
  });

  const resolved = await sheets.resolveWorksheet(testCase.spreadsheetId, worksheetTitle);
  const exported = await sheets.readWorksheet(resolved);
  const expectedValues = values.map((csvRow) => [...csvRow]);
  for (const { address, value } of testCase.expectedWrites) {
    const match = /^([A-Z]+)(\d+)$/u.exec(address);
    expect(match, `invalid expected cell address ${address}`).not.toBeNull();
    const row = Number(match![2]) - 1;
    const column = columnNumber(match![1]!) - 1;
    expectedValues[row]![column] = value;
  }

  expect(exported.values, `${testCase.name} complete worksheet after export`).toEqual(expectedValues);
  expect(sheets.exportBatches).toHaveLength(1);
  expect(sheets.exportBatches[0]?.writes.map(({ rowNumber, answerColumnNumber, value }) => ({
    address: `${columnLetters(answerColumnNumber)}${rowNumber}`,
    value,
  }))).toEqual(testCase.expectedWrites);
}

describe('teacher-provided Feature 004 worksheet templates', () => {
  it('imports and writes the single-question example to its exact answer cells', async () => {
    await importAndExportTemplate({
      name: 'single-question example',
      filename: '單題_範例_學習單.csv',
      spreadsheetId: 'feature004-single-template-fixture',
      sheetId: 41,
      questionIds: ['1', '2', '3', '4', '5', '6'],
      questionLayouts: ['1', '2', '3', '4', '5', '6'].map((questionId) => ({
        questionId, kind: 'SINGLE', answerCount: 1,
      })),
      answers: ['reply 1', 'reply 2', 'reply 3', 'reply 4', 'reply 5', 'reply 6'].map((answerText, index) => ({
        questionId: String(index + 1), groupId: 'A', answerText,
      })),
      expectedWrites: [
        { address: 'G5', value: 'reply 1' },
        { address: 'G7', value: 'reply 2' },
        { address: 'G9', value: 'reply 3' },
        { address: 'G11', value: 'reply 4' },
        { address: 'G13', value: 'reply 5' },
        { address: 'G15', value: 'reply 6' },
      ],
      sourceCells: [
        { address: 'B4', value: '題號' },
        { address: 'C4', value: '題目' },
        { address: 'G4', value: '作答' },
        { address: 'C13', value: '有一種資料結構的特性是「後進先出」(Last-In, First-Out, LIFO)，就像是疊盤子一樣，最後放上去的盤子會最先被拿走，這種資料結構稱為什麼？' },
      ],
    });
  });

  it('imports mixed grouped and single questions and writes every answer to its exact source cell', async () => {
    await importAndExportTemplate({
      name: 'grouped-question example',
      filename: '題組_範例_學習單.csv',
      spreadsheetId: 'feature004-group-template-fixture',
      sheetId: 42,
      questionIds: ['1', '2', '3', '4'],
      questionLayouts: [
        { questionId: '1', kind: 'GROUP', answerCount: 2 },
        { questionId: '2', kind: 'GROUP', answerCount: 2 },
        { questionId: '3', kind: 'SINGLE', answerCount: 1 },
        { questionId: '4', kind: 'SINGLE', answerCount: 1 },
      ],
      answers: [
        { questionId: '1', groupId: 'A', answers: [
          { placeholderNumber: 1, answerText: 'group 1, slot 1' },
          { placeholderNumber: 2, answerText: 'group 1, slot 2' },
        ] },
        { questionId: '2', groupId: 'B', answers: [
          { placeholderNumber: 1, answerText: 'group 2, slot 1' },
          { placeholderNumber: 2, answerText: 'group 2, slot 2' },
        ] },
        { questionId: '3', groupId: 'A', answerText: 'single 3' },
        { questionId: '4', groupId: 'B', answerText: 'single 4' },
      ],
      expectedWrites: [
        { address: 'G5', value: 'group 1, slot 1' },
        { address: 'G6', value: 'group 1, slot 2' },
        { address: 'G8', value: 'group 2, slot 1' },
        { address: 'G9', value: 'group 2, slot 2' },
        { address: 'G11', value: 'single 3' },
        { address: 'G13', value: 'single 4' },
      ],
      sourceCells: [
        { address: 'B4', value: '題號' },
        { address: 'C4', value: '題目' },
        { address: 'G4', value: '作答' },
        { address: 'G5', value: '（1）' },
        { address: 'G6', value: '（2）' },
        { address: 'G8', value: '（1）' },
        { address: 'G9', value: '（2）' },
      ],
    });
  });
});
