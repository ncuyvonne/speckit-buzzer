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

describe('buzzer results student ranking WebSocket integration', () => {
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

  it('keeps ranks private during BUZZING and sends role-filtered results after ENDED', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B', 'C'], teacherPassword: 'test-password', teacherLoginEnabled: true }, port: 0,
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(
      { spreadsheetId: 'ranking', sheetId: 1, worksheetTitle: 'Sheet' },
      [{ questionId: '1', displayOrder: 1, sourceRowAtImport: 2 }],
    );
    const port = await app.listen(0);
    const teacher = await connect(port);
    const studentA = await connect(port);
    const studentB = await connect(port);
    const studentC = await connect(port);

    for (const [student, groupId] of [[studentA, 'A'], [studentB, 'B'], [studentC, 'C']] as const) {
      student.socket.send(JSON.stringify({ type: 'student.join', requestId: `join-${groupId}`, payload: { groupId } }));
      await student.messages.waitFor((message) => message.type === 'student.joined');
    }
    teacher.socket.send(JSON.stringify({
      type: 'teacher.authenticate', requestId: 'auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');

    const buzzing = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged' && message.payload.stage === 'BUZZING');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await buzzing;
    studentC.socket.send(JSON.stringify({
      type: 'buzzerResults.getStudentResults', requestId: 'early-result', payload: {},
    }));
    expect((await studentC.messages.waitFor((message) => message.requestId === 'early-result')).payload.code)
      .toBe('STAGE_CONFLICT');
    studentA.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'a-answer', payload: { questionId: '1', answerText: 'winner answer' },
    }));
    studentC.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'c-answer', payload: { questionId: '1', answerText: 'private answer' },
    }));
    studentB.socket.send(JSON.stringify({
      type: 'buzzerResults.submitAnswer', requestId: 'b-answer', payload: { questionId: '1', answerText: 'other private answer' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.payload.questions?.[0]?.groups?.[1]?.rank === 3);
    expect(studentA.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
    expect(studentC.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);

    const ended = teacher.messages.waitFor((message) => message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'end', payload: { from: 'BUZZING', to: 'ENDED' },
    }));
    await ended;

    studentC.socket.send(JSON.stringify({ type: 'buzzerResults.getStudentResults', requestId: 'student-result', payload: {} }));
    teacher.socket.send(JSON.stringify({ type: 'buzzerResults.getTeacherProgress', requestId: 'teacher-result', payload: {} }));
    const studentResult = await studentC.messages.waitFor((message) => message.type === 'buzzerResults.studentResults'
      && message.requestId === 'student-result');
    const teacherResult = await teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress'
      && message.requestId === 'teacher-result');
    expect(studentResult.payload.questions[0]).toMatchObject({
      winningGroupId: 'A', winningAnswer: 'winner answer', ownAnswer: 'private answer',
      groups: [{ groupId: 'A', rank: 1 }, { groupId: 'B', rank: 3 }, { groupId: 'C', rank: 2 }],
    });
    expect(JSON.stringify(studentResult.payload)).not.toContain('other private answer');
    expect(teacherResult.payload.questions[0].groups[1].answerText).toBe('other private answer');
  });
});
