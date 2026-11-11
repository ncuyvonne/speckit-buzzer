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

export const test = base.extend<TestFixtures & TestOptions>({
  teacherPassword: ['e2e-teacher-password', { option: true }],
  groupIds: ['1,2,3', { option: true }],
  guidedNotesSheets: [async ({}, use) => {
    const fixtures: FakeWorksheetFixture[] = [
      {
        worksheet: { spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1' },
        rowCount: 8,
        columnCount: 4,
        cells: {
          A2: '作答', B2: '題號', C2: '題目敘述',
          A3: '舊答案一', B3: '1', C3: '第一題說明',
          A4: '', B4: '',
          A5: '舊答案二', B5: '2', C5: '第二題說明',
          A7: '舊答案四', B7: '4', C7: '第四題說明',
        },
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
