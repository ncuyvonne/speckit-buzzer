import { test, expect } from './fixtures';

async function connected(page: import('@playwright/test').Page) {
  await expect(page.getByRole('status').first()).toContainText('已連線');
}

async function connectLoadStudents(page: import('@playwright/test').Page, firstStudentIndex: number, count: number) {
  if (count === 0) return 0;

  return page.evaluate(async ({ firstStudentIndex, count }) => {
    const sockets: WebSocket[] = [];
    const connectStudent = (index: number) => new Promise<void>((resolve, reject) => {
      const scheme = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const socket = new WebSocket(`${scheme}//${window.location.host}/ws`);
      sockets.push(socket);

      const requestId = `load-student-${index}`;
      const groupId = String((index % 3) + 1);
      const timeout = window.setTimeout(() => reject(new Error(`Student ${index} did not join in time.`)), 15_000);

      socket.addEventListener('open', () => {
        socket.addEventListener('message', (event) => {
          const message = JSON.parse(String(event.data)) as {
            type?: string;
            requestId?: string;
            payload?: { groupId?: string; code?: string };
          };
          if (message.requestId !== requestId) return;
          if (message.type === 'student.joined' && message.payload?.groupId === groupId) {
            window.clearTimeout(timeout);
            resolve();
          } else if (message.type === 'error') {
            window.clearTimeout(timeout);
            reject(new Error(`Student ${index} failed to join: ${message.payload?.code ?? 'unknown error'}.`));
          }
        }, { once: false });
        socket.send(JSON.stringify({ type: 'student.join', requestId, payload: { groupId } }));
      }, { once: true });
      socket.addEventListener('error', () => {
        window.clearTimeout(timeout);
        reject(new Error(`Student ${index} WebSocket failed to connect.`));
      }, { once: true });
    });

    (window as Window & { __loadStudentSockets?: WebSocket[] }).__loadStudentSockets = sockets;
    await Promise.all(Array.from({ length: count }, (_, offset) => connectStudent(firstStudentIndex + offset)));
    return sockets.length;
  }, { firstStudentIndex, count });
}

test('teacher sees full live progress for the classroom within two seconds', async ({ browser }) => {
  const classroomSize = Number(process.env.PLAYWRIGHT_CLASS_SIZE ?? '3');
  expect(Number.isInteger(classroomSize) && classroomSize > 0).toBeTruthy();
  test.setTimeout(90_000);

  const teacher = await browser.newPage();
  await teacher.goto('/');
  await connected(teacher);
  await teacher.getByLabel('老師密碼').fill('e2e-teacher-password');
  await teacher.getByRole('button', { name: '老師登入' }).click();
  await teacher.getByLabel('Google 試算表網址').fill('https://docs.google.com/spreadsheets/d/e2e-valid-sheet/edit');
  await teacher.getByLabel('工作表分頁名稱').fill('工作表1');
  await teacher.getByRole('button', { name: '匯入題號' }).click();
  await expect(teacher.getByText('題數：3')).toBeVisible();
  await expect(teacher.getByRole('heading', { name: /^題目 / })).toHaveCount(3);
  for (const groupId of ['1', '2', '3']) {
    await expect(teacher.getByText(`組別 ${groupId}：尚未提交`, { exact: true })).toHaveCount(3);
  }

  const studentUiCount = Math.min(classroomSize, 3);
  const students = await Promise.all(Array.from({ length: studentUiCount }, async (_, index) => {
    const groupId = String((index % 3) + 1);
    const page = await browser.newPage();
    await page.goto('/');
    await connected(page);
    await page.getByLabel('學生組別').selectOption(groupId);
    await page.getByRole('button', { name: '加入組別' }).click();
    await page.getByLabel('題目').selectOption('1');
    return page;
  }));
  const loadConnectionCount = await connectLoadStudents(teacher, students.length, classroomSize - students.length);
  expect(students.length + loadConnectionCount).toBe(classroomSize);

  await teacher.getByRole('button', { name: '開始搶答' }).click();
  await students[0]!.getByLabel('答案').fill('組別 1 的答案');
  const sentAt = Date.now();
  await students[0]!.getByRole('button', { name: '送出答案' }).click();
  await expect(teacher.getByText('目前成功組別：1；答案：組別 1 的答案', { exact: true })).toBeVisible();
  const latencyMs = Date.now() - sentAt;
  console.info(`teacher progress classroomSize=${classroomSize} latencyMs=${latencyMs}`);
  expect(latencyMs).toBeLessThan(2_000);
  await expect(teacher.getByText('目前成功組別：1')).toBeVisible();
  await expect(teacher.getByText('組別 2：尚未提交').first()).toBeVisible();

  await teacher.evaluate(() => {
    (window as Window & { __loadStudentSockets?: WebSocket[] }).__loadStudentSockets?.forEach((socket) => socket.close());
  });
  await Promise.all(students.map((page) => page.close()));
  await teacher.close();
});
