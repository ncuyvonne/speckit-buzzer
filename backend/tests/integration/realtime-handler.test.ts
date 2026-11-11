import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { loadConfig } from '../../src/config.js';
import { createRealtimeServer } from '../../src/server.js';

const ORIGIN = 'http://127.0.0.1:5173';
type JsonMessage = { type: string; requestId?: string; payload: Record<string, unknown> };

function createInbox(socket: WebSocket) {
  const messages: JsonMessage[] = [];
  const seen: string[] = [];
  const waiters: Array<{ predicate: (message: JsonMessage) => boolean; resolve: (message: JsonMessage) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as JsonMessage;
    seen.push(`${message.type}:${message.requestId ?? ''}:${String(message.payload.code ?? message.payload.stage ?? '')}`);
    const waiterIndex = waiters.findIndex(({ predicate }) => predicate(message));
    if (waiterIndex >= 0) waiters.splice(waiterIndex, 1)[0]?.resolve(message);
    else messages.push(message);
  });

  return {
    waitFor(predicate: (message: JsonMessage) => boolean, timeoutMs = 2_000): Promise<JsonMessage> {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      return new Promise((resolve, reject) => {
        const waiter = {
          predicate,
          resolve: (message: JsonMessage) => {
            clearTimeout(timeout);
            resolve(message);
          },
        };
        const timeout = setTimeout(() => {
          const waiterIndex = waiters.indexOf(waiter);
          if (waiterIndex >= 0) waiters.splice(waiterIndex, 1);
          reject(new Error(`Timed out waiting for WebSocket message; seen: ${seen.join(',')}; queued: ${JSON.stringify(messages)}`));
        }, timeoutMs);
        waiters.push(waiter);
      });
    },
    async expectNoPhaseBroadcast(timeoutMs = 50): Promise<void> {
      const event = this.waitFor((message) => message.type === 'activity.phaseChanged', timeoutMs);
      await expect(event).rejects.toThrow('Timed out waiting for WebSocket message');
    },
  };
}

describe('realtime role and phase handler', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function startServer() {
    const config = loadConfig({ GROUP_IDS: '1,2', TEACHER_PASSWORD: 'test-password' });
    const app = createRealtimeServer({ config, port: 0 });
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

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('rejects unauthenticated phase changes without mutation or broadcast', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    const peer = await connect(port);

    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'unauth-1', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    const error = await teacher.inbox.waitFor((message) => message.type === 'error');
    expect(error).toMatchObject({ requestId: 'unauth-1', payload: { code: 'AUTH_REQUIRED' } });
    expect(app.activity.stage).toBe('PREPARING');
    await peer.inbox.expectNoPhaseBroadcast();
  });

  it('keeps teacher role and stage unchanged for invalid requests and broadcasts only accepted transitions', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    const peer = await connect(port);
    const teacherAuth = teacher.inbox.waitFor((message) => message.type === 'teacher.authenticated');
    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth-1', payload: { password: 'test-password' },
    }));
    expect(await teacherAuth).toMatchObject({ requestId: 'auth-1', payload: { ok: true } });
    await teacher.inbox.waitFor((message) => message.type === 'activity.snapshot');

    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'repeat-auth', payload: { password: 'wrong-secret' },
    }));
    expect(await teacher.inbox.waitFor((message) => message.type === 'error')).toMatchObject({
      requestId: 'repeat-auth', payload: { code: 'INVALID_MESSAGE' },
    });
    expect(app.activity.stage).toBe('PREPARING');
    await peer.inbox.expectNoPhaseBroadcast();

    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'skip', payload: { from: 'PREPARING', to: 'ENDED' },
    }));
    expect(await teacher.inbox.waitFor((message) => message.type === 'error')).toMatchObject({
      requestId: 'skip', payload: { code: 'STAGE_CONFLICT' },
    });
    expect(app.activity.stage).toBe('PREPARING');
    await peer.inbox.expectNoPhaseBroadcast();

    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'advance-1', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    expect(await teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged')).toMatchObject({
      payload: { stage: 'BUZZING' },
    });
    expect(await peer.inbox.waitFor((message) => message.type === 'activity.phaseChanged')).toMatchObject({
      payload: { stage: 'BUZZING' },
    });

    for (const [requestId, from, to] of [
      ['stale', 'PREPARING', 'BUZZING'],
      ['backward', 'BUZZING', 'PREPARING'],
    ] as const) {
      teacher.socket.send(JSON.stringify({ type: 'activity.advance', requestId, payload: { from, to } }));
      expect(await teacher.inbox.waitFor((message) => message.type === 'error')).toMatchObject({
        requestId, payload: { code: 'STAGE_CONFLICT' },
      });
      expect(app.activity.stage).toBe('BUZZING');
      await peer.inbox.expectNoPhaseBroadcast();
    }

    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'advance-2', payload: { from: 'BUZZING', to: 'ENDED' },
    }));
    expect(await teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged')).toMatchObject({
      payload: { stage: 'ENDED' },
    });
    expect(app.activity.stage).toBe('ENDED');
  });

  it('binds each joined student connection independently and enforces role-specific message guards', async () => {
    const { app, port } = await startServer();
    const studentOne = await connect(port);
    const studentTwo = await connect(port);
    const studentOtherGroup = await connect(port);

    for (const [connection, groupId, requestId] of [
      [studentOne, '1', 'join-one'],
      [studentTwo, '1', 'join-two'],
      [studentOtherGroup, '2', 'join-other'],
    ] as const) {
      connection.socket.send(JSON.stringify({ type: 'student.join', requestId, payload: { groupId } }));
      expect(await connection.inbox.waitFor((message) => message.type === 'student.joined')).toMatchObject({
        requestId, payload: { ok: true, groupId },
      });
      expect(await connection.inbox.waitFor((message) => message.type === 'activity.snapshot')).toMatchObject({
        payload: { stage: 'PREPARING', groups: ['1', '2'] },
      });
    }

    studentOne.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'student-auth', payload: { password: 'test-password' },
    }));
    expect(await studentOne.inbox.waitFor((message) => message.type === 'error')).toMatchObject({
      requestId: 'student-auth', payload: { code: 'INVALID_MESSAGE' },
    });
    studentOne.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'student-advance', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    expect(await studentOne.inbox.waitFor((message) => message.type === 'error')).toMatchObject({
      requestId: 'student-advance', payload: { code: 'AUTH_REQUIRED' },
    });
    expect(app.activity.stage).toBe('PREPARING');
    await studentTwo.inbox.expectNoPhaseBroadcast();

    const teacher = await connect(port);
    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'teacher-auth', payload: { password: 'test-password' },
    }));
    await teacher.inbox.waitFor((message) => message.type === 'teacher.authenticated');
    await teacher.inbox.waitFor((message) => message.type === 'activity.snapshot');
    teacher.socket.send(JSON.stringify({ type: 'student.join', requestId: 'teacher-join', payload: { groupId: '2' } }));
    expect(await teacher.inbox.waitFor((message) => message.type === 'error')).toMatchObject({
      requestId: 'teacher-join', payload: { code: 'INVALID_MESSAGE' },
    });
    expect(app.activity.stage).toBe('PREPARING');
    await studentOne.inbox.expectNoPhaseBroadcast();

    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'teacher-advance', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    for (const student of [studentOne, studentTwo, studentOtherGroup]) {
      expect(await student.inbox.waitFor((message) => message.type === 'activity.phaseChanged')).toMatchObject({
        payload: { stage: 'BUZZING' },
      });
    }
    expect(app.activity.stage).toBe('BUZZING');
  });
});
