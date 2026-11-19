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
    const endedForTeacher = teacher.messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED');
    const endedForStudentA = studentA.messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED');
    const endedForStudentB = studentB.messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED');
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'end', payload: { from: 'BUZZING', to: 'ENDED' },
    }));
    await Promise.all([endedForTeacher, endedForStudentA, endedForStudentB]);

    expect(studentA.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
    expect(studentB.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
    expect(studentA.messages.all.some((message) => JSON.stringify(message).includes('B answer'))).toBe(false);
  });

  it('keeps BUZZING and ENDED student packets private across groups and reconnection', async () => {
    const app = createRealtimeServer({
      config: { groups: ['A', 'B', 'C'], teacherPassword: 'test-password', teacherLoginEnabled: true },
      port: 0,
    });
    apps.push(app);
    app.activity.replaceGuidedNotesImport(
      { spreadsheetId: 'privacy', sheetId: 1, worksheetTitle: 'Sheet' },
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
      type: 'teacher.authenticate', requestId: 'teacher-auth', payload: { password: 'test-password' },
    }));
    await teacher.messages.waitFor((message) => message.type === 'teacher.authenticated');
    await teacher.messages.waitFor((message) => message.type === 'buzzerResults.teacherProgress');
    const buzzingForTeacher = teacher.messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'BUZZING');
    const buzzingForStudents = [studentA, studentB, studentC].map(({ messages }) => messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'BUZZING'));
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'start', payload: { from: 'PREPARING', to: 'BUZZING' },
    }));
    await Promise.all([buzzingForTeacher, ...buzzingForStudents]);

    const answers = {
      A: 'A 組勝出答案',
      B: '只屬於 B 組的非勝出答案',
      C: '只屬於 C 組的非勝出答案',
    };
    const activeStudents = [
      { connection: studentA, groupId: 'A', answer: answers.A },
      { connection: studentB, groupId: 'B', answer: answers.B },
      { connection: studentC, groupId: 'C', answer: answers.C },
    ] as const;
    for (const { connection, groupId, answer } of activeStudents) {
      const requestId = `answer-${groupId}`;
      const accepted = connection.messages.waitFor((message) =>
        message.type === 'buzzerResults.submitted' && message.requestId === requestId);
      const ownProgress = connection.messages.waitFor((message) =>
        message.type === 'buzzerResults.ownProgress'
          && message.payload.questions?.[0]?.answerText === answer);
      const teacherUpdate = teacher.messages.waitFor((message) =>
        message.type === 'buzzerResults.teacherProgress'
          && message.payload.questions?.[0]?.groups?.some((group: { groupId: string; submitted: boolean }) =>
            group.groupId === groupId && group.submitted));
      connection.socket.send(JSON.stringify({
        type: 'buzzerResults.submitAnswer', requestId,
        payload: { questionId: '1', answerText: answer },
      }));
      await Promise.all([
        expect(accepted).resolves.toMatchObject({
          requestId, payload: { questionId: '1', accepted: true, locked: true },
        }),
        ownProgress,
        teacherUpdate,
      ]);
    }

    const studentAReconnected = await connect(port);
    studentAReconnected.socket.send(JSON.stringify({
      type: 'student.join', requestId: 'reconnect-A', payload: { groupId: 'A' },
    }));
    await studentAReconnected.messages.waitFor((message) =>
      message.type === 'student.joined' && message.requestId === 'reconnect-A');
    await expect(studentAReconnected.messages.waitFor((message) => message.type === 'buzzerResults.ownProgress'))
      .resolves.toMatchObject({ payload: { questions: [
        { questionId: '1', submitted: true, answerText: answers.A, locked: true },
      ] } });

    const buzzingConnections = [studentA, studentB, studentC, studentAReconnected];
    const assertOwnProgressOnly = (connection: Awaited<ReturnType<typeof connect>>, ownAnswer: string) => {
      const ownProgressMessages = connection.messages.all.filter((message) =>
        message.type === 'buzzerResults.ownProgress');
      expect(ownProgressMessages.length).toBeGreaterThan(0);
      for (const message of ownProgressMessages) {
        expect(message.payload.questions).toEqual([
          { questionId: '1', submitted: true, answerText: ownAnswer, locked: true },
        ]);
      }
      expect(connection.messages.all.some((message) => message.type === 'buzzerResults.teacherProgress')).toBe(false);
      expect(connection.messages.all.some((message) => message.type === 'buzzerResults.studentResults')).toBe(false);
      expect(JSON.stringify(ownProgressMessages)).not.toContain('winningGroupId');
      expect(JSON.stringify(ownProgressMessages)).not.toContain('winningAnswer');
    };
    assertOwnProgressOnly(studentA, answers.A);
    assertOwnProgressOnly(studentB, answers.B);
    assertOwnProgressOnly(studentC, answers.C);
    assertOwnProgressOnly(studentAReconnected, answers.A);
    for (const [connection, ownGroup] of [
      [studentA, 'A'], [studentB, 'B'], [studentC, 'C'], [studentAReconnected, 'A'],
    ] as const) {
      const encodedMessages = JSON.stringify(connection.messages.all);
      for (const [groupId, answer] of Object.entries(answers)) {
        if (groupId !== ownGroup) expect(encodedMessages).not.toContain(answer);
      }
    }

    const endedForTeacher = teacher.messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED');
    const endedForStudents = buzzingConnections.map(({ messages }) => messages.waitFor((message) =>
      message.type === 'activity.phaseChanged' && message.payload.stage === 'ENDED'));
    teacher.socket.send(JSON.stringify({
      type: 'activity.advance', requestId: 'end', payload: { from: 'BUZZING', to: 'ENDED' },
    }));
    await Promise.all([endedForTeacher, ...endedForStudents]);

    const endedStudents = [
      { connection: studentAReconnected, groupId: 'A' },
      { connection: studentB, groupId: 'B' },
      { connection: studentC, groupId: 'C' },
    ] as const;
    const resultWaiters = endedStudents.map(({ connection, groupId }) => {
      const requestId = `results-${groupId}`;
      const results = connection.messages.waitFor((message) =>
        message.type === 'buzzerResults.studentResults' && message.requestId === requestId);
      connection.socket.send(JSON.stringify({
        type: 'buzzerResults.getStudentResults', requestId, payload: {},
      }));
      return results;
    });
    const [resultsA, resultsB, resultsC] = await Promise.all(resultWaiters);
    expect(resultsA.payload.questions).toEqual([{
      questionId: '1', winningGroupId: 'A', winningAnswer: answers.A,
      ownAnswer: answers.A, ownStatus: 'SUBMITTED', ownGroupWon: true,
    }]);
    expect(resultsB.payload.questions).toEqual([{
      questionId: '1', winningGroupId: 'A', winningAnswer: answers.A,
      ownAnswer: answers.B, ownStatus: 'SUBMITTED', ownGroupWon: false,
    }]);
    expect(resultsC.payload.questions).toEqual([{
      questionId: '1', winningGroupId: 'A', winningAnswer: answers.A,
      ownAnswer: answers.C, ownStatus: 'SUBMITTED', ownGroupWon: false,
    }]);
    expect(JSON.stringify(studentB.messages.all)).not.toContain(answers.C);
    expect(JSON.stringify(studentC.messages.all)).not.toContain(answers.B);
    expect(JSON.stringify(studentA.messages.all)).not.toContain(answers.B);
    expect(JSON.stringify(studentA.messages.all)).not.toContain(answers.C);
    expect(JSON.stringify(studentAReconnected.messages.all)).not.toContain(answers.B);
    expect(JSON.stringify(studentAReconnected.messages.all)).not.toContain(answers.C);
  });
});
