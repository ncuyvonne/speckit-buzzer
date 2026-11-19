import { test as base, expect } from './fixtures';

const configuredGroupIds = process.env.PLAYWRIGHT_GROUP_IDS ?? process.env.GROUP_IDS ?? '1,2,3';
const groupIds = configuredGroupIds.split(',').map((groupId) => groupId.trim()).filter(Boolean);
base.use({ groupIds: configuredGroupIds });

async function connected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

async function createTeacher(browser: import('@playwright/test').Browser, fairnessDelay?: string) {
  const teacher = await browser.newPage();
  await teacher.goto('/');
  await connected(teacher);
  await teacher.getByLabel('老師密碼').fill('e2e-teacher-password');
  await teacher.getByRole('button', { name: '老師登入' }).click();
  await teacher.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await teacher.getByLabel('工作表分頁名稱').fill('工作表1');
  await teacher.getByRole('button', { name: '匯入題號' }).click();
  await expect(teacher.getByText('題數：3')).toBeVisible();
  if (fairnessDelay !== undefined) {
    await teacher.getByLabel('啟用公平順位').check();
    await teacher.getByLabel('每次成功題數增加延遲（秒）').fill(fairnessDelay);
    await teacher.getByRole('button', { name: '儲存順位設定' }).click();
    await expect(teacher.getByRole('button', { name: '開始搶答' })).toBeEnabled();
  }
  return teacher;
}

async function createStudent(browser: import('@playwright/test').Browser, groupId: string) {
  const student = await browser.newPage();
  await student.goto('/');
  await connected(student);
  await student.getByLabel('學生組別').selectOption(groupId);
  await student.getByRole('button', { name: '加入組別' }).click();
  await expect(student.getByText(`已加入組別：${groupId}`)).toBeVisible();
  return student;
}

base('fairness off: server receive order updates every configured group within two seconds', async ({ browser }, testInfo) => {
  expect(groupIds.length).toBeGreaterThan(0);
  const teacher = await createTeacher(browser);
  const students: import('@playwright/test').Page[] = [];
  const measurements: Array<{ groupId: string; rank: number; winningGroupId: string; latencyMs: number }> = [];

  try {
    for (const groupId of groupIds) students.push(await createStudent(browser, groupId));
    await teacher.getByRole('button', { name: '開始搶答' }).click();

    const winningGroupId = groupIds[0]!;
    const questionOne = teacher.locator('ol > li').filter({
      has: teacher.getByRole('heading', { name: '題目 1', exact: true }),
    });
    for (const [index, groupId] of groupIds.entries()) {
      const student = students[index]!;
      await student.getByLabel('題目').selectOption('1');
      await student.getByLabel('答案').fill(`公平關閉-${groupId}`);
      const submittedAt = Date.now();
      await student.getByRole('button', { name: '送出答案' }).click();
      await Promise.all([
        expect(questionOne.getByText(`組別 ${groupId}：第 ${index + 1} 名`, { exact: true }))
          .toBeVisible({ timeout: 2_000 }),
        expect(questionOne.getByText(
          `目前成功組別：${winningGroupId}；答案：公平關閉-${winningGroupId}`,
          { exact: true },
        )).toBeVisible({ timeout: 2_000 }),
      ]);
      const latencyMs = Date.now() - submittedAt;
      measurements.push({ groupId, rank: index + 1, winningGroupId, latencyMs });
      expect(latencyMs).toBeLessThanOrEqual(2_000);
    }

    const evidence = { groupCountN: groupIds.length, measurements };
    console.info(`Feature 005 SC-006 ${JSON.stringify(evidence)}`);
    await testInfo.attach('sc-006-ranking-latencies.json', {
      body: JSON.stringify(evidence, null, 2),
      contentType: 'application/json',
    });
  } finally {
    await Promise.all(students.map((student) => student.close()));
    await teacher.close();
  }
});

base('fairness on: a prior winner receives the configured effective-time delay', async ({ browser }) => {
  base.skip(groupIds.length < 2, 'Fairness outcome requires at least two configured groups.');
  const firstGroup = groupIds[0]!;
  const secondGroup = groupIds[1]!;
  const teacher = await createTeacher(browser, '10');
  const firstStudent = await createStudent(browser, firstGroup);
  const secondStudent = await createStudent(browser, secondGroup);

  try {
    await teacher.getByRole('button', { name: '開始搶答' }).click();
    await expect(teacher.getByText('公平順位啟用中；後續提交可能使目前成功組別與順位改變。')).toBeVisible();
    await firstStudent.getByLabel('題目').selectOption('1');
    await firstStudent.getByLabel('答案').fill('先取得成功題');
    await firstStudent.getByRole('button', { name: '送出答案' }).click();
    await expect(teacher.getByText(`目前成功組別：${firstGroup}；答案：先取得成功題`, { exact: true })).toBeVisible();

    await firstStudent.getByLabel('題目').selectOption('2');
    await firstStudent.getByLabel('子題 1 答案').fill('公平延遲答案一');
    await firstStudent.getByLabel('子題 2 答案').fill('公平延遲答案二');
    await firstStudent.getByRole('button', { name: '送出答案' }).click();
    const secondQuestion = teacher.locator('ol > li').filter({
      has: teacher.getByRole('heading', { name: '題目 2', exact: true }),
    });
    await expect(secondQuestion.getByText(`組別 ${firstGroup}：第 1 名`, { exact: true })).toBeVisible();

    await secondStudent.getByLabel('題目').selectOption('2');
    await secondStudent.getByLabel('子題 1 答案').fill('尚未成功組答案一');
    await secondStudent.getByLabel('子題 2 答案').fill('尚未成功組答案二');
    await secondStudent.getByRole('button', { name: '送出答案' }).click();
    await expect(secondQuestion.getByText(`目前成功組別：${secondGroup}；答案：尚未成功組答案一；尚未成功組答案二`, { exact: true })).toBeVisible();
    await expect(secondQuestion.getByText(`組別 ${firstGroup}：第 2 名`, { exact: true })).toBeVisible();
    await expect(secondQuestion.getByText(`組別 ${secondGroup}：第 1 名`, { exact: true })).toBeVisible();
  } finally {
    await Promise.all([firstStudent.close(), secondStudent.close(), teacher.close()]);
  }
});
