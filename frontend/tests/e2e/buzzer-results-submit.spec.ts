import { test, expect } from './fixtures';

async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(page.getByText('已連線', { exact: true })).toBeVisible();
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

test('a student answer immediately locks the same question for every connected group member', async ({ browser }) => {
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

  await expect(secondStudent.getByLabel('答案')).toBeDisabled();
  await expect(secondStudent.getByLabel('答案')).toHaveValue('第一位同學的答案');
  await expect(secondStudent.getByRole('button', { name: '送出答案' })).toBeDisabled();
  await expect(secondStudent.getByText('此題已鎖定。')).toBeVisible();
  await expect(secondStudent.getByText('第二位同學的答案')).toHaveCount(0);

  await firstStudent.close();
  await secondStudent.close();
  await teacher.close();
});

test('a student can switch to another question after the current question is locked', async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await waitForConnected(teacher);
  await importQuestions(teacher);

  const student = await browser.newPage();
  await student.goto('/');
  await waitForConnected(student);
  await student.getByLabel('學生組別').selectOption('1');
  await student.getByRole('button', { name: '加入組別' }).click();
  await student.getByLabel('題目').selectOption('1');
  await student.getByLabel('答案').fill('第一題答案');
  await student.getByRole('button', { name: '送出答案' }).click();
  await expect(student.getByText(/答案已接受並鎖定/)).toBeVisible();

  await student.getByLabel('題目').selectOption('2');
  await student.getByLabel('子題 1 答案').fill('第二題答案一');
  await student.getByLabel('子題 2 答案').fill('第二題答案二');
  await student.getByRole('button', { name: '送出答案' }).click();
  await expect(student.getByText(/答案已接受並鎖定/)).toContainText('第二題答案一；第二題答案二');

  await student.close();
  await teacher.close();
});

test('a grouped answer keeps partial drafts, locks the complete vector once, and restores it after rejoin', async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await waitForConnected(teacher);
  await importQuestions(teacher);

  const student = await browser.newPage();
  await student.goto('/');
  await waitForConnected(student);
  await student.getByLabel('學生組別').selectOption('1');
  await student.getByRole('button', { name: '加入組別' }).click();
  await student.getByLabel('題目').selectOption('2');
  const answer1 = student.getByLabel('子題 1 答案');
  const answer2 = student.getByLabel('子題 2 答案');
  await answer1.fill('第一個答案');
  await student.getByRole('button', { name: '送出答案' }).click();
  await expect(student.getByRole('alert')).toContainText('尚未填寫');
  await expect(answer1).toHaveValue('第一個答案');
  await expect(answer2).toHaveValue('');

  await answer2.fill('第二個答案');
  await answer1.fill('甲'.repeat(6_000));
  await student.getByRole('button', { name: '送出答案' }).click();
  await expect(student.getByRole('alert')).toContainText('16 KiB');
  await expect(answer1).toHaveValue('甲'.repeat(6_000));
  await expect(answer2).toHaveValue('第二個答案');
  await answer1.fill('第一個答案');
  await student.getByRole('button', { name: '送出答案' }).click();
  await expect(student.getByRole('status').filter({ hasText: '答案已接受並鎖定' })).toBeVisible();
  await expect(answer1).toBeDisabled();
  await expect(answer2).toBeDisabled();
  await expect(answer1).toHaveValue('第一個答案');
  await expect(answer2).toHaveValue('第二個答案');
  await expect(teacher.getByText('目前成功組別：1；答案：第一個答案；第二個答案')).toBeVisible();

  await student.reload();
  await waitForConnected(student);
  await expect(student.getByRole('heading', { name: '學生搶答' })).toBeVisible();
  await student.getByLabel('題目').selectOption('2');
  await expect(student.getByLabel('子題 1 答案')).toBeDisabled();
  await expect(student.getByLabel('子題 2 答案')).toBeDisabled();
  await expect(student.getByLabel('子題 1 答案')).toHaveValue('第一個答案');
  await expect(student.getByLabel('子題 2 答案')).toHaveValue('第二個答案');

  await teacher.getByRole('button', { name: '結束活動' }).click();
  await expect(student.getByText('勝出組別：1；勝出答案：第一個答案；第二個答案')).toBeVisible();
  await expect(student.getByText('本組答案：第一個答案；第二個答案')).toBeVisible();

  await student.close();
  await teacher.close();
});

