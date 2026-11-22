import { test, expect } from './fixtures';

async function connect(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

async function importWorksheet(page: import('@playwright/test').Page) {
  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByText('題數：3')).toBeVisible();
}

test('teacher marks, revises, and clears a winner; students see the live scoreboard and confirm reset', async ({ page }) => {
  const student = await page.context().newPage();
  await connect(page);
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
  await connect(student);
  await student.getByLabel('學生組別').selectOption('1');
  await student.getByRole('button', { name: '加入組別' }).click();
  await expect(student.getByText('已加入組別：1')).toBeVisible();
  await importWorksheet(page);

  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(student.getByText('本組已送出 0 / 3')).toBeVisible();
  await student.getByLabel('答案').fill('teacher decides correctness');
  await student.getByRole('button', { name: '送出答案' }).click();
  await expect(student.getByText(/答案已接受並鎖定/)).toBeVisible();
  await page.getByRole('button', { name: '結束活動' }).click();
  await expect(student.getByRole('heading', { name: '計分板' })).toBeVisible();

  const markedAt = Date.now();
  await page.getByRole('button', { name: '標記正確：1' }).click();
  await expect(page.getByRole('table', { name: '計分板' }).getByText('1 分')).toBeVisible();
  await expect(student.getByRole('table', { name: '計分板' }).getByText('1 分')).toBeVisible();
  expect(Date.now() - markedAt).toBeLessThan(1_000);

  await page.getByRole('button', { name: '標記錯誤：1' }).click();
  await expect(student.getByRole('table', { name: '計分板' }).getByRole('row').filter({ hasText: '組別 1' }).getByText('0 分')).toBeVisible();
  await page.getByRole('button', { name: '取消標記：1' }).click();
  await expect(page.getByText('目前判定：未標記')).toBeVisible();

  await page.getByRole('button', { name: '重設活動' }).click();
  const dialog = page.getByRole('dialog', { name: '確認重設活動' });
  await expect(dialog).toContainText('保留目前學習單、題目及公平順位設定');
  await expect(dialog).toContainText('清除本場作答、鎖定、成功結果、正誤標記及分數');
  await dialog.getByRole('button', { name: '取消' }).click();
  await expect(page.getByText('活動階段：已結束')).toBeVisible();

  await page.getByRole('button', { name: '重設活動' }).click();
  await page.getByRole('dialog', { name: '確認重設活動' }).getByRole('button', { name: '確認重設' }).click();
  await expect(page.getByText('活動階段：準備中')).toBeVisible();
  await expect(student.getByRole('heading', { name: '計分板' })).toHaveCount(0);
  await expect(page.getByRole('table', { name: '計分板' })).toHaveCount(0);
  await student.close();
});
