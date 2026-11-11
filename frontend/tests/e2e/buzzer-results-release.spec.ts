import { test, expect } from './fixtures';

test.use({ groupIds: '1,2,3,4' });

async function connected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

async function collectMessages(page: import('@playwright/test').Page, received: string[]) {
  page.on('websocket', (socket) => {
    socket.on('framereceived', (frame) => {
      if (typeof frame.payload === 'string') received.push(frame.payload);
    });
  });
}

test('ended students see only winner and own answers, and reload restores their result', async ({ browser }) => {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await connected(teacher);
  await teacher.getByLabel('老師密碼').fill('e2e-teacher-password');
  await teacher.getByRole('button', { name: '老師登入' }).click();
  await teacher.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await teacher.getByLabel('工作表分頁名稱').fill('工作表1');
  await teacher.getByRole('button', { name: '匯入題號' }).click();
  await expect(teacher.getByText('題數：3')).toBeVisible();

  const messagesA: string[] = [];
  const messagesB: string[] = [];
  const groupA = await browser.newPage();
  await collectMessages(groupA, messagesA);
  await groupA.goto('/');
  await connected(groupA);
  await groupA.getByLabel('學生組別').selectOption('1');
  await groupA.getByRole('button', { name: '加入組別' }).click();

  const groupB = await browser.newPage();
  await collectMessages(groupB, messagesB);
  await groupB.goto('/');
  await connected(groupB);
  await groupB.getByLabel('學生組別').selectOption('2');
  await groupB.getByRole('button', { name: '加入組別' }).click();

  const groupC = await browser.newPage();
  await groupC.goto('/');
  await connected(groupC);
  await groupC.getByLabel('學生組別').selectOption('3');
  await groupC.getByRole('button', { name: '加入組別' }).click();

  const groupD = await browser.newPage();
  await groupD.goto('/');
  await connected(groupD);
  await groupD.getByLabel('學生組別').selectOption('4');
  await groupD.getByRole('button', { name: '加入組別' }).click();

  await teacher.getByRole('button', { name: '開始搶答' }).click();
  for (const [page, answer] of [[groupA, 'winner answer'], [groupB, 'group B private'], [groupC, 'group C private']] as const) {
    await page.getByLabel('答案').fill(answer);
    await page.getByRole('button', { name: '送出答案' }).click();
    await expect(page.getByText(/答案已接受並鎖定/)).toBeVisible();
  }

  await groupB.reload();
  await connected(groupB);
  await expect(groupB.getByText('此題已鎖定。')).toBeVisible();
  await expect(groupB.getByLabel('答案')).toHaveValue('group B private');

  await teacher.getByRole('button', { name: '結束活動' }).click();
  await expect(groupA.getByText('勝出組別：1')).toBeVisible();
  await expect(groupB.getByText('勝出組別：1')).toBeVisible();
  await expect(groupC.getByText('本組答案：group C private')).toBeVisible();
  await expect(groupC.getByText('本組未勝出')).toBeVisible();
  await expect(groupB.getByText('本組答案：group B private')).toBeVisible();
  await expect(groupB.getByText('group C private')).toHaveCount(0);
  await expect(groupD.getByText('尚未作答').first()).toBeVisible();
  await expect(groupD.getByText('group B private')).toHaveCount(0);
  await expect(groupD.getByText('group C private')).toHaveCount(0);
  await expect.poll(() => messagesB.join('\n')).not.toContain('group C private');

  await groupA.reload();
  await connected(groupA);
  await expect(groupA.getByText('勝出組別：1')).toBeVisible();
  await expect(groupA.getByText('本組答案：winner answer')).toBeVisible();
  await expect.poll(() => messagesA.join('\n')).not.toContain('group B private');

  await Promise.all([groupA.close(), groupB.close(), groupC.close(), groupD.close(), teacher.close()]);
});
