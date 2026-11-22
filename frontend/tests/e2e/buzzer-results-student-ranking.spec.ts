import { test, expect } from './fixtures';

async function connected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

async function join(page: import('@playwright/test').Page, groupId: string) {
  await page.goto('/');
  await connected(page);
  await page.getByLabel('學生組別').selectOption(groupId);
  await page.getByRole('button', { name: '加入組別' }).click();
  await expect(page.getByText(`已加入組別：${groupId}`)).toBeVisible();
}

test('after end students see full ranks but only winner and own answers; teacher sees all answers', async ({ browser }) => {
  const teacher = await browser.newPage();
  const studentA = await browser.newPage();
  const studentB = await browser.newPage();
  const studentC = await browser.newPage();
  try {
    await teacher.goto('/');
    await connected(teacher);
    await teacher.getByLabel('老師密碼').fill('e2e-teacher-password');
    await teacher.getByRole('button', { name: '老師登入' }).click();
    await teacher.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
    await teacher.getByLabel('工作表分頁名稱').fill('工作表1');
    await teacher.getByRole('button', { name: '匯入題號' }).click();
    await expect(teacher.getByText('題數：3')).toBeVisible();

    await Promise.all([join(studentA, '1'), join(studentB, '2'), join(studentC, '3')]);
    await teacher.getByRole('button', { name: '開始搶答' }).click();
    for (const [student, answer] of [[studentA, '勝出答案'], [studentB, '非勝出隱私答案']] as const) {
      await student.getByLabel('題目').selectOption('1');
      await student.getByLabel('答案').fill(answer);
      await student.getByRole('button', { name: '送出答案' }).click();
    }
    await expect(teacher.getByText('組別 2：第 2 名', { exact: true })).toBeVisible();
    await expect(studentC.getByText('非勝出隱私答案')).toHaveCount(0);
    await teacher.getByRole('button', { name: '結束活動' }).click();

    const studentResults = studentC.getByRole('region', { name: '本次搶答結果' });
    const questionOne = studentResults.locator('ol > li').first();
    await expect(questionOne.getByText('組別 1：第 1 名', { exact: true })).toBeVisible();
    await expect(questionOne.getByText('組別 2：第 2 名', { exact: true })).toBeVisible();
    await expect(questionOne.getByText('組別 3：未作答', { exact: true })).toBeVisible();
    await expect(questionOne.getByText('勝出答案')).toBeVisible();
    await expect(questionOne.getByText('非勝出隱私答案')).toHaveCount(0);
    await expect(questionOne.getByText('尚未作答')).toBeVisible();

    const studentBResults = studentB.getByRole('region', { name: '本次搶答結果' });
    await expect(studentBResults.getByText('非勝出隱私答案')).toBeVisible();
    const teacherResults = teacher.getByRole('region', { name: '搶答進度' });
    await expect(teacherResults.getByText('非勝出隱私答案')).toBeVisible();
  } finally {
    await Promise.all([teacher.close(), studentA.close(), studentB.close(), studentC.close()]);
  }
});
