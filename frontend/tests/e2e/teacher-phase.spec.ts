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

test('unauthorized phase responses show login guidance and leave the server stage unchanged', async ({ page }) => {
  let fakeFirstAuthentication = true;
  await page.routeWebSocket('**/ws', (clientSocket) => {
    const serverSocket = clientSocket.connectToServer();
    clientSocket.onMessage((message) => {
      const request = JSON.parse(String(message)) as { type?: string; requestId?: string };
      if (request.type === 'teacher.authenticate' && fakeFirstAuthentication) {
        // Simulate a browser that still shows teacher controls while the server connection is unauthenticated.
        fakeFirstAuthentication = false;
        clientSocket.send(JSON.stringify({
          type: 'teacher.authenticated',
          requestId: request.requestId,
          payload: { ok: true },
        }));
        return;
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => clientSocket.send(message));
  });

  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await expect(page.getByRole('button', { name: '開始搶答' })).toBeVisible();

  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByRole('alert')).toContainText('請先以老師密碼登入');
  await expect(page.getByText('活動階段：準備中')).toBeVisible();
  await expect(page.getByRole('button', { name: '開始搶答' })).toHaveCount(0);
  await expect(page.getByLabel('老師密碼')).toBeVisible();

  await loginTeacher(page);
  await expect(page.getByRole('button', { name: '開始搶答' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
  await expect(page.getByText('活動階段：準備中')).toBeVisible();

  const serverStage = await page.evaluate(async () => {
    const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
    return await new Promise<string>((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error('No authoritative snapshot')), 2_000);
      socket.addEventListener('message', (event) => {
        const message = JSON.parse(String(event.data)) as { type: string; payload?: { stage?: string } };
        if (message.type === 'activity.snapshot' && typeof message.payload?.stage === 'string') {
          window.clearTimeout(timeout);
          socket.close();
          resolve(message.payload.stage);
        }
      });
    });
  });
  expect(serverStage).toBe('PREPARING');
});

test('AUTH_REQUIRED preserves the joined student role and saved group', async ({ page }) => {
  let injectedUnauthorizedAdvance = false;
  await page.routeWebSocket('**/ws', (clientSocket) => {
    const serverSocket = clientSocket.connectToServer();
    clientSocket.onMessage((message) => serverSocket.send(message));
    serverSocket.onMessage((message) => {
      const response = JSON.parse(String(message)) as { type?: string };
      clientSocket.send(message);
      if (response.type === 'student.joined' && !injectedUnauthorizedAdvance) {
        injectedUnauthorizedAdvance = true;
        serverSocket.send(JSON.stringify({
          type: 'activity.advance',
          requestId: 'student-unauthorized-advance',
          payload: { from: 'PREPARING', to: 'BUZZING' },
        }));
      }
    });
  });

  await page.goto('/');
  await waitForConnected(page);
  await page.getByLabel('學生組別').selectOption('1');
  await page.getByRole('button', { name: '加入組別' }).click();

  await expect(page.getByRole('alert')).toContainText('請先以老師密碼登入');
  await expect(page.getByRole('heading', { name: '學生畫面' })).toBeVisible();
  await expect(page.getByText('已加入組別：1')).toBeVisible();
  await expect(page.getByText('活動階段：準備中')).toBeVisible();
  expect(await page.evaluate(() => sessionStorage.getItem('classroom.groupId'))).toBe('1');
  expect(injectedUnauthorizedAdvance).toBe(true);
});

test('stage transition conflicts show corrective feedback without changing the displayed stage', async ({ page }) => {
  const invalidTransitions = [
    { from: 'BUZZING', to: 'ENDED' },
    { from: 'PREPARING', to: 'ENDED' },
    { from: 'BUZZING', to: 'PREPARING' },
  ];
  let nextTransition = 0;
  let conflictResponses = 0;

  await page.routeWebSocket('**/ws', (clientSocket) => {
    const serverSocket = clientSocket.connectToServer();
    clientSocket.onMessage((message) => {
      const request = JSON.parse(String(message)) as {
        type?: string;
        requestId?: string;
        payload?: unknown;
      };
      if (request.type === 'activity.advance' && nextTransition < invalidTransitions.length) {
        serverSocket.send(JSON.stringify({
          ...request,
          payload: invalidTransitions[nextTransition++],
        }));
        return;
      }
      serverSocket.send(message);
    });
    serverSocket.onMessage((message) => {
      const response = JSON.parse(String(message)) as { payload?: { code?: string } };
      if (response.payload?.code === 'STAGE_CONFLICT') conflictResponses += 1;
      clientSocket.send(message);
    });
  });

  await page.goto('/');
  await waitForConnected(page);
  await loginTeacher(page);
  await expect(page.getByText('活動階段：準備中')).toBeVisible();

  for (const expectedCount of [1, 2, 3]) {
    await page.getByRole('button', { name: '開始搶答' }).click();
    await expect.poll(() => conflictResponses).toBe(expectedCount);
    await expect(page.getByRole('alert')).toContainText('依目前階段重新操作');
    await expect(page.getByText('活動階段：準備中')).toBeVisible();
  }

  expect(nextTransition).toBe(invalidTransitions.length);

  await page.getByRole('button', { name: '開始搶答' }).click();
  await expect(page.getByText('活動階段：搶答中')).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
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
