import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRealtimeServer } from '../../src/server.js';

const ORIGIN = 'http://127.0.0.1:5173';
type Message = { type: string; requestId?: string; payload: Record<string, any> };

function createInbox(socket: WebSocket) {
  const messages: Message[] = [];
  const waiters: Array<{ check: (message: Message) => boolean; resolve: (message: Message) => void; reject: (error: Error) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as Message;
    const index = waiters.findIndex(({ check }) => check(message));
    if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
    else messages.push(message);
  });
  return {
    waitFor(check: (message: Message) => boolean): Promise<Message> {
      const index = messages.findIndex(check);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      return new Promise((resolve, reject) => {
        const waiter = { check, resolve, reject };
        const timeout = setTimeout(() => {
          const current = waiters.indexOf(waiter);
          if (current >= 0) waiters.splice(current, 1);
          reject(new Error(`Timed out waiting for WebSocket message; queued=${JSON.stringify(messages)}`));
        }, 2_000);
        waiters.push({ ...waiter, resolve: (message) => { clearTimeout(timeout); resolve(message); }, reject });
      });
    },
  };
}

describe('buzzer results release WebSocket integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function start() {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(
      { spreadsheetId: 'release', sheetId: 1, worksheetTitle: 'Sheet' },
      ['1', '2'].map((questionId, index) => ({ questionId, displayOrder: index + 1, sourceRowAtImport: index + 2 })),
    );
    return { app, port: await app.listen(0) };
  }

  async function connect(port: number) {
    const socket = new WebSocket(`ws://127.0.0.1:${port}/ws`, { headers: { Origin: ORIGIN } });
    sockets.push(socket);
    const inbox = createInbox(socket);
    await new Promise<void>((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    await inbox.waitFor((message) => message.type === 'activity.snapshot');
    return { socket, inbox };
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('releases role-filtered results only after ENDED and restores group locks after rejoin', async () => {
    const { app, port } = await start();
    const teacher = await connect(port);
    const studentA = await connect(port);
    const studentB = await connect(port);
    for (const [student, groupId] of [[studentA, 'A'], [studentB, 'B']] as const) {
      student.socket.send(JSON.stringify({ type: 'student.join', requestId: `join-${groupId}`, payload: { groupId } }));
      await student.inbox.waitFor((message) => message.type === 'student.joined');
      await student.inbox.waitFor((message) => message.type === 'buzzerResults.questionList');
    }
    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await teacher.inbox.waitFor((message) => message.type === 'teacher.authenticated');
    await teacher.inbox.waitFor((message) => message.type === 'buzzerResults.teacherProgress');

    studentA.socket.send(JSON.stringify({
      type: 'buzzerResults.getStudentResults', requestId: 'preparing-results', payload: {},
    }));
    expect(await studentA.inbox.waitFor((message) => message.type === 'error'))
      .toMatchObject({ requestId: 'preparing-results', payload: { code: 'STAGE_CONFLICT' } });

    const started = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await started;
    for (const [student, groupId, text] of [[studentA, 'A', 'winner answer'], [studentB, 'B', 'private non-winning answer']] as const) {
      const ack = student.inbox.waitFor((message) => message.type === 'buzzerResults.submitted');
      student.socket.send(JSON.stringify({
        type: 'buzzerResults.submitAnswer', requestId: `answer-${groupId}`, payload: { questionId: '1', answerText: text },
      }));
      await ack;
    }

    const restored = await connect(port);
    restored.socket.send(JSON.stringify({ type: 'student.join', requestId: 'rejoin-A', payload: { groupId: 'A' } }));
    await restored.inbox.waitFor((message) => message.type === 'student.joined');
    await restored.inbox.waitFor((message) => message.type === 'buzzerResults.questionList');
    const ownProgress = await restored.inbox.waitFor((message) => message.type === 'buzzerResults.ownProgress');
    expect(ownProgress.payload.questions).toHaveLength(2);
    expect(ownProgress.payload.questions[0]).toMatchObject({
      questionId: '1', submitted: true, answerText: 'winner answer', locked: true,
    });

    studentB.socket.send(JSON.stringify({
      type: 'buzzerResults.getStudentResults', requestId: 'buzzing-results', payload: {},
    }));
    expect(await studentB.inbox.waitFor((message) => message.type === 'error'))
      .toMatchObject({ requestId: 'buzzing-results', payload: { code: 'STAGE_CONFLICT' } });

    const ended = teacher.inbox.waitFor((message) => message.type === 'activity.phaseChanged');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'end', payload: { from: 'BUZZING', to: 'ENDED' },
    }));
    await ended;
    const studentResults = studentB.inbox.waitFor((message) => message.type === 'buzzerResults.studentResults');
    const resultError = studentB.inbox.waitFor((message) => message.type === 'error');
    studentB.socket.send(JSON.stringify({ type: 'buzzerResults.getStudentResults', requestId: 'results-B', payload: {} }));
    const releasedResults = await Promise.race([
      studentResults,
      resultError.then((message) => { throw new Error(`Student result query rejected: ${JSON.stringify(message)}`); }),
    ]);
    expect(releasedResults).toMatchObject({ payload: { questions: [
      { questionId: '1', winningGroupId: 'A', winningAnswer: 'winner answer', ownAnswer: 'private non-winning answer', ownStatus: 'SUBMITTED', ownGroupWon: false },
      { questionId: '2', winningGroupId: null, winningAnswer: null, ownAnswer: null, ownStatus: 'NOT_SUBMITTED', ownGroupWon: false },
    ] } });

    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.getTeacherProgress', requestId: 'full', payload: {} }));
    const full = await teacher.inbox.waitFor((message) => message.type === 'buzzerResults.teacherProgress' && message.requestId === 'full');
    expect(JSON.stringify(full)).toContain('private non-winning answer');

    const unjoined = await connect(port);
    unjoined.socket.send(JSON.stringify({ type: 'buzzerResults.getStudentResults', requestId: 'unjoined', payload: {} }));
    expect(await unjoined.inbox.waitFor((message) => message.type === 'error'))
      .toMatchObject({ requestId: 'unjoined', payload: { code: 'AUTH_REQUIRED' } });
    expect(app.activity.stage).toBe('ENDED');
  });
});
