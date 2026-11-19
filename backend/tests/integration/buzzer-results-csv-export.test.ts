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

describe('buzzer results CSV export WebSocket integration', () => {
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

  it('authorizes teachers, enforces ENDED, and returns CSV only to its requester', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B'], teacherPassword: 'test-password', teacherLoginEnabled: true }, port: 0,
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(
      { spreadsheetId: 'csv', sheetId: 1, worksheetTitle: 'Sheet' },
      [{ questionId: '1', displayOrder: 1, sourceRowAtImport: 2 }],
    );
    const port = await app.listen(0);
    const teacher = await connect(port);
    const student = await connect(port);
    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join', payload: { groupId: 'A' } }));
    await student.messages.waitFor((message) => message.type === 'student.joined');
    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');

    student.socket.send(JSON.stringify({ type: 'buzzerResults.exportCsv', requestId: 'student-export', payload: {} }));
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.exportCsv', requestId: 'early-export', payload: {} }));
    expect((await student.messages.waitFor((message) => message.requestId === 'student-export')).payload.code)
      .toBe('AUTH_REQUIRED');
    expect((await teacher.messages.waitFor((message) => message.requestId === 'early-export')).payload.code)
      .toBe('STAGE_CONFLICT');

    const buzzing = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged' && message.payload.stage === 'BUZZING');
    teacher.socket.send(JSON.stringify({ type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' } }));
    await buzzing;
    student.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer', payload: { questionId: '1', answerText: 'winner' },
    }));
    const ended = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED');
    teacher.socket.send(JSON.stringify({ type: 'activity.advance', requestId: 'end', payload: { from: 'BUZZING', to: 'ENDED' } }));
    await ended;

    student.socket.send(JSON.stringify({ type: 'buzzerResults.exportCsv', requestId: 'student-export-ended', payload: {} }));
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.exportCsv', requestId: 'teacher-export', payload: {} }));
    const csv = await teacher.messages.waitFor((message) => message.type === 'buzzerResults.csvReady');
    expect(csv.requestId).toBe('teacher-export');
    expect(csv.payload.fileName).toMatch(/\.csv$/);
    expect(csv.payload.csvText).toContain('\uFEFF題號,成功組別');
    expect((await student.messages.waitFor((message) => message.requestId === 'student-export-ended')).payload.code)
      .toBe('AUTH_REQUIRED');
    expect(student.messages.all.some((message) => message.type === 'buzzerResults.csvReady')).toBe(false);
  });

  it('returns RESULTS_NOT_READY after ENDED when no worksheet results exist', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A'], teacherPassword: 'test-password', teacherLoginEnabled: true }, port: 0,
    });
    apps.push(app);
    const port = await app.listen(0);
    const teacher = await connect(port);
    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');
    for (const [from, to, requestId] of [
      ['PREPARING', 'BUZZING', 'start'], ['BUZZING', 'ENDED', 'end'],
    ] as const) {
      const stage = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged' && message.payload.stage === to);
      teacher.socket.send(JSON.stringify({ type: 'activity.advance', requestId, payload: { from, to } }));
      await stage;
    }
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.exportCsv', requestId: 'no-results', payload: {} }));
    expect((await teacher.messages.waitFor((message) => message.requestId === 'no-results')).payload.code)
      .toBe('RESULTS_NOT_READY');
    expect(teacher.messages.all.some((message) => message.type === 'buzzerResults.csvReady')).toBe(false);
  });
});
