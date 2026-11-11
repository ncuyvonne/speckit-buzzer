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

describe('buzzer results teacher progress WebSocket integration', () => {
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

  it('sends a complete initial snapshot and subsequent progress only to authenticated teachers', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(
      { spreadsheetId: 'integration', sheetId: 1, worksheetTitle: 'Sheet' },
      [1, 2].map((index) => ({ questionId: String(index), displayOrder: index, sourceRowAtImport: index + 1 })),
    );
    const port = await app.listen(0);
    const teacher = await connect(port);
    const studentA = await connect(port);
    const studentB = await connect(port);
    for (const [student, groupId] of [[studentA, 'A'], [studentB, 'B']] as const) {
      student.socket.send(JSON.stringify({ type: 'student.join', requestId: `join-${groupId}`, payload: { groupId } }));
      await student.messages.waitFor((message) => message.type === 'student.joined');
    }

    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'teacher-auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');
    expect(await teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'))
      .toMatchObject({ payload: { questions: [
        { questionId: '1', groups: [{ groupId: 'A', submitted: false }, { groupId: 'B', submitted: false }] },
        { questionId: '2', groups: [{ groupId: 'A', submitted: false }, { groupId: 'B', submitted: false }] },
      ] } });

    const stageChanged = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await stageChanged;

    studentA.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-A', payload: { questionId: '1', answerText: 'A answer' },
    }));
    await studentA.messages.waitFor((message) => message.type === 'buzzerResults.submitted');
    const firstUpdate = await teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.payload.questions?.[0]?.groups?.[0]?.submitted === true);
    expect(firstUpdate.payload.questions[0]).toMatchObject({ winningGroupId: 'A', winningAnswer: 'A answer' });

    studentB.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-B', payload: { questionId: '2', answerText: 'B answer' },
    }));
    await studentB.messages.waitFor((message) => message.type === 'buzzerResults.submitted');
    await teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.payload.questions?.[1]?.groups?.[1]?.submitted === true);
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(studentA.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
    expect(studentB.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
    expect(studentA.messages.all.some((message) => JSON.stringify(message).includes('B answer'))).toBe(false);
  });
});
