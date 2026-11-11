import { afterEach, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { ActivityState } from '../../src/domain/activity-state.js';
import { createRealtimeServer } from '../../src/server.js';
import { FakeGoogleSheetsAdapter } from '../support/fake-google-sheets.js';

const ORIGIN = 'http://127.0.0.1:5173';
type JsonMessage = { type: string; requestId?: string; payload: Record<string, unknown> };

function createInbox(socket: WebSocket) {
  const messages: JsonMessage[] = [];
  const waiters: Array<{ predicate: (message: JsonMessage) => boolean; resolve: (message: JsonMessage) => void; reject: (error: Error) => void }> = [];
  socket.on('message', (data) => {
    const message = JSON.parse(data.toString()) as JsonMessage;
    const index = waiters.findIndex(({ predicate }) => predicate(message));
    if (index >= 0) waiters.splice(index, 1)[0]?.resolve(message);
    else messages.push(message);
  });
  return {
    waitFor(predicate: (message: JsonMessage) => boolean, timeoutMs = 2_000): Promise<JsonMessage> {
      const index = messages.findIndex(predicate);
      if (index >= 0) return Promise.resolve(messages.splice(index, 1)[0]!);
      return new Promise((resolve, reject) => {
        const waiter = { predicate, resolve, reject };
        const timer = setTimeout(() => {
          const current = waiters.indexOf(waiter);
          if (current >= 0) waiters.splice(current, 1);
          reject(new Error('Timed out waiting for WebSocket message'));
        }, timeoutMs);
        waiters.push({
          ...waiter,
          resolve: (message) => { clearTimeout(timer); resolve(message); },
          reject: (error) => { clearTimeout(timer); reject(error); },
        });
      });
    },
  };
}

describe('buzzer results submit WebSocket integration', () => {
  const apps: ReturnType<typeof createRealtimeServer>[] = [];
  const sockets: WebSocket[] = [];

  async function startServer() {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B', 'C'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
      guidedNotes: {
        sheetsAdapter: new FakeGoogleSheetsAdapter([{
          worksheet: { spreadsheetId: 'test', sheetId: 1, worksheetTitle: 'Sheet' },
          rowCount: 3,
          columnCount: 2,
          cells: { A1: '題號', B1: '作答', A2: '1', B2: '舊答案' },
        }]),
      },
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

  async function prepareTeacher(app: ReturnType<typeof createRealtimeServer>, inbox: ReturnType<typeof createInbox>, socket: WebSocket, includeQuestions: boolean) {
    const auth = inbox.waitFor((message) => message.type === 'teacher.authenticated');
    socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await auth;
    await inbox.waitFor((message) => message.type === 'activity.snapshot');
    if (includeQuestions) {
      const imported = inbox.waitFor((message) => message.type === 'guidedNotes.imported');
      socket.send(JSON.stringify({
        type: 'guidedNotes.import', requestId: 'import',
        payload: { spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/test/edit', worksheetTitle: 'Sheet' },
      }));
      await imported;
    }
    const advance = inbox.waitFor((message) => message.type === 'activity.phaseChanged');
    socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'buzz', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await advance;
  }

  afterEach(async () => {
    for (const socket of sockets.splice(0)) socket.terminate();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it('binds submissions to joined groups, locks the first valid answer, and rejects invalid attempts without mutation', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    const firstStudent = await connect(port);
    const secondStudent = await connect(port);
    const otherGroup = await connect(port);

    firstStudent.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join-1', payload: { groupId: 'A' } }));
    await firstStudent.inbox.waitFor((message) => message.type === 'student.joined');
    await expect(firstStudent.inbox.waitFor((message) => message.type === 'buzzerResults.questionList'))
      .resolves.toMatchObject({ payload: { questionIds: [] } });
    secondStudent.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join-2', payload: { groupId: 'A' } }));
    await secondStudent.inbox.waitFor((message) => message.type === 'student.joined');
    otherGroup.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join-3', payload: { groupId: 'B' } }));
    await otherGroup.inbox.waitFor((message) => message.type === 'student.joined');
    await prepareTeacher(app, teacher.inbox, teacher.socket, true);
    await expect(firstStudent.inbox.waitFor((message) => message.type === 'buzzerResults.questionList'))
      .resolves.toMatchObject({ payload: { questionIds: ['1'] } });
    // The question import also updates students who already joined, and later joins see the same list.
    const lateStudent = await connect(port);
    lateStudent.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join-late', payload: { groupId: 'C' } }));
    await lateStudent.inbox.waitFor((message) => message.type === 'student.joined');
    await expect(lateStudent.inbox.waitFor((message) => message.type === 'buzzerResults.questionList'))
      .resolves.toMatchObject({ payload: { questionIds: ['1'] } });

    const firstAck = firstStudent.inbox.waitFor((message) => message.type === 'buzzerResults.submitted');
    firstStudent.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-1', payload: { questionId: '1', answerText: '  first  ' },
    }));
    expect(await firstAck).toMatchObject({
      requestId: 'answer-1',
      payload: { questionId: '1', accepted: true, locked: true },
    });
    expect(app.buzzerResults.getSubmission('A', '1')?.answerText).toBe('  first  ');

    const duplicateError = secondStudent.inbox.waitFor((message) => message.type === 'error' && message.payload.code === 'ANSWER_LOCKED');
    secondStudent.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-2', payload: { questionId: '1', answerText: 'second' },
    }));
    expect(await duplicateError).toMatchObject({ requestId: 'answer-2', payload: { code: 'ANSWER_LOCKED' } });
    expect(app.buzzerResults.getSubmission('A', '1')?.answerText).toBe('  first  ');

    const blankError = firstStudent.inbox.waitFor((message) => message.type === 'error' && message.payload.code === 'ANSWER_EMPTY');
    firstStudent.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-blank', payload: { questionId: '1', answerText: ' \u3000 ' },
    }));
    expect(await blankError).toMatchObject({ requestId: 'answer-blank', payload: { code: 'ANSWER_EMPTY' } });

    const questionError = otherGroup.inbox.waitFor((message) => message.type === 'error' && message.payload.code === 'QUESTION_INVALID');
    otherGroup.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-question', payload: { questionId: 'unknown', answerText: 'x' },
    }));
    expect(await questionError).toMatchObject({ requestId: 'answer-question', payload: { code: 'QUESTION_INVALID' } });
    expect(app.buzzerResults.getSubmission('A', '1')?.answerText).toBe('  first  ');

    const unauthenticated = await connect(port);
    const authError = unauthenticated.inbox.waitFor((message) => message.type === 'error' && message.payload.code === 'AUTH_REQUIRED');
    unauthenticated.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'unjoined', payload: { questionId: '1', answerText: 'x' },
    }));
    await expect(authError).resolves.toMatchObject({ payload: { code: 'AUTH_REQUIRED' } });
  });

  it('rejects submissions when no questions have been imported', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    const student = await connect(port);
    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join', payload: { groupId: 'A' } }));
    await student.inbox.waitFor((message) => message.type === 'student.joined');
    await expect(student.inbox.waitFor((message) => message.type === 'buzzerResults.questionList'))
      .resolves.toMatchObject({ payload: { questionIds: [] } });
    await prepareTeacher(app, teacher.inbox, teacher.socket, false);

    const error = student.inbox.waitFor((message) => message.type === 'error' && message.payload.code === 'QUESTION_INVALID');
    student.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'empty-activity', payload: { questionId: '1', answerText: 'x' },
    }));
    await expect(error).resolves.toMatchObject({ requestId: 'empty-activity', payload: { code: 'QUESTION_INVALID' } });
    expect(app.buzzerResults.getSubmission('A', '1')).toBeNull();
  });

  it('keeps an already joined student connection bound to its original group', async () => {
    const { app, port } = await startServer();
    const teacher = await connect(port);
    const student = await connect(port);

    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'join-A', payload: { groupId: 'A' } }));
    await student.inbox.waitFor((message) => message.type === 'student.joined');
    await prepareTeacher(app, teacher.inbox, teacher.socket, true);

    const rebindError = student.inbox.waitFor((message) => message.type === 'error' && message.requestId === 'rebind');
    student.socket.send(JSON.stringify({ type: 'student.join', requestId: 'rebind', payload: { groupId: 'B' } }));
    await expect(rebindError).resolves.toMatchObject({
      requestId: 'rebind',
      payload: { code: 'GROUP_INVALID', message: '已加入的組別不能變更，請重新連線以恢復原組別。' },
    });

    const accepted = student.inbox.waitFor((message) => message.type === 'buzzerResults.submitted');
    student.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'answer-A', payload: { questionId: '1', answerText: 'A answer' },
    }));
    await expect(accepted).resolves.toMatchObject({
      requestId: 'answer-A',
      payload: { questionId: '1', accepted: true, locked: true },
    });
    expect(app.buzzerResults.getSubmission('A', '1')?.answerText).toBe('A answer');
    expect(app.buzzerResults.getSubmission('B', '1')).toBeNull();
    expect(app.buzzerResults.getOwnProgress('A').questions[0]).toMatchObject({
      submitted: true,
      answerText: 'A answer',
    });
    expect(app.buzzerResults.getOwnProgress('B').questions[0]).toMatchObject({
      submitted: false,
      answerText: null,
    });
  });
});
