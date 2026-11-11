import { test, expect } from './fixtures';

async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toContainText('已連線');
}

async function loginTeacher(page: import('@playwright/test').Page) {
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
}

async function importQuestions(page: import('@playwright/test').Page) {
  await loginTeacher(page);
  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByText('題數：3')).toBeVisible();
  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText('活動階段：搶答中')).toBeVisible();
}

test('a student answer is accepted and locked, and a second member of the group gets corrective feedback', async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await waitForConnected(teacher);
  await importQuestions(teacher);

  const firstStudent = await browser.newPage();
  await firstStudent.goto('/');
  await waitForConnected(firstStudent);
  await firstStudent.getByLabel('學生組別').selectOption('1');
  await firstStudent.getByRole('button', { name: '加入組別' }).click();
  await expect(firstStudent.getByRole('heading', { name: '學生畫面' })).toBeVisible();
  await firstStudent.getByLabel('題目').selectOption('1');

  const secondStudent = await browser.newPage();
  await secondStudent.goto('/');
  await waitForConnected(secondStudent);
  await secondStudent.getByLabel('學生組別').selectOption('1');
  await secondStudent.getByRole('button', { name: '加入組別' }).click();
  await secondStudent.getByLabel('題目').selectOption('1');

  await firstStudent.getByLabel('答案').fill('第一位同學的答案');
  await firstStudent.getByRole('button', { name: '送出答案' }).click();
  await expect(firstStudent.getByText(/答案已接受並鎖定/)).toBeVisible();

  await secondStudent.getByLabel('答案').fill('第二位同學的答案');
  await secondStudent.getByRole('button', { name: '送出答案' }).click();
  await expect(secondStudent.getByRole('alert')).toContainText('鎖定');
  await expect(secondStudent.getByText('第二位同學的答案')).toHaveCount(0);

  await firstStudent.close();
  await secondStudent.close();
  await teacher.close();
});
