import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRealtimeServer } from '../../src/server.js';

const ORIGIN = 'http://127.0.0.1:5173';
type JsonMessage = { type: string; requestId?: string; payload: Record<string, unknown> };

function createInbox(socket: WebSocket) {
  const messages: JsonMessage[] = [];
  const received: JsonMessage[] = [];
  const waiters: Array<{
    predicate: (message: JsonMessage) => boolean;
    resolve: (message: JsonMessage) => void;
    reject: (error: Error) => void;
  }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as JsonMessage;
    received.push(message);
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
    else messages.push(message);
  });
  return {
    all: received,
    waitFor(predicate: (message: JsonMessage) => boolean, timeoutMs = 3_000): Promise<JsonMessage> {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject };
        const timeout = setTimeout(() => {
          const current = waiters.indexOf(waiter);
          if (current >= 0) waiters.splice(current, 1);
          reject(new Error('Timed out waiting for WebSocket message'));
        }, timeoutMs);
        waiters.push({
          ...waiter,
          resolve: (message) => { clearTimeout(timeout); resolve(message); },
          reject: (error) => { clearTimeout(timeout); reject(error); },
        });
      });
    },
  };
}

describe('activity timer WebSocket integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function startServer() {
    const app = createRealtimeServer({
      config: { groups: ['1', '2'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
    });
    apps.push(app);
    const port = await app.listen(0);
    return { app, port };
  }

  async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
    sockets.push(socket);
    const inbox = createInbox(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await inbox.waitFor((message) => message.type === 'activity.snapshot');
    return { socket, inbox };
  }

  async function loginTeacher(socket: WebSocket, inbox: ReturnType<typeof createInbox>) {
    const auth = inbox.waitFor((message) => message.type === 'teacher.authenticated');
    socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await auth;
  }

  async function setLimit(seconds: number, socket: WebSocket, inbox: ReturnType<typeof createInbox>) {
    const response = inbox.waitFor((message) => message.type === 'activity.timeLimitSet'
      || (message.type === 'error' && message.requestId === `limit-${seconds}`));
    socket.send(JSON.stringify({
      type: 'activity.setTimeLimit', requestId: `limit-${seconds}`, payload: { seconds },
    }));
    return response;
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('validates teacher-only time-limit settings and broadcasts the deadline to both roles within one second', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    const student = await connect(port);

    const joined = student.inbox.waitFor((message) => message.type === 'student.joined');
    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join', payload: { groupId: '1' } }));
    await joined;
    await loginTeacher(teacher.socket, teacher.inbox);

    const unauthorized = student.inbox.waitFor((message) => message.type === 'error' && message.requestId === 'unauthorized-limit');
    student.socket.send(JSON.stringify({
      type: 'activity.setTimeLimit', requestId: 'unauthorized-limit', payload: { seconds: 3_601 },
    }));
    await expect(unauthorized).resolves.toMatchObject({ payload: { code: 'AUTH_REQUIRED' } });

    await expect(setLimit(3601, teacher.socket, teacher.inbox)).resolves.toMatchObject({
      type: 'error', payload: { code: 'TIME_LIMIT_INVALID' },
    });
    expect(app.activity.timeLimitSeconds).toBe(0);
    await expect(setLimit(2, teacher.socket, teacher.inbox)).resolves.toMatchObject({
      type: 'activity.timeLimitSet', payload: { seconds: 2 },
    });

    const teacherBuzzing = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'BUZZING');
    const studentBuzzing = student.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'BUZZING');
    const teacherInitialTick = teacher.inbox.waitFor((message) => message.type === 'activity.countdown'
      && message.payload.remainingSeconds === 2);
    const studentInitialTick = student.inbox.waitFor((message) => message.type === 'activity.countdown'
      && message.payload.remainingSeconds === 2);
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await Promise.all([teacherBuzzing, studentBuzzing, teacherInitialTick, studentInitialTick]);
    const deadlineAt = app.activity.deadlineAt as number;

    const wrongStageLimit = teacher.inbox.waitFor((message) => message.type === 'error'
      && message.requestId === 'limit-during-buzzing');
    teacher.socket.send(JSON.stringify({
      type: 'activity.setTimeLimit', requestId: 'limit-during-buzzing', payload: { seconds: 3_601 },
    }));
    await expect(wrongStageLimit).resolves.toMatchObject({ payload: { code: 'STAGE_CONFLICT' } });
    expect(app.activity.timeLimitSeconds).toBe(2);

    const teacherEnded = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'ENDED');
    const studentEnded = student.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'ENDED');
    await Promise.all([teacherEnded, studentEnded]);
    expect(Date.now() - deadlineAt).toBeLessThan(1_000);
    expect(app.activity.stage).toBe('ENDED');

    const late = student.inbox.waitFor((message) => message.type === 'error' && message.requestId === 'late-answer');
    student.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'late-answer', payload: { questionId: '1', answerText: 'late' },
    }));
    await expect(late).resolves.toMatchObject({ payload: { code: 'STAGE_CONFLICT' } });
  }, 6_000);

  it('includes the current remaining time in a reconnect snapshot during BUZZING', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    await loginTeacher(teacher.socket, teacher.inbox);
    await expect(setLimit(30, teacher.socket, teacher.inbox)).resolves.toMatchObject({
      type: 'activity.timeLimitSet', payload: { seconds: 30 },
    });

    const buzzing = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'BUZZING');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await buzzing;
    const deadlineAt = app.activity.deadlineAt as number;
    await new Promise((resolve) => setTimeout(resolve, 1_250));

    const reconnectingStudent = await connect(port);
    const snapshot = reconnectingStudent.inbox.all.find((message) => message.type === 'activity.snapshot');
    expect(snapshot?.payload).toMatchObject({ stage: 'BUZZING', timeLimitSeconds: 30 });
    expect(Math.abs(Number(snapshot?.payload.remainingSeconds) - app.activity.getRemainingSeconds()!))
      .toBeLessThanOrEqual(1);
    expect(Number(snapshot?.payload.remainingSeconds)).toBeGreaterThan(0);
    expect(Number(snapshot?.payload.remainingSeconds)).toBeLessThan(30);
    expect(Number(snapshot?.payload.remainingSeconds)).toBeGreaterThanOrEqual(28);
    expect(Date.now()).toBeLessThan(deadlineAt);
  }, 4_000);

  it('manual end stops the countdown and the delayed timer cannot publish a second end', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    await loginTeacher(teacher.socket, teacher.inbox);
    await expect(setLimit(3, teacher.socket, teacher.inbox)).resolves.toMatchObject({
      type: 'activity.timeLimitSet', payload: { seconds: 3 },
    });

    const buzzing = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'BUZZING');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await buzzing;

    const ended = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'ENDED');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'manual-end', payload: { from: 'BUZZING', to: 'ENDED' },
    }));
    await ended;
    await new Promise((resolve) => setTimeout(resolve, 3_100));
    expect(app.activity.stage).toBe('ENDED');
    expect(teacher.inbox.all.filter((message) => message.type === 'activity.phaseChanged'
      && message.payload.stage === 'ENDED')).toHaveLength(1);
  }, 5_000);
});
