import { test, expect } from './fixtures';

async function connected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

test('teacher sees full live progress for the classroom within two seconds', async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await connected(teacher);
  await teacher.getByLabel('老師密碼').fill('e2e-teacher-password');
  await teacher.getByRole('button', { name: '老師登入' }).click();
  await teacher.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await teacher.getByLabel('工作表分頁名稱').fill('工作表1');
  await teacher.getByRole('button', { name: '匯入題號' }).click();
  await expect(teacher.getByText('題數：3')).toBeVisible();

  const students = await Promise.all(['1', '2', '3'].map(async (groupId) => {
    const page = await browser.newPage();
    await page.goto('/');
    await connected(page);
    await page.getByLabel('學生組別').selectOption(groupId);
    await page.getByRole('button', { name: '加入組別' }).click();
    await page.getByLabel('題目').selectOption('1');
    return page;
  }));

  await teacher.getByRole('button', { name: '開始搶答' }).click();
  const sentAt = Date.now();
  await students[0]!.getByLabel('答案').fill('組別 1 的答案');
  await students[0]!.getByRole('button', { name: '送出答案' }).click();
  await expect(teacher.getByText('目前成功組別：1；答案：組別 1 的答案', { exact: true })).toBeVisible();
  expect(Date.now() - sentAt).toBeLessThan(2_000);
  await expect(teacher.getByText('目前成功組別：1')).toBeVisible();
  await expect(teacher.getByText('組別 2：尚未提交').first()).toBeVisible();

  await Promise.all(students.map((page) => page.close()));
  await teacher.close();
});
