import { test, expect } from './fixtures';

async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toContainText('已連線');
}

async function loginTeacher(page: import('@playwright/test').Page) {
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
}

async function joinStudent(page: import('@playwright/test').Page) {
  await page.goto('/');
  await waitForConnected(page);
  await page.getByLabel('學生組別').selectOption('1');
  await page.getByRole('button', { name: '加入組別' }).click();
  await expect(page.getByText('已加入組別：1')).toBeVisible();
}

async function setLimit(page: import('@playwright/test').Page, seconds: number) {
  const input = page.getByLabel('搶答時限（秒）');
  await input.fill(String(seconds));
  await page.getByRole('button', { name: '設定時限' }).click();
  if (seconds === 0) await expect(page.getByText('目前設定：不限時')).toBeVisible();
  else await expect(page.getByText(`目前設定：${seconds} 秒`)).toBeVisible();
}

test('rejects out-of-range and fractional limits with guidance and keeps the current setting', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  const input = page.getByLabel('搶答時限（秒）');
  await input.fill('3601');
  await page.getByRole('button', { name: '設定時限' }).click();
  await expect(page.getByRole('alert')).toContainText('0 至 3600 的整數');
  await expect(page.getByText('目前設定：不限時')).toBeVisible();
  await input.fill('1.5');
  await page.getByRole('button', { name: '設定時限' }).click();
  await expect(page.getByRole('alert')).toContainText('0 至 3600 的整數');
  await expect(page.getByText('目前設定：不限時')).toBeVisible();
});

test('teacher and student see the countdown and automatic end; late answers are rejected', async ({ page }) => {
  const student = await page.context().newPage();
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await joinStudent(student);

  await page.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await page.getByLabel('工作表分頁名稱').fill('工作表1');
  await page.getByRole('button', { name: '匯入題號' }).click();
  await expect(page.getByText('題數：3')).toBeVisible();

  await setLimit(page, 2);
  const startAt = Date.now();
  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText(/剩餘時間：\d+ 秒/)).toBeVisible();
  await expect(student.getByText(/剩餘時間：\d+ 秒/)).toBeVisible();
  await expect(page.getByText('活動階段：已結束')).toBeVisible({ timeout: 4_000 });
  await expect(student.getByText('活動階段：已結束')).toBeVisible({ timeout: 4_000 });
  expect(Date.now() - startAt).toBeLessThan(3_500);

  const lateError = await student.evaluate(async () => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    return await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No late-answer rejection')), 2_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'student.join', requestId: 'late-join', payload: { groupId: '1' },
      })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; requestId?: string; payload?: { code?: string } };
        if (message.type === 'student.joined') {
          socket.send(JSON.stringify({
            type: 'buzzerResults.submitAnswer', requestId: 'late-e2e', payload: { questionId: '1', answerText: '遲到答案' },
          }));
        } else if (message.type === 'error' && message.requestId === 'late-e2e') {
          window.clearTimeout(timeout);
          socket.close();
          resolve(message.payload?.code ?? 'missing-code');
        }
      });
    });
  });
  expect(lateError).toBe('STAGE_CONFLICT');
  await student.close();
});

test('zero seconds remains unlimited', async ({ page }) => {
  const student = await page.context().newPage();
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await joinStudent(student);
  await setLimit(page, 0);
  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText('不限時', { exact: true })).toBeVisible();
  await expect(student.getByText('不限時', { exact: true })).toBeVisible();
  await page.waitForTimeout(1_100);
  await expect(page.getByText('活動階段：搶答中')).toBeVisible();
  await student.close();
});

test('teacher can manually end a timed round before its deadline', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await setLimit(page, 5);
  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText(/剩餘時間：\d+ 秒/)).toBeVisible();
  await page.getByRole('button', { name: '結束活動' }).click();
  await expect(page.getByText('活動階段：已結束')).toBeVisible();
  await expect(page.getByText(/剩餘時間：\d+ 秒/)).toHaveCount(0);
});
