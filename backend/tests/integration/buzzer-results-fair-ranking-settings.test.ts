import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRealtimeServer } from '../../src/server.js';

const ORIGIN = 'http://127.0.0.1:5173';
type Message = { type: string; requestId?: string; payload: Record<string, any> };

function listen(socket: WebSocket) {
  const all: Message[] = [];
  const waiters: Array<{ check: (message: Message) => boolean; resolve: (message: Message) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as Message;
    all.push(message);
    const index = waiters.findIndex(({ check }) => check(message));
    if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
  });
  return {
    all,
    waitFor(check: (message: Message) => boolean): Promise<Message> {
      const existing = all.find(check);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => waiters.push({ check, resolve }));
    },
  };
}

describe('fair-ranking settings WebSocket integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
    sockets.push(socket);
    const messages = listen(socket);
    await new Promise<void>((resolve, reject) => {
      socket.once('open', resolve);
      socket.once('error', reject);
    });
    await messages.waitFor((message) => message.type === 'activity.snapshot');
    return { socket, messages };
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('allows only a teacher to configure valid decimal delay during PREPARING and freezes it after start', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A'], teacherPassword: 'test-password', teacherLoginEnabled: true }, port: 0,
    });
    apps.push(app);
    const port = await app.listen(0);
    const student = await connect(port);
    const teacher = await connect(port);

    student.socket.send(JSON.stringify({
      type: 'buzzerResults.setFairRanking', requestId: 'student-set',
      payload: { enabled: true, delaySeconds: 0.5 },
    }));
    expect(await student.messages.waitFor((message) => message.requestId === 'student-set'))
      .toMatchObject({ type: 'error', payload: { code: 'AUTH_REQUIRED' } });

    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'teacher-auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');
    expect(await teacher.messages.waitFor((message) => message.type === 'buzzerResults.fairRankingConfigured'))
      .toMatchObject({ payload: { enabled: false, delaySeconds: null } });

    teacher.socket.send(JSON.stringify({
      type: 'buzzerResults.setFairRanking', requestId: 'invalid-set',
      payload: { enabled: true, delaySeconds: 0 },
    }));
    expect(await teacher.messages.waitFor((message) => message.requestId === 'invalid-set'))
      .toMatchObject({ type: 'error', payload: { code: 'FAIR_RANKING_INVALID' } });
    expect(app.activity.fairRankingSettings).toEqual({ enabled: false, delaySeconds: null });

    teacher.socket.send(JSON.stringify({
      type: 'buzzerResults.setFairRanking', requestId: 'valid-set',
      payload: { enabled: true, delaySeconds: 0.5 },
    }));
    expect(await teacher.messages.waitFor((message) => message.requestId === 'valid-set'))
      .toMatchObject({ type: 'buzzerResults.fairRankingConfigured', payload: { enabled: true, delaySeconds: 0.5 } });

    const phaseChanged = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await phaseChanged;
    teacher.socket.send(JSON.stringify({
      type: 'buzzerResults.setFairRanking', requestId: 'late-set',
      payload: { enabled: false, delaySeconds: null },
    }));
    expect(await teacher.messages.waitFor((message) => message.requestId === 'late-set'))
      .toMatchObject({ type: 'error', payload: { code: 'STAGE_CONFLICT' } });
    expect(app.activity.fairRankingSettings).toEqual({ enabled: true, delaySeconds: 0.5 });
  });
});
