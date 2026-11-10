import { test as base, expect } from '@playwright/test';
import { startTestServer, type TestServerHandle } from '../../../backend/tests/support/test-server.js';

type TestFixtures = {
  backend: TestServerHandle;
};

type TestOptions = {
  teacherPassword: string | null;
  groupIds: string;
};

export const test = base.extend<TestFixtures & TestOptions>({
  teacherPassword: ['e2e-teacher-password', { option: true }],
  groupIds: ['1,2,3', { option: true }],
  backend: [async ({ teacherPassword, groupIds }, use) => {
    const backend = await startTestServer({
      port: 3001,
      teacherPassword,
      groupIds,
    });
    try {
      await use(backend);
    } finally {
      await backend.close();
    }
  }, { auto: true }],
});

export { expect };
