import { test, expect } from './fixtures';

async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toContainText('已連線');
}

async function loginTeacher(page: import('@playwright/test').Page) {
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
}

test('teacher imports displayed IDs from a dynamically located row and column order', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);

  await expect(page.getByRole('heading', { name: 'Guided Notes' })).toBeVisible();
  await expect(page.getByText('題數：0')).toBeVisible();
  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();

  await expect(page.getByText('題數：3')).toBeVisible();
  await expect(page.getByRole('list', { name: '已匯入題號' }).locator('li')).toHaveText(['1', '2', '4']);
  const displayedIds = await page.getByRole('list', { name: '已匯入題號' }).locator('li').allTextContents();
  expect(displayedIds).toEqual(['1', '2', '4']);
  await expect(page.getByText('第一題說明')).toHaveCount(0);
});

test('invalid header layout displays repair guidance without replacing the imported list', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);

  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByText('題數：3')).toBeVisible();

  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-invalid-sheet/edit');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByRole('alert')).toContainText('標題');
  await expect(page.getByText('題數：3')).toBeVisible();
  await expect(page.getByRole('list', { name: '已匯入題號' }).locator('li')).toHaveText(['1', '2', '4']);
});

test('a joined student cannot import and the Sheets adapter is not called', async ({ page, guidedNotesSheets }) => {
  await page.goto('/');
  const errorCode = await page.evaluate(async () => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    return await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No student authorization response')), 2_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'student.join', requestId: 'e2e-student-join', payload: { groupId: '1' },
      })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type?: string; payload?: { code?: string } };
        if (message.type === 'student.joined') {
          socket.send(JSON.stringify({
            type: 'guidedNotes.import', requestId: 'e2e-student-import',
            payload: {
              spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit',
              worksheetTitle: '工作表1',
            },
          }));
        }
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          socket.close();
          resolve(message.payload?.code ?? 'missing-code');
        }
      });
    });
  });

  expect(errorCode).toBe('AUTH_REQUIRED');
  expect(guidedNotesSheets.resolveRequests).toHaveLength(0);
  expect(guidedNotesSheets.requestedReadRanges).toHaveLength(0);
});
