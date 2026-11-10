import { test, expect } from './fixtures';

async function waitForConnected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status')).toContainText('已連線');
}

async function loginTeacher(page: import('@playwright/test').Page, password = 'e2e-teacher-password') {
  await page.getByLabel('老師密碼').fill(password);
  await page.getByRole('button', { name: '老師登入' }).click();
}

test('teacher login advances both phases and updates from the server broadcast within two seconds', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await expect(page.getByText('活動階段：準備中')).toBeVisible();
  await loginTeacher(page);
  await expect(page.getByRole('button', { name: '開始搶答' })).toBeVisible();

  const startAt = Date.now();
  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText('活動階段：搶答中')).toBeVisible();
  expect(Date.now() - startAt).toBeLessThan(2_000);

  await page.getByRole('button', { name: '結束活動' }).click();
  await expect(page.getByText('活動階段：已結束')).toBeVisible();
});

test('incorrect credentials grant no teacher control and the error does not reveal the password', async ({ page }) => {
  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page, 'wrong-secret-value');
  await expect(page.getByRole('alert')).toContainText('密碼');
  await expect(page.getByRole('alert')).not.toContainText('wrong-secret-value');
  await expect(page.getByRole('button', { name: '開始搶答' })).toHaveCount(0);
});

test('an unauthenticated phase command is rejected by the backend', async ({ page }) => {
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const url = `${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`;
    const socket = new WebSocket(url);
    return await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No authorization response')), 2_000);
      socket.addEventListener('open', () => socket.send(JSON.stringify({
        type: 'activity.advance', requestId: 'browser-unauth', payload: { from: 'PREPARING', to: 'BUZZING' },
      })));
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; payload?: { code?: string } };
        if (message.type === 'error') {
          window.clearTimeout(timeout);
          socket.close();
          resolve(message.payload?.code ?? 'missing-code');
        }
      });
    });
  });
  expect(result).toBe('AUTH_REQUIRED');
});

test.describe('teacher login configuration', () => {
  test.use({ teacherPassword: null });

  test('shows a configuration hint when the password is unavailable', async ({ page }) => {
    await page.goto('/');
    await waitForConnected(page);
    await loginTeacher(page);
    await expect(page.getByRole('alert')).toContainText(/設定|本機/);
    await expect(page.getByRole('button', { name: '開始搶答' })).toHaveCount(0);
  });
});

test.describe('teacher reconnection and reload', () => {
  for (const targetStage of ['BUZZING', 'ENDED'] as const) {
    test(`${targetStage}: reconnect and reload require the password again`, async ({ page, backend }) => {
      await page.goto('/');
      await waitForConnected(page);
      await loginTeacher(page);
      await page.getByRole('button', { name: '開始搶答' }).click();
      if (targetStage === 'ENDED') await page.getByRole('button', { name: '結束活動' }).click();
      const label = targetStage === 'ENDED' ? '已結束' : '搶答中';
      await expect(page.getByText(`活動階段：${label}`)).toBeVisible();

      backend.disconnectClients();
      await expect(page.getByLabel('老師密碼')).toBeVisible({ timeout: 10_000 });
      await waitForConnected(page);
      await expect(page.getByLabel('老師密碼')).toBeVisible();
      await loginTeacher(page);
      await expect(page.getByText(`活動階段：${label}`)).toBeVisible();

      await page.reload();
      await waitForConnected(page);
      await expect(page.getByLabel('老師密碼')).toBeVisible();
      await expect(page.getByText(`活動階段：${label}`)).toBeVisible();
      await loginTeacher(page);
      await expect(page.getByText(`活動階段：${label}`)).toBeVisible();
    });
  }
});
