import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRealtimeServer } from '../../src/server.js';

const ORIGIN = 'http://127.0.0.1:5173';
type Message = { type: string; requestId?: string; payload: Record<string, any> };

function inbox(socket: WebSocket) {
  const all: Message[] = [];
  const waiters: Array<{ predicate: (message: Message) => boolean; resolve: (message: Message) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as Message;
    all.push(message);
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
  });
  return {
    all,
    waitFor(predicate: (message: Message) => boolean, timeout = 1_000): Promise<Message> {
      const existing = all.find(predicate);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve };
        const timer = setTimeout(() => reject(new Error('Timed out waiting for scoring message')), timeout);
        waiters.push({ predicate, resolve: (message) => { clearTimeout(timer); resolve(message); } });
      });
    },
  };
}

describe('scoring WebSocket integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];
  async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
    sockets.push(socket);
    const messages = inbox(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await messages.waitFor((item) => item.type === 'activity.snapshot');
    return { socket, messages };
  }
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('authorizes marks, limits them to ended winners, and updates teacher and student scoreboards live', async () => {
    const app = createRealtimeServer({ config: { groups: ['2', '10'], teacherPassword: 'pw', teacherLoginEnabled: true }, port: 0 });
    apps.push(app);
    app.activity.replaceGuidedNotesImport({ spreadsheetId: 'test', sheetId: 1, worksheetTitle: 'Sheet' },
      ['Q1', 'Q2'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })));
    const port = await app.listen(0);
    const teacher = await connect(port);
    const student = await connect(port);
    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join', payload: { groupId: '2' } }));
    await student.messages.waitFor((item) => item.type === 'student.joined');
    teacher.socket.send(JSON.stringify({ type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'pw' } }));
    await teacher.messages.waitFor((item) => item.type === 'teacher.authenticated');

    student.socket.send(JSON.stringify({ type: 'buzzerResults.markCorrectness', requestId: 'unauthorized', payload: { questionId: 'Q1', judgement: 'CORRECT' } }));
    expect(await student.messages.waitFor((item) => item.requestId === 'unauthorized')).toMatchObject({ payload: { code: 'AUTH_REQUIRED' } });
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.markCorrectness', requestId: 'too-early', payload: { questionId: 'Q1', judgement: 'CORRECT' } }));
    expect(await teacher.messages.waitFor((item) => item.requestId === 'too-early')).toMatchObject({ payload: { code: 'STAGE_CONFLICT' } });

    teacher.socket.send(JSON.stringify({ type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' } }));
    await teacher.messages.waitFor((item) => item.type === 'activity.phaseChanged' && item.payload.stage === 'BUZZING');
    student.socket.send(JSON.stringify({ type: 'buzzerResults.submitAnswer', requestId: 'answer', payload: { questionId: 'Q1', answerText: 'manual judgment only' } }));
    await student.messages.waitFor((item) => item.type === 'buzzerResults.submitted');
    teacher.socket.send(JSON.stringify({ type: 'activity.advance', requestId: 'end', payload: { from: 'BUZZING', to: 'ENDED' } }));
    await teacher.messages.waitFor((item) => item.type === 'activity.phaseChanged' && item.payload.stage === 'ENDED');

    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.markCorrectness', requestId: 'no-winner', payload: { questionId: 'Q2', judgement: 'CORRECT' } }));
    expect(await teacher.messages.waitFor((item) => item.requestId === 'no-winner')).toMatchObject({ payload: { code: 'WINNER_NOT_FOUND' } });
    const teacherBoard = teacher.messages.waitFor((item) => item.type === 'buzzerResults.scoreboard'
      && item.payload.entries?.[0]?.score === 1);
    const studentBoard = student.messages.waitFor((item) => item.type === 'buzzerResults.scoreboard'
      && item.payload.entries?.[0]?.score === 1);
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.markCorrectness', requestId: 'mark', payload: { questionId: 'Q1', judgement: 'CORRECT' } }));
    await Promise.all([teacherBoard, studentBoard]);

    const correctedTeacherBoard = teacher.messages.waitFor((item) => item.type === 'buzzerResults.scoreboard'
      && item.payload.entries?.[0]?.score === 0);
    const correctedStudentBoard = student.messages.waitFor((item) => item.type === 'buzzerResults.scoreboard'
      && item.payload.entries?.[0]?.score === 0);
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.markCorrectness', requestId: 'change', payload: { questionId: 'Q1', judgement: 'INCORRECT' } }));
    await Promise.all([correctedTeacherBoard, correctedStudentBoard]);
    expect(app.buzzerResults.getWinner('Q1')?.answerText).toBe('manual judgment only');
  });
});
