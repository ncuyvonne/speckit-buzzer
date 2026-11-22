import { test, expect } from './fixtures';

async function connected(page: import('@playwright/test').Page) {
  await page.goto('/');
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

async function join(page: import('@playwright/test').Page, groupId: string) {
  await connected(page);
  await page.getByLabel('學生組別').selectOption(groupId);
  await page.getByRole('button', { name: '加入組別' }).click();
  await expect(page.getByText(`已加入組別：${groupId}`)).toBeVisible();
}

test('shows only own accepted top-level question count during BUZZING', async ({ page }) => {
  const otherGroup = await page.context().newPage();
  await join(page, '1');
  await join(otherGroup, '2');
  const teacher = await page.context().newPage();
  await connected(teacher);
  await teacher.getByLabel('老師密碼').fill('e2e-teacher-password');
  await teacher.getByRole('button', { name: '老師登入' }).click();
  await teacher.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await teacher.getByLabel('工作表分頁名稱').fill('工作表1');
  await teacher.getByRole('button', { name: '匯入題號' }).click();
  await expect(teacher.getByText('題數：3')).toBeVisible();
  await teacher.getByRole('button', { name: '開始搶答' }).click();

  await expect(page.getByText('本組已送出 0 / 3')).toBeVisible();
  await otherGroup.getByLabel('答案').fill('other group secret');
  await otherGroup.getByRole('button', { name: '送出答案' }).click();
  await expect(otherGroup.getByText(/答案已接受並鎖定/)).toBeVisible();
  await expect(page.getByText('本組已送出 0 / 3')).toBeVisible();
  await expect(page.getByText('other group secret')).toHaveCount(0);

  await page.getByLabel('答案').fill('own answer');
  await page.getByRole('button', { name: '送出答案' }).click();
  await expect(page.getByText('本組已送出 1 / 3')).toBeVisible();
  await teacher.getByRole('button', { name: '結束活動' }).click();
  await expect(page.getByText('本組已送出')).toHaveCount(0);
  await Promise.all([otherGroup.close(), teacher.close()]);
});
