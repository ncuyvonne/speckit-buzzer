import { readFile } from 'node:fs/promises';
import { test, expect } from './fixtures';

test('teacher downloads UTF-8 BOM CSV with Traditional Chinese headers and unanswered rows', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('status')).toContainText('已連線');
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByText('題數：3')).toBeVisible();
  await page.getByRole('button', { name: '開始搶答' }).click();
  await page.getByRole('button', { name: '結束活動' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: '匯出 CSV' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/^buzzer-results-.*\.csv$/);
  const filePath = await download.path();
  expect(filePath).not.toBeNull();
  const content = await readFile(filePath!);
  expect([...content.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
  const csv = content.toString('utf8');
  expect(csv).toContain('題號,成功組別,成功答案,組別,組別答案,搶答順位');
  expect(csv).toContain('1,,,1,,');
  expect(csv).toContain('\r\n');
});
