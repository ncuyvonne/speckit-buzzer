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

test('transient worksheet read is retried and the teacher can complete the import', async ({
  page,
  guidedNotesSheets,
}) => {
  guidedNotesSheets.failReadsRemaining = 1;
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);

  await expect(page.getByText('題數：3')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  expect(guidedNotesSheets.requestedReadRanges).toHaveLength(2);
});

test('exhausted transient reads show a next step and do not replace the imported list', async ({
  page,
  guidedNotesSheets,
}) => {
  guidedNotesSheets.failReadsRemaining = 3;
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);

  await expect(page.getByRole('alert')).toContainText('檢查網路或存取權限後再試');
  await expect(page.getByText('題數：0')).toBeVisible();
  expect(guidedNotesSheets.requestedReadRanges).toHaveLength(3);
});

test('definite write rejection shows editor-permission guidance and no success state after retries', async ({
  page,
  guidedNotesSheets,
  winningResultsProvider,
}) => {
  winningResultsProvider.snapshot = {
    status: 'READY',
    answers: [{ questionId: '1', groupId: '1', answerText: '答案一' }],
  };
  guidedNotesSheets.writeFailures.push(
    { kind: 'DEFINITE_REJECTION' },
    { kind: 'DEFINITE_REJECTION' },
    { kind: 'DEFINITE_REJECTION' },
  );
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);
  await expect(page.getByText('題數：3')).toBeVisible();
  await endActivity(page);

  await confirmExport(page);
  await expect(page.getByRole('alert')).toContainText('編輯權限');
  await expect(page.getByText(/寫回完成/)).toHaveCount(0);
  expect(guidedNotesSheets.writeBatches).toHaveLength(3);
});

test('unconfirmed batch write tells the teacher to inspect the sheet and never shows success', async ({
  page,
  guidedNotesSheets,
  winningResultsProvider,
}) => {
  winningResultsProvider.snapshot = {
    status: 'READY',
    answers: [{ questionId: '1', groupId: '1', answerText: '答案一' }],
  };
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await importWorksheet(page);
  await expect(page.getByText('題數：3')).toBeVisible();
  await endActivity(page);
  guidedNotesSheets.nextWriteFailure = {
    kind: 'LOST_RESPONSE', commit: 'NONE', readBack: 'UNAVAILABLE',
  };

  await confirmExport(page);
  await expect(page.getByRole('alert')).toContainText('結果未確認');
  await expect(page.getByRole('alert')).toContainText('可能已套用或仍會完成');
  await expect(page.getByText(/寫回完成/)).toHaveCount(0);
  expect(guidedNotesSheets.writeBatches).toHaveLength(1);
});
