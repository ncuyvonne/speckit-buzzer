import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRealtimeServer } from '../../src/server.js';

const ORIGIN = 'http://127.0.0.1:5173';
type Message = { type: string; payload: Record<string, any> };
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

describe('student own progress projection', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];
  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('updates only the submitting group with its count and top-level total', async () => {
    const app = createRealtimeServer({ config: { groups: ['A', 'B'], teacherPassword: 'pw', teacherLoginEnabled: true }, port: 0 });
    apps.push(app);
    app.activity.replaceGuidedNotesImport({ spreadsheetId: 'test', sheetId: 1, worksheetTitle: 'Sheet' },
      ['single', 'group-question'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })));
    const port = await app.listen(0);
    const connect = async (groupId: string) => {
      const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
      sockets.push(socket);
      const messages = listen(socket);
      await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
      await messages.waitFor((message) => message.type === 'activity.snapshot');
      socket.send(JSON.stringify({ type: 'student.join', requestId: `join-${groupId}`, payload: { groupId } }));
      await messages.waitFor((message) => message.type === 'student.joined');
      return { socket, messages };
    };
    const studentA = await connect('A');
    const studentB = await connect('B');
    const teacherSocket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
    sockets.push(teacherSocket);
    const teacherMessages = listen(teacherSocket);
    await new Promise<void>((resolve, reject) => { teacherSocket.once('open', resolve); teacherSocket.once('error', reject); });
    await teacherMessages.waitFor((message) => message.type === 'activity.snapshot');
    teacherSocket.send(JSON.stringify({ type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'pw' } }));
    await teacherMessages.waitFor((message) => message.type === 'teacher.authenticated');
    const buzzing = teacherMessages.waitFor((message) => message.type === 'activity.phaseChanged' && message.payload.stage === 'BUZZING');
    teacherSocket.send(JSON.stringify({ type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' } }));
    await buzzing;
    const initialA = studentA.messages.waitFor((message) => message.type === 'buzzerResults.ownProgress');
    const initialB = studentB.messages.waitFor((message) => message.type === 'buzzerResults.ownProgress');
    studentA.socket.send(JSON.stringify({ type: 'buzzerResults.submitAnswer', requestId: 'answer-A',
      payload: { questionId: 'group-question', answerText: 'complete group response' } }));
    const updateA = studentA.messages.waitFor((message) => message.type === 'buzzerResults.ownProgress'
      && message.payload.submittedCount === 1);
    await Promise.all([initialA, initialB, updateA]);

    expect(studentA.messages.all.some((message) => message.type === 'buzzerResults.ownProgress'
      && message.payload.submittedCount === 1 && message.payload.totalQuestionCount === 2)).toBe(true);
    expect(studentB.messages.all.some((message) => message.type === 'buzzerResults.ownProgress'
      && message.payload.submittedCount === 1)).toBe(false);
    expect(JSON.stringify(studentB.messages.all)).not.toContain('complete group response');
  });
});
