import { test as base, expect } from '@playwright/test';
import { startTestServer, type TestServerHandle } from '../../../backend/tests/support/test-server.js';
import { FakeGoogleSheetsAdapter, type FakeWorksheetFixture } from '../../../backend/tests/support/fake-google-sheets.js';
import { FakeWinningResultsProvider } from '../../../backend/tests/support/fake-winning-results.js';

type TestFixtures = {
  backend: TestServerHandle;
  guidedNotesSheets: FakeGoogleSheetsAdapter;
  winningResultsProvider: FakeWinningResultsProvider;
};

type TestOptions = {
  teacherPassword: string | null;
  groupIds: string;
};

const requestId = '123e4567-e89b-12d3-a456-426614174000';

function minimumGroupQuestionId(targetBytes: number): string {
  const envelope = {
    type: 'buzzerResults.submitAnswer',
    requestId,
    payload: {
      questionId: '',
      subAnswers: [
        { placeholderNumber: 1, answerText: 'a' },
        { placeholderNumber: 2, answerText: 'a' },
      ],
    },
  };
  return 'Q'.repeat(targetBytes - new TextEncoder().encode(JSON.stringify(envelope)).length);
}

function groupCells(questionId: string, slotCount: number): Record<string, string> {
  const cells: Record<string, string> = { A2: '作答', B2: '題號', B3: questionId };
  for (let slot = 1; slot <= slotCount; slot += 1) {
    cells[`A${slot + 2}`] = `（${slot}）`;
  }
  return cells;
}

const mixedWorksheetCells = {
  A2: '作答', B2: '題號', C2: '題目敘述',
  A3: '舊答案一', B3: '1', C3: '第一題說明',
  A4: '（1）', B4: '2',
  A5: '（2）', B5: '',
  A6: '', B6: '',
  A7: '（1）', B7: '4',
  A8: '（2）', B8: '',
  A9: '（3）', B9: '',
};

export const test = base.extend<TestFixtures & TestOptions>({
  teacherPassword: ['e2e-teacher-password', { option: true }],
  groupIds: [process.env.PLAYWRIGHT_GROUP_IDS ?? process.env.GROUP_IDS ?? '1,2,3', { option: true }],
  guidedNotesSheets: [async ({}, use) => {
    const fixtures: FakeWorksheetFixture[] = [
      {
        worksheet: { spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1' },
        rowCount: 10,
        columnCount: 4,
        cells: mixedWorksheetCells,
      },
      {
        worksheet: { spreadsheetId: 'e2e-exported-sheet', sheetId: 17, worksheetTitle: '工作表1' },
        rowCount: 10,
        columnCount: 4,
        cells: mixedWorksheetCells,
        developerMetadata: [
          { metadataKey: 'sb004', visibility: 'PROJECT', locationType: 'ROW', sheetId: 17 },
        ],
      },
      {
        worksheet: { spreadsheetId: 'e2e-20-slot-sheet', sheetId: 20, worksheetTitle: '工作表1' },
        rowCount: 24,
        columnCount: 4,
        cells: groupCells('Q-20', 20),
      },
      {
        worksheet: { spreadsheetId: 'e2e-21-slot-sheet', sheetId: 21, worksheetTitle: '工作表1' },
        rowCount: 25,
        columnCount: 4,
        cells: groupCells('Q-21', 21),
      },
      {
        worksheet: { spreadsheetId: 'e2e-one-marker-sheet', sheetId: 22, worksheetTitle: '工作表1' },
        rowCount: 5,
        columnCount: 4,
        cells: groupCells('Q-one', 1),
      },
      {
        worksheet: { spreadsheetId: 'e2e-oversized-group-sheet', sheetId: 23, worksheetTitle: '工作表1' },
        rowCount: 5,
        columnCount: 4,
        cells: groupCells(minimumGroupQuestionId(16_385), 2),
      },
      {
        worksheet: { spreadsheetId: 'e2e-invalid-sheet', sheetId: 8, worksheetTitle: '工作表1' },
        rowCount: 5,
        columnCount: 3,
        cells: { A2: '題號', A3: '1', B3: '題目描述但缺少作答' },
      },
    ];
    await use(new FakeGoogleSheetsAdapter(fixtures));
  }, { auto: true }],
  winningResultsProvider: [async ({}, use) => {
    await use(new FakeWinningResultsProvider());
  }, { auto: true }],
  backend: [async ({ teacherPassword, groupIds, guidedNotesSheets, winningResultsProvider }, use) => {
    const backend = await startTestServer({
      port: 3001,
      teacherPassword,
      groupIds,
      guidedNotes: { sheetsAdapter: guidedNotesSheets, winningResultsProvider },
      allowedOrigin: process.env.PLAYWRIGHT_TEST_ORIGIN,
    });
    try {
      await use(backend);
    } finally {
      await backend.close();
    }
  }, { auto: true }],
});

export { expect };
