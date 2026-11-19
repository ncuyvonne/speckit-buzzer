import { test, expect } from './fixtures';
import type { Page } from '@playwright/test';

const SELECTION_KEY = 'classroom.groupId';

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

async function reconnectTeacher(page: Page) {
  await expect(page.getByLabel('老師密碼')).toBeVisible();
  await waitForConnected(page);
  await loginTeacher(page);
}

test('same tab restores its group after reload and reconnect in all stages without age expiry', async ({ page, backend }) => {
  await page.clock.install({ time: new Date('2026-11-11T00:00:00Z') });
  await page.goto('/');
  await waitForConnected(page);
  await joinGroup(page, '1');
  expect(await page.evaluate((key) => sessionStorage.getItem(key), SELECTION_KEY)).toBe('1');

  await page.clock.fastForward(365 * 24 * 60 * 60 * 1_000);

  const teacher = await page.context().newPage();
  await teacher.goto('/');
  await waitForConnected(teacher);
  await loginTeacher(teacher);

  for (const [stage, nextAction] of [
    ['準備中', '開始搶答'],
    ['搶答中', '結束活動'],
    ['已結束', null],
  ] as const) {
    const currentStage = page.getByText(`活動階段：${stage}`);
    const joinedGroup = page.getByText('已加入組別：1');
    await expect(currentStage).toBeVisible();

    await test.step(`${stage}: reload restores the group and phase`, async () => {
      await page.reload();
      await waitForConnected(page);
      await expect(joinedGroup).toBeVisible();
      await expect(currentStage).toBeVisible();
    });

    await test.step(`${stage}: reconnect restores the group and phase`, async () => {
      const newConnection = page.waitForEvent('websocket', {
        predicate: (socket) => new URL(socket.url()).pathname === '/ws',
      });
      backend.disconnectClients();
      await newConnection;
      await waitForConnected(page);
      await expect(joinedGroup).toBeVisible();
      await expect(currentStage).toBeVisible();
    });

    if (nextAction !== null) {
      await reconnectTeacher(teacher);
      await teacher.getByRole('button', { name: nextAction }).click();
    }
  }
  await teacher.close();
});

test('same tab restores its group after reload when sessionStorage access is blocked', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, 'sessionStorage', {
      configurable: true,
      get() {
        throw new DOMException('Storage access is blocked', 'SecurityError');
      },
    });
  });

  await page.goto('/');
  await waitForConnected(page);
  await joinGroup(page, '1');
  await expect(page.getByText('已加入組別：1')).toBeVisible();

  await page.reload();
  await waitForConnected(page);
  await expect(page.getByText('已加入組別：1')).toBeVisible();
});

test('selection is tab-scoped and a reconnecting same-group student does not displace its peer', async ({ page, backend }) => {
  await page.goto('/');
  await waitForConnected(page);
  await joinGroup(page, '1');

  const peer = await page.context().newPage();
  await peer.goto('/');
  await waitForConnected(peer);
  expect(await peer.evaluate((key) => sessionStorage.getItem(key), SELECTION_KEY)).toBeNull();
  await joinGroup(peer, '1');

  const teacher = await page.context().newPage();
  await teacher.goto('/');
  await waitForConnected(teacher);
  await loginTeacher(teacher);

  let allowReconnect = false;
  await page.routeWebSocket('**/ws', (socket) => {
    if (allowReconnect) socket.connectToServer();
    else void socket.close({ code: 1012, reason: 'test offline' });
  });
  backend.disconnectFirstClient();
  await expect(page.getByRole('status')).toHaveText('正在重新連線');
  await teacher.getByRole('button', { name: '開始搶答' }).click();
  await expect(peer.getByText('活動階段：搶答中')).toBeVisible();
  await expect(peer.getByText('已加入組別：1')).toBeVisible();
  await expect(page.getByText('已加入組別：1')).toHaveCount(0);

  allowReconnect = true;
  await waitForConnected(page);
  await expect(page.getByText('已加入組別：1')).toBeVisible();
  await expect(page.getByText('活動階段：搶答中')).toBeVisible();
  await expect(peer.getByText('已加入組別：1')).toBeVisible();
  await teacher.close();
  await peer.close();
});

test.describe('missing and invalid stored student selections', () => {
  test.use({ groupIds: '2,3' });

  test('missing selection shows the picker; a server-rejected saved group is cleared', async ({ page }) => {
    await page.goto('/');
    await waitForConnected(page);
    await expect(page.getByLabel('學生組別')).toBeVisible();
    expect(await page.evaluate((key) => sessionStorage.getItem(key), SELECTION_KEY)).toBeNull();

    const restoredTab = await page.context().newPage();
    await restoredTab.addInitScript((key) => sessionStorage.setItem(key, '1'), SELECTION_KEY);
    await restoredTab.goto('/');
    await waitForConnected(restoredTab);
    await expect(restoredTab.getByLabel('學生組別')).toBeVisible();
    await expect(restoredTab.getByRole('alert')).toContainText('組別');
    expect(await restoredTab.evaluate((key) => sessionStorage.getItem(key), SELECTION_KEY)).toBeNull();
    await expect(restoredTab.getByText('活動階段：準備中')).toBeVisible();
    await restoredTab.close();
  });
});
