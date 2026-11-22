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

describe('buzzer results ranking WebSocket integration', () => {
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

  it('publishes server ranks and changes the question winner after a fair-delay submission', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B', 'C'], teacherPassword: 'test-password', teacherLoginEnabled: true }, port: 0,
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(
      { spreadsheetId: 'ranking', sheetId: 1, worksheetTitle: 'Sheet' },
      ['1', '2'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
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
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');

    teacher.socket.send(JSON.stringify({
      type: 'buzzerResults.setFairRanking', requestId: 'fair',
      payload: { enabled: true, delaySeconds: 10 },
    }));
    await teacher.messages.waitFor((message) => message.requestId === 'fair');
    const phaseChanged = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await phaseChanged;

    const aFirstUpdate = teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.payload.questions?.[0]?.groups?.[0]?.rank === 1);
    studentA.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'a-q1', payload: { questionId: '1', answerText: 'A first' },
    }));
    await aFirstUpdate;

    const aSecondQuestion = teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.payload.questions?.[1]?.groups?.[0]?.submitted === true);
    studentA.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'a-q2', payload: { questionId: '2', answerText: 'A delayed' },
    }));
    await aSecondQuestion;

    const bWinsSecondQuestion = teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.payload.questions?.[1]?.winningGroupId === 'B');
    studentB.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'b-q2', payload: { questionId: '2', answerText: 'B first effective' },
    }));
    const update = await bWinsSecondQuestion;
    expect(update.payload.questions[1]).toMatchObject({
      winningGroupId: 'B',
      groups: [
        { groupId: 'A', submitted: true, rank: 2 },
        { groupId: 'B', submitted: true, rank: 1 },
        { groupId: 'C', submitted: false, rank: null },
      ],
    });
    expect(studentA.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
  });
});
