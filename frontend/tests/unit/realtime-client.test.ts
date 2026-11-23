import { afterEach, describe, expect, it, vi } from 'vitest';
import { RealtimeClient } from '../../src/realtime/client';
import { StudentSelection, STUDENT_SELECTION_STORAGE_KEY } from '../../src/state/student-selection';

type TestListener = (event: unknown) => void;

class FakeWebSocket {
  readyState = 0;
  readonly sent: string[] = [];
  readonly #listeners = new Map<string, TestListener[]>();

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.#listeners.get(type) ?? [];
    listeners.push(listener);
    this.#listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = 3;
    this.#emit('close', { code: 1000 });
  }

  open(): void {
    this.readyState = 1;
    this.#emit('open', { type: 'open' });
  }

  receive(message: unknown): void {
    this.#emit('message', { data: JSON.stringify(message) });
  }

  #emit(type: string, event: unknown): void {
    for (const listener of this.#listeners.get(type) ?? []) listener(event);
  }
}

describe('RealtimeClient group binding errors', () => {
  afterEach(() => vi.unstubAllGlobals());

  function createInMemoryStudentSelection(): StudentSelection {
    return new StudentSelection({
      getItem: () => null,
      setItem: () => undefined,
      removeItem: () => undefined,
    });
  }

  function createConnectedStudent() {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: createInMemoryStudentSelection(),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({ type: 'student.joined', requestId: 'joined', payload: { ok: true, groupId: 'A' } });
    return { client, socket };
  }

  it('stores the teacher question layouts with top-level question counts', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: createInMemoryStudentSelection(),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });

    client.connect();
    socket.open();
    socket.receive({ type: 'teacher.authenticated', requestId: 'teacher', payload: { ok: true } });
    socket.receive({
      type: 'guidedNotes.snapshot',
      payload: {
        worksheetTitle: '工作表1',
        questionIds: ['1', '2', '3'],
        questionCount: 3,
        questionLayouts: [
          { questionId: '1', kind: 'SINGLE', answerCount: 1 },
          { questionId: '2', kind: 'GROUP', answerCount: 2 },
          { questionId: '3', kind: 'GROUP', answerCount: 4 },
        ],
      },
    });

    expect(client.store.getSnapshot()).toMatchObject({
      worksheetTitle: '工作表1',
      questionIds: ['1', '2', '3'],
      questionCount: 3,
      questionLayouts: [
        { questionId: '1', kind: 'SINGLE', answerCount: 1 },
        { questionId: '2', kind: 'GROUP', answerCount: 2 },
        { questionId: '3', kind: 'GROUP', answerCount: 4 },
      ],
    });
  });

  it('gives students only the question layout summary and keeps worksheet references private', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: createInMemoryStudentSelection(),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });

    client.connect();
    socket.open();
    socket.receive({ type: 'student.joined', requestId: 'join', payload: { ok: true, groupId: 'A' } });
    socket.receive({
      type: 'buzzerResults.questionList',
      payload: {
        questionIds: ['1', '2'],
        questionLayouts: [
          { questionId: '1', kind: 'SINGLE', answerCount: 1 },
          { questionId: '2', kind: 'GROUP', answerCount: 3 },
        ],
      },
    });

    const state = client.store.getSnapshot();
    expect(state).toMatchObject({
      role: 'STUDENT',
      worksheetTitle: null,
      questionIds: ['1', '2'],
      questionCount: 2,
      questionLayouts: [
        { questionId: '1', kind: 'SINGLE', answerCount: 1 },
        { questionId: '2', kind: 'GROUP', answerCount: 3 },
      ],
    });
    expect(state.questionLayouts.every((layout) => Object.keys(layout).sort().join(',')
      === 'answerCount,kind,questionId')).toBe(true);
  });

  it('preserves the joined student role and saved group when a rebind is rejected', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const values = new Map<string, string>();
    const selection = new StudentSelection({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
      removeItem: (key) => { values.delete(key); },
    });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: selection,
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });

    client.connect();
    socket.open();
    socket.receive({ type: 'student.joined', requestId: 'join-a', payload: { ok: true, groupId: 'A' } });
    expect(client.store.getSnapshot()).toMatchObject({ role: 'STUDENT', selectedGroupId: 'A' });
    expect(values.get(STUDENT_SELECTION_STORAGE_KEY)).toBe('A');

    client.join('B');
    const rebindRequestId = JSON.parse(socket.sent.at(-1)!).requestId as string;
    socket.receive({
      type: 'error',
      requestId: rebindRequestId,
      payload: { code: 'GROUP_INVALID', message: '已加入的組別不能變更，請重新連線以恢復原組別。' },
    });

    expect(client.store.getSnapshot()).toMatchObject({ role: 'STUDENT', selectedGroupId: 'A' });
    expect(selection.read()).toBe('A');
  });

  it('sends a complete multibyte group packet at exactly 16 KiB and accepts its acknowledgment', () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    vi.stubGlobal('crypto', { randomUUID: () => requestId });
    const { client, socket } = createConnectedStudent();
    const prefix = '中文「答案」\\\n"';
    const base = {
      type: 'buzzerResults.submitAnswer',
      requestId,
      payload: {
        questionId: '題組G',
        subAnswers: [
          { placeholderNumber: 1, answerText: prefix },
          { placeholderNumber: 2, answerText: '第二格' },
        ],
      },
    };
    const baseBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength;
    const answers = [
      { placeholderNumber: 1, answerText: `${prefix}${'x'.repeat(16_384 - baseBytes)}` },
      { placeholderNumber: 2, answerText: '第二格' },
    ];

    expect(new TextEncoder().encode(JSON.stringify({ ...base, payload: { questionId: '題組G', subAnswers: answers } })).byteLength)
      .toBe(16_384);
    expect(client.submitAnswer('題組G', answers)).toBe(true);
    expect(socket.sent).toHaveLength(1);
    expect(new TextEncoder().encode(socket.sent[0]).byteLength).toBe(16_384);
    expect(JSON.parse(socket.sent[0]!)).toMatchObject({ requestId, payload: { questionId: '題組G', subAnswers: answers } });

    socket.receive({
      type: 'buzzerResults.submitted',
      requestId,
      payload: { questionId: '題組G', accepted: true, locked: true },
    });
    expect(client.buzzerResults.getSnapshot().acceptedSubmission).toMatchObject({ questionId: '題組G', subAnswers: answers });
  });

  it('does not send, pend, accept, or lock an oversized group draft', () => {
    const requestId = '123e4567-e89b-12d3-a456-426614174000';
    vi.stubGlobal('crypto', { randomUUID: () => requestId });
    const { client, socket } = createConnectedStudent();
    const prefix = '含中文\\n"';
    const base = {
      type: 'buzzerResults.submitAnswer',
      requestId,
      payload: {
        questionId: 'G',
        subAnswers: [
          { placeholderNumber: 1, answerText: prefix },
          { placeholderNumber: 2, answerText: 'b' },
        ],
      },
    };
    const baseBytes = new TextEncoder().encode(JSON.stringify(base)).byteLength;
    const answers = [
      { placeholderNumber: 1, answerText: `${prefix}${'x'.repeat(16_385 - baseBytes)}` },
      { placeholderNumber: 2, answerText: 'b' },
    ];

    expect(client.submitAnswer('G', answers)).toBe(false);
    expect(socket.sent).toHaveLength(0);
    expect(client.buzzerResults.getSnapshot()).toMatchObject({
      acceptedSubmission: null,
      ownProgress: [],
      error: { code: 'INVALID_MESSAGE', questionId: 'G' },
    });
    socket.receive({
      type: 'buzzerResults.submitted',
      requestId,
      payload: { questionId: 'G', accepted: true, locked: true },
    });
    expect(client.buzzerResults.getSnapshot().acceptedSubmission).toBeNull();
    expect(client.buzzerResults.getSnapshot().ownProgress).toEqual([]);
  });

  it('uses a fixed 36-byte request ID fallback while preserving the legacy single-answer payload', () => {
    vi.stubGlobal('crypto', {});
    const { client, socket } = createConnectedStudent();
    expect(client.submitAnswer('1', 'legacy answer')).toBe(true);
    const message = JSON.parse(socket.sent[0]!) as { requestId: string; payload: unknown };
    expect(message.requestId).toMatch(/^[A-Za-z0-9_-]{36}$/);
    expect(message.payload).toEqual({ questionId: '1', answerText: 'legacy answer' });
  });

  it('decodes teacher, own-progress, and ended student group vectors', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const teacherSocket = new FakeWebSocket();
    const teacher = new RealtimeClient({
      studentSelection: createInMemoryStudentSelection(),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => teacherSocket as unknown as WebSocket,
    });
    teacher.connect();
    teacherSocket.open();
    teacherSocket.receive({ type: 'teacher.authenticated', requestId: 'teacher', payload: { ok: true } });
    teacherSocket.receive({ type: 'buzzerResults.teacherProgress', payload: { questions: [{
      questionId: 'G',
      groups: [{ groupId: 'A', submitted: true, rank: 1, answerText: null, answers: [
        { placeholderNumber: 1, answerText: 'A1' },
        { placeholderNumber: 2, answerText: 'A2' },
      ] }],
      winningGroupId: 'A',
      winningAnswer: null,
      winningAnswers: [
        { placeholderNumber: 1, answerText: 'A1' },
        { placeholderNumber: 2, answerText: 'A2' },
      ],
    }] } });
    expect(teacher.buzzerResults.getSnapshot().teacherProgress?.questions[0]?.winningAnswers).toEqual([
      { placeholderNumber: 1, answerText: 'A1' },
      { placeholderNumber: 2, answerText: 'A2' },
    ]);

    const studentSocket = new FakeWebSocket();
    const student = new RealtimeClient({
      studentSelection: createInMemoryStudentSelection(),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => studentSocket as unknown as WebSocket,
    });
    student.connect();
    studentSocket.open();
    studentSocket.receive({ type: 'student.joined', requestId: 'joined', payload: { ok: true, groupId: 'A' } });
    studentSocket.receive({ type: 'buzzerResults.questionList', payload: {
      questionIds: ['G'], questionLayouts: [{ questionId: 'G', kind: 'GROUP', answerCount: 2 }],
    } });
    studentSocket.receive({ type: 'buzzerResults.ownProgress', payload: { questions: [{
      questionId: 'G', submitted: true, answerText: null, locked: true, answers: [
        { placeholderNumber: 1, answerText: 'A1' },
        { placeholderNumber: 2, answerText: 'A2' },
      ],
    }], submittedCount: 1, totalQuestionCount: 1 } });
    expect(student.buzzerResults.getSnapshot().ownProgress[0]?.answers).toEqual([
      { placeholderNumber: 1, answerText: 'A1' },
      { placeholderNumber: 2, answerText: 'A2' },
    ]);
    studentSocket.receive({ type: 'buzzerResults.studentResults', requestId: 'results', payload: { questions: [{
      questionId: 'G',
      winningGroupId: 'A',
      winningAnswer: null,
      winningAnswers: [
        { placeholderNumber: 1, answerText: 'A1' },
        { placeholderNumber: 2, answerText: 'A2' },
      ],
      ownAnswer: null,
      ownAnswers: [
        { placeholderNumber: 1, answerText: 'A1' },
        { placeholderNumber: 2, answerText: 'A2' },
      ],
      ownStatus: 'SUBMITTED',
      ownGroupWon: true,
      groups: [{ groupId: 'A', submitted: true, rank: 1 }],
    }] } });
    expect(student.buzzerResults.getSnapshot().studentResults?.questions[0]?.ownAnswers).toEqual([
      { placeholderNumber: 1, answerText: 'A1' },
      { placeholderNumber: 2, answerText: 'A2' },
    ]);
  });

  it('resets the teacher time limit and clears cached results after a successful import', () => {
    vi.stubGlobal('WebSocket', { OPEN: 1, CLOSING: 2 });
    const socket = new FakeWebSocket();
    const client = new RealtimeClient({
      studentSelection: createInMemoryStudentSelection(),
      location: { protocol: 'http:', host: 'localhost' },
      createSocket: () => socket as unknown as WebSocket,
    });
    client.connect();
    socket.open();
    socket.receive({ type: 'teacher.authenticated', requestId: 'teacher', payload: { ok: true } });
    client.store.update({ stage: 'PREPARING', timeLimitSeconds: 45, remainingSeconds: null });
    client.buzzerResults.applyQuestionList(['old-question']);
    client.buzzerResults.applyAccepted('old-question', 'old answer');
    client.buzzerResults.applyTeacherProgress({ questions: [{
      questionId: 'old-question',
      groups: [],
      winningGroupId: 'old-group',
      winningAnswer: 'old answer',
      judgement: 'CORRECT',
    }] });
    client.buzzerResults.applyScoreboard([{ rank: 1, groupId: 'old-group', score: 1, successfulQuestionCount: 1 }]);

    socket.receive({
      type: 'guidedNotes.imported',
      requestId: 'import',
      payload: { worksheetTitle: '新工作表', questionIds: ['new-question'], questionCount: 1 },
    });

    expect(client.store.getSnapshot()).toMatchObject({
      worksheetTitle: '新工作表',
      questionIds: ['new-question'],
      questionCount: 1,
      timeLimitSeconds: 0,
      remainingSeconds: null,
    });
    expect(client.buzzerResults.getSnapshot()).toMatchObject({
      questionIds: ['new-question'],
      ownProgress: [],
      acceptedSubmission: null,
      teacherProgress: null,
      scoreboard: null,
      submittedCount: 0,
    });
  });

  it('clears a student’s cached results when a successful import sends the new question list', () => {
    const { client, socket } = createConnectedStudent();
    client.buzzerResults.applyQuestionList(['old-question']);
    client.buzzerResults.applyOwnProgress([{
      questionId: 'old-question', submitted: true, answerText: 'old answer', locked: true,
    }], 1, 1);
    client.buzzerResults.applyStudentResults({ questions: [] });
    client.buzzerResults.applyScoreboard([{ rank: 1, groupId: 'old-group', score: 1, successfulQuestionCount: 1 }]);

    socket.receive({
      type: 'buzzerResults.questionList',
      payload: { questionIds: ['new-question'] },
    });

    expect(client.buzzerResults.getSnapshot()).toMatchObject({
      questionIds: ['new-question'],
      ownProgress: [],
      studentResults: null,
      scoreboard: null,
      submittedCount: 0,
      totalQuestionCount: 1,
    });
  });
});
