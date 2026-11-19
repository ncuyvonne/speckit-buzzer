import { test, expect } from './fixtures';

async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toContainText('已連線');
}

async function loginTeacher(page: import('@playwright/test').Page) {
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
  await expect(page.getByRole('heading', { name: '老師控制台' })).toBeVisible();
}

async function importWorksheet(page: import('@playwright/test').Page) {
  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByText('題數：3')).toBeVisible();
}

async function endActivity(page: import('@playwright/test').Page) {
  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText('活動階段：搶答中')).toBeVisible();
  await page.getByRole('button', { name: '結束活動' }).click();
  await expect(page.getByText('活動階段：已結束')).toBeVisible();
}

async function confirmExport(page: import('@playwright/test').Page) {
  page.once('dialog', (dialog) => dialog.accept());
  await page.getByRole('button', { name: '寫回答案' }).click();
}

test('ENDED teacher confirms export and sees written and cleared counts only after server confirmation', async ({
  page,
  winningResultsProvider,
  guidedNotesSheets,
}) => {
  winningResultsProvider.snapshot = {
    status: 'READY',
    answers: [
      { questionId: '1', groupId: '1', answerText: '本次答案一' },
      { questionId: '2', groupId: '1', answers: [
        { placeholderNumber: 1, answerText: '題組二答案一' },
        { placeholderNumber: 2, answerText: '題組二答案二' },
      ] },
    ],
  };
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);
  await endActivity(page);

  await expect(page.getByText(/寫回完成/)).toHaveCount(0);
  await confirmExport(page);
  await expect(page.getByText(/寫回完成/)).toBeVisible();
  await expect(page.getByText('更新 3 格，清空 3 格')).toBeVisible();
  expect(guidedNotesSheets.writeBatches).toHaveLength(1);
  expect(guidedNotesSheets.exportBatches[0]?.writes.map((write) => [write.questionId, write.rowNumber, write.value]))
    .toEqual([
      ['1', 3, '本次答案一'],
      ['2', 4, '題組二答案一'],
      ['2', 5, '題組二答案二'],
      ['4', 7, ''],
      ['4', 8, ''],
      ['4', 9, ''],
    ]);
  expect(guidedNotesSheets.getCellState({
    spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1',
  }, 'A3').value).toBe('本次答案一');
  expect(guidedNotesSheets.getCellState({
    spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1',
  }, 'A5').value).toBe('題組二答案二');
  expect(guidedNotesSheets.getCellState({
    spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1',
  }, 'A4').value).toBe('題組二答案一');
  expect(guidedNotesSheets.getCellState({
    spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1',
  }, 'A5').value).toBe('題組二答案二');
});

test('confirmed export reuses anchored targets after value edits and rejects moved structure without another batch', async ({
  page,
  winningResultsProvider,
  guidedNotesSheets,
}) => {
  const worksheet = { spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1' };
  winningResultsProvider.snapshot = { status: 'READY', answers: [{
    questionId: '2', groupId: '1', answers: [
      { placeholderNumber: 1, answerText: 'first 1' },
      { placeholderNumber: 2, answerText: 'first 2' },
    ],
  }] };
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);
  await endActivity(page);

  await confirmExport(page);
  await expect(page.getByText(/寫回完成/)).toBeVisible();
  expect(guidedNotesSheets.exportBatches).toHaveLength(1);
  const firstAnchorIds = guidedNotesSheets.getDeveloperMetadata(worksheet).map((anchor) => anchor.metadataId);
  expect(firstAnchorIds).toHaveLength(9);

  guidedNotesSheets.setCellState(worksheet, 'A4', '教師編輯了目標答案格');
  winningResultsProvider.snapshot = { status: 'READY', answers: [{
    questionId: '2', groupId: '2', answers: [
      { placeholderNumber: 1, answerText: 'repeat 1' },
      { placeholderNumber: 2, answerText: 'repeat 2' },
    ],
  }] };
  await confirmExport(page);
  await expect(page.getByText('更新 2 格，清空 4 格')).toBeVisible();
  expect(guidedNotesSheets.exportBatches).toHaveLength(2);
  expect(guidedNotesSheets.exportBatches[1]?.writes.map((write) => write.rowNumber)).toContain(4);
  expect(guidedNotesSheets.exportBatches[1]?.anchors).toEqual([]);
  expect(guidedNotesSheets.getDeveloperMetadata(worksheet).map((anchor) => anchor.metadataId)).toEqual(firstAnchorIds);
  expect(guidedNotesSheets.getCellState(worksheet, 'A4').value).toBe('repeat 1');

  guidedNotesSheets.insertBlankRowBefore(worksheet, 5);
  await confirmExport(page);
  await expect(page.getByRole('alert')).toContainText('已移動');
  expect(guidedNotesSheets.exportBatches).toHaveLength(2);
});

test('confirmed export refuses to repeat when a persisted anchor is missing', async ({
  page,
  winningResultsProvider,
  guidedNotesSheets,
}) => {
  const worksheet = { spreadsheetId: 'e2e-valid-sheet', sheetId: 7, worksheetTitle: '工作表1' };
  winningResultsProvider.snapshot = { status: 'READY', answers: [{ questionId: '1', groupId: '1', answerText: 'winner' }] };
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);
  await endActivity(page);

  await confirmExport(page);
  expect(guidedNotesSheets.exportBatches).toHaveLength(1);
  const anchor = guidedNotesSheets.getDeveloperMetadata(worksheet)[0];
  expect(anchor?.metadataId).toBeDefined();
  guidedNotesSheets.removeDeveloperMetadata(worksheet, anchor!.metadataId!);

  await confirmExport(page);
  await expect(page.getByRole('alert')).toContainText('錨點已遺失');
  expect(guidedNotesSheets.exportBatches).toHaveLength(1);
});

test('ENDED teacher gets import guidance without calling results or Sheets when no worksheet was imported', async ({
  page,
  winningResultsProvider,
  guidedNotesSheets,
}) => {
  winningResultsProvider.snapshot = { status: 'READY', answers: [] };
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await endActivity(page);

  await confirmExport(page);
  await expect(page.getByRole('alert')).toContainText('尚未匯入學習單');
  expect(winningResultsProvider.callCount).toBe(0);
  expect(guidedNotesSheets.resolveRequests).toHaveLength(0);
  expect(guidedNotesSheets.requestedReadRanges).toHaveLength(0);
  expect(guidedNotesSheets.writeBatches).toHaveLength(0);
});

test('UNAVAILABLE winning results show guidance and do not write to Sheets', async ({
  page,
  winningResultsProvider,
  guidedNotesSheets,
}) => {
  winningResultsProvider.snapshot = { status: 'UNAVAILABLE', reason: 'NOT_READY' };
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);
  await endActivity(page);

  await confirmExport(page);
  await expect(page.getByRole('alert')).toContainText('尚未就緒');
  expect(winningResultsProvider.callCount).toBe(1);
  expect(guidedNotesSheets.writeBatches).toHaveLength(0);
});

test('export is blocked before ENDED', async ({ page, winningResultsProvider, guidedNotesSheets }) => {
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);

  await expect(page.getByRole('button', { name: '寫回答案' })).toBeDisabled();
  expect(winningResultsProvider.callCount).toBe(0);
  expect(guidedNotesSheets.resolveRequests).toHaveLength(0);
  expect(guidedNotesSheets.requestedReadRanges).toHaveLength(0);
  expect(guidedNotesSheets.writeBatches).toHaveLength(0);
});
