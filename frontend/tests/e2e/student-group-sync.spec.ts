import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

async function waitForConnected(page: Page) {
  await expect(page.getByRole('status')).toContainText('已連線');
}

async function joinGroup(page: Page, groupId: string) {
  await page.getByLabel('學生組別').selectOption(groupId);
  await page.getByRole('button', { name: '加入組別' }).click();
  await expect(page.getByText(`已加入組別：${groupId}`)).toBeVisible();
}

async function loginTeacher(page: Page) {
  await page.getByLabel('老師密碼').fill('e2e-teacher-password');
  await page.getByRole('button', { name: '老師登入' }).click();
  await expect(page.getByRole('heading', { name: '老師控制台' })).toBeVisible();
}

test('students can join configured groups and receive teacher phase broadcasts', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await joinGroup(page, '1');

  const secondStudent = await page.context().newPage();
  const thirdStudent = await page.context().newPage();
  const teacher = await page.context().newPage();
  await Promise.all([secondStudent.goto('/'), thirdStudent.goto('/'), teacher.goto('/')]);
  await Promise.all([waitForConnected(secondStudent), waitForConnected(thirdStudent), waitForConnected(teacher)]);
  await joinGroup(secondStudent, '1');
  await joinGroup(thirdStudent, '2');
  await loginTeacher(teacher);

  const started = Date.now();
  await teacher.getByRole('button', { name: '開始搶答' }).click();
  for (const studentPage of [page, secondStudent, thirdStudent]) {
    await expect(studentPage.getByText('活動階段：搶答中')).toBeVisible();
  }
  expect(Date.now() - started).toBeLessThan(2_000);

  await Promise.all([secondStudent.close(), thirdStudent.close(), teacher.close()]);
});

test('the server rejects an unknown group with GROUP_INVALID and leaves the activity unchanged', async ({ page }) => {
  await page.goto('/');
  const response = await page.evaluate(async () => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    return await new Promise<{ code: string; stage: string | null }>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No group validation response')), 2_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'student.join', requestId: 'invalid-group', payload: { groupId: 'not-configured' },
      })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; payload?: { code?: string; stage?: string } };
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          socket.close();
          resolve({ code: message.payload?.code ?? 'missing-code', stage: null });
        }
      });
    });
  });
  expect(response.code).toBe('GROUP_INVALID');
  await expect(page.getByText('活動階段：準備中')).toBeVisible();
});

test('a joined student connection cannot authenticate as teacher or advance the activity', async ({ page }) => {
  await page.goto('/');
  const results = await page.evaluate(async () => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    return await new Promise<string[]>((resolve, reject) => {
      const errors: string[] = [];
      const timeout = window.setTimeout(() => reject(new Error('Student role checks did not finish')), 2_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'student.join', requestId: 'join-as-student', payload: { groupId: '1' },
      })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; payload?: { code?: string } };
        if (message.type === 'student.joined') {
          socket.send(JSON.stringify({ type: 'teacher.authenticate', requestId: 'student-auth', payload: { password: 'e2e-teacher-password' } }));
        } else if (message.type === 'error' && message.payload?.code === 'INVALID_MESSAGE') {
          errors.push(message.payload.code);
          socket.send(JSON.stringify({ type: 'activity.advance', requestId: 'student-advance', payload: { from: 'PREPARING', to: 'BUZZING' } }));
        } else if (message.type === 'error' && message.payload?.code === 'AUTH_REQUIRED') {
          errors.push(message.payload.code);
          window.clearTimeout(timeout);
          socket.close();
          resolve(errors);
        }
      });
    });
  });
  expect(results).toEqual(['INVALID_MESSAGE', 'AUTH_REQUIRED']);
  await expect(page.getByText('活動階段：準備中')).toBeVisible();
});

test.describe('students can join when teacher password is not configured', () => {
  test.use({ teacherPassword: null });

  test('valid student join works while teacher login remains unavailable', async ({ page }) => {
    await page.goto('/');
    await waitForConnected(page);
    await joinGroup(page, '2');
    const teacher = await page.context().newPage();
    await teacher.goto('/');
    await waitForConnected(teacher);
    await teacher.getByLabel('老師密碼').fill('some-password');
    await teacher.getByRole('button', { name: '老師登入' }).click();
    await expect(teacher.getByRole('alert')).toContainText(/設定|本機/);
    await expect(page.getByText('已加入組別：2')).toBeVisible();
    await teacher.close();
  });
});