test('group packets honor the exact 16 KiB UTF-8 limit and keep an oversized draft editable', async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await waitForConnected(teacher);
  await importQuestions(teacher);

  const requestId = '123e4567-e89b-12d3-a456-426614174000';
  const prefix = '中文「答案」"\\\n';
  function answerForBytes(targetBytes: number): string {
    const template = {
      type: 'buzzerResults.submitAnswer',
      requestId,
      payload: {
        questionId: '2',
        subAnswers: [
          { placeholderNumber: 1, answerText: prefix },
          { placeholderNumber: 2, answerText: '第二格' },
        ],
      },
    };
    const baseBytes = new TextEncoder().encode(JSON.stringify(template)).byteLength;
    return `${prefix}${'x'.repeat(targetBytes - baseBytes)}`;
  }
  const exactAnswer = answerForBytes(16_384);
  const oversizedAnswer = answerForBytes(16_385);

  const firstStudent = await browser.newPage();
  await firstStudent.goto('/');
  await waitForConnected(firstStudent);
  await firstStudent.getByLabel('學生組別').selectOption('1');
  await firstStudent.getByRole('button', { name: '加入組別' }).click();
  await firstStudent.getByLabel('題目').selectOption('2');
  await firstStudent.getByLabel('子題 1 答案').fill(exactAnswer);
  await firstStudent.getByLabel('子題 2 答案').fill('第二格');
  const exactWire = {
    type: 'buzzerResults.submitAnswer',
    requestId,
    payload: {
      questionId: '2',
      subAnswers: [
        { placeholderNumber: 1, answerText: exactAnswer },
        { placeholderNumber: 2, answerText: '第二格' },
      ],
    },
  };
  expect(new TextEncoder().encode(JSON.stringify(exactWire)).byteLength).toBe(16_384);
  await firstStudent.getByRole('button', { name: '送出答案' }).click();
  await expect(firstStudent.getByLabel('子題 1 答案')).toBeDisabled();
  await expect(teacher.getByText('目前成功組別：1')).toBeVisible();

  const secondStudent = await browser.newPage();
  await secondStudent.goto('/');
  await waitForConnected(secondStudent);
  await secondStudent.getByLabel('學生組別').selectOption('2');
  await secondStudent.getByRole('button', { name: '加入組別' }).click();
  await secondStudent.getByLabel('題目').selectOption('2');
  await secondStudent.getByLabel('子題 1 答案').fill(oversizedAnswer);
  await secondStudent.getByLabel('子題 2 答案').fill('第二格');
  const oversizedWire = { ...exactWire, payload: { ...exactWire.payload, subAnswers: [
    { placeholderNumber: 1, answerText: oversizedAnswer },
    { placeholderNumber: 2, answerText: '第二格' },
  ] } };
  expect(new TextEncoder().encode(JSON.stringify(oversizedWire)).byteLength).toBe(16_385);
  await secondStudent.getByRole('button', { name: '送出答案' }).click();
  await expect(secondStudent.getByRole('alert')).toContainText('16 KiB');
  await expect(secondStudent.getByLabel('子題 1 答案')).toHaveValue(oversizedAnswer);
  await expect(secondStudent.getByLabel('子題 2 答案')).toHaveValue('第二格');
  await secondStudent.getByLabel('子題 1 答案').fill('縮短後的答案');
  await secondStudent.getByRole('button', { name: '送出答案' }).click();
  await expect(secondStudent.getByLabel('子題 1 答案')).toBeDisabled();

  await firstStudent.close();
  await secondStudent.close();
  await teacher.close();
});
